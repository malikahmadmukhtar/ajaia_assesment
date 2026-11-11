import { Binary, MongoClient, type Collection } from 'mongodb';
import type { AttachmentMeta, DocRecord, Role, User } from '../../../src/shared/types';
import { normalizeDoc, type Repo, type StoredAttachment, type StoredUser, type UpdateResult } from './repo';

type UserDoc = { _id: string; email: string; name: string; passwordHash: string };
type DocDoc = Omit<DocRecord, 'id'> & { _id: string };
type AttDoc = Omit<AttachmentMeta, 'id'> & { _id: string; data: Binary | Buffer };

/** The driver returns BSON `Binary` by default (Buffer.from(Binary) is empty), so unwrap it explicitly. */
export const binaryToBytes = (v: Binary | Uint8Array): Uint8Array =>
  v instanceof Binary ? new Uint8Array(v.value()) : new Uint8Array(v);

const toUser = (u: UserDoc): User => ({ id: u._id, email: u.email, name: u.name });
const toStored = (u: UserDoc): StoredUser => ({ ...toUser(u), passwordHash: u.passwordHash });
const toDoc = (d: DocDoc): DocRecord => { const { _id, ...rest } = d; return normalizeDoc({ id: _id, ...rest }); };

// Cached at module scope so warm serverless invocations reuse the connection.
let clientPromise: Promise<MongoClient> | null = null;
function client(uri: string) {
  clientPromise ??= new MongoClient(uri, { serverSelectionTimeoutMS: 8000 }).connect().catch((e) => { clientPromise = null; throw e; });
  return clientPromise;
}

export class MongoRepo implements Repo {
  private constructor(private users: Collection<UserDoc>, private docs: Collection<DocDoc>, private atts: Collection<AttDoc>) {}

  static async connect(uri: string): Promise<MongoRepo> {
    const db = (await client(uri)).db(); // db name comes from the URI path
    const repo = new MongoRepo(db.collection<UserDoc>('users'), db.collection<DocDoc>('documents'), db.collection<AttDoc>('attachments'));
    await Promise.all([
      repo.users.createIndex({ email: 1 }, { unique: true }),
      repo.docs.createIndex({ ownerId: 1 }),
      repo.docs.createIndex({ 'sharedWith.userId': 1 }),
      repo.atts.createIndex({ docId: 1 }),
    ]);
    return repo;
  }

  async getUser(id: string) { const u = await this.users.findOne({ _id: id }); return u ? toUser(u) : null; }
  async getUserByEmail(email: string) { const u = await this.users.findOne({ email }); return u ? toStored(u) : null; }
  async createUser(user: StoredUser) {
    try {
      await this.users.insertOne({ _id: user.id, email: user.email, name: user.name, passwordHash: user.passwordHash });
      return 'ok' as const;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return 'duplicate' as const;
      throw e;
    }
  }

  async setPasswordHashIfMissing(id: string, passwordHash: string) {
    await this.users.updateOne({ _id: id, $or: [{ passwordHash: { $exists: false } }, { passwordHash: '' }] }, { $set: { passwordHash } });
  }

  async createDoc(doc: DocRecord) { const { id, ...rest } = doc; await this.docs.insertOne({ _id: id, ...rest }); }
  async getDoc(id: string) { const d = await this.docs.findOne({ _id: id }); return d ? toDoc(d) : null; }
  async listDocsFor(userId: string) {
    const rows = await this.docs
      .find({ $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }] })
      .sort({ updatedAt: -1 })
      .toArray();
    return rows.map(toDoc);
  }

  async updateDoc(id: string, expectedVersion: number, patch: Partial<Pick<DocRecord, 'title' | 'contentHtml'>>): Promise<UpdateResult> {
    const res = await this.docs.findOneAndUpdate(
      { _id: id, version: expectedVersion },
      { $set: { ...patch, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    if (res) return toDoc(res);
    return (await this.docs.countDocuments({ _id: id })) ? 'conflict' : null;
  }

  async deleteDoc(id: string) { return (await this.docs.deleteOne({ _id: id })).deletedCount === 1; }

  async setShare(id: string, userId: string, role: Role) {
    // two-step so the upsert is idempotent without positional-operator edge cases
    await this.docs.updateOne({ _id: id }, { $pull: { sharedWith: { userId } } });
    const res = await this.docs.findOneAndUpdate(
      { _id: id },
      { $push: { sharedWith: { userId, role } }, $pull: { accessRequests: { userId } } },
      { returnDocument: 'after' },
    );
    return res ? toDoc(res) : null;
  }
  async removeShare(id: string, userId: string) {
    const res = await this.docs.findOneAndUpdate(
      { _id: id },
      { $pull: { sharedWith: { userId }, accessRequests: { userId } } },
      { returnDocument: 'after' },
    );
    return res ? toDoc(res) : null;
  }
  async addAccessRequest(id: string, userId: string, message?: string) {
    await this.docs.updateOne({ _id: id }, { $pull: { accessRequests: { userId } } });
    const res = await this.docs.findOneAndUpdate(
      { _id: id },
      { $push: { accessRequests: { userId, createdAt: new Date().toISOString(), ...(message && { message }) } } },
      { returnDocument: 'after' },
    );
    return res ? toDoc(res) : null;
  }
  async removeAccessRequest(id: string, userId: string) {
    const res = await this.docs.findOneAndUpdate({ _id: id }, { $pull: { accessRequests: { userId } } }, { returnDocument: 'after' });
    return res ? toDoc(res) : null;
  }

  async addAttachment(meta: AttachmentMeta, data: Uint8Array) {
    const { id, ...rest } = meta;
    await this.atts.insertOne({ _id: id, ...rest, data: Buffer.from(data) });
  }
  async listAttachments(docId: string) {
    const rows = await this.atts.find({ docId }, { projection: { data: 0 } }).sort({ createdAt: 1 }).toArray();
    return rows.map(({ _id, ...rest }) => ({ id: _id, ...rest }) as AttachmentMeta);
  }
  async getAttachment(docId: string, id: string): Promise<StoredAttachment | null> {
    const a = await this.atts.findOne({ _id: id, docId });
    if (!a) return null;
    const { _id, data, ...rest } = a;
    return { id: _id, ...rest, data: binaryToBytes(data) };
  }
  async deleteAttachment(docId: string, id: string) { return (await this.atts.deleteOne({ _id: id, docId })).deletedCount === 1; }
  async deleteAttachmentsFor(docId: string) { await this.atts.deleteMany({ docId }); }
}
