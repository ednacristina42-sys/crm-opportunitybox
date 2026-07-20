import { createContext } from 'react';
import type { Session } from '@supabase/supabase-js';

export interface AuthContextValue {
  session: Session | null;
  loading: boolean;
}

export const AuthContext = createContext<AuthContextValue>({ session: null, loading: true });
