import mammoth from 'mammoth';
import { marked } from 'marked';
import { MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES, SUPPORTED_UPLOADS, type ImportResponse } from '../../../src/shared/types';
import { HttpError } from './errors';
import { fetchRemoteImage, sniffImage, type ImageFetcher } from './net';
import { escapeHtml, sanitize } from './sanitize';

export { HttpError };
const MAX_IMAGES = 15;
const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '');

export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f]/g, '').trim();
  return (base || 'Imported document').slice(0, 200);
}

const decode = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
const unescapeAttr = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOf = (html: string) => unescapeAttr(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Converts an uploaded .txt/.md/.docx into sanitized editor HTML (+ title hint + fidelity warnings). */
export async function fileToHtml(
  name: string,
  bytes: Uint8Array,
  deps: { fetchImage?: ImageFetcher } = {},
): Promise<ImportResponse> {
  if (bytes.byteLength === 0) throw new HttpError(400, 'The file is empty.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, 'File is too large (max 2 MB).');

  switch (ext(name)) {
    case '.txt': return fromText(decode(bytes));
    case '.md': return fromMarkdown(decode(bytes), deps.fetchImage ?? fetchRemoteImage);
    case '.docx': return fromDocx(bytes);
    default:
      throw new HttpError(415, `Unsupported file type. Supported: ${SUPPORTED_UPLOADS.join(', ')}`);
  }
}

function fromText(text: string): ImportResponse {
  const html = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { html: sanitize(html || '<p></p>'), warnings: [] };
}

async function fromMarkdown(src: string, fetchImage: ImageFetcher): Promise<ImportResponse> {
  const warnings: string[] = [];
  const body = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''); // YAML front matter
  let html = await marked.parse(body, { gfm: true, breaks: false });

  // GFM task lists → readable text (the editor has no checkbox node)
  html = html.replace(/<input\b[^>]*type="checkbox"[^>]*>\s*/gi, (m) => (/\bchecked\b/i.test(m) ? '☑ ' : '☐ '));

  // Images: keep data URIs, inline remote https images once, placeholder for anything else.
  const seen = new Map<string, string | null>();
  const srcs = [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/gi)].map((m) => unescapeAttr(m[1]));
  let fetched = 0, failed = 0;
  for (const src of new Set(srcs)) {
    if (/^data:image\//i.test(src)) { seen.set(src, src); continue; }
    if (fetched >= MAX_IMAGES) { seen.set(src, null); failed++; continue; }
    fetched++;
    const data = /^https:\/\//i.test(src) ? await fetchImage(src) : null;
    seen.set(src, data);
    if (!data) failed++;
  }
  html = html.replace(/<img\b[^>]*?>/gi, (tag) => {
    const src = unescapeAttr(tag.match(/\ssrc="([^"]*)"/i)?.[1] ?? '');
    const alt = unescapeAttr(tag.match(/\salt="([^"]*)"/i)?.[1] ?? '');
    const data = seen.get(src);
    return data ? `<img src="${data}" alt="${escapeHtml(alt).replace(/"/g, '&quot;')}">` : `<em>[image unavailable${alt ? `: ${escapeHtml(alt)}` : ''}]</em>`;
  });
  if (failed) warnings.push(`${failed} image${failed > 1 ? 's' : ''} couldn't be imported (only https images ≤ 1 MB and embedded data images are supported).`);

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1 ? textOf(h1[1]).slice(0, 200) || undefined : undefined;
  return { html: sanitize(html) || '<p></p>', title, warnings };
}

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Heading 4'] => h3:fresh",
  "p[style-name='Heading 5'] => h3:fresh",
  "p[style-name='Heading 6'] => h3:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Block Text'] => blockquote > p:fresh",
  "p[style-name='Code'] => pre:fresh",
  "p[style-name='Source Code'] => pre:fresh",
  "r[style-name='Code Char'] => code",
  'u => u',
  'strike => s',
];

async function fromDocx(bytes: Uint8Array): Promise<ImportResponse> {
  let images = 0, omitted = 0, unsupported = 0;
  const OMIT = 'about:omitted';
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      {
        styleMap: STYLE_MAP,
        convertImage: mammoth.images.imgElement(async (image) => {
          const buf: Buffer = await (image as unknown as { readAsBuffer(): Promise<Buffer> }).readAsBuffer();
          const mime = sniffImage(buf);
          if (!mime) { unsupported++; return { src: OMIT }; }
          if (buf.byteLength > MAX_IMAGE_BYTES || ++images > MAX_IMAGES) { omitted++; return { src: OMIT }; }
          return { src: `data:${mime};base64,${buf.toString('base64')}` };
        }),
      },
    );
    let html = result.value
      .replace(/<img\b[^>]*src="about:omitted"[^>]*>/gi, '<em>[image omitted]</em>')
      .replace(/<pre>(?!<code>)([\s\S]*?)<\/pre>/gi, '<pre><code>$1</code></pre>')
      .replace(/<a href="#[^"]*">↑<\/a>/g, ''); // footnote back-links point at anchors we don't keep

    const warnings: string[] = [];
    const msgs = result.messages.filter((m) => m.type === 'warning').length;
    if (msgs) warnings.push(`${msgs} Word formatting element${msgs > 1 ? 's' : ''} couldn't be converted and were simplified.`);
    if (omitted) warnings.push(`${omitted} image${omitted > 1 ? 's were' : ' was'} too large or over the ${MAX_IMAGES}-image limit and omitted.`);
    if (unsupported) warnings.push(`${unsupported} image${unsupported > 1 ? 's use' : ' uses'} an unsupported format (only PNG, JPEG, GIF, WebP) and ${unsupported > 1 ? 'were' : 'was'} omitted.`);
    html = sanitize(html);
    return { html: html || '<p></p>', warnings };
  } catch {
    throw new HttpError(422, 'Could not read this .docx file. Is it a valid Word document?');
  }
}
