import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

export default function LeagueDetail() {
  const { leagueId } = useParams();
  const [league, setLeague] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = () => api.getLeague(leagueId).then(setLeague).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const onAddDivision = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createDivision(leagueId, { name, order: league.divisions.length });
      setName('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!league) return <p>Loading…</p>;

  return (
    <div>
      <p><Link to="/">&larr; All leagues</Link></p>
      <div className="page-header">
        <div>
          <h1>{league.name}</h1>
          <p className="muted">
            {league.sport} · {league.format.matchFormat}, race to {league.format.raceTo}, single round robin
          </p>
        </div>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New Division'}
        </button>
      </div>

      {showForm && (
        <form className="card form" onSubmit={onAddDivision}>
          <label>
            Division name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Division 1" required />
          </label>
          <button className="btn btn-primary" type="submit">
            Add Division
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      <div className="card-grid">
        {league.divisions.map((division) => (
          <Link key={division.id} to={`/divisions/${division.id}`} className="card card-link">
            <h2>{division.name}</h2>
            <p className="muted">
              {division.playerIds.length} player{division.playerIds.length === 1 ? '' : 's'} ·{' '}
              {division.fixturesGenerated ? 'fixtures generated' : 'not started'}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
