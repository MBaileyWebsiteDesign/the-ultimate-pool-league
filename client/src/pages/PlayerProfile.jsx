import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

export default function PlayerProfile() {
  const { playerId } = useParams();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPlayerProfile(playerId).then(setProfile).catch((e) => setError(e.message));
  }, [playerId]);

  if (error) return <p className="error">{error}</p>;
  if (!profile) return <p>Loading…</p>;

  const { career } = profile;
  const winPct = career.played > 0 ? Math.round((career.won / career.played) * 100) : 0;

  return (
    <div>
      <h1>{profile.name}</h1>
      <p className="muted">Career record across every league and division</p>

      <section className="card">
        <h2>Career</h2>
        <div className="card-grid">
          <div><strong>{career.played}</strong><div className="muted">Played</div></div>
          <div><strong>{career.won}</strong><div className="muted">Won</div></div>
          <div><strong>{career.lost}</strong><div className="muted">Lost</div></div>
          <div><strong>{winPct}%</strong><div className="muted">Win rate</div></div>
          <div><strong>{career.framesFor}-{career.framesAgainst}</strong><div className="muted">Frames for/against</div></div>
          <div><strong>{career.frameDifference > 0 ? '+' : ''}{career.frameDifference}</strong><div className="muted">Frame diff</div></div>
        </div>
      </section>

      <section className="card">
        <h2>Head-to-head</h2>
        {profile.headToHead.length === 0 ? (
          <p className="muted">No completed matches yet.</p>
        ) : (
          <table className="standings-table">
            <thead>
              <tr><th>Opponent</th><th>P</th><th>W</th><th>L</th></tr>
            </thead>
            <tbody>
              {profile.headToHead.map((h) => (
                <tr key={h.opponentId}>
                  <td style={{ textAlign: 'left' }}>{h.opponentName}</td>
                  <td>{h.played}</td>
                  <td>{h.won}</td>
                  <td>{h.lost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Match history</h2>
        {profile.results.length === 0 ? (
          <p className="muted">No completed matches yet.</p>
        ) : (
          <ul className="fixture-list">
            {profile.results.map((r, i) => (
              <li key={i}>
                <Link to={`/fixtures/${r.fixtureId}`}>
                  vs {r.opponentName} <strong>{r.forScore}-{r.againstScore}</strong>
                  <span className="muted"> · {r.leagueName} / {r.divisionName} ({r.context})</span>
                </Link>
                <span className={`status ${r.result === 'win' ? 'status-completed' : ''}`}>{r.result}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
