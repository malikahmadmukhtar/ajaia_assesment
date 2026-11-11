import { createHandler } from '../netlify/functions/lib/handler';
import { MemoryRepo } from '../netlify/functions/lib/repo';
import { signSession } from '../netlify/functions/lib/auth';
import type { ImageFetcher } from '../netlify/functions/lib/net';

export const SECRET = 'test-secret';

export function makeApp(fetchImage?: ImageFetcher) {
  const handle = createHandler({ repo: new MemoryRepo(), secret: SECRET, fetchImage });
  async function call(as: string | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (as) headers.cookie = `session=${await signSession(as, SECRET)}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await handle(new Request(`http://localhost/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, headers: res.headers, data: (ct.includes('json') ? await res.json() : null) as any, raw: res };
  }
  async function upload(as: string, path: string, name: string, content: BlobPart) {
    const form = new FormData();
    form.set('file', new File([content], name));
    const res = await handle(new Request(`http://localhost/api${path}`, {
      method: 'POST', headers: { cookie: `session=${await signSession(as, SECRET)}` }, body: form,
    }));
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, data: (ct.includes('json') ? await res.json() : null) as any, raw: res };
  }
  return { handle, call, upload };
}

/** Minimal valid 1x1 PNG. */
export const PNG_BYTES = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
