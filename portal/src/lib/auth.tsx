'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { validateKey } from './api';

interface AuthState {
  key: string;
  role: 'owner' | 'client';
  clientId?: string;
  clientName?: string;
}

interface AuthContextValue {
  auth: AuthState | null;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue>({ auth: null, loading: true, error: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('key');

    if (!key) {
      setError('No API key provided. Add ?key=YOUR_KEY to the URL.');
      setLoading(false);
      return;
    }

    validateKey(key)
      .then(result => {
        setAuth({ key, ...result });
      })
      .catch(() => {
        setError('Invalid API key.');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ auth, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
