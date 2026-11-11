import { beforeEach, describe, expect, it } from 'vitest';
import { createHandler } from '../netlify/functions/lib/handler';
import { MemoryRepo } from '../netlify/functions/lib/repo';
import { signSession } from '../netlify/functions/lib/auth';

const SECRET = 'test-secret';
let handle: ReturnType<typeof createHandler>;

async function call(as: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (as) headers.cookie = `session=${await signSession(as, SECRET)}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await handle(new Request(`http://localhost/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, data: await res.json() as any };
}

beforeEach(() => { handle = createHandler({ repo: new MemoryRepo(), secret: SECRET }); });

describe('sharing & access control', () => {
  it('owner shares; shared user sees it under "shared" with the right role', async () => {
    const { data: doc } = await call('u_alice', 'POST', '/documents', { title: 'Plan' });
    expect((await call('u_bob', 'GET', `/documents/${doc.id}`)).status).toBe(404); // stranger

    expect((await call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'bob@example.com', role: 'viewer' })).status).toBe(200);

    const bobList = (await call('u_bob', 'GET', '/documents')).data;
    expect(bobList.owned).toHaveLength(0);
    expect(bobList.shared[0]).toMatchObject({ id: doc.id, access: 'viewer', ownerName: 'Alice Johnson' });
    expect((await call('u_alice', 'GET', '/documents')).data.owned).toHaveLength(1);
  });

  it('viewer cannot edit, editor can, only owner can share/delete', async () => {
    const { data: doc } = await call('u_alice', 'POST', '/documents');
    await call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'bob@example.com', role: 'viewer' });
    expect((await call('u_bob', 'PATCH', `/documents/${doc.id}`, { version: 1, title: 'Hacked' })).status).toBe(403);

    await call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'bob@example.com', role: 'editor' }); // upgrade (idempotent upsert)
    expect((await call('u_bob', 'PATCH', `/documents/${doc.id}`, { version: 1, title: 'Edited' })).data.title).toBe('Edited');

    expect((await call('u_bob', 'POST', `/documents/${doc.id}/share`, { email: 'carol@example.com', role: 'viewer' })).status).toBe(403);
    expect((await call('u_bob', 'DELETE', `/documents/${doc.id}`)).status).toBe(403);
  });

  it('revoking access hides the document again', async () => {
    const { data: doc } = await call('u_alice', 'POST', '/documents');
    await call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'bob@example.com', role: 'editor' });
    await call('u_alice', 'DELETE', `/documents/${doc.id}/share/u_bob`);
    expect((await call('u_bob', 'GET', `/documents/${doc.id}`)).status).toBe(404);
  });

  it('rejects sharing with self / unknown users / bad roles', async () => {
    const { data: doc } = await call('u_alice', 'POST', '/documents');
    const share = (b: unknown) => call('u_alice', 'POST', `/documents/${doc.id}/share`, b);
    expect((await share({ email: 'alice@example.com', role: 'editor' })).status).toBe(400);
    expect((await share({ email: 'nobody@example.com', role: 'editor' })).status).toBe(404);
    expect((await share({ email: 'bob@example.com', role: 'admin' })).status).toBe(400);
  });
});

describe('documents', () => {
  it('requires authentication', async () => {
    expect((await call(null, 'GET', '/documents')).status).toBe(401);
  });

  it('persists title + content, bumps version, and sanitizes HTML', async () => {
    const { data: doc } = await call('u_alice', 'POST', '/documents');
    const res = await call('u_alice', 'PATCH', `/documents/${doc.id}`, {
      version: 1, title: '  Spec  ', contentHtml: '<h1>Hi</h1><p><strong>b</strong><script>alert(1)</script><img src=x onerror=alert(1)></p>',
    });
    expect(res.data).toMatchObject({ title: 'Spec', version: 2, contentHtml: '<h1>Hi</h1><p><strong>b</strong></p>' });
    expect((await call('u_alice', 'GET', `/documents/${doc.id}`)).data.contentHtml).toContain('<h1>Hi</h1>');
  });

  it('returns 409 on stale version instead of silently overwriting', async () => {
    const { data: doc } = await call('u_alice', 'POST', '/documents');
    await call('u_alice', 'PATCH', `/documents/${doc.id}`, { version: 1, contentHtml: '<p>A</p>' });
    const stale = await call('u_alice', 'PATCH', `/documents/${doc.id}`, { version: 1, contentHtml: '<p>B</p>' });
    expect(stale.status).toBe(409);
    expect((await call('u_alice', 'GET', `/documents/${doc.id}`)).data.contentHtml).toBe('<p>A</p>');
  });

  it('validates input', async () => {
    const { data: doc } = await call('u_alice', 'POST', '/documents');
    expect((await call('u_alice', 'PATCH', `/documents/${doc.id}`, { version: 1, title: '   ' })).status).toBe(400);
    expect((await call('u_alice', 'PATCH', `/documents/${doc.id}`, { version: 1 })).status).toBe(400);
  });
});

describe('creation & deletion', () => {
  it('reuses an untouched blank draft instead of creating duplicates', async () => {
    const a = await call('u_alice', 'POST', '/documents');
    const b = await call('u_alice', 'POST', '/documents');
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.data.id).toBe(a.data.id);
    expect((await call('u_alice', 'GET', '/documents')).data.owned).toHaveLength(1);
    await call('u_alice', 'PATCH', `/documents/${a.data.id}`, { version: 1, contentHtml: '<p>x</p>' });
    expect((await call('u_alice', 'POST', '/documents')).status).toBe(201); // edited draft is not reused
  });

  it('delete removes the document for good, including for collaborators', async () => {
    const { data: doc } = await call('u_alice', 'POST', '/documents');
    await call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'bob@example.com', role: 'editor' });
    expect((await call('u_alice', 'DELETE', `/documents/${doc.id}`)).status).toBe(200);
    expect((await call('u_alice', 'GET', `/documents/${doc.id}`)).status).toBe(404);
    expect((await call('u_bob', 'GET', '/documents')).data.shared).toHaveLength(0);
  });
});

describe('file import', () => {
  async function upload(name: string, content: BlobPart, as = 'u_alice') {
    const form = new FormData();
    form.set('file', new File([content], name));
    const res = await handle(new Request('http://localhost/api/documents/import', {
      method: 'POST', headers: { cookie: `session=${await signSession(as, SECRET)}` }, body: form,
    }));
    return { status: res.status, data: await res.json() as any };
  }

  it('turns markdown into a formatted, owned document', async () => {
    const { status, data } = await upload('Meeting Notes.md', '# Agenda\n\n- one\n- **two**\n');
    expect(status).toBe(201);
    expect(data.title).toBe('Agenda'); // first H1 wins over the filename
    expect(data.access).toBe('owner');
    expect(data.contentHtml).toContain('<h1>Agenda</h1>');
    expect(data.contentHtml).toContain('<li><strong>two</strong></li>');
  });

  it('escapes plain text', async () => {
    const { data } = await upload('a.txt', 'Hello <script>x</script>\n\nSecond');
    expect(data.contentHtml).not.toContain('<script>');
    expect(data.contentHtml).toContain('<p>Second</p>');
  });

  it('imports a real .docx', async () => {
    const JSZip = (await import('jszip')).default;
    const z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold hello</w:t></w:r></w:p></w:body></w:document>');
    const buf = await z.generateAsync({ type: 'uint8array' });
    const { status, data } = await upload('report.docx', buf as BlobPart);
    expect(status).toBe(201);
    expect(data.contentHtml).toContain('<strong>Bold hello</strong>');
  });

  it('rejects unsupported, empty, oversized and corrupt files', async () => {
    expect((await upload('a.pdf', 'x')).status).toBe(415);
    expect((await upload('a.txt', '')).status).toBe(400);
    expect((await upload('a.txt', new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await upload('bad.docx', 'not a zip')).status).toBe(422);
  });
});
