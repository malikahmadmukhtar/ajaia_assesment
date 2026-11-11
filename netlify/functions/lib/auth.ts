import { SignJWT, jwtVerify } from 'jose';

const COOKIE = 'session';
const enc = (s: string) => new TextEncoder().encode(s);

export async function signSession(userId: string, secret: string): Promise<string> {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(enc(secret));
}

export async function userIdFromRequest(req: Request, secret: string): Promise<string | null> {
  const raw = req.headers.get('cookie')?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw.slice(COOKIE.length + 1), enc(secret));
    return typeof payload.uid === 'string' ? payload.uid : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, secure: boolean) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}${secure ? '; Secure' : ''}`;
}
export function clearCookie(secure: boolean) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
