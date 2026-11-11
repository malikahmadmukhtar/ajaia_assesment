import JSZip from 'jszip';
import { Packer } from 'docx';
import { generateHTML, generateJSON } from '@tiptap/html/server';
import { describe, expect, it } from 'vitest';
import { buildExtensions } from '../src/shared/extensions';
import { buildDocx, safeFilename, toMarkdown, toText } from '../src/export';
import { fileToHtml } from '../netlify/functions/lib/importer';
import { PNG_BYTES } from './helpers';

const MD = `# Release Notes

Some **bold**, *italic*, ~~gone~~ and \`inline\` text with a [link](https://example.com).

- one
  - nested
- two

1. first
2. second

> quoted

| Col A | Col B |
|-------|-------|
| 1 | 2 |

\`\`\`js
const x = 1;
\`\`\`

---

![pic](data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')})
`;

async function fixture() {
  const { html } = await fileToHtml('n.md', new TextEncoder().encode(MD));
  const ext = buildExtensions();
  const json = generateJSON(html, ext);
  return { html: generateHTML(json, ext), json };
}

const pngLoader = async () => ({ data: PNG_BYTES, width: 1, height: 1 });

describe('export', () => {
  it('plain text keeps structure readable', async () => {
    const { json } = await fixture();
    const t = toText(json);
    expect(t).toContain('Release Notes');
    expect(t).toContain('- one');
    expect(t).toMatch(/- one\n\s+- nested/);
    expect(t).toContain('1. first');
    expect(t).toContain('> quoted');
    expect(t).toContain('Col A\tCol B');
    expect(t).toContain('[image: pic]');
    expect(t).not.toMatch(/<[a-z]+>/); // no markup leaks
    expect(t.endsWith('\n')).toBe(true);
  });

  it('markdown round-trips back to equivalent structure', async () => {
    const { html } = await fixture();
    const md = await toMarkdown(html);
    expect(md).toContain('# Release Notes');
    expect(md).toContain('**bold**');
    expect(md).toContain('~~gone~~');
    expect(md).toContain('[link](https://example.com)');
    expect(md).toMatch(/-\s+one[\s\S]*-\s+nested/);
    expect(md).toMatch(/1\.\s+first/);
    expect(md).toContain('> quoted');
    expect(md).toMatch(/\|\s*Col A\s*\|\s*Col B\s*\|/);
    expect(md).toMatch(/```\nconst x = 1;\n```/); // fenced (language tag isn't kept: sanitizer drops class attributes)
    expect(md).toContain('![pic](data:image/png;base64,');
    // and it re-imports cleanly through our own importer
    const again = await fileToHtml('x.md', new TextEncoder().encode(md));
    expect(again.html).toContain('<h1>Release Notes</h1>');
    expect(again.html).toContain('<table>');
  });

  it('docx contains the headings, formatting, list numbering, table, link and image', async () => {
    const { json } = await fixture();
    const buf = await Packer.toBuffer(await buildDocx(json, 'Notes', pngLoader));
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Release Notes');
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toMatch(/<w:b\/>[\s\S]*bold/);
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:strike/>');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Col A');
    expect(xml).toContain('<w:hyperlink');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('Courier New');
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
    const numbering = await zip.file('word/numbering.xml')!.async('string');
    expect(numbering).toContain('w:val="decimal"');
    expect(numbering).toContain('w:val="bullet"');
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it('docx falls back to a placeholder when an image cannot be decoded, and handles empty docs', async () => {
    const { json } = await fixture();
    const broken = await Packer.toBuffer(await buildDocx(json, 'x', async () => null));
    expect(await (await JSZip.loadAsync(broken)).file('word/document.xml')!.async('string')).toContain('[image: pic]');
    const empty = await Packer.toBuffer(await buildDocx({ type: 'doc', content: [] }, 'empty', pngLoader));
    expect(empty.byteLength).toBeGreaterThan(500);
  });

  it('merged table cells and alignment survive into docx', async () => {
    const ext = buildExtensions();
    const json = generateJSON('<p style="text-align:center">mid</p><table><tr><th colspan="2">Head</th></tr><tr><td>a</td><td>b</td></tr></table>', ext);
    const xml = await (await JSZip.loadAsync(await Packer.toBuffer(await buildDocx(json, 't', pngLoader)))).file('word/document.xml')!.async('string');
    expect(xml).toContain('w:gridSpan');
    expect(xml).toContain('w:jc w:val="center"');
  });

  it('builds safe filenames', () => {
    expect(safeFilename('  A/B: "C"?*  ')).toBe('AB C');
    expect(safeFilename('///')).toBe('document');
    expect(safeFilename('x'.repeat(300)).length).toBe(100);
  });
});
