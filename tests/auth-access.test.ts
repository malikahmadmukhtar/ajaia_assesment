import { describe, expect, it } from 'vitest';
import { makeApp } from './helpers';

const signup = (call: ReturnType<typeof makeApp>['call'], over: object = {}) =>
  call(null, 'POST', '/signup', { name: 'Dana Lee', email: 'dana@example.com', password: 'correct horse', ...over });

describe('signup & login', () => {
  it('signs up, logs in, and never leaks the password hash', async () => {
    const { call, handle } = makeApp();
    const s = await signup(call);
    expect(s.status).toBe(201);
    expect(s.data).toMatchObject({ name: 'Dana Lee', email: 'dana@example.com' });
    expect(JSON.stringify(s.data)).not.toMatch(/hash|scrypt|password/i);
    expect(s.headers.get('set-cookie')).toMatch(/HttpOnly/);

    const l = await call(null, 'POST', '/login', { email: ' DANA@example.com ', password: 'correct horse' });
    expect(l.status).toBe(200);
    const cookie = l.headers.get('set-cookie')!.split(';')[0];
    const me = await handle(new Request('http://localhost/api/me', { headers: { cookie } }));
    expect((await me.json()).email).toBe('dana@example.com');
  });

  it('seeded demo accounts can log in', async () => {
    const { call } = makeApp();
    expect((await call(null, 'POST', '/login', { email: 'alice@example.com', password: 'demo1234' })).status).toBe(200);
  });

  it('validates signup fields with per-field messages', async () => {
    const { call } = makeApp();
    const bad = await signup(call, { name: ' ', email: 'nope', password: 'short' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.data.fields).sort()).toEqual(['email', 'name', 'password']);
    expect((await signup(call, { password: 'x'.repeat(129) })).status).toBe(400);
    expect((await signup(call, { password: '        ' })).status).toBe(400);
    expect((await signup(call, { name: '<script>' })).status).toBe(400);
    expect((await call(null, 'POST', '/signup', 'not json' as any)).status).toBe(400);
  });

  it('rejects duplicate emails (case-insensitive) and wrong credentials uniformly', async () => {
    const { call } = makeApp();
    await signup(call);
    expect((await signup(call, { email: 'DANA@example.com' })).status).toBe(409);
    const wrongPw = await call(null, 'POST', '/login', { email: 'dana@example.com', password: 'wrong-password' });
    const noUser = await call(null, 'POST', '/login', { email: 'ghost@example.com', password: 'wrong-password' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.data.error).toBe(noUser.data.error); // no account enumeration
  });

  it('locks an account after repeated failures', async () => {
    const { call } = makeApp();
    for (let i = 0; i < 5; i++) await call(null, 'POST', '/login', { email: 'alice@example.com', password: 'nope-nope' });
    const locked = await call(null, 'POST', '/login', { email: 'alice@example.com', password: 'demo1234' });
    expect(locked.status).toBe(429);
  });

  it('does not expose a public user list', async () => {
    const { call } = makeApp();
    expect((await call(null, 'GET', '/users')).status).toBe(401);
    expect((await call('u_alice', 'GET', '/users')).status).toBe(404);
  });
});

describe('legacy demo accounts', () => {
  it('repairs seeded users that were created before passwords existed', async () => {
    const { createHandler } = await import('../netlify/functions/lib/handler');
    const { MemoryRepo } = await import('../netlify/functions/lib/repo');
    const repo = new MemoryRepo();
    repo.users.set('u_alice', { id: 'u_alice', email: 'alice@example.com', name: 'Alice Johnson', passwordHash: undefined as unknown as string });
    const handle = createHandler({ repo, secret: 'test-secret' });
    const res = await handle(new Request('http://localhost/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'demo1234' }) }));
    expect(res.status).toBe(200);
  });
});

describe('edit-access requests', () => {
  async function sharedViewer() {
    const app = makeApp();
    const { data: doc } = await app.call('u_alice', 'POST', '/documents', { title: 'Spec' });
    await app.call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'bob@example.com', role: 'viewer' });
    return { ...app, id: doc.id as string };
  }

  it('viewer requests; owner sees it, approves; viewer can then edit', async () => {
    const { call, id } = await sharedViewer();
    expect((await call('u_bob', 'PATCH', `/documents/${id}`, { version: 1, title: 'x' })).status).toBe(403);

    const req = await call('u_bob', 'POST', `/documents/${id}/access-requests`, { message: 'Can I fix typos?' });
    expect(req.status).toBe(200);
    expect(req.data.hasRequested).toBe(true);
    expect(req.data.accessRequests).toEqual([]); // collaborators' details are owner-only
    await call('u_bob', 'POST', `/documents/${id}/access-requests`, {}); // idempotent

    const owner = (await call('u_alice', 'GET', `/documents/${id}`)).data;
    expect(owner.accessRequests).toHaveLength(1);
    expect(owner.accessRequests[0]).toMatchObject({ userId: 'u_bob', name: 'Bob Martinez', message: 'Can I fix typos?' });
    expect((await call('u_alice', 'GET', '/documents')).data.owned[0].accessRequests).toHaveLength(1);

    expect((await call('u_bob', 'POST', `/documents/${id}/access-requests/u_bob/approve`)).status).toBe(403); // can't self-approve
    expect((await call('u_alice', 'POST', `/documents/${id}/access-requests/u_bob/approve`)).status).toBe(200);
    expect((await call('u_bob', 'GET', `/documents/${id}`)).data).toMatchObject({ access: 'editor', hasRequested: false });
    expect((await call('u_bob', 'PATCH', `/documents/${id}`, { version: 1, title: 'Fixed' })).status).toBe(200);
  });

  it('owner can deny; the viewer stays read-only and may ask again', async () => {
    const { call, id } = await sharedViewer();
    await call('u_bob', 'POST', `/documents/${id}/access-requests`, {});
    expect((await call('u_alice', 'DELETE', `/documents/${id}/access-requests/u_bob`)).status).toBe(200);
    expect((await call('u_bob', 'GET', `/documents/${id}`)).data).toMatchObject({ access: 'viewer', hasRequested: false });
    expect((await call('u_bob', 'POST', `/documents/${id}/access-requests`, {})).status).toBe(200);
  });

  it('only viewers may request; strangers get 404; approving a missing request 404s', async () => {
    const { call, id } = await sharedViewer();
    expect((await call('u_alice', 'POST', `/documents/${id}/access-requests`, {})).status).toBe(400); // owner
    expect((await call('u_carol', 'POST', `/documents/${id}/access-requests`, {})).status).toBe(404); // stranger
    await call('u_alice', 'POST', `/documents/${id}/share`, { email: 'bob@example.com', role: 'editor' });
    expect((await call('u_bob', 'POST', `/documents/${id}/access-requests`, {})).status).toBe(400); // already editor
    expect((await call('u_alice', 'POST', `/documents/${id}/access-requests/u_carol/approve`)).status).toBe(404);
    expect((await call('u_bob', 'POST', `/documents/${id}/access-requests`, { message: 'x'.repeat(301) })).status).toBe(400);
  });

  it('revoking a share clears the pending request', async () => {
    const { call, id } = await sharedViewer();
    await call('u_bob', 'POST', `/documents/${id}/access-requests`, {});
    await call('u_alice', 'DELETE', `/documents/${id}/share/u_bob`);
    expect((await call('u_alice', 'GET', `/documents/${id}`)).data.accessRequests).toEqual([]);
  });
});

describe('request validation', () => {
  it('rejects malformed ids, bodies and content types without leaking details', async () => {
    const { call, handle } = makeApp();
    expect((await call('u_alice', 'GET', '/documents/not-a-uuid')).status).toBe(404);
    expect((await call('u_alice', 'GET', '/documents/../../etc/passwd')).status).toBe(404);
    const { data: doc } = await call('u_alice', 'POST', '/documents');
    const badType = await handle(new Request(`http://localhost/api/documents/${doc.id}`, {
      method: 'PATCH', headers: { 'content-type': 'text/plain', cookie: `session=${(await (await import('../netlify/functions/lib/auth')).signSession('u_alice', 'test-secret'))}` }, body: '{"version":1,"title":"x"}',
    }));
    expect(badType.status).toBe(415);
    expect((await call('u_alice', 'PATCH', `/documents/${doc.id}`, { version: 'one', title: 'x' })).status).toBe(400);
    expect((await call('u_alice', 'PATCH', `/documents/${doc.id}`, { version: 1, title: 'a'.repeat(201) })).status).toBe(400);
    expect((await call('u_alice', 'PATCH', `/documents/${doc.id}`, { version: 1, title: 'bad\u0007title' })).status).toBe(400);
    expect((await call('u_alice', 'PATCH', `/documents/${doc.id}`, { version: 1, contentHtml: 'x'.repeat(5_000_001) })).status).toBe(400);
    expect((await call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'not-an-email', role: 'editor' })).status).toBe(400);
    expect((await call('u_alice', 'DELETE', `/documents/${doc.id}/share/..%2F..`)).status).toBe(400);
  });
});
