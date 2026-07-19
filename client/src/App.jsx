import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import LeagueList from './pages/LeagueList.jsx';
import LeagueDetail from './pages/LeagueDetail.jsx';
import DivisionDetail from './pages/DivisionDetail.jsx';
import FixtureDetail from './pages/FixtureDetail.jsx';
import Login from './pages/Login.jsx';
import { AuthProvider, useAuth } from './AuthContext.jsx';

function HeaderAuthControl() {
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

function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          🎱 The Ultimate Pool League
        </Link>
        <HeaderAuthControl />
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<LeagueList />} />
          <Route path="/login" element={<Login />} />
          <Route path="/leagues/:leagueId" element={<LeagueDetail />} />
          <Route path="/divisions/:divisionId" element={<DivisionDetail />} />
          <Route path="/fixtures/:fixtureId" element={<FixtureDetail />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
