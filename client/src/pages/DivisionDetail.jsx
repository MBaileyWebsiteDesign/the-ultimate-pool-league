import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { useSetBreadcrumbs } from '../BreadcrumbContext.jsx';

function SinglesRoster({ division, registeredPlayers, onChange, setError }) {
  const [playerId, setPlayerId] = useState('');
  const alreadyIn = new Set(division.players.map((p) => p.id));
  const available = registeredPlayers.filter((p) => !alreadyIn.has(p.id));

  const onAddPlayer = async (e) => {
    e.preventDefault();
    if (!playerId) return;
    setError('');
    try {
      await api.addPlayer(division.id, playerId);
      setPlayerId('');
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  const onRemovePlayer = async (playerId) => {
    setError('');
    try {
      await api.removePlayer(division.id, playerId);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card">
      <h2>Players</h2>
      {!division.fixturesGenerated && (
        <form className="inline-form" onSubmit={onAddPlayer}>
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} required>
            <option value="" disabled>
              {available.length === 0 ? 'No registered players available' : 'Select a registered player…'}
            </option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit" disabled={!playerId}>Add Player</button>
        </form>
      )}
      <p className="muted" style={{ marginTop: -8, marginBottom: 12, fontSize: '0.8rem' }}>
        Only people with a registered player account can be added - see "My Account" to register.
      </p>
      <ul className="player-list">
        {division.players.map((p) => (
          <li key={p.id}>
            <Link to={`/players/${p.id}`}>{p.name}</Link>
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
          onClick={() => api.generateFixtures(division.id).then(onChange).catch((e) => setError(e.message))}
          title={division.players.length < 2 ? 'Add at least 2 players first' : ''}
        >
          Generate Fixtures (round robin, play each other once)
        </button>
      ) : (
        <p className="muted">Fixtures generated — player list is locked.</p>
      )}
    </section>
  );
}

// Admin-only tool for handling a player dropping out mid-season: pick who's
// leaving and who's replacing them, and every fixture of theirs that hasn't
// been played yet gets handed to the replacement. Completed fixtures (and
// any that already have some frames recorded) are left untouched - the
// outgoing player's record up to that point stays exactly as it was, it just
// stops growing, while the incoming player picks up from there. Only shown
// once fixtures exist to reassign; before that, dropping someone and adding
// someone else through the roster list above does the same thing more
// directly.
function PlayerSubstitutionPanel({ division, registeredPlayers, onChange, setError }) {
  const [outgoingId, setOutgoingId] = useState('');
  const [incomingId, setIncomingId] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const alreadyIn = new Set(division.players.map((p) => p.id));
  const available = registeredPlayers.filter((p) => !alreadyIn.has(p.id));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!outgoingId || !incomingId) return;
    setError('');
    setResult(null);
    setSubmitting(true);
    try {
      const res = await api.substitutePlayer(division.id, outgoingId, incomingId);
      setResult(res);
      setOutgoingId('');
      setIncomingId('');
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card">
      <h2>Substitute a Player</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 12, fontSize: '0.8rem' }}>
        If a player drops out, swap them for a replacement here. Completed matches (and any
        already partway through) are left exactly as they are - only the outgoing player's
        remaining, not-yet-started fixtures move to the replacement.
      </p>
      <form className="inline-form" onSubmit={onSubmit}>
        <select value={outgoingId} onChange={(e) => setOutgoingId(e.target.value)} required>
          <option value="" disabled>Player dropping out…</option>
          {division.players.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select value={incomingId} onChange={(e) => setIncomingId(e.target.value)} required>
          <option value="" disabled>
            {available.length === 0 ? 'No registered players available' : 'Replacement player…'}
          </option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className="btn btn-primary" type="submit" disabled={!outgoingId || !incomingId || submitting}>
          {submitting ? 'Swapping…' : 'Swap Player'}
        </button>
      </form>

      {result && (
        <div className="banner banner-success" style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>
            {result.swapped.length} remaining fixture{result.swapped.length === 1 ? '' : 's'} reassigned to the replacement.
            {result.blockedInProgress.length > 0 && (
              <>
                {' '}{result.blockedInProgress.length} fixture{result.blockedInProgress.length === 1 ? '' : 's'} already had frames
                recorded and were left with the outgoing player - finish or override those first if they need to change hands too.
              </>
            )}
          </p>
        </div>
      )}

      {division.substitutions && division.substitutions.length > 0 && (
        <>
          <h3 style={{ fontSize: '1rem', color: 'var(--muted)', marginTop: 16 }}>Substitution history</h3>
          <ul className="fixture-list">
            {division.substitutions.map((s) => (
              <li key={s.id}>
                <span>{s.outgoingPlayerName} &rarr; {s.incomingPlayerName} ({s.fixturesSwapped} fixture{s.fixturesSwapped === 1 ? '' : 's'})</span>
                <span className="muted">{new Date(s.at).toLocaleDateString()} · {s.by}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function TeamRoster({ division, registeredPlayers, onChange, setError }) {
  const [teamName, setTeamName] = useState('');
  const [playerIds, setPlayerIds] = useState({}); // teamId -> selected registered playerId
  // A player can only be on one roster within a division at a time.
  const assignedElsewhere = new Set(division.teams.flatMap((t) => t.players.map((p) => p.id)));

  const onAddTeam = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.createTeam(division.id, teamName);
      setTeamName('');
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  const onRemoveTeam = async (teamId) => {
    setError('');
    try {
      await api.removeTeam(division.id, teamId);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  const onAddTeamPlayer = async (e, teamId) => {
    e.preventDefault();
    const selected = playerIds[teamId];
    if (!selected) return;
    setError('');
    try {
      await api.addTeamPlayer(teamId, selected);
      setPlayerIds((prev) => ({ ...prev, [teamId]: '' }));
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  const onRemoveTeamPlayer = async (teamId, playerId) => {
    setError('');
    try {
      await api.removeTeamPlayer(teamId, playerId);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };

  const enoughPlayers = division.teams.every((t) => t.players.length >= 1);
  const canGenerate = division.teams.length >= 2 && enoughPlayers;

  return (
    <section className="card">
      <h2>Teams</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 12, fontSize: '0.8rem' }}>
        Only people with a registered player account can be added to a team roster.
      </p>
      {!division.fixturesGenerated && (
        <form className="inline-form" onSubmit={onAddTeam}>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            required
          />
          <button className="btn btn-primary" type="submit">Add Team</button>
        </form>
      )}

      <div className="card-grid">
        {division.teams.map((team) => (
          <div key={team.id} className="card">
            <div className="page-header">
              <h3 style={{ margin: 0 }}>{team.name}</h3>
              {!division.fixturesGenerated && (
                <button className="btn-link" onClick={() => onRemoveTeam(team.id)}>remove team</button>
              )}
            </div>
            <ul className="player-list">
              {team.players.map((p) => (
                <li key={p.id}>
                  <Link to={`/players/${p.id}`}>{p.name}</Link>
                  {!division.fixturesGenerated && (
                    <button className="btn-link" onClick={() => onRemoveTeamPlayer(team.id, p.id)}>remove</button>
                  )}
                </li>
              ))}
              {team.players.length === 0 && <li className="muted">No players yet</li>}
            </ul>
            {!division.fixturesGenerated && (() => {
              const teamAvailable = registeredPlayers.filter((p) => !assignedElsewhere.has(p.id));
              return (
                <form className="inline-form" onSubmit={(e) => onAddTeamPlayer(e, team.id)}>
                  <select
                    value={playerIds[team.id] || ''}
                    onChange={(e) => setPlayerIds((prev) => ({ ...prev, [team.id]: e.target.value }))}
                    required
                  >
                    <option value="" disabled>
                      {teamAvailable.length === 0 ? 'No registered players available' : 'Select a registered player…'}
                    </option>
                    {teamAvailable.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button className="btn btn-primary" type="submit" disabled={!playerIds[team.id]}>Add</button>
                </form>
              );
            })()}
          </div>
        ))}
        {division.teams.length === 0 && <p className="muted">No teams registered yet</p>}
      </div>

      {!division.fixturesGenerated ? (
        <button
          className="btn btn-primary"
          disabled={!canGenerate}
          onClick={() => api.generateFixtures(division.id).then(onChange).catch((e) => setError(e.message))}
          title={!canGenerate ? 'Add at least 2 teams, each with at least 1 player' : ''}
        >
          Generate Fixtures (round robin, play each other once)
        </button>
      ) : (
        <p className="muted">Fixtures generated — team rosters are locked.</p>
      )}
    </section>
  );
}

export default function DivisionDetail() {
  const { divisionId } = useParams();
  const { isAdmin } = useAuth();
  const [division, setDivision] = useState(null);
  const [registeredPlayers, setRegisteredPlayers] = useState([]);
  const [error, setError] = useState('');

  const load = () => api.getDivision(divisionId).then(setDivision).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api.getRegisteredPlayers().then(setRegisteredPlayers).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionId]);

  useSetBreadcrumbs(
    division
      ? [
          { label: 'Home', to: '/' },
          { label: division.leagueName || 'League', to: `/leagues/${division.leagueId}` },
          { label: division.name },
        ]
      : [{ label: 'Home', to: '/' }, { label: 'Loading…' }]
  );

  if (!division) return <p>Loading…</p>;

  const isTeams = division.entryType === 'teams';
  const nameOf = (id) =>
    (isTeams ? division.teams : division.players).find((x) => x.id === id)?.name || '—';

  const fixturesByRound = {};
  for (const fixture of division.fixtures) {
    (fixturesByRound[fixture.round] ||= []).push(fixture);
  }

  return (
    <div>
      <p><Link to={`/leagues/${division.leagueId}`}>&larr; Back to league</Link></p>
      <h1>{division.name}</h1>
      <p className="muted">
        {isTeams ? `Team league · ${division.legsPerMatch} legs per match` : 'Singles league'}
      </p>
      {error && <p className="error">{error}</p>}

      {isTeams ? (
        <TeamRoster division={division} registeredPlayers={registeredPlayers} onChange={load} setError={setError} />
      ) : (
        <SinglesRoster division={division} registeredPlayers={registeredPlayers} onChange={load} setError={setError} />
      )}

      {isAdmin && !isTeams && division.fixturesGenerated && (
        <PlayerSubstitutionPanel division={division} registeredPlayers={registeredPlayers} onChange={load} setError={setError} />
      )}

      <section className="card">
        <h2>Standings</h2>
        <table className="standings-table">
          {isTeams ? (
            <>
              <thead>
                <tr>
                  <th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>LF</th><th>LA</th><th>+/-</th><th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {division.standings.map((row, i) => (
                  <tr key={row.teamId}>
                    <td>{i + 1}</td>
                    <td>{row.teamName}</td>
                    <td>{row.played}</td>
                    <td>{row.won}</td>
                    <td>{row.drawn}</td>
                    <td>{row.lost}</td>
                    <td>{row.legsFor}</td>
                    <td>{row.legsAgainst}</td>
                    <td>{row.legDifference}</td>
                    <td><strong>{row.points}</strong></td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead>
                <tr>
                  <th>#</th><th>Player</th><th>P</th><th>W</th><th>L</th><th>F</th><th>A</th><th>+/-</th><th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {division.standings.map((row, i) => (
                  <tr key={row.playerId}>
                    <td>{i + 1}</td>
                    <td><Link to={`/players/${row.playerId}`}>{row.playerName}</Link></td>
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
            </>
          )}
        </table>
      </section>

      <section className="card">
        <h2>Fixtures</h2>
        {Object.keys(fixturesByRound).length === 0 && <p className="muted">No fixtures yet.</p>}
        {Object.entries(fixturesByRound).map(([round, fixtures]) => (
          <div key={round} className="round-block">
            <h3>Round {round}</h3>
            <ul className="fixture-list">
              {fixtures.map((f) => {
                const homeId = isTeams ? f.homeTeamId : f.homePlayerId;
                const awayId = isTeams ? f.awayTeamId : f.awayPlayerId;
                const homeScore = isTeams ? f.homeLegsWon : f.homeFrameScore;
                const awayScore = isTeams ? f.awayLegsWon : f.awayFrameScore;
                return (
                  <li key={f.id}>
                    <Link to={`/fixtures/${f.id}`}>
                      {nameOf(homeId)} <strong>{homeScore} - {awayScore}</strong> {nameOf(awayId)}
                    </Link>
                    <span className={`status status-${f.status}`}>{f.status.replace('_', ' ')}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
