import { useAuth } from './AuthContext.jsx';
import { usePlayerAuth } from './PlayerAuthContext.jsx';

// True for either the hardcoded super-admin session or a player account
// that's been promoted to role: 'admin' - mirrors the server's
// requireAdminRole check (see server/src/userAuth.js), so the UI only shows
// admin-only controls to sessions that the API will actually let through.
export function useIsAdminSession() {
  const { isAdmin } = useAuth();
  const { player } = usePlayerAuth();
  return isAdmin || player?.role === 'admin';
}
