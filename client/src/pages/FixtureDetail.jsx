import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

export default function FixtureDetail() {
  const { fixtureId } = useParams();
  const [fixture, setFixture] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.getFixture(fixtureId).then(setFixture).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId]);

  const onRecord = async (winnerPlayerId) => {
    setError('');
    try {
      await api.recordFrame(fixtureId, winnerPlayerId);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const onUndo = async () => {
    setError('');
    try {
      await api.undoLastFrame(fixtureId);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!fixture) return <p>Loading…</p>;

  const complete = fixture.status === 'completed';

  return (
    <div>
      <p><Link to={`/divisions/${fixture.divisionId}`}>&larr; Back to division</Link></p>
      <h1>Round {fixture.round} · Race to {fixture.raceTo}</h1>
      {error && <p className="error">{error}</p>}

      <section className="card scoreboard">
        <div className="scoreboard-player">
          <h2>{fixture.homePlayer.name}</h2>
          <div className="score">{fixture.homeFrameScore}</div>
          <button
            className="btn btn-primary"
            disabled={complete}
            onClick={() => onRecord(fixture.homePlayerId)}
          >
            Frame won by {fixture.homePlayer.name}
          </button>
        </div>
        <div className="scoreboard-vs">vs</div>
        <div className="scoreboard-player">
          <h2>{fixture.awayPlayer.name}</h2>
          <div className="score">{fixture.awayFrameScore}</div>
          <button
            className="btn btn-primary"
            disabled={complete}
            onClick={() => onRecord(fixture.awayPlayerId)}
          >
            Frame won by {fixture.awayPlayer.name}
          </button>
        </div>
      </section>

      {complete && (
        <p className="banner banner-success">
          Match complete: {fixture.homePlayer.name} {fixture.homeFrameScore} - {fixture.awayFrameScore} {fixture.awayPlayer.name}
        </p>
      )}

      <section className="card">
        <div className="page-header">
          <h2>Frame history</h2>
          <button className="btn" disabled={fixture.frames.length === 0} onClick={onUndo}>
            Undo last frame
          </button>
        </div>
        <ol className="frame-history">
          {fixture.frames.map((f) => (
            <li key={f.frameNumber}>
              Frame {f.frameNumber}: {f.winnerPlayerId === fixture.homePlayerId ? fixture.homePlayer.name : fixture.awayPlayer.name}
            </li>
          ))}
          {fixture.frames.length === 0 && <li className="muted">No frames recorded yet.</li>}
        </ol>
      </section>
    </div>
  );
}
