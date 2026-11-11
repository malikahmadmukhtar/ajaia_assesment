import { useState } from 'react';
import { api, ApiError } from '../api';
import type { DocView, Role } from '../shared/types';
import { useToast } from '../toast';
import { validateEmail } from '../validation';

export default function ShareDialog({ doc, onChange, onClose }: { doc: DocView; onChange: (d: DocView) => void; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function wrap(fn: () => Promise<DocView>, ok: string): Promise<boolean> {
    setBusy(true);
    try { onChange(await fn()); toast('ok', ok); return true; } catch (e) { toast('error', (e as Error).message); return false; } finally { setBusy(false); }
  }

  async function share() {
    const err = validateEmail(email);
    if (err) { setError(err); return; }
    setError(''); setBusy(true);
    try { onChange(await api.share(doc.id, email.trim(), role)); toast('ok', 'Access updated'); setEmail(''); }
    catch (e) { setError((e as ApiError).fields?.email ?? (e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Share document" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Share “{doc.title}”</h3>

        {doc.accessRequests.length > 0 && (
          <>
            <h4>Edit-access requests <span className="count">{doc.accessRequests.length}</span></h4>
            <ul className="people">
              {doc.accessRequests.map((r) => (
                <li key={r.userId}>
                  <span><strong>{r.name}</strong> <span className="muted small">{r.email}</span>{r.message && <><br /><span className="small">“{r.message}”</span></>}</span>
                  <span className="row">
                    <button className="btn primary" disabled={busy} onClick={() => wrap(() => api.approveRequest(doc.id, r.userId), `${r.name} can now edit`)}>Approve</button>
                    <button className="btn" disabled={busy} onClick={() => wrap(() => api.denyRequest(doc.id, r.userId), 'Request declined')}>Deny</button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <form className="row" onSubmit={(e) => { e.preventDefault(); share(); }} noValidate>
          <input type="email" placeholder="Add person by email" value={email} maxLength={254} aria-label="Email" aria-invalid={!!error}
            onChange={(e) => { setEmail(e.target.value); setError(''); }} />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
            <option value="editor">Can edit</option>
            <option value="viewer">View only</option>
          </select>
          <button className="btn primary" disabled={!email.trim() || busy} type="submit">Share</button>
        </form>
        {error && <small className="err" role="alert">{error}</small>}

        <h4>People with access</h4>
        <ul className="people">
          <li><span>{doc.ownerName}</span><span className="badge owner">Owner</span></li>
          {doc.sharedWith.map((s) => (
            <li key={s.userId}>
              <span>{s.name} <span className="muted small">{s.email}</span></span>
              <span className="row">
                <span className="badge shared">{s.role === 'editor' ? 'Can edit' : 'View only'}</span>
                <button className="btn" disabled={busy} onClick={() => wrap(() => api.unshare(doc.id, s.userId), 'Access removed')}>Remove</button>
              </span>
            </li>
          ))}
          {doc.sharedWith.length === 0 && <li className="muted">Not shared with anyone yet.</li>}
        </ul>
        <div className="row end"><button className="btn" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
