import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

export default function DivisionDetail() {
  const { divisionId } = useParams();
  const [division, setDivision] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');

  const load = () => api.getDivision(divisionId).then(setDivision).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionId]);

  const playerName_ = (id) => division.players.find((p) => p.id === id)?.name || '—';

  const onAddPlayer = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.addPlayer(divisionId, playerName);
      setPlayerName('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const onRemovePlayer = async (playerId) => {
    setError('');
    try {
      await api.removePlayer(divisionId, playerId);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const onGenerateFixtures = async () => {
    setError('');
    try {
      await api.generateFixtures(divisionId);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!division) return <p>Loading…</p>;

  const fixturesByRound = {};
  for (const fixture of division.fixtures) {
    (fixturesByRound[fixture.round] ||= []).push(fixture);
  }

  return (
    <div>
      <p><Link to={`/leagues/${division.leagueId}`}>&larr; Back to league</Link></p>
      <h1>{division.name}</h1>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Players</h2>
        {!division.fixturesGenerated && (
          <form className="inline-form" onSubmit={onAddPlayer}>
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Player name"
              required
            />
            <button className="btn btn-primary" type="submit">Add Player</button>
          </form>
        )}
        <ul className="player-list">
          {division.players.map((p) => (
            <li key={p.id}>
              {p.name}
              {!division.fixturesGenerated && (
                <button className="btn-link" onClick={() => onRemovePlayer(p.id)}>remove</button>
              )}
            </li>
          ))}
          {division.players.length === 0 && <li className="muted">No players registered yet</li>}
        </ul>

        {!division.fixturesGenerated ? (
          <button
            className="btn btn-primary"
            disabled={division.players.length < 2}
            onClick={onGenerateFixtures}
            title={division.players.length < 2 ? 'Add at least 2 players first' : ''}
          >
            Generate Fixtures (round robin, play each other once)
          </button>
        ) : (
          <p className="muted">Fixtures generated — player list is locked.</p>
        )}
      </section>

      <section className="card">
        <h2>Standings</h2>
        <table className="standings-table">
          <thead>
            <tr>
              <th>#</th><th>Player</th><th>P</th><th>W</th><th>L</th><th>F</th><th>A</th><th>+/-</th><th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {division.standings.map((row, i) => (
              <tr key={row.playerId}>
                <td>{i + 1}</td>
                <td>{row.playerName}</td>
                <td>{row.played}</td>
                <td>{row.won}</td>
                <td>{row.lost}</td>
                <td>{row.framesFor}</td>
                <td>{row.framesAgainst}</td>
                <td>{row.frameDifference}</td>
                <td><strong>{row.points}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Fixtures</h2>
        {Object.keys(fixturesByRound).length === 0 && <p className="muted">No fixtures yet.</p>}
        {Object.entries(fixturesByRound).map(([round, fixtures]) => (
          <div key={round} className="round-block">
            <h3>Round {round}</h3>
            <ul className="fixture-list">
              {fixtures.map((f) => (
                <li key={f.id}>
                  <Link to={`/fixtures/${f.id}`}>
                    {playerName_(f.homePlayerId)} <strong>{f.homeFrameScore} - {f.awayFrameScore}</strong> {playerName_(f.awayPlayerId)}
                  </Link>
                  <span className={`status status-${f.status}`}>{f.status.replace('_', ' ')}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
