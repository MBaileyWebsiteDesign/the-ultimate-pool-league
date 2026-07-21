import { createContext, useContext, useState, useCallback } from 'react';

// Player/member account session - separate from the admin session in
// AuthContext.jsx. This is what gates the standard "view the site"
// experience (see App.jsx's RequireLogin wrapper): either being logged in
// as admin OR as a registered player is enough to browse.
const PlayerAuthContext = createContext(null);
const STORAGE_KEY = 'poolLeaguePlayerSession';

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

export function PlayerAuthProvider({ children }) {
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

  const value = {
    isPlayerLoggedIn: !!session,
    playerToken: session?.token || null,
    player: session?.user || null,
    login,
    logout,
    updateUser,
  };

  return <PlayerAuthContext.Provider value={value}>{children}</PlayerAuthContext.Provider>;
}

export function usePlayerAuth() {
  const ctx = useContext(PlayerAuthContext);
  if (!ctx) throw new Error('usePlayerAuth must be used within a PlayerAuthProvider');
  return ctx;
}

export function getStoredPlayerToken() {
  return loadStoredSession()?.token || null;
}
