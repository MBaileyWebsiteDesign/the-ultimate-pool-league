import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

function LegNominationForm({ fixture, leg, onChange, setError }) {
  const [homePlayerId, setHomePlayerId] = useState('');
  const [awayPlayerId, setAwayPlayerId] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.nominateLeg(fixture.id, leg.legNumber, homePlayerId, awayPlayerId);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      <select value={homePlayerId} onChange={(e) => setHomePlayerId(e.target.value)} required>
        <option value="" disabled>{fixture.homeTeam.name} player…</option>
        {fixture.homeTeam.players.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <span className="muted">vs</span>
      <select value={awayPlayerId} onChange={(e) => setAwayPlayerId(e.target.value)} required>
        <option value="" disabled>{fixture.awayTeam.name} player…</option>
        {fixture.awayTeam.players.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <button className="btn btn-primary" type="submit">Nominate</button>
    </form>
  );
}

function LegRow({ fixture, leg, onChange, setError }) {
  const complete = leg.status === 'completed';

  const onRecord = async (winnerPlayerId) => {
    setError('');
    try {
      await api.recordLegFrame(fixture.id, leg.legNumber, winnerPlayerId);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  const onUndo = async () => {
    setError('');
    try {
      await api.undoLastLegFrame(fixture.id, leg.legNumber);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="card">
      <div className="page-header">
        <h3 style={{ margin: 0 }}>Leg {leg.legNumber}</h3>
        <span className={`status status-${leg.status === 'pending' ? 'scheduled' : leg.status}`}>
          {leg.status === 'pending' ? 'not nominated' : leg.status.replace('_', ' ')}
        </span>
      </div>

      {leg.status === 'pending' ? (
        <LegNominationForm fixture={fixture} leg={leg} onChange={onChange} setError={setError} />
      ) : (
        <>
          <div className="scoreboard">
            <div className="scoreboard-player">
              <h2><Link to={`/players/${leg.homePlayerId}`}>{leg.homePlayer.name}</Link></h2>
              <div className="score">{leg.homeFrameScore}</div>
              <button className="btn btn-primary" disabled={complete} onClick={() => onRecord(leg.homePlayerId)}>
                Frame won
              </button>
            </div>
            <div className="scoreboard-vs">vs</div>
            <div className="scoreboard-player">
              <h2><Link to={`/players/${leg.awayPlayerId}`}>{leg.awayPlayer.name}</Link></h2>
              <div className="score">{leg.awayFrameScore}</div>
              <button className="btn btn-primary" disabled={complete} onClick={() => onRecord(leg.awayPlayerId)}>
                Frame won
              </button>
            </div>
          </div>
          <div className="page-header">
            <span className="muted">Race to {leg.raceTo}</span>
            <button className="btn" disabled={leg.frames.length === 0} onClick={onUndo}>
              Undo last frame
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TeamFixtureView({ fixture, onChange, setError }) {
  const complete = fixture.status === 'completed';
  const drawn = complete && fixture.winnerTeamId === null;

  if (!fixture.bothEntrantsKnown) {
    return (
      <section className="card scoreboard">
        <div className="scoreboard-player">
          <h2>{fixture.homeTeam ? fixture.homeTeam.name : 'TBD'}</h2>
        </div>
        <div className="scoreboard-vs">vs</div>
        <div className="scoreboard-player">
          <h2>{fixture.awayTeam ? fixture.awayTeam.name : 'TBD'}</h2>
        </div>
        <p className="muted" style={{ width: '100%', textAlign: 'center' }}>
          Waiting on the result of an earlier round before this match can be played.
        </p>
      </section>
    );
  }

  return (
    <div>
      <section className="card scoreboard">
        <div className="scoreboard-player">
          <h2>{fixture.homeTeam.name}</h2>
          <div className="score">{fixture.homeLegsWon}</div>
        </div>
        <div className="scoreboard-vs">legs</div>
        <div className="scoreboard-player">
          <h2>{fixture.awayTeam.name}</h2>
          <div className="score">{fixture.awayLegsWon}</div>
        </div>
      </section>

      {complete && (
        <p className="banner banner-success">
          {drawn
            ? `Team match drawn ${fixture.homeLegsWon}-${fixture.awayLegsWon}`
            : `Match complete: ${fixture.winnerTeamId === fixture.homeTeamId ? fixture.homeTeam.name : fixture.awayTeam.name} win ${Math.max(fixture.homeLegsWon, fixture.awayLegsWon)}-${Math.min(fixture.homeLegsWon, fixture.awayLegsWon)}`}
        </p>
      )}

      {fixture.legs.map((leg) => (
        <LegRow key={leg.legNumber} fixture={fixture} leg={leg} onChange={onChange} setError={setError} />
      ))}
    </div>
  );
}

function SinglesFixtureView({ fixture, onChange, setError }) {
  const complete = fixture.status === 'completed';

  if (!fixture.bothEntrantsKnown) {
    return (
      <section className="card scoreboard">
        <div className="scoreboard-player">
          <h2>{fixture.homePlayer ? <Link to={`/players/${fixture.homePlayerId}`}>{fixture.homePlayer.name}</Link> : 'TBD'}</h2>
        </div>
        <div className="scoreboard-vs">vs</div>
        <div className="scoreboard-player">
          <h2>{fixture.awayPlayer ? <Link to={`/players/${fixture.awayPlayerId}`}>{fixture.awayPlayer.name}</Link> : 'TBD'}</h2>
        </div>
        <p className="muted" style={{ width: '100%', textAlign: 'center' }}>
          Waiting on the result of an earlier round before this match can be played.
        </p>
      </section>
    );
  }

  const onRecord = async (winnerPlayerId) => {
    setError('');
    try {
      await api.recordFrame(fixture.id, winnerPlayerId);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  const onUndo = async () => {
    setError('');
    try {
      await api.undoLastFrame(fixture.id);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <section className="card scoreboard">
        <div className="scoreboard-player">
          <h2><Link to={`/players/${fixture.homePlayerId}`}>{fixture.homePlayer.name}</Link></h2>
          <div className="score">{fixture.homeFrameScore}</div>
          <button className="btn btn-primary" disabled={complete} onClick={() => onRecord(fixture.homePlayerId)}>
            Frame won by {fixture.homePlayer.name}
          </button>
        </div>
        <div className="scoreboard-vs">vs</div>
        <div className="scoreboard-player">
          <h2><Link to={`/players/${fixture.awayPlayerId}`}>{fixture.awayPlayer.name}</Link></h2>
          <div className="score">{fixture.awayFrameScore}</div>
          <button className="btn btn-primary" disabled={complete} onClick={() => onRecord(fixture.awayPlayerId)}>
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

export default function FixtureDetail() {
  const { fixtureId } = useParams();
  const [fixture, setFixture] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.getFixture(fixtureId).then(setFixture).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId]);

  if (!fixture) return <p>Loading…</p>;

  // NB: can't detect team fixtures via `homeTeamId` - it's `null` for TBD
  // knockout slots even on team fixtures. `legs` is always present on team
  // fixture responses (even before both sides are known), never on singles.
  const isTeams = Array.isArray(fixture.legs);

  return (
    <div>
      <p><Link to={`/divisions/${fixture.divisionId}`}>&larr; Back to division</Link></p>
      <h1>Round {fixture.round}{isTeams ? ` · Best of ${fixture.legs.length} legs` : ` · Race to ${fixture.raceTo}`}</h1>
      {error && <p className="error">{error}</p>}

      {isTeams ? (
        <TeamFixtureView fixture={fixture} onChange={load} setError={setError} />
      ) : (
        <SinglesFixtureView fixture={fixture} onChange={load} setError={setError} />
      )}
    </div>
  );
}
