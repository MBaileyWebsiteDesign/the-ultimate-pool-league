import { createContext, useContext, useState, useCallback } from 'react';

// One account, one login, one session - `isAdmin` and `isCaptain` are just
// flags on the logged-in user rather than a separate identity/session (there
// used to be two entirely separate contexts here, one for a hardcoded admin
// account and one for self-registered players; that's gone now that every
// account is the same kind of thing and can hold any combination of flags).
const AuthContext = createContext(null);
const STORAGE_KEY = 'poolLeagueSession';

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

  const login = useCallback((token, expiresAt, user) => {
    const next = { token, expiresAt, user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  // Refreshes the cached user object after a self-service profile edit or
  // password change, without needing a brand new token.
  const updateUser = useCallback((user) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, user };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const user = session?.user || null;

  const value = {
    isLoggedIn: !!session,
    token: session?.token || null,
    user,
    isAdmin: !!user?.isAdmin,
    isCaptain: !!user?.isCaptain,
    login,
    logout,
    updateUser,
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
