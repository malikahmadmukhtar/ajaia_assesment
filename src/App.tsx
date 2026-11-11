import { Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { api } from './api';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import Login from './pages/Login';
import { useSession } from './session';

export default function App() {
  const { user, loading, setUser } = useSession();
  const nav = useNavigate();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">📄 Ajaia Docs</Link>
        <span className="spacer" />
        <span className="muted" title={user.email}>{user.name}</span>
        <button className="btn" onClick={async () => { await api.logout(); setUser(null); nav('/'); }}>Log out</button>
      </header>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/d/:id" element={<Editor />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
