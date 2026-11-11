import { FilterXSS } from 'xss';

/**
 * Allowlist = exactly what the editor can produce (src/shared/extensions.ts).
 * Applied on every save and import. Nothing outside this list survives.
 */
const ALIGNABLE = ['style'];
const WHITELIST: Record<string, string[]> = {
  p: ALIGNABLE, h1: ALIGNABLE, h2: ALIGNABLE, h3: ALIGNABLE,
  br: [], hr: [], strong: [], em: [], u: [], s: [], sub: [], sup: [], code: [], pre: [], blockquote: [],
  ul: [], ol: [], li: [],
  table: [], thead: [], tbody: [], tr: [], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
  a: ['href'], img: ['src', 'alt'],
};
const RENAME = /<(\/?)(b|i|strike|del|h4|h5|h6)(?=[\s>/])/gi;
const RENAMES: Record<string, string> = { b: 'strong', i: 'em', strike: 's', del: 's', h4: 'h3', h5: 'h3', h6: 'h3' };

const SAFE_IMG = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

const filter = new FilterXSS({
  whiteList: WHITELIST,
  stripIgnoreTag: true, // unknown tags are dropped, their text kept
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'],
  css: { whiteList: { 'text-align': /^(left|center|right|justify)$/ } },
  onTagAttr(tag, name, value) {
    if (name === 'src' && tag === 'img') return SAFE_IMG.test(value) ? `src="${value}"` : '';
    if (name === 'href' && tag === 'a') return SAFE_HREF.test(value.trim()) ? undefined : '';
    if (name === 'colspan' || name === 'rowspan') return /^\d{1,3}$/.test(value) && +value >= 1 ? `${name}="${+value}"` : '';
    return undefined;
  },
});

export function sanitize(html: string): string {
  const renamed = html.replace(RENAME, (_m, slash: string, tag: string) => `<${slash}${RENAMES[tag.toLowerCase()]}`);
  return filter
    .process(renamed)
    .replace(/<img(?![^>]*\ssrc=)[^>]*>/g, '') // image whose src was rejected
    .replace(/<a href="/g, '<a target="_blank" rel="noopener noreferrer" href="');
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
