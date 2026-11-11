import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { DEMO_PASSWORD, PASSWORD_MAX, SEED_USERS } from '../shared/types';
import { useToast } from '../toast';
import { validateEmail, validateName, validatePassword } from '../validation';

type Mode = 'login' | 'signup';
type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>;

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const { setUser } = useSession();
  const toast = useToast();

  function switchMode(m: Mode) { setMode(m); setErrors({}); }

  async function submit(e?: FormEvent, creds?: { email: string; password: string }) {
    e?.preventDefault();
    const em = creds?.email ?? email, pw = creds?.password ?? password;
    const errs: Errors = {
      email: validateEmail(em) || undefined,
      password: (mode === 'signup' && !creds ? validatePassword(pw) : pw ? '' : 'Password is required.') || undefined,
      name: mode === 'signup' && !creds ? validateName(name) || undefined : undefined,
    };
    if (errs.email || errs.password || errs.name) { setErrors(errs); return; }
    setErrors({}); setBusy(true);
    try {
      setUser(mode === 'signup' && !creds ? await api.signup(name.trim(), em.trim(), pw) : await api.login(em.trim(), pw));
    } catch (err) {
      const a = err as ApiError;
      setErrors({ ...a.fields, form: a.fields ? undefined : a.message });
      if (!a.fields && a.status === 0) toast('error', a.message);
    } finally { setBusy(false); }
  }

  return (
    <main className="login">
      <h1>📄 Ajaia Docs</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => switchMode('login')}>Sign in</button>
        <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchMode('signup')}>Sign up</button>
      </div>

      <form className="card form" onSubmit={submit} noValidate>
        {errors.form && <div className="banner" role="alert">{errors.form}</div>}
        {mode === 'signup' && (
          <Field label="Name" error={errors.name}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" aria-invalid={!!errors.name} />
          </Field>
        )}
        <Field label="Email" error={errors.email}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} aria-invalid={!!errors.email} />
        </Field>
        <Field label="Password" error={errors.password} hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={PASSWORD_MAX}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} aria-invalid={!!errors.password} />
        </Field>
        <button className="btn primary" disabled={busy} type="submit">{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </form>

      <div className="card">
        <p className="muted small">Reviewing? Use a demo account (password <code>{DEMO_PASSWORD}</code>) — sign in as two of them in different browsers to try sharing.</p>
        <div className="demo-row">
          {SEED_USERS.map((u) => (
            <button key={u.id} className="btn" disabled={busy} onClick={() => { setMode('login'); setEmail(u.email); setPassword(DEMO_PASSWORD); submit(undefined, { email: u.email, password: DEMO_PASSWORD }); }}>
              {u.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <small className="err" role="alert">{error}</small> : hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}
