import { useState, type FormEvent } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError('Supabase não está configurado (faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
      return;
    }

    setSubmitting(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);

    if (authError) setError(authError.message);
  }

  return (
    <main>
      <h1>Opportunity AI OS — Login</h1>
      {!isSupabaseConfigured && (
        <p role="alert">Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.</p>
      )}
      <form onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button type="submit" disabled={submitting}>
          {submitting ? 'A entrar...' : 'Entrar'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
