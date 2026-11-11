import JSZip from 'jszip';
import { generateHTML, generateJSON } from '@tiptap/html/server';
import { describe, expect, it } from 'vitest';
import { buildExtensions } from '../src/shared/extensions';
import { fileToHtml } from '../netlify/functions/lib/importer';
import { isPrivateIp } from '../netlify/functions/lib/net';
import { sanitize } from '../netlify/functions/lib/sanitize';
import { PNG_BYTES, makeApp } from './helpers';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const para = (inner: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
const run = (t: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const listPara = (t: string, numId: number, lvl = 0) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(t)}</w:p>`;

async function richDocx(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pic.png"/><Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/docs" TargetMode="External"/></Relationships>`);
  z.file('word/media/pic.png', PNG_BYTES);
  z.file('word/styles.xml', `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style></w:styles>`);
  z.file('word/numbering.xml', `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`);
  z.file('word/footnotes.xml', `<?xml version="1.0"?><w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:t>The footnote text.</w:t></w:r></w:p></w:footnote></w:footnotes>`);
  const image = `<w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="p" descr="A tiny picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const cell = (t: string, extra = '') => `<w:tc><w:tcPr>${extra}</w:tcPr>${para(run(t))}</w:tc>`;
  const body = [
    para(run('Project Report'), 'Heading1'),
    para(run('Overview'), 'Heading2'),
    para(run('Bold ', '<w:b/>') + run('italic ', '<w:i/>') + run('underline ', '<w:u w:val="single"/>') + run('struck', '<w:strike/>')),
    para(`<w:hyperlink r:id="rIdLink">${run('our docs')}</w:hyperlink>` + `<w:r><w:footnoteReference w:id="1"/></w:r>`),
    listPara('Bullet one', 1), listPara('Nested bullet', 1, 1), listPara('Step one', 2), listPara('Step two', 2),
    para(run('A wise quote'), 'Quote'),
    `<w:tbl><w:tr>${cell('Name')}${cell('Score')}</w:tr><w:tr>${cell('Ann')}${cell('9')}</w:tr><w:tr>${cell('Merged', '<w:gridSpan w:val="2"/>')}</w:tr></w:tbl>`,
    para(image),
  ].join('');
  z.file('word/document.xml', `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  return z.generateAsync({ type: 'uint8array' });
}

/** Every node/mark type present in a ProseMirror JSON tree. */
function types(node: any, acc = new Set<string>()): Set<string> {
  if (node.type) acc.add(node.type);
  node.marks?.forEach((m: any) => acc.add(`mark:${m.type}`));
  node.content?.forEach((c: any) => types(c, acc));
  return acc;
}
const roundTrip = (html: string) => {
  const ext = buildExtensions();
  const json = generateJSON(html, ext);
  return { json, html: generateHTML(json, ext), types: types(json) };
};

describe('.docx import fidelity', () => {
  it('keeps headings, inline formatting, link, lists, quote, table, footnote and the embedded image', async () => {
    const { html, warnings } = await fileToHtml('report.docx', await richDocx());
    expect(html).toContain('<h1>Project Report</h1>');
    expect(html).toContain('<h2>Overview</h2>');
    expect(html).toContain('<strong>Bold </strong>');
    expect(html).toContain('<em>italic </em>');
    expect(html).toContain('<u>underline </u>');
    expect(html).toContain('<s>struck</s>');
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/docs"[^>]*>our docs<\/a>/);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/<ul>[\s\S]*Bullet one[\s\S]*<ul>[\s\S]*Nested bullet/); // nested list
    expect(html).toMatch(/<ol>[\s\S]*Step one[\s\S]*Step two/);
    expect(html).toContain('<blockquote>');
    expect(html).toMatch(/<table>[\s\S]*Name[\s\S]*Score[\s\S]*Ann[\s\S]*colspan="2"[^>]*>[\s\S]*Merged/);
    expect(html).toContain('The footnote text.');
    expect(html).toMatch(/<img[^>]*src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
    expect(html).toContain('alt="A tiny picture"');
    expect(warnings).toEqual([]);
  });

  it('survives the editor schema round trip with no node types dropped', async () => {
    const { html } = await fileToHtml('report.docx', await richDocx());
    const rt = roundTrip(html);
    for (const t of ['heading', 'bulletList', 'orderedList', 'blockquote', 'table', 'tableRow', 'tableCell', 'image', 'mark:bold', 'mark:italic', 'mark:underline', 'mark:strike', 'mark:link']) {
      expect(rt.types, `missing ${t}`).toContain(t);
    }
    expect(rt.html).toContain('data:image/png;base64,');
    expect(rt.html).toContain('colspan="2"');
  });

  it('omits unsupported/oversized images visibly and reports a warning', async () => {
    const z = await JSZip.loadAsync(await richDocx());
    z.file('word/media/pic.png', new Uint8Array(1024 * 1024 + 10).fill(0x89)); // not a real image + too big
    const { html, warnings } = await fileToHtml('x.docx', await z.generateAsync({ type: 'uint8array' }));
    expect(html).toContain('[image omitted]');
    expect(html).not.toContain('<img');
    expect(warnings.join(' ')).toMatch(/image/i);
  });
});

const MD = `---
title: ignored
---
# Release Notes

Some **bold**, *italic*, ~~gone~~ and \`inline\` text with a [link](https://example.com).

## Tasks
- [x] done
- [ ] todo
  - nested item

1. first
2. second

> quoted

| Col A | Col B |
|-------|-------|
| 1 | 2 |

\`\`\`js
const x = 1 < 2;
\`\`\`

---

![inline](data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')})

![remote](https://images.example.com/ok.png)
![blocked](https://169.254.169.254/latest/meta-data.png)
![insecure](http://images.example.com/plain.png)
`;

describe('Markdown import fidelity', () => {
  const fetchImage = async (u: string) => (u.includes('ok.png') ? `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}` : null);

  it('renders every GFM element, inlines allowed images and reports the rest', async () => {
    const { html, title, warnings } = await fileToHtml('notes.md', new TextEncoder().encode(MD), { fetchImage });
    expect(title).toBe('Release Notes');
    expect(html).not.toContain('title: ignored'); // front matter stripped
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toContain('<code>inline</code>');
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com"/);
    expect(html).toContain('☑ done');
    expect(html).toContain('☐ todo');
    expect(html).toMatch(/<ul>[\s\S]*todo[\s\S]*<ul>[\s\S]*nested item/);
    expect(html).toMatch(/<ol>[\s\S]*first[\s\S]*second/);
    expect(html).toContain('<blockquote>');
    expect(html).toMatch(/<table>[\s\S]*Col A[\s\S]*<td>1<\/td>/);
    expect(html).toMatch(/<pre><code[^>]*>const x = 1 &lt; 2;/);
    expect(html).toContain('<hr>');
    expect((html.match(/<img /g) ?? []).length).toBe(2); // data URI + fetched remote
    expect(html).toContain('[image unavailable: blocked]');
    expect(html).toContain('[image unavailable: insecure]');
    expect(warnings.join(' ')).toMatch(/2 images/);
  });

  it('round-trips through the editor schema', async () => {
    const { html } = await fileToHtml('notes.md', new TextEncoder().encode(MD), { fetchImage });
    const rt = roundTrip(html);
    for (const t of ['heading', 'bulletList', 'orderedList', 'blockquote', 'table', 'codeBlock', 'horizontalRule', 'image', 'mark:code', 'mark:strike', 'mark:link']) {
      expect(rt.types, `missing ${t}`).toContain(t);
    }
  });

  it('never fetches remote images in the real fetcher for private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
  });
});

describe('sanitizer', () => {
  it('neutralizes hostile input but keeps legitimate rich content', () => {
    const dirty = [
      '<p onclick="x()">hi<script>alert(1)</script></p>',
      '<a href="javascript:alert(1)">bad</a>',
      '<a href="https://ok.example/">good</a>',
      '<img src="https://evil.example/track.png">',
      '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
      '<img src="data:text/html;base64,PHNjcmlwdD4=">',
      '<img src=x onerror=alert(1)>',
      '<iframe src="https://evil.example"></iframe>',
      '<p style="background:url(javascript:alert(1))">evil style</p>',
      '<p style="text-align:center">centered</p>',
      '<svg><script>alert(1)</script></svg>',
      `<img src="data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}" alt="ok">`,
    ].join('');
    const out = sanitize(dirty);
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe|svg|evil\.example|text\/html|background/i);
    expect(out).toContain('good</a>');
    expect(out).toContain('text-align:center');
    expect(out).toContain('data:image/png;base64,');
    expect(out).not.toMatch(/<a [^>]*>bad/); // unsafe link loses its href (text stays, no anchor target)
  });
});

describe('import into an existing draft & new-doc import', () => {
  it('returns converted HTML without saving; viewers are rejected', async () => {
    const { call, upload } = makeApp();
    const { data: doc } = await call('u_alice', 'POST', '/documents');
    await call('u_alice', 'POST', `/documents/${doc.id}/share`, { email: 'bob@example.com', role: 'viewer' });

    const ok = await upload('u_alice', `/documents/${doc.id}/import`, 'a.md', '# Hello\n\n**x**');
    expect(ok.status).toBe(200);
    expect(ok.data.html).toContain('<h1>Hello</h1>');
    expect((await call('u_alice', 'GET', `/documents/${doc.id}`)).data.contentHtml).toBe('<p></p>'); // not persisted by the server

    expect((await upload('u_bob', `/documents/${doc.id}/import`, 'a.md', 'x')).status).toBe(403);
    expect((await upload('u_carol', `/documents/${doc.id}/import`, 'a.md', 'x')).status).toBe(404);
    expect((await upload('u_alice', `/documents/${doc.id}/import`, 'a.exe', 'x')).status).toBe(415);
  });

  it('new-document import returns warnings alongside the document', async () => {
    const { upload } = makeApp();
    const res = await upload('u_alice', '/documents/import', 'n.md', '![x](http://insecure.example/a.png)');
    expect(res.status).toBe(201);
    expect(res.data.warnings.length).toBe(1);
  });
});
