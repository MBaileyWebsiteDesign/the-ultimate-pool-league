import { Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import LeagueList from './pages/LeagueList.jsx';
import LeagueDetail from './pages/LeagueDetail.jsx';
import DivisionDetail from './pages/DivisionDetail.jsx';
import FixtureDetail from './pages/FixtureDetail.jsx';
import PlayerProfile from './pages/PlayerProfile.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import PlayerLogin from './pages/PlayerLogin.jsx';
import Account from './pages/Account.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminUserEdit from './pages/AdminUserEdit.jsx';
import AdminAuditLog from './pages/AdminAuditLog.jsx';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { PlayerAuthProvider, usePlayerAuth } from './PlayerAuthContext.jsx';
import { BreadcrumbProvider } from './BreadcrumbContext.jsx';
import Breadcrumbs from './components/Breadcrumbs.jsx';
import { useIsAdminSession } from './useAdminSession.js';

// Gates the standard "view the site" pages: being logged in as EITHER an
// admin or a registered player is enough. Anonymous visitors are bounced to
// the player login page (registration is one click away from there).
function RequireLogin({ children }) {
  const { isAdmin } = useAuth();
  const { isPlayerLoggedIn } = usePlayerAuth();
  const location = useLocation();

  if (!isAdmin && !isPlayerLoggedIn) {
    return <Navigate to="/account/login" state={{ from: location }} replace />;
  }
  return children;
}

// Gates the "My Account" page: only registered player accounts have a
// db.users record to edit - the hardcoded super-admin has nothing to manage
// here (they'd want /admin/users instead).
function RequirePlayerAccount({ children }) {
  const { isPlayerLoggedIn } = usePlayerAuth();
  const location = useLocation();

  if (!isPlayerLoggedIn) {
    return <Navigate to="/account/login" state={{ from: location }} replace />;
  }
  return children;
}

// Gates the /admin/* user-management pages: either the hardcoded super-admin
// or a player account promoted to role: 'admin' - mirrors the server's
// requireAdminRole check.
function RequireAdminSession({ children }) {
  const isAdminSession = useIsAdminSession();
  const location = useLocation();

  if (!isAdminSession) {
    return <Navigate to="/account/login" state={{ from: location }} replace />;
  }
  return children;
}

function AdminHeaderControl() {
  const { isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  if (!isAdmin) {
    return (
      <Link to="/login" className="header-link">
        Admin Login
      </Link>
    );
  }

  return (
    <span className="header-admin">
      <span className="admin-badge">Admin</span>
      <button
        className="header-link header-link-button"
        onClick={() => {
          logout();
          navigate('/');
        }}
      >
        Log out
      </button>
    </span>
  );
}

function PlayerHeaderControl() {
  const { isPlayerLoggedIn, player, logout } = usePlayerAuth();
  const navigate = useNavigate();

  if (!isPlayerLoggedIn) {
    return (
      <Link to="/account/login" className="header-link">
        Login
      </Link>
    );
  }

  return (
    <span className="header-admin">
      <Link to="/account" className="admin-badge">{player?.firstName || 'Player'}</Link>
      <button
        className="header-link header-link-button"
        onClick={() => {
          logout();
          navigate('/account/login');
        }}
      >
        Log out
      </button>
    </span>
  );
}

function AdminUsersNavLink() {
  const isAdminSession = useIsAdminSession();
  if (!isAdminSession) return null;
  return (
    <Link to="/admin/users" className="header-link">
      Manage Users
    </Link>
  );
}

function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          🎱 The Ultimate Pool League
        </Link>
        <span className="header-accounts">
          <AdminUsersNavLink />
          <PlayerHeaderControl />
          <AdminHeaderControl />
        </span>
      </header>
      <Breadcrumbs />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<RequireLogin><LeagueList /></RequireLogin>} />
          <Route path="/login" element={<Login />} />
          <Route path="/account/login" element={<PlayerLogin />} />
          <Route path="/account/register" element={<Register />} />
          <Route path="/account" element={<RequirePlayerAccount><Account /></RequirePlayerAccount>} />
          <Route path="/admin/users" element={<RequireAdminSession><AdminUsers /></RequireAdminSession>} />
          <Route path="/admin/users/:userId" element={<RequireAdminSession><AdminUserEdit /></RequireAdminSession>} />
          <Route path="/admin/audit-log" element={<RequireAdminSession><AdminAuditLog /></RequireAdminSession>} />
          <Route path="/leagues/:leagueId" element={<RequireLogin><LeagueDetail /></RequireLogin>} />
          <Route path="/divisions/:divisionId" element={<RequireLogin><DivisionDetail /></RequireLogin>} />
          <Route path="/fixtures/:fixtureId" element={<RequireLogin><FixtureDetail /></RequireLogin>} />
          <Route path="/players/:playerId" element={<RequireLogin><PlayerProfile /></RequireLogin>} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PlayerAuthProvider>
        <BreadcrumbProvider>
          <AppShell />
        </BreadcrumbProvider>
      </PlayerAuthProvider>
    </AuthProvider>
  );
}
