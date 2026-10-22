import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/login', { method: 'POST', body: { password } });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card auth__card" onSubmit={submit}>
        <div className="auth__brand">
          <img src="/icons/icon-192.png" alt="" />
          Budget
        </div>
        <div>
          <h1>Sign in</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Enter the password for this instance.
          </p>
        </div>
        <label className="field">
          <span className="field__label">Password</span>
          <input className="input" type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
          {error && (
            <span className="field__error" role="alert">
              {error}
            </span>
          )}
        </label>
        <button type="submit" className="btn btn--primary btn--block" disabled={busy || !password}>
          Sign in
        </button>
      </form>
    </div>
  );
}
