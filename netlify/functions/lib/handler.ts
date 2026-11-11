import { accessFor, canEdit, canRead, isOwner } from '../../../src/shared/access';
import {
  DEMO_PASSWORD, MAX_ATTACHMENTS_PER_DOC, MAX_ATTACHMENT_BYTES, MAX_UPLOAD_BYTES, SEED_USERS,
  type AccessRequestView, type DocRecord, type DocView, type Share, type User,
} from '../../../src/shared/types';
import { clearCookie, sessionCookie, signSession, userIdFromRequest } from './auth';
import { HttpError } from './errors';
import { fileToHtml, titleFromFilename } from './importer';
import { hashPassword, verifyPassword } from './password';
import type { Repo } from './repo';
import { sanitize } from './sanitize';
import {
  UUID_RE, USER_ID_RE, createDocSchema, loginSchema, parse, patchDocSchema, readJson, readUpload,
  requestSchema, shareSchema, signupSchema, validateAttachment,
} from './validate';
import type { ImageFetcher } from './net';

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

const DEFAULT_TITLE = 'Untitled document';
const BLANK_HTML = '<p></p>';
const isUntouchedBlank = (d: DocRecord) =>
  d.title === DEFAULT_TITLE && d.contentHtml === BLANK_HTML && d.version === 1 && d.sharedWith.length === 0;

export interface HandlerDeps {
  repo: Repo;
  secret: string;
  fetchImage?: ImageFetcher; // injectable for tests
}

// Best-effort brute-force throttle (per server instance; documented limitation).
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60_000;
const DUMMY_HASH = hashPassword('not-a-real-password'); // equalizes timing for unknown emails

let demoHashes: Promise<Map<string, string>> | null = null;
const getDemoHashes = () => (demoHashes ??= (async () => {
  const m = new Map<string, string>();
  for (const u of SEED_USERS) m.set(u.id, await hashPassword(DEMO_PASSWORD));
  return m;
})());

export function createHandler({ repo, secret, fetchImage }: HandlerDeps) {
  let seeded = false;
  const failures = new Map<string, { n: number; until: number }>();

  async function seed() {
    if (seeded) return;
    const hashes = await getDemoHashes();
    for (const u of SEED_USERS) {
      const hash = hashes.get(u.id)!;
      // New database: create. Existing demo user from before passwords existed: repair in place.
      if ((await repo.createUser({ ...u, passwordHash: hash })) === 'duplicate') await repo.setPasswordHashIfMissing(u.id, hash);
    }
    seeded = true;
  }

  async function view(doc: DocRecord, me: User): Promise<DocView> {
    const access = accessFor(doc, me.id)!;
    const owner = await repo.getUser(doc.ownerId);
    let sharedWith: Share[] = [];
    let accessRequests: AccessRequestView[] = [];
    if (access === 'owner') {
      sharedWith = await Promise.all(doc.sharedWith.map(async (s) => {
        const u = await repo.getUser(s.userId);
        return { ...s, name: u?.name ?? 'Unknown user', email: u?.email };
      }));
      accessRequests = await Promise.all(doc.accessRequests.map(async (r) => {
        const u = await repo.getUser(r.userId);
        return { ...r, name: u?.name ?? 'Unknown user', email: u?.email ?? '' };
      }));
    }
    return {
      ...doc, sharedWith, accessRequests, access,
      ownerName: owner?.name ?? 'Unknown',
      hasRequested: access === 'viewer' && doc.accessRequests.some((r) => r.userId === me.id),
    };
  }

  async function loadDoc(id: string, userId: string) {
    // 404 (not 403) for strangers and malformed ids so existence isn't leaked
    const doc = UUID_RE.test(id) ? await repo.getDoc(id) : null;
    if (!doc || !canRead(accessFor(doc, userId))) throw new HttpError(404, 'Document not found.');
    return doc;
  }

  async function login(req: Request, secure: boolean) {
    const { email, password } = parse(loginSchema, await readJson(req));
    const f = failures.get(email);
    if (f && f.until > Date.now()) throw new HttpError(429, 'Too many failed attempts. Please try again in a few minutes.');
    const user = await repo.getUserByEmail(email);
    const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !ok) {
      const n = (f?.n ?? 0) + 1;
      failures.set(email, n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 });
      throw new HttpError(401, 'Invalid email or password.');
    }
    failures.delete(email);
    const pub: User = { id: user.id, email: user.email, name: user.name };
    return json(pub, 200, { 'set-cookie': sessionCookie(await signSession(user.id, secret), secure) });
  }

  async function signup(req: Request, secure: boolean) {
    const body = parse(signupSchema, await readJson(req));
    const user = { id: `u_${crypto.randomUUID()}`, email: body.email, name: body.name, passwordHash: await hashPassword(body.password) };
    if ((await repo.createUser(user)) === 'duplicate') {
      throw new HttpError(409, 'An account with this email already exists.', { email: 'An account with this email already exists.' });
    }
    const pub: User = { id: user.id, email: user.email, name: user.name };
    return json(pub, 201, { 'set-cookie': sessionCookie(await signSession(user.id, secret), secure) });
  }

  return async function handle(req: Request): Promise<Response> {
    try {
      await seed();
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/api/, '').replace(/\/index\.html?$/, '').replace(/\/+$/, '') || '/'; // index.htm: `netlify dev` proxy quirk
      const method = req.method;
      const secure = url.protocol === 'https:';
      const seg = path.split('/').filter(Boolean);

      // ---- public ----
      if (method === 'POST' && path === '/login') return await login(req, secure);
      if (method === 'POST' && path === '/signup') return await signup(req, secure);
      if (method === 'POST' && path === '/logout') return json({ ok: true }, 200, { 'set-cookie': clearCookie(secure) });

      // ---- authenticated ----
      const userId = await userIdFromRequest(req, secret);
      const me = userId ? await repo.getUser(userId) : null;
      if (!me) throw new HttpError(401, 'Please sign in.');

      if (method === 'GET' && path === '/me') return json(me);

      if (seg[0] !== 'documents') throw new HttpError(404, 'Not found.');

      // ---- /documents ----
      if (seg.length === 1) {
        if (method === 'GET') {
          const docs = await Promise.all((await repo.listDocsFor(me.id)).map((d) => view(d, me)));
          return json({ owned: docs.filter((d) => d.access === 'owner'), shared: docs.filter((d) => d.access !== 'owner') });
        }
        if (method === 'POST') {
          const body = parse(createDocSchema, await readJson(req).catch((e) => (e instanceof HttpError && e.status === 415 ? {} : Promise.reject(e))));
          // Idempotent "new blank doc": reuse an untouched blank draft instead of piling up empty files.
          if (!body.title) {
            const blank = (await repo.listDocsFor(me.id)).find((d) => d.ownerId === me.id && isUntouchedBlank(d));
            if (blank) return json(await view(blank, me), 200);
          }
          const doc = newDoc(me.id, body.title ?? DEFAULT_TITLE, BLANK_HTML);
          await repo.createDoc(doc);
          return json(await view(doc, me), 201);
        }
        throw new HttpError(405, 'Method not allowed.');
      }

      // POST /documents/import → new document from a file
      if (seg.length === 2 && seg[1] === 'import' && method === 'POST') {
        const file = await readUpload(req, MAX_UPLOAD_BYTES, 'File is too large (max 2 MB).');
        const imp = await fileToHtml(file.name, new Uint8Array(await file.arrayBuffer()), { fetchImage });
        const title = (imp.title?.trim() || titleFromFilename(file.name)).slice(0, 200);
        const doc = newDoc(me.id, title, imp.html);
        await repo.createDoc(doc);
        return json({ ...(await view(doc, me)), warnings: imp.warnings }, 201);
      }

      const id = seg[1];
      const doc = await loadDoc(id, me.id);
      const access = accessFor(doc, me.id);
      const sub = seg[2];

      // ---- /documents/:id ----
      if (!sub) {
        if (method === 'GET') return json(await view(doc, me));

        if (method === 'PATCH') {
          if (!canEdit(access)) throw new HttpError(403, 'You have view-only access to this document.');
          const { version, title, contentHtml } = parse(patchDocSchema, await readJson(req));
          const result = await repo.updateDoc(id, version, {
            ...(title !== undefined && { title }),
            ...(contentHtml !== undefined && { contentHtml: sanitize(contentHtml) }),
          });
          if (result === 'conflict') throw new HttpError(409, 'This document was changed by someone else. Reload to get the latest version.');
          if (!result) throw new HttpError(404, 'Document not found.');
          return json(await view(result, me));
        }

        if (method === 'DELETE') {
          if (!isOwner(access)) throw new HttpError(403, 'Only the owner can delete a document.');
          await repo.deleteAttachmentsFor(id);
          await repo.deleteDoc(id);
          return json({ ok: true });
        }
        throw new HttpError(405, 'Method not allowed.');
      }

      // ---- sharing (owner only) ----
      if (sub === 'share') {
        if (!isOwner(access)) throw new HttpError(403, 'Only the owner can manage sharing.');
        if (method === 'POST' && seg.length === 3) {
          const body = parse(shareSchema, await readJson(req));
          const target = await repo.getUserByEmail(body.email);
          if (!target) throw new HttpError(404, 'No user with that email.', { email: 'No user with that email.' });
          if (target.id === me.id) throw new HttpError(400, 'You already own this document.', { email: 'You already own this document.' });
          return json(await view((await repo.setShare(id, target.id, body.role))!, me));
        }
        if (method === 'DELETE' && seg.length === 4) {
          if (!USER_ID_RE.test(seg[3])) throw new HttpError(400, 'Invalid user id.');
          return json(await view((await repo.removeShare(id, seg[3]))!, me));
        }
        throw new HttpError(405, 'Method not allowed.');
      }

      // ---- edit-access requests ----
      if (sub === 'access-requests') {
        if (method === 'POST' && seg.length === 3) {
          if (access !== 'viewer') {
            throw new HttpError(400, access === 'owner' || access === 'editor' ? 'You already have edit access.' : 'Not found.');
          }
          const { message } = parse(requestSchema, await readJson(req).catch(() => ({})));
          // Repeat request without a new message: keep the original request (and its message) untouched.
          if (!message && doc.accessRequests.some((r) => r.userId === me.id)) return json(await view(doc, me));
          return json(await view((await repo.addAccessRequest(id, me.id, message || undefined))!, me));
        }
        if (seg.length === 4 || (seg.length === 5 && seg[4] === 'approve')) {
          if (!isOwner(access)) throw new HttpError(403, 'Only the owner can respond to access requests.');
          const target = seg[3];
          if (!USER_ID_RE.test(target)) throw new HttpError(400, 'Invalid user id.');
          if (!doc.accessRequests.some((r) => r.userId === target)) throw new HttpError(404, 'No pending request from that user.');
          if (method === 'POST' && seg[4] === 'approve') {
            // setShare also clears the pending request atomically
            return json(await view((await repo.setShare(id, target, 'editor'))!, me));
          }
          if (method === 'DELETE' && seg.length === 4) {
            return json(await view((await repo.removeAccessRequest(id, target))!, me));
          }
        }
        throw new HttpError(405, 'Method not allowed.');
      }

      // ---- import a file into this draft (returns HTML; client inserts it, autosave persists) ----
      if (sub === 'import' && method === 'POST' && seg.length === 3) {
        if (!canEdit(access)) throw new HttpError(403, 'You have view-only access to this document.');
        const file = await readUpload(req, MAX_UPLOAD_BYTES, 'File is too large (max 2 MB).');
        return json(await fileToHtml(file.name, new Uint8Array(await file.arrayBuffer()), { fetchImage }));
      }

      // ---- attachments ----
      if (sub === 'attachments') {
        if (method === 'GET' && seg.length === 3) return json(await repo.listAttachments(id));

        if (method === 'POST' && seg.length === 3) {
          if (!canEdit(access)) throw new HttpError(403, 'You have view-only access to this document.');
          const file = await readUpload(req, MAX_ATTACHMENT_BYTES, 'Attachment is too large (max 5 MB).');
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { name, mime } = validateAttachment(file.name, bytes);
          if ((await repo.listAttachments(id)).length >= MAX_ATTACHMENTS_PER_DOC) {
            throw new HttpError(409, `A document can have at most ${MAX_ATTACHMENTS_PER_DOC} attachments.`);
          }
          const meta = { id: crypto.randomUUID(), docId: id, name, size: bytes.byteLength, mime, uploadedBy: me.id, createdAt: new Date().toISOString() };
          await repo.addAttachment(meta, bytes);
          return json(meta, 201);
        }

        if (seg.length === 4) {
          const aid = seg[3];
          if (!UUID_RE.test(aid)) throw new HttpError(404, 'Attachment not found.');
          if (method === 'GET') {
            const a = await repo.getAttachment(id, aid);
            if (!a) throw new HttpError(404, 'Attachment not found.');
            return new Response(a.data as BodyInit, {
              headers: {
                'content-type': a.mime,
                'content-length': String(a.size),
                // always download, never render inline; nosniff so a hostile upload can't be reinterpreted
                'content-disposition': `attachment; filename="${a.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
                'x-content-type-options': 'nosniff',
                'cache-control': 'private, no-store',
              },
            });
          }
          if (method === 'DELETE') {
            if (!canEdit(access)) throw new HttpError(403, 'You have view-only access to this document.');
            if (!(await repo.deleteAttachment(id, aid))) throw new HttpError(404, 'Attachment not found.');
            return json({ ok: true });
          }
        }
        throw new HttpError(405, 'Method not allowed.');
      }

      throw new HttpError(404, 'Not found.');
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...(err.fields && { fields: err.fields }) }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
    }
  };
}

function newDoc(ownerId: string, title: string, contentHtml: string): DocRecord {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title, contentHtml, ownerId, sharedWith: [], accessRequests: [], version: 1, createdAt: now, updatedAt: now };
}
