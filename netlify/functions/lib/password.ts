import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, (e, k) => (e ? rej(e) : res(k))));

/** Format: scrypt$<salt b64>$<hash b64>. Salted, memory-hard, no extra dependency. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const expected = Buffer.from(h, 'base64');
  const actual = await scrypt(password, Buffer.from(s, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}
