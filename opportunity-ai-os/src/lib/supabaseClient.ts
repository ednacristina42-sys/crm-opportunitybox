import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Nunca hardcode a URL/chave aqui — vêm sempre de variáveis de ambiente.
// Sem elas, devolve null em vez de rebentar o arranque da app (permite o
// health check e a shell inicial funcionarem antes do .env estar configurado).
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
