import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function LeagueList() {
  const [leagues, setLeagues] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', raceTo: 6 });
  const [showForm, setShowForm] = useState(false);

  const load = () => api.getLeagues().then(setLeagues).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createLeague({ name: form.name, raceTo: Number(form.raceTo) });
      setForm({ name: '', raceTo: 6 });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Leagues</h1>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New League'}
        </button>
      </div>

      {showForm && (
        <form className="card form" onSubmit={onSubmit}>
          <label>
            League name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Top Spin Singles"
              required
            />
          </label>
          <label>
            Race to (frames)
            <input
              type="number"
              min="1"
              value={form.raceTo}
              onChange={(e) => setForm({ ...form, raceTo: e.target.value })}
              required
            />
          </label>
          <button className="btn btn-primary" type="submit">
            Create League
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      <div className="card-grid">
        {leagues.map((league) => (
          <Link key={league.id} to={`/leagues/${league.id}`} className="card card-link">
            <h2>{league.name}</h2>
            <p className="muted">{league.sport}</p>
            <p>
              {league.format.matchFormat} · race to {league.format.raceTo} ·{' '}
              {league.format.scheduling === 'round_robin_single' ? 'round robin (play once)' : league.format.scheduling}
            </p>
          </Link>
        ))}
        {leagues.length === 0 && <p className="muted">No leagues yet. Create one to get started.</p>}
      </div>
    </div>
  );
}
