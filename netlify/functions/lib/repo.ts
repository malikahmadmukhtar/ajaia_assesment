import type { AttachmentMeta, DocRecord, Role, User } from '../../../src/shared/types';

export type UpdateResult = DocRecord | 'conflict' | null;
export interface StoredUser extends User { passwordHash: string }
export type StoredAttachment = AttachmentMeta & { data: Uint8Array };

/** Storage abstraction: Mongo in prod, in-memory fake in tests, JSON file for zero-setup local dev. */
export interface Repo {
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<StoredUser | null>;
  createUser(user: StoredUser): Promise<'ok' | 'duplicate'>;
  /** Used only to repair demo accounts created before passwords existed. */
  setPasswordHashIfMissing(id: string, passwordHash: string): Promise<void>;

  createDoc(doc: DocRecord): Promise<void>;
  getDoc(id: string): Promise<DocRecord | null>;
  listDocsFor(userId: string): Promise<DocRecord[]>;
  /** Atomic compare-and-set on `version`. null = not found, 'conflict' = stale version. */
  updateDoc(id: string, expectedVersion: number, patch: Partial<Pick<DocRecord, 'title' | 'contentHtml'>>): Promise<UpdateResult>;
  deleteDoc(id: string): Promise<boolean>;

  /** Sets (or changes) a share and clears any pending edit request from that user. */
  setShare(id: string, userId: string, role: Role): Promise<DocRecord | null>;
  /** Removes a share and any pending edit request from that user. */
  removeShare(id: string, userId: string): Promise<DocRecord | null>;
  addAccessRequest(id: string, userId: string, message?: string): Promise<DocRecord | null>;
  removeAccessRequest(id: string, userId: string): Promise<DocRecord | null>;

  addAttachment(meta: AttachmentMeta, data: Uint8Array): Promise<void>;
  listAttachments(docId: string): Promise<AttachmentMeta[]>;
  getAttachment(docId: string, id: string): Promise<StoredAttachment | null>;
  deleteAttachment(docId: string, id: string): Promise<boolean>;
  deleteAttachmentsFor(docId: string): Promise<void>;
}

/** Older stored documents predate some fields. */
export const normalizeDoc = (d: DocRecord): DocRecord => ({ ...d, accessRequests: d.accessRequests ?? [], sharedWith: d.sharedWith ?? [] });

export class MemoryRepo implements Repo {
  users = new Map<string, StoredUser>();
  docs = new Map<string, DocRecord>();
  atts = new Map<string, StoredAttachment>();

  async getUser(id: string) {
    const u = this.users.get(id);
    return u ? { id: u.id, email: u.email, name: u.name } : null;
  }
  async getUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async createUser(user: StoredUser) {
    if ([...this.users.values()].some((u) => u.email === user.email || u.id === user.id)) return 'duplicate' as const;
    this.users.set(user.id, { ...user });
    return 'ok' as const;
  }

  async setPasswordHashIfMissing(id: string, passwordHash: string) {
    const u = this.users.get(id);
    if (u && !u.passwordHash) u.passwordHash = passwordHash;
  }

  async createDoc(doc: DocRecord) { this.docs.set(doc.id, structuredClone(doc)); }
  async getDoc(id: string) { const d = this.docs.get(id); return d ? normalizeDoc(structuredClone(d)) : null; }
  async listDocsFor(userId: string) {
    return [...this.docs.values()]
      .filter((d) => d.ownerId === userId || d.sharedWith.some((s) => s.userId === userId))
      .map((d) => normalizeDoc(structuredClone(d)));
  }
  async updateDoc(id: string, expectedVersion: number, patch: Partial<Pick<DocRecord, 'title' | 'contentHtml'>>) {
    const d = this.docs.get(id);
    if (!d) return null;
    if (d.version !== expectedVersion) return 'conflict' as const;
    Object.assign(d, patch, { version: d.version + 1, updatedAt: new Date().toISOString() });
    return normalizeDoc(structuredClone(d));
  }
  async deleteDoc(id: string) { return this.docs.delete(id); }

  async setShare(id: string, userId: string, role: Role) {
    const d = this.docs.get(id);
    if (!d) return null;
    d.sharedWith = d.sharedWith.filter((s) => s.userId !== userId).concat({ userId, role });
    d.accessRequests = (d.accessRequests ?? []).filter((r) => r.userId !== userId);
    return normalizeDoc(structuredClone(d));
  }
  async removeShare(id: string, userId: string) {
    const d = this.docs.get(id);
    if (!d) return null;
    d.sharedWith = d.sharedWith.filter((s) => s.userId !== userId);
    d.accessRequests = (d.accessRequests ?? []).filter((r) => r.userId !== userId);
    return normalizeDoc(structuredClone(d));
  }
  async addAccessRequest(id: string, userId: string, message?: string) {
    const d = this.docs.get(id);
    if (!d) return null;
    d.accessRequests = (d.accessRequests ?? []).filter((r) => r.userId !== userId)
      .concat({ userId, createdAt: new Date().toISOString(), ...(message && { message }) });
    return normalizeDoc(structuredClone(d));
  }
  async removeAccessRequest(id: string, userId: string) {
    const d = this.docs.get(id);
    if (!d) return null;
    d.accessRequests = (d.accessRequests ?? []).filter((r) => r.userId !== userId);
    return normalizeDoc(structuredClone(d));
  }

  async addAttachment(meta: AttachmentMeta, data: Uint8Array) { this.atts.set(meta.id, { ...meta, data: new Uint8Array(data) }); }
  async listAttachments(docId: string) {
    return [...this.atts.values()].filter((a) => a.docId === docId)
      .map(({ data: _d, ...m }) => m).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async getAttachment(docId: string, id: string) {
    const a = this.atts.get(id);
    return a && a.docId === docId ? a : null;
  }
  async deleteAttachment(docId: string, id: string) {
    const a = this.atts.get(id);
    return a && a.docId === docId ? this.atts.delete(id) : false;
  }
  async deleteAttachmentsFor(docId: string) {
    for (const [k, a] of this.atts) if (a.docId === docId) this.atts.delete(k);
  }
}
