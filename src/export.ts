import type { Editor } from '@tiptap/react';

export type ExportFormat = 'docx' | 'md' | 'txt';

/** Minimal ProseMirror JSON shape (what editor.getJSON() returns). */
export interface PM {
  type?: string;
  attrs?: Record<string, any>;
  content?: PM[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
}

export const safeFilename = (title: string) =>
  (title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'document');

/* ------------------------------------------------------------------ .txt */

const inlineText = (n: PM): string =>
  n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inlineText).join('');

function textBlocks(nodes: PM[] = [], indent = ''): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
        out.push(inlineText(n).split('\n').map((l) => indent + l).join('\n'));
        break;
      case 'blockquote':
        out.push(textBlocks(n.content, indent + '> ').join('\n'));
        break;
      case 'bulletList':
      case 'orderedList': {
        const start = n.attrs?.start ?? 1;
        (n.content ?? []).forEach((li, i) => {
          const marker = n.type === 'bulletList' ? '- ' : `${start + i}. `;
          const [first, ...rest] = textBlocks(li.content, indent + ' '.repeat(marker.length));
          out.push(indent + marker + (first ?? '').trimStart() + (rest.length ? '\n' + rest.join('\n') : ''));
        });
        break;
      }
      case 'horizontalRule': out.push(indent + '----------'); break;
      case 'image': out.push(`${indent}[image${n.attrs?.alt ? `: ${n.attrs.alt}` : ''}]`); break;
      case 'table':
        out.push((n.content ?? []).map((row) => indent + (row.content ?? []).map((c) => textBlocks(c.content).join(' ').replace(/\s+/g, ' ').trim()).join('\t')).join('\n'));
        break;
      default:
        if (n.content) out.push(...textBlocks(n.content, indent));
    }
  }
  return out;
}

/** Plain text: blocks separated by blank lines, lists/quotes/tables keep a readable shape. */
export function toText(doc: PM): string {
  const blocks = textBlocks(doc.content);
  // keep list items tight (single newline between consecutive items), paragraphs separated by blank lines
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ------------------------------------------------------------------- .md */

/**
 * GFM tables need: rows directly under <table>, a header row of <th>, and single-line cells.
 * TipTap emits <tbody>, <p>-wrapped cells, and tables whose first row may be plain <td>.
 */
function normalizeTables(html: string): string {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => {
    let t = inner.replace(/<\/?(thead|tbody|tfoot|colgroup)[^>]*>/gi, '').replace(/<col[^>]*>/gi, '');
    t = t.replace(/<\/p>\s*<p[^>]*>/gi, '<br>').replace(/<\/?p[^>]*>/gi, '');
    t = t.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/i, (row) => (/<th[\s>]/i.test(row) ? row : row.replace(/<(\/?)td/gi, '<$1th')));
    return `<table>${t}</table>`;
  });
}

export async function toMarkdown(html: string): Promise<string> {
  const [{ default: Turndown }, { gfm }] = await Promise.all([import('turndown'), import('turndown-plugin-gfm')]);
  const td = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', hr: '---' });
  td.use(gfm);
  td.addRule('strike', { filter: ['s', 'del', 'strike'] as any, replacement: (c) => `~~${c}~~` }); // GFM plugin emits single ~, which many renderers ignore
  td.keep(['u', 'sub', 'sup']); // no Markdown syntax for these; inline HTML renders in most viewers
  // GFM tables need a header row; TipTap tables always have one when inserted, but imported ones may not.
  td.addRule('alignedBlocks', {
    filter: (n) => /^(P|H[1-6])$/.test(n.nodeName) && /text-align:\s*(center|right|justify)/.test((n as HTMLElement).getAttribute('style') ?? ''),
    replacement: (content, n) => `<div align="${/center/.test((n as HTMLElement).getAttribute('style')!) ? 'center' : /right/.test((n as HTMLElement).getAttribute('style')!) ? 'right' : 'justify'}">\n\n${content}\n\n</div>`,
  });
  return td.turndown(normalizeTables(html)).trim() + '\n';
}

/* ----------------------------------------------------------------- .docx */

export interface LoadedImage { data: Uint8Array; width: number; height: number }
export type ImageLoader = (src: string) => Promise<LoadedImage | null>;

/** Browser image loader: decodes any supported data URI (incl. WebP) and re-encodes as PNG for Word. */
export const browserImageLoader: ImageLoader = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      canvas.toBlob(async (b) => resolve(b ? { data: new Uint8Array(await b.arrayBuffer()), width: img.naturalWidth, height: img.naturalHeight } : null), 'image/png');
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

export async function buildDocx(doc: PM, title: string, loadImage: ImageLoader = browserImageLoader) {
  const d = await import('docx');
  const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat } = d;

  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
    left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
  };
  const MAX_IMG_W = 576; // 6 inches at 96 dpi

  const numberingConfigs: any[] = [];
  const levelFmt = (fmt: any[], text: string[]) =>
    fmt.map((format, level) => ({
      level, format, text: text[level] ?? text[0], alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    }));
  numberingConfigs.push({
    reference: 'bullets',
    levels: levelFmt([LevelFormat.BULLET, LevelFormat.BULLET, LevelFormat.BULLET, LevelFormat.BULLET], ['•', '◦', '▪', '•']),
  });
  let orderedCount = 0;
  const newOrdered = () => {
    const reference = `ordered-${++orderedCount}`;
    numberingConfigs.push({
      reference,
      levels: levelFmt([LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL], ['%1.', '%2.', '%3.', '%4.']),
    });
    return reference;
  };

  type Ctx = { bold?: boolean };

  async function runs(nodes: PM[] = [], ctx: Ctx = {}): Promise<any[]> {
    const out: any[] = [];
    for (const n of nodes) {
      if (n.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue; }
      if (n.type !== 'text') { out.push(...(await runs(n.content, ctx))); continue; }
      const m = new Set((n.marks ?? []).map((x) => x.type));
      const link = n.marks?.find((x) => x.type === 'link')?.attrs?.href as string | undefined;
      const run = new TextRun({
        text: n.text ?? '',
        bold: m.has('bold') || ctx.bold || undefined,
        italics: m.has('italic') || undefined,
        underline: m.has('underline') || link ? {} : undefined,
        strike: m.has('strike') || undefined,
        subScript: m.has('subscript') || undefined,
        superScript: m.has('superscript') || undefined,
        font: m.has('code') ? 'Courier New' : undefined,
        shading: m.has('code') ? { type: ShadingType.CLEAR, fill: 'EEEEEE', color: 'auto' } : undefined,
        color: link ? '0563C1' : undefined,
      });
      out.push(link ? new ExternalHyperlink({ link, children: [run] }) : run);
    }
    return out;
  }

  async function imageParagraph(n: PM): Promise<any> {
    const src = String(n.attrs?.src ?? '');
    const img = src ? await loadImage(src) : null;
    if (!img || !img.width || !img.height) return new Paragraph({ children: [new TextRun({ text: `[image${n.attrs?.alt ? `: ${n.attrs.alt}` : ''}]`, italics: true })] });
    const scale = Math.min(1, MAX_IMG_W / img.width);
    return new Paragraph({
      children: [new ImageRun({ type: 'png', data: img.data, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) }, altText: { title: n.attrs?.alt ?? '', description: n.attrs?.alt ?? '', name: 'image' } })],
    });
  }

  interface Opts { list?: { ref: string; level: number }; quote?: boolean; ctx?: Ctx }

  async function blocks(nodes: PM[] = [], o: Opts = {}): Promise<any[]> {
    const out: any[] = [];
    for (const n of nodes) {
      switch (n.type) {
        case 'paragraph':
        case 'heading': {
          const isHeading = n.type === 'heading';
          out.push(new Paragraph({
            heading: isHeading ? HEADINGS[Math.min(Math.max((n.attrs?.level ?? 1) - 1, 0), 2)] : undefined,
            alignment: ALIGN[n.attrs?.textAlign as string],
            numbering: o.list ? { reference: o.list.ref, level: Math.min(o.list.level, 3) } : undefined,
            indent: o.quote ? { left: 720 } : undefined,
            border: o.quote ? { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } } : undefined,
            children: await runs(n.content, o.ctx),
          }));
          if (o.list) o = { ...o, list: undefined }; // only the first paragraph of an item gets the marker
          break;
        }
        case 'blockquote': out.push(...(await blocks(n.content, { ...o, quote: true }))); break;
        case 'codeBlock':
          for (const line of inlineText(n).split('\n')) {
            out.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: 'F3F3F3', color: 'auto' }, children: [new TextRun({ text: line, font: 'Courier New', size: 20 })] }));
          }
          break;
        case 'bulletList':
        case 'orderedList': {
          const ref = n.type === 'bulletList' ? 'bullets' : newOrdered();
          const level = o.list ? o.list.level + 1 : (o as any).depth ?? 0;
          for (const li of n.content ?? []) {
            const kids = li.content ?? [];
            const firstParaIdx = kids.findIndex((k) => k.type === 'paragraph');
            for (let i = 0; i < kids.length; i++) {
              const k = kids[i];
              if (k.type === 'bulletList' || k.type === 'orderedList') out.push(...(await blocks([k], { ...o, list: { ref, level }, ctx: o.ctx })));
              else out.push(...(await blocks([k], { ...o, list: i === firstParaIdx ? { ref, level } : undefined, ctx: o.ctx })));
            }
          }
          break;
        }
        case 'horizontalRule':
          out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } }, children: [] }));
          break;
        case 'image': out.push(await imageParagraph(n)); break;
        case 'table': {
          const rows = [];
          for (const row of n.content ?? []) {
            const cells = [];
            for (const c of row.content ?? []) {
              const header = c.type === 'tableHeader';
              const kids = await blocks(c.content, { ctx: { bold: header } });
              cells.push(new TableCell({
                children: kids.length ? kids : [new Paragraph({ children: [] })],
                columnSpan: (c.attrs?.colspan ?? 1) > 1 ? c.attrs!.colspan : undefined,
                rowSpan: (c.attrs?.rowspan ?? 1) > 1 ? c.attrs!.rowspan : undefined,
                shading: header ? { type: ShadingType.CLEAR, fill: 'EDEDED', color: 'auto' } : undefined,
              }));
            }
            if (cells.length) rows.push(new TableRow({ children: cells }));
          }
          if (rows.length) { out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })); out.push(new Paragraph({ children: [] })); }
          break;
        }
        default:
          if (n.content) out.push(...(await blocks(n.content, o)));
      }
    }
    return out;
  }

  const children = await blocks(doc.content);
  return new Document({
    creator: 'Ajaia Docs',
    title,
    numbering: { config: numberingConfigs },
    sections: [{ children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
}

/* --------------------------------------------------------------- download */

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Exports what's currently in the editor (including unsaved edits). */
export async function exportDocument(format: ExportFormat, editor: Editor, title: string): Promise<void> {
  const name = safeFilename(title);
  if (format === 'txt') return download(new Blob([toText(editor.getJSON())], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
  if (format === 'md') return download(new Blob([await toMarkdown(editor.getHTML())], { type: 'text/markdown;charset=utf-8' }), `${name}.md`);
  const { Packer } = await import('docx');
  const blob = await Packer.toBlob(await buildDocx(editor.getJSON(), title));
  download(blob, `${name}.docx`);
}
