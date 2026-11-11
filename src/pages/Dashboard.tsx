import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { SUPPORTED_UPLOADS, type DocView } from '../shared/types';
import { useToast } from '../toast';
import { validateImportFile } from '../validation';

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export default function Dashboard() {
  const [data, setData] = useState<{ owned: DocView[]; shared: DocView[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();

  const load = useCallback(() => api.list().then(setData).catch((e) => toast('error', e.message)), [toast]);
  useEffect(() => { load(); }, [load]);

  // Live-ish updates: poll while the tab is visible, and refresh immediately on focus.
  // Background polls fail silently (no toast spam); the next tick just retries.
  useEffect(() => {
    const quiet = () => { if (document.visibilityState === 'visible') api.list().then(setData).catch(() => {}); };
    const t = setInterval(quiet, 5000);
    document.addEventListener('visibilitychange', quiet);
    window.addEventListener('focus', quiet);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', quiet); window.removeEventListener('focus', quiet); };
  }, []);

  async function run(fn: () => Promise<DocView>) {
    setBusy(true);
    try {
      const d = await fn();
      nav(`/d/${d.id}`, { state: { warnings: (d as DocView & { warnings?: string[] }).warnings ?? [] } });
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  }

  async function remove(d: DocView) {
    if (!confirm(`Delete "${d.title}"? This cannot be undone${d.sharedWith.length ? ' and removes access for collaborators' : ''}.`)) return;
    try { await api.remove(d.id); toast('ok', 'Document deleted'); load(); } catch (e) { toast('error', (e as Error).message); }
  }

  return (
    <main className="page">
      <div className="actions">
        <button className="btn primary" disabled={busy} onClick={() => run(() => api.create())}>＋ New document</button>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>⬆ Import file</button>
        <small className="muted">Supported: {SUPPORTED_UPLOADS.join(' ')} · max 2 MB</small>
        <input ref={fileRef} type="file" hidden accept={SUPPORTED_UPLOADS.join(',')}
          onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            const err = validateImportFile(f);
            if (err) toast('error', err); else run(() => api.import(f));
          }} />
      </div>

      {!data ? <p className="muted">Loading documents…</p> : (
        <>
          <Section title="My documents" docs={data.owned} empty="You haven't created any documents yet." onDelete={remove} />
          <Section title="Shared with me" docs={data.shared} empty="Nothing has been shared with you yet." />
        </>
      )}
    </main>
  );
}

function Section({ title, docs, empty, onDelete }: { title: string; docs: DocView[]; empty: string; onDelete?: (d: DocView) => void }) {
  return (
    <section>
      <h2>{title} <span className="count">{docs.length}</span></h2>
      {docs.length === 0 ? <p className="empty">{empty}</p> : (
        <ul className="doclist">
          {docs.map((d) => (
            <li key={d.id}>
              <Link to={`/d/${d.id}`} className="doclink">
                <span className="doctitle">{d.title}</span>
                <span className="meta">
                  {d.access === 'owner'
                    ? <><span className="badge owner">Owner{d.sharedWith.length ? ` · shared with ${d.sharedWith.length}` : ''}</span>
                        {d.accessRequests.length > 0 && <span className="badge request">{d.accessRequests.length} edit request{d.accessRequests.length > 1 ? 's' : ''}</span>}</>
                    : <span className="badge shared">Shared by {d.ownerName} · {d.access === 'editor' ? 'Can edit' : 'View only'}</span>}
                  <span className="muted">Updated {fmt(d.updatedAt)}</span>
                </span>
              </Link>
              {onDelete && <button className="btn danger" onClick={() => onDelete(d)} aria-label={`Delete ${d.title}`}>Delete</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
