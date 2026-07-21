import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { announceLogin, onLogin } from './sessionBus.js';

const AuthContext = createContext(null);
const STORAGE_KEY = 'poolLeagueAdminSession';

function loadStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || !session.expiresAt || Date.now() > session.expiresAt) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(loadStoredSession);

  // Admin and player sessions are mutually exclusive - if a player logs in
  // elsewhere in the app, drop any admin session immediately.
  useEffect(() => onLogin((kind) => {
    if (kind === 'player') {
      localStorage.removeItem(STORAGE_KEY);
      setSession(null);
    }
  }), []);

  const login = useCallback((token, expiresAt) => {
    const next = { token, expiresAt };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
    announceLogin('admin');
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const value = {
    isAdmin: !!session,
    token: session?.token || null,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export function getStoredToken() {
  return loadStoredSession()?.token || null;
}
