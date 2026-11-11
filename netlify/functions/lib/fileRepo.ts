import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DocRecord } from '../../../src/shared/types';
import { MemoryRepo, type Repo, type StoredAttachment, type StoredUser } from './repo';

type Persisted = { users: StoredUser[]; docs: DocRecord[]; atts: (Omit<StoredAttachment, 'data'> & { data: string })[] };

/**
 * Local-dev only: a JSON-file store so `netlify dev` works with zero setup
 * (function invocations don't share memory there). Production uses MongoRepo.
 */
export function createFileRepo(file: string): Repo {
  const inner = new MemoryRepo();
  const load = () => {
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Persisted;
    inner.users = new Map(raw.users.map((u) => [u.id, u]));
    inner.docs = new Map(raw.docs.map((d) => [d.id, d]));
    inner.atts = new Map((raw.atts ?? []).map((a) => [a.id, { ...a, data: new Uint8Array(Buffer.from(a.data, 'base64')) }]));
  };
  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    const out: Persisted = {
      users: [...inner.users.values()],
      docs: [...inner.docs.values()],
      atts: [...inner.atts.values()].map((a) => ({ ...a, data: Buffer.from(a.data).toString('base64') })),
    };
    writeFileSync(file, JSON.stringify(out));
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function') return v;
      return async (...args: unknown[]) => { load(); const out = await v.apply(target, args); save(); return out; };
    },
  });
}
