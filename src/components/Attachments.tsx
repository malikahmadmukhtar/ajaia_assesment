import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ATTACHMENT_EXTENSIONS, MAX_ATTACHMENTS_PER_DOC, type AttachmentMeta } from '../shared/types';
import { useToast } from '../toast';
import { fmtSize, validateAttachmentFile } from '../validation';

export default function Attachments({ docId, canEdit }: { docId: string; canEdit: boolean }) {
  const [items, setItems] = useState<AttachmentMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(() => api.attachments(docId).then(setItems).catch((e) => { setItems([]); toast('error', e.message); }), [docId, toast]);
  useEffect(() => { load(); }, [load]);

  async function upload(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const err = validateAttachmentFile(f);
      if (err) { toast('error', `${f.name}: ${err}`); continue; }
      setBusy(true);
      try { await api.attach(docId, f); toast('ok', `Attached ${f.name}`); } catch (e) { toast('error', `${f.name}: ${(e as Error).message}`); }
      finally { setBusy(false); }
    }
    load();
  }

  async function remove(a: AttachmentMeta) {
    if (!confirm(`Remove attachment "${a.name}"?`)) return;
    try { await api.detach(docId, a.id); load(); } catch (e) { toast('error', (e as Error).message); }
  }

  const full = (items?.length ?? 0) >= MAX_ATTACHMENTS_PER_DOC;
  return (
    <section className={`attachments ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (canEdit && !full) upload(e.dataTransfer.files); }}>
      <div className="row">
        <h3>Attachments {items && <span className="count">{items.length}</span>}</h3>
        <span className="spacer" />
        {canEdit && (
          <>
            <button className="btn" disabled={busy || full} onClick={() => inputRef.current?.click()}>{busy ? 'Uploading…' : '＋ Attach file'}</button>
            <input ref={inputRef} type="file" multiple hidden accept={ATTACHMENT_EXTENSIONS.join(',')} onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ''; }} />
          </>
        )}
      </div>
      {canEdit && <small className="muted">Drop files here · up to {MAX_ATTACHMENTS_PER_DOC} files, 5 MB each · {ATTACHMENT_EXTENSIONS.join(' ')}{full ? ' · limit reached' : ''}</small>}
      {!items ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="muted small">No attachments.</p> : (
        <ul className="people">
          {items.map((a) => (
            <li key={a.id}>
              <a href={api.attachmentUrl(docId, a.id)} download={a.name}>📎 {a.name}</a>
              <span className="row"><span className="muted small">{fmtSize(a.size)}</span>
                {canEdit && <button className="btn" onClick={() => remove(a)} aria-label={`Remove ${a.name}`}>Remove</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
