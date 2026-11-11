export type Role = 'editor' | 'viewer';
export type AccessLevel = 'owner' | Role;

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Share {
  userId: string;
  role: Role;
  /** Populated only in the owner's view of a document. */
  name?: string;
  email?: string;
}

export interface AccessRequest {
  userId: string;
  createdAt: string;
  message?: string;
}

export interface AccessRequestView extends AccessRequest {
  name: string;
  email: string;
}

export interface DocRecord {
  id: string;
  title: string;
  contentHtml: string;
  ownerId: string;
  sharedWith: Share[];
  accessRequests: AccessRequest[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** What the API returns to a client for a given viewer. Collaborator details are owner-only. */
export interface DocView extends Omit<DocRecord, 'accessRequests'> {
  access: AccessLevel;
  ownerName: string;
  /** Owner only: pending edit-access requests with names. */
  accessRequests: AccessRequestView[];
  /** Viewer only: whether I already asked the owner for edit access. */
  hasRequested: boolean;
}

export interface AttachmentMeta {
  id: string;
  docId: string;
  name: string;
  size: number;
  mime: string;
  uploadedBy: string;
  createdAt: string;
}

export interface ImportResponse {
  html: string;
  title?: string;
  warnings: string[];
}

/** Demo accounts for reviewers. Real users sign up; these exist so sharing can be tried instantly. */
export const SEED_USERS: User[] = [
  { id: 'u_alice', email: 'alice@example.com', name: 'Alice Johnson' },
  { id: 'u_bob', email: 'bob@example.com', name: 'Bob Martinez' },
  { id: 'u_carol', email: 'carol@example.com', name: 'Carol Singh' },
];
export const DEMO_PASSWORD = 'demo1234';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // import files
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_DOC = 10;
export const MAX_DOC_BYTES = 5_000_000;
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const SUPPORTED_UPLOADS = ['.txt', '.md', '.docx'] as const;
export const ATTACHMENT_EXTENSIONS = ['.txt', '.md', '.docx', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.csv', '.xlsx', '.pptx'] as const;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
