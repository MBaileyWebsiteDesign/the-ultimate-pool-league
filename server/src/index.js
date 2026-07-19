import express from 'express';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readDb, writeDb } from './db.js';
import { generateRoundRobin } from './services/roundRobin.js';
import { computeStandings } from './services/standings.js';
import { ApiError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');

const app = express();
app.use(cors());
app.use(express.json());

const asyncRoute = (fn) => (req, res, next) => {
  try {
    fn(req, res);
  } catch (err) {
    next(err);
  }
};

// ---------- Leagues ----------

app.get('/api/leagues', asyncRoute((req, res) => {
  const db = readDb();
  res.json(db.leagues);
}));

app.post('/api/leagues', asyncRoute((req, res) => {
  const { name, sport = 'English 8-Ball Pool', matchFormat = 'singles', raceTo = 6, scheduling = 'round_robin_single' } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'League name is required');

  const db = readDb();
  const league = {
    id: uuid(),
    name: name.trim(),
    sport,
    format: { matchFormat, raceTo, scheduling },
    createdAt: new Date().toISOString(),
  };
  db.leagues.push(league);
  writeDb(db);
  res.status(201).json(league);
}));

app.get('/api/leagues/:id', asyncRoute((req, res) => {
  const db = readDb();
  const league = db.leagues.find((l) => l.id === req.params.id);
  if (!league) throw new ApiError(404, 'League not found');
  const divisions = db.divisions
    .filter((d) => d.leagueId === league.id)
    .sort((a, b) => a.order - b.order);
  res.json({ ...league, divisions });
}));

// ---------- Divisions ----------

app.post('/api/leagues/:leagueId/divisions', asyncRoute((req, res) => {
  const { name, order = 0 } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Division name is required');

  const db = readDb();
  const league = db.leagues.find((l) => l.id === req.params.leagueId);
  if (!league) throw new ApiError(404, 'League not found');

  const division = {
    id: uuid(),
    leagueId: league.id,
    name: name.trim(),
    order,
    playerIds: [],
    fixturesGenerated: false,
  };
  db.divisions.push(division);
  writeDb(db);
  res.status(201).json(division);
}));

function hydrateDivision(db, division) {
  const fixtures = db.fixtures.filter((f) => f.divisionId === division.id);
  const players = db.players.filter((p) => division.playerIds.includes(p.id));
  const standings = computeStandings(division, db.fixtures, db.players);
  return { ...division, players, fixtures, standings };
}

app.get('/api/divisions/:id', asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  res.json(hydrateDivision(db, division));
}));

app.post('/api/divisions/:id/players', asyncRoute((req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Player name is required');

  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.fixturesGenerated) {
    throw new ApiError(400, 'Cannot add players after fixtures have been generated for this division');
  }

  let player = db.players.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  if (!player) {
    player = { id: uuid(), name: name.trim() };
    db.players.push(player);
  }
  if (!division.playerIds.includes(player.id)) {
    division.playerIds.push(player.id);
  }
  writeDb(db);
  res.status(201).json(hydrateDivision(db, division));
}));

app.delete('/api/divisions/:id/players/:playerId', asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.fixturesGenerated) {
    throw new ApiError(400, 'Cannot remove players after fixtures have been generated for this division');
  }
  division.playerIds = division.playerIds.filter((id) => id !== req.params.playerId);
  writeDb(db);
  res.json(hydrateDivision(db, division));
}));

app.post('/api/divisions/:id/generate-fixtures', asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  const league = db.leagues.find((l) => l.id === division.leagueId);
  if (division.playerIds.length < 2) {
    throw new ApiError(400, 'A division needs at least 2 players before fixtures can be generated');
  }
  if (division.fixturesGenerated) {
    throw new ApiError(400, 'Fixtures have already been generated for this division');
  }

  const rounds = generateRoundRobin(division.playerIds);
  rounds.forEach((pairs, roundIndex) => {
    pairs.forEach(([homePlayerId, awayPlayerId]) => {
      db.fixtures.push({
        id: uuid(),
        leagueId: league.id,
        divisionId: division.id,
        round: roundIndex + 1,
        homePlayerId,
        awayPlayerId,
        raceTo: league.format.raceTo,
        frames: [], // each entry: { frameNumber, winnerPlayerId }
        homeFrameScore: 0,
        awayFrameScore: 0,
        status: 'scheduled', // scheduled -> in_progress -> completed
        winnerPlayerId: null,
      });
    });
  });
  division.fixturesGenerated = true;
  writeDb(db);
  res.status(201).json(hydrateDivision(db, division));
}));

// ---------- Fixtures / frame scoring ----------

app.get('/api/fixtures/:id', asyncRoute((req, res) => {
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  const homePlayer = db.players.find((p) => p.id === fixture.homePlayerId);
  const awayPlayer = db.players.find((p) => p.id === fixture.awayPlayerId);
  res.json({ ...fixture, homePlayer, awayPlayer });
}));

app.post('/api/fixtures/:id/frames', asyncRoute((req, res) => {
  const { winnerPlayerId } = req.body;
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  if (fixture.status === 'completed') {
    throw new ApiError(400, `Match is already complete (${fixture.homeFrameScore}-${fixture.awayFrameScore}). Undo a frame to make corrections.`);
  }
  if (![fixture.homePlayerId, fixture.awayPlayerId].includes(winnerPlayerId)) {
    throw new ApiError(400, 'winnerPlayerId must be one of the two players in this fixture');
  }

  fixture.frames.push({ frameNumber: fixture.frames.length + 1, winnerPlayerId });
  fixture.homeFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.homePlayerId).length;
  fixture.awayFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.awayPlayerId).length;
  fixture.status = 'in_progress';

  if (fixture.homeFrameScore >= fixture.raceTo) {
    fixture.status = 'completed';
    fixture.winnerPlayerId = fixture.homePlayerId;
  } else if (fixture.awayFrameScore >= fixture.raceTo) {
    fixture.status = 'completed';
    fixture.winnerPlayerId = fixture.awayPlayerId;
  }

  writeDb(db);
  res.json(fixture);
}));

app.delete('/api/fixtures/:id/frames/last', asyncRoute((req, res) => {
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  if (fixture.frames.length === 0) throw new ApiError(400, 'No frames recorded yet');

  fixture.frames.pop();
  fixture.homeFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.homePlayerId).length;
  fixture.awayFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.awayPlayerId).length;
  fixture.winnerPlayerId = null;
  fixture.status = fixture.frames.length === 0 ? 'scheduled' : 'in_progress';

  writeDb(db);
  res.json(fixture);
}));

// ---------- Players ----------

app.get('/api/players', asyncRoute((req, res) => {
  const db = readDb();
  res.json(db.players);
}));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Serve the built React client, if present ----------
// (`npm run build` in /client produces /client/dist; when present we serve
// it here so the whole app runs from a single `npm start` on one port. In
// local development, run the Vite dev server separately instead - see
// README - so you get hot reload.)
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// ---------- Error handling ----------

app.use((err, req, res, next) => {
  const status = err instanceof ApiError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Pool League API listening on http://localhost:${PORT}`);
});
