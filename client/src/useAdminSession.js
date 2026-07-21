import { useAuth } from './AuthContext.jsx';

// Thin re-export so existing call sites (and any future ones) read clearly
// as "does this session get admin-only UI" without reaching into useAuth()
// directly. Kept as its own hook mostly for history - now that there's a
// single account model, this is just `isAdmin`.
export function useIsAdminSession() {
  const { isAdmin } = useAuth();
  return isAdmin;
}
