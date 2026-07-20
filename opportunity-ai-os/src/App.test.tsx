import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginPage } from './auth/LoginPage';

vi.mock('./lib/supabaseClient', () => ({
  supabase: null,
  isSupabaseConfigured: false,
}));

describe('LoginPage', () => {
  it('renders the email, password fields and submit button', () => {
    render(<LoginPage />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });

  it('warns when Supabase is not configured', () => {
    render(<LoginPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/não configurado/i);
  });
});
