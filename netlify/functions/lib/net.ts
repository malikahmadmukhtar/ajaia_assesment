import { lookup } from 'node:dns/promises';
import { MAX_IMAGE_BYTES } from '../../../src/shared/types';

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (v.includes(':')) {
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // unparseable → refuse
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export type ImageFetcher = (url: string) => Promise<string | null>;

/**
 * Fetches a remote image once at import time and returns it as a data URI, so documents
 * don't depend on third-party hosts. https only, public IPs only, no redirects, 1 MB cap, 5 s timeout.
 * (Residual risk: DNS rebinding between lookup and fetch; acceptable for this scope, noted in docs.)
 */
export const fetchRemoteImage: ImageFetcher = async (urlStr) => {
  let u: URL;
  try { u = new URL(urlStr); } catch { return null; }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return null;
  const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { accept: 'image/*' } });
    if (!res.ok || !res.body) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_IMAGE_BYTES) { ctrl.abort(); return null; }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const mime = sniffImage(bytes);
    return mime ? `data:${mime};base64,${bytes.toString('base64')}` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};
