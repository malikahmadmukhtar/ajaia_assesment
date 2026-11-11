import { describe, expect, it } from 'vitest';
import { PNG_BYTES, makeApp } from './helpers';

const PDF = '%PDF-1.4\n%fake but magic-valid\n';

async function setup() {
  const app = makeApp();
  const { data: doc } = await app.call('u_alice', 'POST', '/documents', { title: 'With files' });
  await app.call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'bob@example.com', role: 'viewer' });
  await app.call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'carol@example.com', role: 'editor' });
  return { ...app, id: doc.id as string, base: `/documents/${doc.id}/attachments` };
}

describe('attachments', () => {
  it('permission matrix: editors upload/delete, viewers list+download only, strangers see nothing', async () => {
    const { call, upload, base, handle } = await setup();
    const up = await upload('u_carol', base, 'plan.pdf', PDF); // editor
    expect(up.status).toBe(201);
    expect(up.data).toMatchObject({ name: 'plan.pdf', mime: 'application/pdf', size: PDF.length });

    expect((await upload('u_bob', base, 'x.pdf', PDF)).status).toBe(403); // viewer
    const list = await call('u_bob', 'GET', base);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).not.toHaveProperty('data');
    expect((await call('u_bob', 'DELETE', `${base}/${up.data.id}`)).status).toBe(403);

    const dl = await call('u_bob', 'GET', `${base}/${up.data.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new TextDecoder().decode(await dl.raw.arrayBuffer())).toBe(PDF);

    expect((await call('u_alice', 'GET', '/documents')).status).toBe(200);
    const stranger = makeApp(); void stranger; void handle;
    const { data: other } = await call('u_alice', 'POST', '/documents', { title: 'Other' });
    expect((await upload('u_bob', `/documents/${other.id}/attachments`, 'x.pdf', PDF)).status).toBe(404);

    expect((await call('u_carol', 'DELETE', `${base}/${up.data.id}`)).status).toBe(200);
    expect((await call('u_bob', 'GET', base)).data).toHaveLength(0);
  });

  it('validates type, magic bytes, size, emptiness and filename', async () => {
    const { upload, base } = await setup();
    expect((await upload('u_alice', base, 'evil.exe', 'MZ')).status).toBe(415);
    expect((await upload('u_alice', base, 'noext', 'x')).status).toBe(415);
    expect((await upload('u_alice', base, 'fake.pdf', 'this is not a pdf')).status).toBe(422);
    expect((await upload('u_alice', base, 'fake.png', 'nope')).status).toBe(422);
    expect((await upload('u_alice', base, 'bin.txt', new Uint8Array([65, 0, 66]))).status).toBe(422);
    expect((await upload('u_alice', base, 'empty.txt', '')).status).toBe(400);
    expect((await upload('u_alice', base, 'big.txt', new Uint8Array(5 * 1024 * 1024 + 1).fill(65))).status).toBe(413);
    const ok = await upload('u_alice', base, '../../etc/pa\u0001ss"wd.png', PNG_BYTES);
    expect(ok.status).toBe(201);
    expect(ok.data.name).toBe('passwd.png'); // path + control chars + quotes stripped
  });

  it('caps attachments per document and cascades on document delete', async () => {
    const { call, upload, base, id } = await setup();
    for (let i = 0; i < 10; i++) expect((await upload('u_alice', base, `f${i}.txt`, `n${i}`)).status).toBe(201);
    expect((await upload('u_alice', base, 'one-too-many.txt', 'x')).status).toBe(409);
    const first = (await call('u_alice', 'GET', base)).data[0];
    await call('u_alice', 'DELETE', `/documents/${id}`);
    expect((await call('u_alice', 'GET', base)).status).toBe(404);
    expect(first.id).toBeTruthy();
  });
});
