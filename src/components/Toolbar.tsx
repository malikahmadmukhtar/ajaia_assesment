import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { useRef, type ReactNode } from 'react';
import { SUPPORTED_UPLOADS } from '../shared/types';
import { useToast } from '../toast';
import { validateImageFile, validateUrl } from '../validation';

interface Props { editor: Editor; onImportFile: (file: File) => void; importing: boolean }

export default function Toolbar({ editor, onImportFile, importing }: Props) {
  const toast = useToast();
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
      sub: e.isActive('subscript'), sup: e.isActive('superscript'), code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), quote: e.isActive('blockquote'), codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'), table: e.isActive('table'),
      left: e.isActive({ textAlign: 'left' }), center: e.isActive({ textAlign: 'center' }), right: e.isActive({ textAlign: 'right' }), justify: e.isActive({ textAlign: 'justify' }),
    }),
  });
  const c = () => editor.chain().focus();

  const B = ({ on, label, title, run, disabled }: { on?: boolean; label: ReactNode; title: string; run: () => void; disabled?: boolean }) => (
    <button type="button" className={`tb ${on ? 'on' : ''}`} title={title} aria-label={title} aria-pressed={on ?? false} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={run}>{label}</button>
  );
  const Sep = () => <span className="sep" />;

  function setLink() {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL (https://…)', prev ?? 'https://');
    if (url === null) return;
    if (url.trim() === '' || url.trim() === 'https://') { c().extendMarkRange('link').unsetLink().run(); return; }
    const err = validateUrl(url);
    if (err) { toast('error', err); return; }
    c().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  function insertImage(file: File | undefined) {
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { toast('error', err); return; }
    const reader = new FileReader();
    reader.onload = () => c().setImage({ src: String(reader.result), alt: file.name.replace(/\.[^.]+$/, '') }).run();
    reader.onerror = () => toast('error', 'Could not read that image.');
    reader.readAsDataURL(file);
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <B on={s.bold} label={<b>B</b>} title="Bold (Ctrl+B)" run={() => c().toggleBold().run()} />
      <B on={s.italic} label={<i>I</i>} title="Italic (Ctrl+I)" run={() => c().toggleItalic().run()} />
      <B on={s.underline} label={<u>U</u>} title="Underline (Ctrl+U)" run={() => c().toggleUnderline().run()} />
      <B on={s.strike} label={<s>S</s>} title="Strikethrough" run={() => c().toggleStrike().run()} />
      <B on={s.sub} label={<span>x<sub>2</sub></span>} title="Subscript" run={() => c().toggleSubscript().run()} />
      <B on={s.sup} label={<span>x<sup>2</sup></span>} title="Superscript" run={() => c().toggleSuperscript().run()} />
      <Sep />
      <B on={s.h1} label="H1" title="Heading 1" run={() => c().toggleHeading({ level: 1 }).run()} />
      <B on={s.h2} label="H2" title="Heading 2" run={() => c().toggleHeading({ level: 2 }).run()} />
      <B on={s.h3} label="H3" title="Heading 3" run={() => c().toggleHeading({ level: 3 }).run()} />
      <Sep />
      <B on={s.bullet} label="• List" title="Bulleted list" run={() => c().toggleBulletList().run()} />
      <B on={s.ordered} label="1. List" title="Numbered list" run={() => c().toggleOrderedList().run()} />
      <B on={s.quote} label="❝" title="Quote" run={() => c().toggleBlockquote().run()} />
      <B on={s.codeBlock} label="</>" title="Code block" run={() => c().toggleCodeBlock().run()} />
      <B label="―" title="Horizontal rule" run={() => c().setHorizontalRule().run()} />
      <Sep />
      <B on={s.left} label="⇤" title="Align left" run={() => c().setTextAlign('left').run()} />
      <B on={s.center} label="↔" title="Align center" run={() => c().setTextAlign('center').run()} />
      <B on={s.right} label="⇥" title="Align right" run={() => c().setTextAlign('right').run()} />
      <B on={s.justify} label="☰" title="Justify" run={() => c().setTextAlign('justify').run()} />
      <Sep />
      <B on={s.link} label="🔗" title="Link" run={setLink} />
      <B label="🖼" title="Insert image (PNG/JPEG/GIF/WebP, max 1 MB)" run={() => imgRef.current?.click()} />
      <B on={s.table} label="▦" title="Insert table" run={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} disabled={s.table} />
      {s.table && (
        <>
          <B label="+row" title="Add row below" run={() => c().addRowAfter().run()} />
          <B label="+col" title="Add column right" run={() => c().addColumnAfter().run()} />
          <B label="−row" title="Delete row" run={() => c().deleteRow().run()} />
          <B label="−col" title="Delete column" run={() => c().deleteColumn().run()} />
          <B label="✕ table" title="Delete table" run={() => c().deleteTable().run()} />
        </>
      )}
      <Sep />
      <B label={importing ? '…' : '⬆ Import'} title={`Import a file into this document (${SUPPORTED_UPLOADS.join(' ')}, max 2 MB)`} run={() => fileRef.current?.click()} disabled={importing} />
      <input ref={imgRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { insertImage(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={fileRef} type="file" accept={SUPPORTED_UPLOADS.join(',')} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportFile(f); }} />
    </div>
  );
}
