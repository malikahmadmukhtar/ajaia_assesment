import type { AttachmentMeta, DocView, ImportResponse, Role, User } from './shared/types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) { super(message); }
}

async function raw(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body instanceof FormData || body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Network error. Check your connection and try again.');
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await raw(method, path, body);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.fields);
  return data as T;
}

const form = (file: File) => { const f = new FormData(); f.set('file', file); return f; };

export const api = {
  me: () => req<User>('GET', '/me'),
  login: (email: string, password: string) => req<User>('POST', '/login', { email, password }),
  signup: (name: string, email: string, password: string) => req<User>('POST', '/signup', { name, email, password }),
  logout: () => req<{ ok: true }>('POST', '/logout'),

  list: () => req<{ owned: DocView[]; shared: DocView[] }>('GET', '/documents'),
  create: (title?: string) => req<DocView>('POST', '/documents', { title }),
  import: (file: File) => req<DocView & { warnings: string[] }>('POST', '/documents/import', form(file)),
  get: (id: string) => req<DocView>('GET', `/documents/${id}`),
  update: (id: string, version: number, patch: { title?: string; contentHtml?: string }) =>
    req<DocView>('PATCH', `/documents/${id}`, { version, ...patch }),
  remove: (id: string) => req<{ ok: true }>('DELETE', `/documents/${id}`),

  share: (id: string, email: string, role: Role) => req<DocView>('POST', `/documents/${id}/share`, { email, role }),
  unshare: (id: string, userId: string) => req<DocView>('DELETE', `/documents/${id}/share/${userId}`),

  requestEdit: (id: string, message?: string) => req<DocView>('POST', `/documents/${id}/access-requests`, { message }),
  approveRequest: (id: string, userId: string) => req<DocView>('POST', `/documents/${id}/access-requests/${userId}/approve`, {}),
  denyRequest: (id: string, userId: string) => req<DocView>('DELETE', `/documents/${id}/access-requests/${userId}`),

  importInto: (id: string, file: File) => req<ImportResponse>('POST', `/documents/${id}/import`, form(file)),

  attachments: (id: string) => req<AttachmentMeta[]>('GET', `/documents/${id}/attachments`),
  attach: (id: string, file: File) => req<AttachmentMeta>('POST', `/documents/${id}/attachments`, form(file)),
  detach: (id: string, aid: string) => req<{ ok: true }>('DELETE', `/documents/${id}/attachments/${aid}`),
  attachmentUrl: (id: string, aid: string) => `/api/documents/${id}/attachments/${aid}`,
};
