import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { exportDocument, type ExportFormat } from '../export';
import { useToast } from '../toast';

const ITEMS: { fmt: ExportFormat; label: string; hint: string }[] = [
  { fmt: 'docx', label: 'Word (.docx)', hint: 'Keeps images, tables, lists' },
  { fmt: 'md', label: 'Markdown (.md)', hint: 'GFM tables and code' },
  { fmt: 'txt', label: 'Plain text (.txt)', hint: 'No formatting' },
];

export default function ExportMenu({ editor, title }: { editor: Editor | null; title: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  async function run(fmt: ExportFormat) {
    if (!editor) return;
    setBusy(fmt);
    try { await exportDocument(fmt, editor, title); setOpen(false); }
    catch (e) { console.error(e); toast('error', `Couldn’t export as .${fmt}. Please try again.`); }
    finally { setBusy(null); }
  }

  return (
    <div className="menu" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} disabled={!editor} onClick={() => setOpen((o) => !o)}>⬇ Export</button>
      {open && (
        <div className="menu-list" role="menu">
          {ITEMS.map((i) => (
            <button key={i.fmt} role="menuitem" className="menu-item" disabled={busy !== null} onClick={() => run(i.fmt)}>
              <strong>{busy === i.fmt ? 'Preparing…' : i.label}</strong>
              <small className="muted">{i.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
