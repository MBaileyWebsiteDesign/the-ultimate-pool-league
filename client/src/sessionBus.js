// Admin sessions (AuthContext) and player sessions (PlayerAuthContext) are
// two independent React contexts, each backed by its own localStorage key.
// They must be mutually exclusive - logging into one should immediately log
// the other out, in the same tab, without a page reload. A tiny pub/sub is
// the least invasive way to let two independent contexts coordinate without
// merging them into one provider or having either import the other.
const target = new EventTarget();

export function announceLogin(kind) {
  target.dispatchEvent(new CustomEvent('pool-league-login', { detail: { kind } }));
}

export function onLogin(handler) {
  const listener = (e) => handler(e.detail.kind);
  target.addEventListener('pool-league-login', listener);
  return () => target.removeEventListener('pool-league-login', listener);
}

const ADMIN_KEY = 'poolLeagueAdminSession';
const PLAYER_KEY = 'poolLeaguePlayerSession';

// One-time cleanup for browsers that had both an admin and a player session
// stored from before sessions were made mutually exclusive. Keeps whichever
// session was issued more recently (higher expiresAt, since both use the
// same 24h TTL) and drops the other. Safe to call on every app load.
export function reconcileSessions() {
  try {
    const adminRaw = localStorage.getItem(ADMIN_KEY);
    const playerRaw = localStorage.getItem(PLAYER_KEY);
    if (!adminRaw || !playerRaw) return;
    const admin = JSON.parse(adminRaw);
    const player = JSON.parse(playerRaw);
    if ((admin.expiresAt || 0) >= (player.expiresAt || 0)) {
      localStorage.removeItem(PLAYER_KEY);
    } else {
      localStorage.removeItem(ADMIN_KEY);
    }
  } catch {
    // Malformed storage - each context's own loader already guards against this.
  }
}
