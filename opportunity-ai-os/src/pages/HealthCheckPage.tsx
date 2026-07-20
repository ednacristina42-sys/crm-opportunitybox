import { isSupabaseConfigured } from '../lib/supabaseClient';

export function HealthCheckPage() {
  return (
    <main>
      <h1>Health Check</h1>
      <ul>
        <li>App: ok</li>
        <li>
          Ambiente: <code>{import.meta.env.VITE_APP_ENV ?? 'desconhecido'}</code>
        </li>
        <li>
          Supabase configurado: <code>{isSupabaseConfigured ? 'sim' : 'não'}</code>
        </li>
      </ul>
    </main>
  );
}
