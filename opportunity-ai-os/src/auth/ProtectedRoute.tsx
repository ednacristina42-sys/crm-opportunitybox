import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) return <p>A verificar sessão...</p>;
  if (!session) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
