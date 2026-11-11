import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import Attachments from '../components/Attachments';
import ExportMenu from '../components/ExportMenu';
import ShareDialog from '../components/ShareDialog';
import Toolbar from '../components/Toolbar';
import { canEdit } from '../shared/access';
import { buildExtensions } from '../shared/extensions';
import { MAX_DOC_BYTES, type DocView } from '../shared/types';
import { useToast } from '../toast';

type Status = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export default function EditorPage() {
  const { id = '' } = useParams();
  const [doc, setDoc] = useState<DocView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDoc(null); setError(null);
    api.get(id).then(setDoc).catch((e: ApiError) => setError(e.status === 404 ? 'This document doesn’t exist, or you don’t have access to it.' : e.message));
  }, [id]);

  if (error) return <main className="page"><p className="empty">{error}</p><Link to="/" className="btn">← Back to documents</Link></main>;
  if (!doc) return <main className="page muted">Loading…</main>;
  return <EditorBody key={doc.id} initial={doc} />;
}

function EditorBody({ initial }: { initial: DocView }) {
  const toast = useToast();
  const nav = useNavigate();
  const location = useLocation();
  const [doc, setDoc] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [status, setStatus] = useState<Status>('saved');
  const [sharing, setSharing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState<string[]>((location.state as { warnings?: string[] } | null)?.warnings ?? []);
  const editable = canEdit(doc.access);

  // Autosave state lives in refs so the debounced callback always sees fresh values.
  const version = useRef(initial.version);
  const dirty = useRef({ title: false, content: false });
  const inFlight = useRef(false);
  const conflict = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const titleRef = useRef(title);
  titleRef.current = title;

  const editor = useEditor({
    extensions: buildExtensions(),
    content: initial.contentHtml,
    editable,
    editorProps: { attributes: { class: 'prose', 'aria-label': 'Document body' } },
    onUpdate: () => { dirty.current.content = true; schedule(); },
  });

  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);

  const save = useCallback(async () => {
    if (inFlight.current || conflict.current || !editor) return;
    const d = dirty.current;
    if (!d.title && !d.content) { setStatus('saved'); return; }
    const html = d.content ? editor.getHTML() : undefined;
    if (html && html.length > MAX_DOC_BYTES) {
      setStatus('error'); toast('error', 'This document is too large to save (max 5 MB). Remove some images.'); return;
    }
    const patch = { ...(d.title && { title: titleRef.current.trim() }), ...(html !== undefined && { contentHtml: html }) };
    const snapshot = { ...d };
    dirty.current = { title: false, content: false };
    inFlight.current = true;
    setStatus('saving');
    try {
      const saved = await api.update(initial.id, version.current, patch);
      version.current = saved.version;
      setDoc((prev) => ({ ...prev, version: saved.version, updatedAt: saved.updatedAt, title: saved.title }));
    } catch (e) {
      const err = e as ApiError;
      inFlight.current = false;
      if (err.status === 409) { conflict.current = true; setStatus('conflict'); return; }
      if (err.status === 400 || err.status === 403 || err.status === 413) { setStatus('error'); toast('error', `Couldn’t save: ${err.message}`); return; } // retrying can't help
      dirty.current = { title: dirty.current.title || snapshot.title, content: dirty.current.content || snapshot.content };
      setStatus('error'); toast('error', `Couldn’t save: ${err.message} Retrying…`);
      timer.current = setTimeout(save, 3000);
      return;
    }
    inFlight.current = false;
    if (dirty.current.title || dirty.current.content) save(); else setStatus('saved');
  }, [editor, initial.id, toast]);

  function schedule() {
    if (conflict.current) return;
    setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 800);
  }

  // Flush on leave + warn on tab close with unsaved work.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current.title || dirty.current.content || inFlight.current) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      clearTimeout(timer.current);
      if (dirty.current.title || dirty.current.content) save();
    };
  }, [save]);

  // A viewer with a pending request polls so the editor unlocks as soon as the owner approves.
  useEffect(() => {
    if (doc.access !== 'viewer' || !doc.hasRequested) return;
    const t = setInterval(async () => {
      try {
        const latest = await api.get(initial.id);
        if (latest.access === 'editor') {
          version.current = latest.version;
          editor?.commands.setContent(latest.contentHtml, { emitUpdate: false });
          setDoc(latest); setTitle(latest.title);
          toast('ok', 'You now have edit access.');
        } else if (!latest.hasRequested) {
          setDoc((p) => ({ ...p, hasRequested: false }));
          toast('error', 'Your edit-access request was declined.');
        }
      } catch { /* transient; try again next tick */ }
    }, 4000);
    return () => clearInterval(t);
  }, [doc.access, doc.hasRequested, editor, initial.id, toast]);

  async function requestEdit() {
    setRequesting(true);
    try {
      const msg = window.prompt('Optional message to the owner:', '');
      if (msg === null) return;
      const d = await api.requestEdit(initial.id, msg.trim() || undefined);
      setDoc((p) => ({ ...p, hasRequested: d.hasRequested }));
      toast('ok', `Request sent to ${doc.ownerName}`);
    } catch (e) { toast('error', (e as Error).message); } finally { setRequesting(false); }
  }

  async function importFile(file: File) {
    if (!editor) return;
    setImporting(true);
    try {
      const r = await api.importInto(initial.id, file);
      editor.chain().focus().insertContent(r.html).run(); // undoable; autosave persists it
      setNotice(r.warnings);
      toast('ok', `Imported ${file.name}`);
    } catch (e) { toast('error', (e as Error).message); } finally { setImporting(false); }
  }

  async function goBack() {
    // Leaving a never-edited blank draft deletes it, so "New document" doesn't leave junk behind.
    const blank = doc.access === 'owner' && doc.version === 1 && version.current === 1 && !dirty.current.title && !dirty.current.content
      && doc.title === 'Untitled document' && (editor?.isEmpty ?? false) && doc.sharedWith.length === 0;
    if (blank) await api.remove(doc.id).catch(() => {});
    nav('/');
  }

  const label = { saved: 'All changes saved', dirty: 'Unsaved changes…', saving: 'Saving…', error: 'Save failed', conflict: 'Not saved' }[status];

  return (
    <div className="editor-wrap">
      <div className="editor-head">
        <button className="btn" aria-label="Back to documents" onClick={goBack}>←</button>
        <input className="title" value={title} readOnly={!editable} maxLength={200} aria-label="Document title"
          onChange={(e) => { setTitle(e.target.value); if (e.target.value.trim()) { dirty.current.title = true; schedule(); } }}
          onBlur={() => { if (!title.trim()) setTitle(doc.title); }} />
        <span className={`status ${status}`} aria-live="polite">{editable ? label : ''}</span>
        <ExportMenu editor={editor} title={title.trim() || doc.title} />
        {doc.access === 'owner'
          ? <button className="btn primary" onClick={() => setSharing(true)}>
              Share{doc.sharedWith.length ? ` (${doc.sharedWith.length})` : ''}
              {doc.accessRequests.length > 0 && <span className="dot" title={`${doc.accessRequests.length} pending request(s)`} />}
            </button>
          : <span className="badge shared">Shared by {doc.ownerName} · {editable ? 'Can edit' : 'View only'}</span>}
      </div>

      {status === 'conflict' && (
        <div className="banner" role="alert">
          This document was changed by someone else, so your latest edits weren’t saved.
          <button className="btn" onClick={() => window.location.reload()}>Reload latest</button>
        </div>
      )}
      {doc.access === 'viewer' && (
        <div className="banner info">
          <span>You have view-only access to this document.</span>
          {doc.hasRequested
            ? <button className="btn" disabled>Request sent ✓</button>
            : <button className="btn primary" disabled={requesting} onClick={requestEdit}>Request edit access</button>}
        </div>
      )}
      {notice.length > 0 && (
        <div className="banner warn" role="status">
          <span><strong>Import note:</strong> {notice.join(' ')}</span>
          <button className="btn" onClick={() => setNotice([])}>Dismiss</button>
        </div>
      )}

      {editable && editor && <Toolbar editor={editor} onImportFile={importFile} importing={importing} />}
      <div className="paper"><EditorContent editor={editor} /></div>

      <Attachments docId={initial.id} canEdit={editable} />

      {sharing && <ShareDialog doc={doc} onClose={() => setSharing(false)} onChange={(d) => setDoc((p) => ({ ...p, sharedWith: d.sharedWith, accessRequests: d.accessRequests }))} />}
    </div>
  );
}
