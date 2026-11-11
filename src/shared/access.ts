import type { AccessLevel, DocRecord } from './types';

export function accessFor(doc: Pick<DocRecord, 'ownerId' | 'sharedWith'>, userId: string): AccessLevel | null {
  if (doc.ownerId === userId) return 'owner';
  return doc.sharedWith.find((s) => s.userId === userId)?.role ?? null;
}

export const canRead = (a: AccessLevel | null) => a !== null;
export const canEdit = (a: AccessLevel | null) => a === 'owner' || a === 'editor';
export const isOwner = (a: AccessLevel | null) => a === 'owner';
