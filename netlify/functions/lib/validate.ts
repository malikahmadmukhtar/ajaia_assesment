import { z } from 'zod';
import {
  ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_BYTES, MAX_DOC_BYTES, PASSWORD_MAX, PASSWORD_MIN,
} from '../../../src/shared/types';
import { HttpError } from './errors';

const noControl = (s: string) => !/[\u0000-\u001f\u007f]/.test(s);
const noMarkup = (s: string) => !/[<>]/.test(s);

export const emailField = z
  .string({ error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .pipe(z.email('Enter a valid email address.'));

export const passwordField = z
  .string({ error: 'Password is required.' })
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Password is too long (max ${PASSWORD_MAX}).`)
  .refine((s) => s.trim().length > 0, 'Password cannot be only spaces.');

export const nameField = z
  .string({ error: 'Name is required.' })
  .trim()
  .min(1, 'Name is required.')
  .max(80, 'Name is too long (max 80).')
  .refine(noControl, 'Name contains invalid characters.')
  .refine(noMarkup, 'Name cannot contain < or >.');

export const titleField = z
  .string({ error: 'Title is required.' })
  .trim()
  .min(1, 'Title cannot be empty.')
  .max(200, 'Title is too long (max 200).')
  .refine(noControl, 'Title contains invalid characters.');

export const signupSchema = z.object({ name: nameField, email: emailField, password: passwordField });
export const loginSchema = z.object({
  email: z.string({ error: 'Email is required.' }).trim().toLowerCase().min(1, 'Email is required.').max(254),
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.').max(PASSWORD_MAX, 'Invalid email or password.'),
});
export const createDocSchema = z.object({ title: titleField.optional() });
export const patchDocSchema = z
  .object({
    version: z.number({ error: 'version is required.' }).int('version must be an integer.').nonnegative('version must be ≥ 0.'),
    title: titleField.optional(),
    contentHtml: z.string({ error: 'contentHtml must be a string.' }).max(MAX_DOC_BYTES, 'Document is too large (max 5 MB).').optional(),
  })
  .refine((v) => v.title !== undefined || v.contentHtml !== undefined, { message: 'Nothing to update.' });
export const shareSchema = z.object({
  email: emailField,
  role: z.enum(['editor', 'viewer'], { error: 'Role must be "editor" or "viewer".' }),
});
export const requestSchema = z.object({
  message: z.string().trim().max(300, 'Message is too long (max 300).').refine(noControl.bind(null), 'Message contains invalid characters.').optional(),
});

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const USER_ID_RE = /^u_[A-Za-z0-9_-]{1,64}$/;

/** Validates with zod and throws a 400 carrying a per-field error map the UI can render inline. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
  throw new HttpError(400, r.error.issues[0].message, fields);
}

const MAX_BODY = 6_500_000; // Netlify's request cap is ~6 MB; reject early with a clear message.

export async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'Request is too large.');
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json.');
  try { return await req.json(); } catch { throw new HttpError(400, 'Request body must be valid JSON.'); }
}

export async function readUpload(req: Request, maxBytes: number, tooBig: string): Promise<File> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes + 100_000) throw new HttpError(413, tooBig);
  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) throw new HttpError(415, 'Upload as multipart/form-data.');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Attach a file in the "file" field.');
  if (file.size === 0) throw new HttpError(400, 'The file is empty.');
  if (file.size > maxBytes) throw new HttpError(413, tooBig);
  return file;
}

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  '.pdf': (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  '.png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  '.docx': (b) => b[0] === 0x50 && b[1] === 0x4b,
  '.xlsx': (b) => b[0] === 0x50 && b[1] === 0x4b,
  '.pptx': (b) => b[0] === 0x50 && b[1] === 0x4b,
};

export const MIME_BY_EXT: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function cleanFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '').trim().slice(-150);
  return cleaned || 'file';
}

/** Extension allowlist + magic-byte check, so a renamed executable can't masquerade as a PDF. */
export function validateAttachment(name: string, bytes: Uint8Array): { name: string; mime: string } {
  const clean = cleanFilename(name);
  const ext = clean.includes('.') ? clean.slice(clean.lastIndexOf('.')).toLowerCase() : '';
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new HttpError(415, `File type not allowed. Allowed: ${ATTACHMENT_EXTENSIONS.join(', ')}`);
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'Attachment is too large (max 5 MB).');
  const check = MAGIC[ext];
  if (check && !check(bytes)) throw new HttpError(422, `This file doesn't look like a valid ${ext} file.`);
  if (['.txt', '.md', '.csv'].includes(ext) && bytes.subarray(0, 4096).includes(0)) throw new HttpError(422, `This file doesn't look like a valid ${ext} text file.`);
  return { name: clean, mime: MIME_BY_EXT[ext] };
}
