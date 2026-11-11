import { ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES, PASSWORD_MAX, PASSWORD_MIN, SUPPORTED_UPLOADS } from './shared/types';

/** Client-side mirrors of the server rules, for instant feedback. The server remains the authority. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const validateEmail = (v: string) =>
  !v.trim() ? 'Email is required.' : v.trim().length > 254 ? 'Email is too long.' : !EMAIL.test(v.trim()) ? 'Enter a valid email address.' : '';
export const validateName = (v: string) =>
  !v.trim() ? 'Name is required.' : v.trim().length > 80 ? 'Name is too long (max 80).' : /[<>\u0000-\u001f]/.test(v) ? 'Name contains invalid characters.' : '';
export const validatePassword = (v: string) =>
  v.length < PASSWORD_MIN ? `Password must be at least ${PASSWORD_MIN} characters.` : v.length > PASSWORD_MAX ? `Password is too long (max ${PASSWORD_MAX}).` : !v.trim() ? 'Password cannot be only spaces.' : '';

const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '');
const mb = (n: number) => `${n / 1024 / 1024} MB`;

export function validateImportFile(f: File): string {
  if (!(SUPPORTED_UPLOADS as readonly string[]).includes(ext(f.name))) return `Unsupported file type. Supported: ${SUPPORTED_UPLOADS.join(', ')}`;
  if (f.size === 0) return 'The file is empty.';
  if (f.size > MAX_UPLOAD_BYTES) return `File is too large (max ${mb(MAX_UPLOAD_BYTES)}).`;
  return '';
}
export function validateAttachmentFile(f: File): string {
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext(f.name))) return `File type not allowed. Allowed: ${ATTACHMENT_EXTENSIONS.join(' ')}`;
  if (f.size === 0) return 'The file is empty.';
  if (f.size > MAX_ATTACHMENT_BYTES) return `Attachment is too large (max ${mb(MAX_ATTACHMENT_BYTES)}).`;
  return '';
}
export function validateImageFile(f: File): string {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return 'Only PNG, JPEG, GIF or WebP images can be inserted.';
  if (f.size > MAX_IMAGE_BYTES) return `Image is too large (max ${mb(MAX_IMAGE_BYTES)}).`;
  return '';
}
export const validateUrl = (v: string) => (/^(https?:\/\/|mailto:)\S+$/i.test(v.trim()) ? '' : 'Enter a full link starting with https://, http:// or mailto:');
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
