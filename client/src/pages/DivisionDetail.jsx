import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

function SinglesRoster({ division, onChange, setError }) {
  const [playerName, setPlayerName] = useState('');

  const onAddPlayer = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.addPlayer(division.id, playerName);
      setPlayerName('');
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

function TeamRoster({ division, onChange, setError }) {
  const [teamName, setTeamName] = useState('');
  const [playerNames, setPlayerNames] = useState({}); // teamId -> draft player name

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
    setError('');
    try {
      await api.addTeamPlayer(teamId, playerNames[teamId] || '');
      setPlayerNames((prev) => ({ ...prev, [teamId]: '' }));
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
            {!division.fixturesGenerated && (
              <form className="inline-form" onSubmit={(e) => onAddTeamPlayer(e, team.id)}>
                <input
                  value={playerNames[team.id] || ''}
                  onChange={(e) => setPlayerNames((prev) => ({ ...prev, [team.id]: e.target.value }))}
                  placeholder="Player name"
                  required
                />
                <button className="btn btn-primary" type="submit">Add</button>
              </form>
            )}
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
  const [division, setDivision] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.getDivision(divisionId).then(setDivision).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionId]);

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
        <TeamRoster division={division} onChange={load} setError={setError} />
      ) : (
        <SinglesRoster division={division} onChange={load} setError={setError} />
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
