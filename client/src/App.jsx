import { Routes, Route, Link } from 'react-router-dom';
import LeagueList from './pages/LeagueList.jsx';
import LeagueDetail from './pages/LeagueDetail.jsx';
import DivisionDetail from './pages/DivisionDetail.jsx';
import FixtureDetail from './pages/FixtureDetail.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          🎱 The Ultimate Pool League
        </Link>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<LeagueList />} />
          <Route path="/leagues/:leagueId" element={<LeagueDetail />} />
          <Route path="/divisions/:divisionId" element={<DivisionDetail />} />
          <Route path="/fixtures/:fixtureId" element={<FixtureDetail />} />
        </Routes>
      </main>
    </div>
  );
}
