import express from 'express';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readDb, writeDb } from './db.js';
import { generateRoundRobin } from './services/roundRobin.js';
import { buildBracketRounds } from './services/bracket.js';
import { computeStandings } from './services/standings.js';
import { computeTeamStandings } from './services/teamStandings.js';
import { buildPlayerProfile } from './services/playerProfile.js';
import { ApiError } from './errors.js';
import { login } from './auth.js';
import {
  CLASSIFICATIONS,
  hashPassword,
  verifyPassword,
  createUserToken,
  verifyUserToken,
  publicUser,
  requireUser,
  requireAnyAuth,
  requireAdminRole,
} from './userAuth.js';
import { recordAudit } from './services/auditLog.js';

const ROLES = ['player', 'admin'];
const STATUSES = ['active', 'suspended'];

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

const SCHEDULING_TYPES = ['round_robin_single', 'knockout_single_elim'];

// ---------- Auth ----------
// Single hardcoded admin account (see auth.js for why). Only league and
// division *creation* are gated behind this for now, per the current
// requirement - team/player management, fixture generation and match
// scoring remain open. Tighten further (e.g. captain-only scoring) later.

app.post('/api/auth/login', asyncRoute((req, res) => {
  const { username, password } = req.body;
  const { token, expiresAt } = login(username, password);
  res.json({ token, expiresAt });
}));

// ---------- Player/member accounts ----------
// Separate from the single admin account above: anyone can self-register a
// player account, and having *either* kind of account is what's required to
// view the standard site (see requireAnyAuth in userAuth.js). Stored in the
// same JSON db as everything else, in db.users.

app.post('/api/users/register', asyncRoute((req, res) => {
  const {
    firstName, lastName, email, password,
    phone = '', venue, teamName, classification = null,
  } = req.body;

  if (!firstName || !firstName.trim()) throw new ApiError(400, 'First name is required');
  if (!lastName || !lastName.trim()) throw new ApiError(400, 'Last name is required');
  if (!email || !email.trim()) throw new ApiError(400, 'Email is required');
  if (!password || password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
  if (!venue || !venue.trim()) throw new ApiError(400, 'Venue is required');
  if (!teamName || !teamName.trim()) throw new ApiError(400, 'Team name is required');
  if (classification && !CLASSIFICATIONS.includes(classification)) {
    throw new ApiError(400, `classification must be one of: ${CLASSIFICATIONS.join(', ')}`);
  }

  const db = readDb();
  const normalizedEmail = email.trim().toLowerCase();
  if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  // Every registered account gets a linked `Player` roster record under the
  // same name (find-or-create, matching the same case-insensitive dedup used
  // when a captain adds a player directly) - this is what lets "my stats"
  // on the account page point somewhere immediately, even before they've
  // been added to a division. See the README data model note on User vs
  // Player for the known limitation (name collisions merge onto one Player).
  const fullName = `${firstName.trim()} ${lastName.trim()}`;
  let linkedPlayer = db.players.find((p) => p.name.toLowerCase() === fullName.toLowerCase());
  if (!linkedPlayer) {
    linkedPlayer = { id: uuid(), name: fullName };
    db.players.push(linkedPlayer);
  }

  const user = {
    id: uuid(),
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.trim(),
    passwordHash: hashPassword(password),
    phone: phone ? phone.trim() : '',
    venue: venue.trim(),
    teamName: teamName.trim(),
    classification: classification || null,
    role: 'player',
    status: 'active',
    playerId: linkedPlayer.id,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  ensureVenue(db, user.venue, user.id, `${user.firstName} ${user.lastName}`);
  writeDb(db);

  const { token, expiresAt } = createUserToken(user.id);
  res.status(201).json({ token, expiresAt, user: publicUser(user) });
}));

app.post('/api/users/login', asyncRoute((req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ApiError(400, 'Email and password are required');

  const db = readDb();
  const normalizedEmail = email.trim().toLowerCase();
  const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new ApiError(401, 'Invalid email or password');
  }
  if (user.status === 'suspended') {
    throw new ApiError(403, 'This account has been suspended');
  }

  const { token, expiresAt } = createUserToken(user.id);
  res.json({ token, expiresAt, user: publicUser(user) });
}));

app.get('/api/users/me', requireUser, asyncRoute((req, res) => {
  res.json(publicUser(req.playerSession.user));
}));

// Keeps a User's linked Player roster entry's display name in sync whenever
// the account's name changes, whether the edit came from the player
// themselves or from an admin.
function syncLinkedPlayerName(db, user) {
  if (!user.playerId) return;
  const player = db.players.find((p) => p.id === user.playerId);
  if (player) player.name = `${user.firstName} ${user.lastName}`;
}

// Venues are a curated, admin-approved list, but a player shouldn't have to
// stop and file a separate "request" before they can register or save their
// profile - so setting `venue` to a name that isn't already known (whether at
// registration or later editing, by the player themselves or an admin on
// their behalf) implicitly creates a pending Venue entry for it. It's usable
// as that player's own venue text immediately either way; approval only
// gates whether it shows up in the shared dropdown for everyone else.
function ensureVenue(db, venueName, requestedByUserId, requestedByName) {
  const trimmed = venueName.trim();
  const existing = db.venues.find((v) => v.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  const venue = {
    id: uuid(),
    name: trimmed,
    status: 'pending',
    requestedBy: requestedByUserId,
    requestedByName,
    requestedAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null,
  };
  db.venues.push(venue);
  return venue;
}

function applyProfileFields(db, user, fields) {
  const { firstName, lastName, email, phone, venue, teamName, classification } = fields;
  if (firstName !== undefined) {
    if (!firstName || !firstName.trim()) throw new ApiError(400, 'First name is required');
    user.firstName = firstName.trim();
  }
  if (lastName !== undefined) {
    if (!lastName || !lastName.trim()) throw new ApiError(400, 'Last name is required');
    user.lastName = lastName.trim();
  }
  if (email !== undefined) {
    if (!email || !email.trim()) throw new ApiError(400, 'Email is required');
    const normalized = email.trim().toLowerCase();
    if (db.users.some((u) => u.id !== user.id && u.email.toLowerCase() === normalized)) {
      throw new ApiError(409, 'An account with this email already exists');
    }
    user.email = email.trim();
  }
  if (phone !== undefined) user.phone = phone ? phone.trim() : '';
  if (venue !== undefined) {
    if (!venue || !venue.trim()) throw new ApiError(400, 'Venue is required');
    user.venue = venue.trim();
    ensureVenue(db, user.venue, user.id, `${user.firstName} ${user.lastName}`);
  }
  if (teamName !== undefined) {
    if (!teamName || !teamName.trim()) throw new ApiError(400, 'Team name is required');
    user.teamName = teamName.trim();
  }
  if (classification !== undefined) {
    if (classification && !CLASSIFICATIONS.includes(classification)) {
      throw new ApiError(400, `classification must be one of: ${CLASSIFICATIONS.join(', ')}`);
    }
    user.classification = classification || null;
  }
  syncLinkedPlayerName(db, user);
}

app.patch('/api/users/me', requireUser, asyncRoute((req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.playerSession.userId);
  applyProfileFields(db, user, req.body);
  writeDb(db);
  res.json(publicUser(user));
}));

app.post('/api/users/me/change-password', requireUser, asyncRoute((req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, 'Current and new password are required');
  }
  if (newPassword.length < 8) throw new ApiError(400, 'New password must be at least 8 characters');

  const db = readDb();
  const user = db.users.find((u) => u.id === req.playerSession.userId);
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new ApiError(401, 'Current password is incorrect');
  }
  user.passwordHash = hashPassword(newPassword);
  writeDb(db);
  res.json({ ok: true });
}));

// ---------- Leagues ----------

app.get('/api/leagues', requireAnyAuth, asyncRoute((req, res) => {
  const db = readDb();
  res.json(db.leagues);
}));

app.post('/api/leagues', requireAdminRole, asyncRoute((req, res) => {
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

app.get('/api/leagues/:id', requireAnyAuth, asyncRoute((req, res) => {
  const db = readDb();
  const league = db.leagues.find((l) => l.id === req.params.id);
  if (!league) throw new ApiError(404, 'League not found');
  const divisions = db.divisions
    .filter((d) => d.leagueId === league.id)
    .sort((a, b) => a.order - b.order);
  res.json({ ...league, divisions });
}));

// ---------- Divisions ----------
// A division has two independent axes:
// - entryType: "singles" (players register directly) or "teams" (teams
//   register, each fixture is `legsPerMatch` nominated player-vs-player legs)
// - scheduling: "round_robin_single" (default - everyone plays everyone once)
//   or "knockout_single_elim" (single-elimination bracket, byes if the
//   entrant count isn't a power of 2). This can differ per division from the
//   league's own default, since a league often runs its regular season as a
//   round robin but a separate cup division as a knockout.

app.post('/api/leagues/:leagueId/divisions', requireAdminRole, asyncRoute((req, res) => {
  const { name, order = 0, entryType = 'singles', legsPerMatch = 5 } = req.body;
  const db = readDb();
  const league = db.leagues.find((l) => l.id === req.params.leagueId);
  if (!league) throw new ApiError(404, 'League not found');
  const scheduling = req.body.scheduling || league.format.scheduling || 'round_robin_single';

  if (!name || !name.trim()) throw new ApiError(400, 'Division name is required');
  if (!['singles', 'teams'].includes(entryType)) {
    throw new ApiError(400, 'entryType must be "singles" or "teams"');
  }
  if (!SCHEDULING_TYPES.includes(scheduling)) {
    throw new ApiError(400, `scheduling must be one of: ${SCHEDULING_TYPES.join(', ')}`);
  }
  if (entryType === 'teams' && (!Number.isInteger(Number(legsPerMatch)) || Number(legsPerMatch) < 1)) {
    throw new ApiError(400, 'legsPerMatch must be a positive whole number');
  }

  const division = {
    id: uuid(),
    leagueId: league.id,
    name: name.trim(),
    order,
    entryType,
    scheduling,
    playerIds: [],
    teamIds: entryType === 'teams' ? [] : [],
    legsPerMatch: entryType === 'teams' ? Number(legsPerMatch) : null,
    fixturesGenerated: false,
  };
  db.divisions.push(division);
  writeDb(db);
  res.status(201).json(division);
}));

function hydrateDivision(db, division) {
  const fixtures = db.fixtures.filter((f) => f.divisionId === division.id);
  const league = db.leagues.find((l) => l.id === division.leagueId);
  const leagueName = league ? league.name : null;

  if (division.entryType === 'teams') {
    const teams = db.teams
      .filter((t) => division.teamIds.includes(t.id))
      .map((t) => ({ ...t, players: db.players.filter((p) => t.playerIds.includes(p.id)) }));
    const standings = computeTeamStandings(division, db.fixtures, db.teams);
    return { ...division, leagueName, teams, fixtures, standings };
  }

  const players = db.players.filter((p) => division.playerIds.includes(p.id));
  const standings = computeStandings(division, db.fixtures, db.players);
  return { ...division, leagueName, players, fixtures, standings };
}

app.get('/api/divisions/:id', requireAnyAuth, asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  res.json(hydrateDivision(db, division));
}));

// ---- Singles players ----
// Players are only ever registered `Users` now (see registeredPlayers()
// below) - a captain picks a name from the list of people who've actually
// signed up rather than typing an arbitrary free-text name. This keeps the
// roster tied to real accounts instead of one-off placeholder names.

// Every registered, active user has (via registration) a linked Player
// record - this is the pool of names a captain/admin can pick from when
// building a division roster or a team. Demo/seed players created directly
// in db.players without a linked user (e.g. the seeded Premier League demo
// data) are NOT included here, since they don't correspond to a real account.
function registeredPlayers(db) {
  const linkedPlayerIds = new Set(
    db.users.filter((u) => u.status === 'active' && u.playerId).map((u) => u.playerId)
  );
  return db.players
    .filter((p) => linkedPlayerIds.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

app.get('/api/registered-players', requireAnyAuth, asyncRoute((req, res) => {
  const db = readDb();
  res.json(registeredPlayers(db));
}));

app.post('/api/divisions/:id/players', asyncRoute((req, res) => {
  const { playerId } = req.body;
  if (!playerId) throw new ApiError(400, 'playerId is required');

  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.entryType !== 'singles') throw new ApiError(400, 'This is a team division - add players to a team instead');
  if (division.fixturesGenerated) {
    throw new ApiError(400, 'Cannot add players after fixtures have been generated for this division');
  }

  const player = registeredPlayers(db).find((p) => p.id === playerId);
  if (!player) throw new ApiError(400, 'Only registered, active users can be added as players - pick a name from the list');
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

// ---- Teams (team divisions only) ----

app.post('/api/divisions/:id/teams', asyncRoute((req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Team name is required');

  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.entryType !== 'teams') throw new ApiError(400, 'This is a singles division - add players directly instead');
  if (division.fixturesGenerated) {
    throw new ApiError(400, 'Cannot add teams after fixtures have been generated for this division');
  }

  const team = { id: uuid(), divisionId: division.id, name: name.trim(), playerIds: [] };
  db.teams.push(team);
  division.teamIds.push(team.id);
  writeDb(db);
  res.status(201).json(hydrateDivision(db, division));
}));

app.delete('/api/divisions/:id/teams/:teamId', asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.fixturesGenerated) {
    throw new ApiError(400, 'Cannot remove teams after fixtures have been generated for this division');
  }
  division.teamIds = division.teamIds.filter((id) => id !== req.params.teamId);
  writeDb(db);
  res.json(hydrateDivision(db, division));
}));

app.post('/api/teams/:teamId/players', asyncRoute((req, res) => {
  const { playerId } = req.body;
  if (!playerId) throw new ApiError(400, 'playerId is required');

  const db = readDb();
  const team = db.teams.find((t) => t.id === req.params.teamId);
  if (!team) throw new ApiError(404, 'Team not found');
  const division = db.divisions.find((d) => d.id === team.divisionId);
  if (division.fixturesGenerated) {
    throw new ApiError(400, 'Cannot add players once fixtures have been generated for this division');
  }

  const player = registeredPlayers(db).find((p) => p.id === playerId);
  if (!player) throw new ApiError(400, 'Only registered, active users can be added as players - pick a name from the list');
  if (!team.playerIds.includes(player.id)) {
    team.playerIds.push(player.id);
  }
  writeDb(db);
  res.status(201).json(hydrateDivision(db, division));
}));

app.delete('/api/teams/:teamId/players/:playerId', asyncRoute((req, res) => {
  const db = readDb();
  const team = db.teams.find((t) => t.id === req.params.teamId);
  if (!team) throw new ApiError(404, 'Team not found');
  const division = db.divisions.find((d) => d.id === team.divisionId);
  if (division.fixturesGenerated) {
    throw new ApiError(400, 'Cannot remove players once fixtures have been generated for this division');
  }
  team.playerIds = team.playerIds.filter((id) => id !== req.params.playerId);
  writeDb(db);
  res.json(hydrateDivision(db, division));
}));

// ---- Fixture generation (branches on entryType x scheduling) ----

function makeSinglesFixture({ league, division, round }) {
  return {
    id: uuid(),
    leagueId: league.id,
    divisionId: division.id,
    round,
    homePlayerId: null,
    awayPlayerId: null,
    raceTo: league.format.raceTo,
    frames: [],
    homeFrameScore: 0,
    awayFrameScore: 0,
    status: 'scheduled', // scheduled -> in_progress -> completed
    winnerPlayerId: null,
    nextFixtureId: null,
    nextFixtureSlot: null,
  };
}

function makeTeamFixture({ league, division, round }) {
  const legs = Array.from({ length: division.legsPerMatch }, (_, i) => ({
    legNumber: i + 1,
    homePlayerId: null,
    awayPlayerId: null,
    raceTo: league.format.raceTo,
    frames: [],
    homeFrameScore: 0,
    awayFrameScore: 0,
    status: 'pending', // pending (not nominated) -> scheduled -> in_progress -> completed
    winnerPlayerId: null,
  }));
  return {
    id: uuid(),
    leagueId: league.id,
    divisionId: division.id,
    round,
    homeTeamId: null,
    awayTeamId: null,
    legs,
    homeLegsWon: 0,
    awayLegsWon: 0,
    status: 'scheduled', // scheduled -> in_progress -> completed
    winnerTeamId: null,
    nextFixtureId: null,
    nextFixtureSlot: null,
  };
}

function generateRoundRobinFixtures({ db, league, division, entrantIds }) {
  const makeFixture = division.entryType === 'teams' ? makeTeamFixture : makeSinglesFixture;
  const rounds = generateRoundRobin(entrantIds);
  rounds.forEach((pairs, roundIndex) => {
    pairs.forEach(([a, b]) => {
      const fixture = makeFixture({ league, division, round: roundIndex + 1 });
      if (division.entryType === 'teams') {
        fixture.homeTeamId = a;
        fixture.awayTeamId = b;
      } else {
        fixture.homePlayerId = a;
        fixture.awayPlayerId = b;
      }
      db.fixtures.push(fixture);
    });
  });
}

// Marks a bye fixture (one side missing) as an automatic win, and propagates
// the winner into the next round straight away.
function resolveByeIfNeeded(db, division, fixture) {
  if (division.entryType === 'teams') {
    if (fixture.homeTeamId && fixture.awayTeamId) return;
    const winnerTeamId = fixture.homeTeamId || fixture.awayTeamId;
    if (!winnerTeamId) return; // shouldn't happen, but don't crash on a fully-empty fixture
    fixture.status = 'completed';
    fixture.winnerTeamId = winnerTeamId;
    propagateWinner(db, division, fixture, winnerTeamId);
  } else {
    if (fixture.homePlayerId && fixture.awayPlayerId) return;
    const winnerPlayerId = fixture.homePlayerId || fixture.awayPlayerId;
    if (!winnerPlayerId) return;
    fixture.status = 'completed';
    fixture.winnerPlayerId = winnerPlayerId;
    propagateWinner(db, division, fixture, winnerPlayerId);
  }
}

function propagateWinner(db, division, fixture, winnerId) {
  if (!fixture.nextFixtureId) return;
  const next = db.fixtures.find((f) => f.id === fixture.nextFixtureId);
  if (!next) return;
  if (division.entryType === 'teams') {
    if (fixture.nextFixtureSlot === 'home') next.homeTeamId = winnerId;
    else next.awayTeamId = winnerId;
  } else if (fixture.nextFixtureSlot === 'home') {
    next.homePlayerId = winnerId;
  } else {
    next.awayPlayerId = winnerId;
  }
  // NB: do NOT call resolveByeIfNeeded here. A bye (a slot that will never be
  // filled) can only ever occur in the very first round, where the bracket
  // was seeded with an uneven entrant count - that's resolved once, right
  // after seeding. From round 2 onward, a slot being empty just means "the
  // other semi-final hasn't been played yet", not a bye - filling one side of
  // a two-sided fixture must never auto-declare a winner. The match still has
  // to be played once both real entrants have arrived.
}

function generateKnockoutFixtures({ db, league, division, entrantIds }) {
  const makeFixture = division.entryType === 'teams' ? makeTeamFixture : makeSinglesFixture;
  const bracketRounds = buildBracketRounds(entrantIds); // rounds[0] has real entrants (nulls = byes); later rounds are just counts

  const fixturesByRound = bracketRounds.map((pairs, roundIndex) =>
    pairs.map(() => makeFixture({ league, division, round: roundIndex + 1 }))
  );

  // Link each fixture to the one its winner advances to.
  for (let round = 0; round < fixturesByRound.length - 1; round++) {
    fixturesByRound[round].forEach((fixture, i) => {
      const next = fixturesByRound[round + 1][Math.floor(i / 2)];
      fixture.nextFixtureId = next.id;
      fixture.nextFixtureSlot = i % 2 === 0 ? 'home' : 'away';
    });
  }

  // Seed round 1 with the real entrants.
  bracketRounds[0].forEach(([a, b], i) => {
    const fixture = fixturesByRound[0][i];
    if (division.entryType === 'teams') {
      fixture.homeTeamId = a;
      fixture.awayTeamId = b;
    } else {
      fixture.homePlayerId = a;
      fixture.awayPlayerId = b;
    }
  });

  const allFixtures = fixturesByRound.flat();
  allFixtures.forEach((f) => db.fixtures.push(f));
  // Resolve any byes now that every fixture (and its next-round link) exists.
  fixturesByRound[0].forEach((fixture) => resolveByeIfNeeded(db, division, fixture));
}

app.post('/api/divisions/:id/generate-fixtures', asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  const league = db.leagues.find((l) => l.id === division.leagueId);
  if (division.fixturesGenerated) {
    throw new ApiError(400, 'Fixtures have already been generated for this division');
  }

  const entrantIds = division.entryType === 'teams' ? division.teamIds : division.playerIds;
  const entrantLabel = division.entryType === 'teams' ? 'teams' : 'players';
  if (entrantIds.length < 2) {
    throw new ApiError(400, `A division needs at least 2 ${entrantLabel} before fixtures can be generated`);
  }

  if (division.scheduling === 'knockout_single_elim') {
    generateKnockoutFixtures({ db, league, division, entrantIds });
  } else {
    generateRoundRobinFixtures({ db, league, division, entrantIds });
  }

  division.fixturesGenerated = true;
  writeDb(db);
  res.status(201).json(hydrateDivision(db, division));
}));

// ---------- Fixtures / frame scoring (singles) ----------

app.get('/api/fixtures/:id', requireAnyAuth, asyncRoute((req, res) => {
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  const division = db.divisions.find((d) => d.id === fixture.divisionId);
  const divisionName = division ? division.name : null;

  if (division.entryType === 'teams') {
    const withPlayers = (team) => (team ? { ...team, players: db.players.filter((p) => team.playerIds.includes(p.id)) } : null);
    const homeTeam = withPlayers(db.teams.find((t) => t.id === fixture.homeTeamId));
    const awayTeam = withPlayers(db.teams.find((t) => t.id === fixture.awayTeamId));
    const legs = fixture.legs.map((leg) => ({
      ...leg,
      homePlayer: leg.homePlayerId ? db.players.find((p) => p.id === leg.homePlayerId) : null,
      awayPlayer: leg.awayPlayerId ? db.players.find((p) => p.id === leg.awayPlayerId) : null,
    }));
    return res.json({ ...fixture, divisionName, legs, homeTeam, awayTeam, bothEntrantsKnown: !!(fixture.homeTeamId && fixture.awayTeamId) });
  }

  const homePlayer = fixture.homePlayerId ? db.players.find((p) => p.id === fixture.homePlayerId) : null;
  const awayPlayer = fixture.awayPlayerId ? db.players.find((p) => p.id === fixture.awayPlayerId) : null;
  res.json({ ...fixture, divisionName, homePlayer, awayPlayer, bothEntrantsKnown: !!(fixture.homePlayerId && fixture.awayPlayerId) });
}));

app.post('/api/fixtures/:id/frames', asyncRoute((req, res) => {
  const { winnerPlayerId } = req.body;
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  const division = db.divisions.find((d) => d.id === fixture.divisionId);
  if (division.entryType === 'teams') {
    throw new ApiError(400, 'This is a team fixture - record frames against a specific leg instead');
  }
  if (!fixture.homePlayerId || !fixture.awayPlayerId) {
    throw new ApiError(400, 'Both players for this fixture are not yet known - waiting on an earlier round');
  }
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

  if (fixture.status === 'completed') {
    propagateWinner(db, division, fixture, fixture.winnerPlayerId);
  }

  writeDb(db);
  res.json(fixture);
}));

app.delete('/api/fixtures/:id/frames/last', asyncRoute((req, res) => {
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  if (fixture.frames.length === 0) throw new ApiError(400, 'No frames recorded yet');
  if (fixture.nextFixtureId && fixture.status === 'completed') {
    throw new ApiError(400, 'This result has already advanced a player to the next round and cannot be undone here');
  }

  fixture.frames.pop();
  fixture.homeFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.homePlayerId).length;
  fixture.awayFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.awayPlayerId).length;
  fixture.winnerPlayerId = null;
  fixture.status = fixture.frames.length === 0 ? 'scheduled' : 'in_progress';

  writeDb(db);
  res.json(fixture);
}));

// ---------- Fixtures / leg scoring (teams) ----------
// A team match is decided the moment one side has won a majority of
// `legsPerMatch` legs (mirrors the singles "race to N" behaviour - once
// decided, no further legs are scored). With an odd legsPerMatch this always
// produces a winner; an even legsPerMatch can end level, which is recorded
// as a drawn team match once every leg is complete. A drawn knockout match
// has no winner to advance - use an odd legsPerMatch for knockout team
// divisions to guarantee one.

function recomputeTeamFixture(db, division, fixture) {
  const homeLegsWon = fixture.legs.filter((l) => l.status === 'completed' && l.winnerPlayerId === l.homePlayerId).length;
  const awayLegsWon = fixture.legs.filter((l) => l.status === 'completed' && l.winnerPlayerId === l.awayPlayerId).length;
  fixture.homeLegsWon = homeLegsWon;
  fixture.awayLegsWon = awayLegsWon;

  const totalLegs = fixture.legs.length;
  const majority = Math.floor(totalLegs / 2) + 1;
  const allLegsDone = fixture.legs.every((l) => l.status === 'completed');
  const wasCompleted = fixture.status === 'completed';

  if (homeLegsWon >= majority) {
    fixture.status = 'completed';
    fixture.winnerTeamId = fixture.homeTeamId;
  } else if (awayLegsWon >= majority) {
    fixture.status = 'completed';
    fixture.winnerTeamId = fixture.awayTeamId;
  } else if (allLegsDone) {
    fixture.status = 'completed';
    fixture.winnerTeamId = homeLegsWon === awayLegsWon ? null : (homeLegsWon > awayLegsWon ? fixture.homeTeamId : fixture.awayTeamId);
  } else {
    fixture.status = fixture.legs.some((l) => l.status !== 'pending') ? 'in_progress' : 'scheduled';
    fixture.winnerTeamId = null;
  }

  if (!wasCompleted && fixture.status === 'completed' && fixture.winnerTeamId) {
    propagateWinner(db, division, fixture, fixture.winnerTeamId);
  }
}

function findTeamFixtureAndLeg(db, fixtureId, legNumber) {
  const fixture = db.fixtures.find((f) => f.id === fixtureId);
  if (!fixture || !fixture.legs) throw new ApiError(404, 'Team fixture not found');
  const leg = fixture.legs.find((l) => l.legNumber === Number(legNumber));
  if (!leg) throw new ApiError(404, 'Leg not found');
  return { fixture, leg };
}

app.post('/api/fixtures/:id/legs/:legNumber/nominate', asyncRoute((req, res) => {
  const { homePlayerId, awayPlayerId } = req.body;
  const db = readDb();
  const { fixture, leg } = findTeamFixtureAndLeg(db, req.params.id, req.params.legNumber);
  if (!fixture.homeTeamId || !fixture.awayTeamId) {
    throw new ApiError(400, 'Both teams for this fixture are not yet known - waiting on an earlier round');
  }
  if (leg.status !== 'pending') {
    throw new ApiError(400, 'This leg already has nominated players - undo its frames first to change them');
  }

  const homeTeam = db.teams.find((t) => t.id === fixture.homeTeamId);
  const awayTeam = db.teams.find((t) => t.id === fixture.awayTeamId);
  if (!homeTeam.playerIds.includes(homePlayerId)) throw new ApiError(400, 'Home player is not registered to the home team');
  if (!awayTeam.playerIds.includes(awayPlayerId)) throw new ApiError(400, 'Away player is not registered to the away team');

  leg.homePlayerId = homePlayerId;
  leg.awayPlayerId = awayPlayerId;
  leg.status = 'scheduled';
  writeDb(db);
  res.json(fixture);
}));

app.post('/api/fixtures/:id/legs/:legNumber/frames', asyncRoute((req, res) => {
  const { winnerPlayerId } = req.body;
  const db = readDb();
  const { fixture, leg } = findTeamFixtureAndLeg(db, req.params.id, req.params.legNumber);
  const division = db.divisions.find((d) => d.id === fixture.divisionId);
  if (fixture.status === 'completed') throw new ApiError(400, 'This team match is already decided');
  if (leg.status === 'pending') throw new ApiError(400, 'Nominate both players for this leg before recording frames');
  if (leg.status === 'completed') {
    throw new ApiError(400, `This leg is already complete (${leg.homeFrameScore}-${leg.awayFrameScore}). Undo a frame to make corrections.`);
  }
  if (![leg.homePlayerId, leg.awayPlayerId].includes(winnerPlayerId)) {
    throw new ApiError(400, 'winnerPlayerId must be one of the two nominated players for this leg');
  }

  leg.frames.push({ frameNumber: leg.frames.length + 1, winnerPlayerId });
  leg.homeFrameScore = leg.frames.filter((f) => f.winnerPlayerId === leg.homePlayerId).length;
  leg.awayFrameScore = leg.frames.filter((f) => f.winnerPlayerId === leg.awayPlayerId).length;
  leg.status = 'in_progress';

  if (leg.homeFrameScore >= leg.raceTo) {
    leg.status = 'completed';
    leg.winnerPlayerId = leg.homePlayerId;
  } else if (leg.awayFrameScore >= leg.raceTo) {
    leg.status = 'completed';
    leg.winnerPlayerId = leg.awayPlayerId;
  }

  recomputeTeamFixture(db, division, fixture);
  writeDb(db);
  res.json(fixture);
}));

app.delete('/api/fixtures/:id/legs/:legNumber/frames/last', asyncRoute((req, res) => {
  const db = readDb();
  const { fixture, leg } = findTeamFixtureAndLeg(db, req.params.id, req.params.legNumber);
  const division = db.divisions.find((d) => d.id === fixture.divisionId);
  if (leg.frames.length === 0) throw new ApiError(400, 'No frames recorded yet for this leg');
  if (fixture.nextFixtureId && fixture.status === 'completed') {
    throw new ApiError(400, 'This result has already advanced a team to the next round and cannot be undone here');
  }

  leg.frames.pop();
  leg.homeFrameScore = leg.frames.filter((f) => f.winnerPlayerId === leg.homePlayerId).length;
  leg.awayFrameScore = leg.frames.filter((f) => f.winnerPlayerId === leg.awayPlayerId).length;
  leg.winnerPlayerId = null;
  leg.status = leg.frames.length === 0 ? 'scheduled' : 'in_progress';

  recomputeTeamFixture(db, division, fixture);
  writeDb(db);
  res.json(fixture);
}));

// ---------- Admin score/game override ----------
// Lets an admin directly set a fixture's final score to correct a
// mis-recorded result, bypassing the normal frame-by-frame flow entirely.
// Deliberately blunt: it replaces the recorded frames/legs with just the
// final tally (tagged `adminOverride` so the UI can show it was hand-set
// rather than played out), rather than trying to reconstruct a plausible
// frame history. Re-propagates into the next knockout round if the winner
// changed, but refuses if that would silently overwrite a match that's
// already been played - the admin has to fix the downstream fixture first,
// so a correction can never quietly erase someone else's recorded result.
app.post('/api/fixtures/:id/override', requireAdminRole, asyncRoute((req, res) => {
  const { homeScore, awayScore } = req.body;
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  const division = db.divisions.find((d) => d.id === fixture.divisionId);
  const isTeams = division.entryType === 'teams';

  if (isTeams) {
    if (!fixture.homeTeamId || !fixture.awayTeamId) {
      throw new ApiError(400, 'Both teams for this fixture are not yet known');
    }
  } else if (!fixture.homePlayerId || !fixture.awayPlayerId) {
    throw new ApiError(400, 'Both players for this fixture are not yet known');
  }
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    throw new ApiError(400, 'homeScore and awayScore must be non-negative whole numbers');
  }
  if (!isTeams && homeScore === awayScore) {
    throw new ApiError(400, 'Singles matches cannot end level - set different scores for home and away');
  }

  const oldWinnerId = isTeams ? fixture.winnerTeamId : fixture.winnerPlayerId;
  const newWinnerId = homeScore === awayScore
    ? null
    : homeScore > awayScore
      ? (isTeams ? fixture.homeTeamId : fixture.homePlayerId)
      : (isTeams ? fixture.awayTeamId : fixture.awayPlayerId);

  if (fixture.nextFixtureId && oldWinnerId && newWinnerId !== oldWinnerId) {
    const next = db.fixtures.find((f) => f.id === fixture.nextFixtureId);
    const nextHasStarted = next && (isTeams ? next.legs.some((l) => l.status !== 'pending') : next.frames.length > 0);
    if (nextHasStarted) {
      throw new ApiError(409, 'This result has already progressed to a fixture that has started - override or reset that fixture first');
    }
  }

  if (isTeams) {
    fixture.homeLegsWon = homeScore;
    fixture.awayLegsWon = awayScore;
    fixture.winnerTeamId = newWinnerId;
    fixture.legs = fixture.legs.map((leg) => ({
      ...leg,
      homePlayerId: null,
      awayPlayerId: null,
      frames: [],
      homeFrameScore: 0,
      awayFrameScore: 0,
      status: 'pending',
      winnerPlayerId: null,
    }));
  } else {
    fixture.homeFrameScore = homeScore;
    fixture.awayFrameScore = awayScore;
    fixture.frames = [];
    fixture.winnerPlayerId = newWinnerId;
  }
  fixture.status = 'completed';
  fixture.adminOverride = { at: new Date().toISOString(), by: req.adminSession.label };

  if (fixture.nextFixtureId && newWinnerId && newWinnerId !== oldWinnerId) {
    propagateWinner(db, division, fixture, newWinnerId);
  }

  recordAudit(db, {
    actor: req.adminSession.label,
    action: 'fixture.override',
    targetType: 'fixture',
    targetId: fixture.id,
    details: `Set final score to ${homeScore}-${awayScore}`,
  });

  writeDb(db);
  res.json(fixture);
}));

// ---------- Players ----------

app.get('/api/players', requireAnyAuth, asyncRoute((req, res) => {
  const db = readDb();
  res.json(db.players);
}));

app.get('/api/players/:id', requireAnyAuth, asyncRoute((req, res) => {
  const db = readDb();
  const profile = buildPlayerProfile(db, req.params.id);
  if (!profile) throw new ApiError(404, 'Player not found');
  res.json(profile);
}));

// ---------- Admin: user management ----------
// Everything here requires requireAdminRole (the super-admin account or a
// promoted player). A promoted admin can manage every account including
// other admins and their own - there's no protection against an admin
// demoting/suspending themselves in this v1; keep at least one working admin
// login (the super-admin env-configured account always works) if you're
// experimenting with roles.

app.get('/api/admin/users', requireAdminRole, asyncRoute((req, res) => {
  const db = readDb();
  const q = (req.query.q || '').trim().toLowerCase();
  let users = db.users;
  if (q) {
    users = users.filter((u) =>
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.venue.toLowerCase().includes(q) ||
      u.teamName.toLowerCase().includes(q)
    );
  }
  users = [...users].sort((a, b) => a.lastName.localeCompare(b.lastName));
  res.json(users.map(publicUser));
}));

app.get('/api/admin/users/:id', requireAdminRole, asyncRoute((req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  res.json(publicUser(user));
}));

app.patch('/api/admin/users/:id', requireAdminRole, asyncRoute((req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  applyProfileFields(db, user, req.body);
  recordAudit(db, {
    actor: req.adminSession.label,
    action: 'user.edit',
    targetType: 'user',
    targetId: user.id,
    details: `Edited profile for ${user.firstName} ${user.lastName}`,
  });
  writeDb(db);
  res.json(publicUser(user));
}));

app.post('/api/admin/users/:id/role', requireAdminRole, asyncRoute((req, res) => {
  const { role } = req.body;
  if (!ROLES.includes(role)) throw new ApiError(400, `role must be one of: ${ROLES.join(', ')}`);
  const db = readDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  user.role = role;
  recordAudit(db, {
    actor: req.adminSession.label,
    action: 'user.role',
    targetType: 'user',
    targetId: user.id,
    details: `Set role of ${user.firstName} ${user.lastName} to ${role}`,
  });
  writeDb(db);
  res.json(publicUser(user));
}));

app.post('/api/admin/users/:id/status', requireAdminRole, asyncRoute((req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) throw new ApiError(400, `status must be one of: ${STATUSES.join(', ')}`);
  const db = readDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  user.status = status;
  recordAudit(db, {
    actor: req.adminSession.label,
    action: 'user.status',
    targetType: 'user',
    targetId: user.id,
    details: `Set status of ${user.firstName} ${user.lastName} to ${status}`,
  });
  writeDb(db);
  res.json(publicUser(user));
}));

app.post('/api/admin/users/:id/reset-password', requireAdminRole, asyncRoute((req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    throw new ApiError(400, 'New password must be at least 8 characters');
  }
  const db = readDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  user.passwordHash = hashPassword(newPassword);
  recordAudit(db, {
    actor: req.adminSession.label,
    action: 'user.reset_password',
    targetType: 'user',
    targetId: user.id,
    details: `Force-reset password for ${user.firstName} ${user.lastName}`,
  });
  writeDb(db);
  res.json({ ok: true });
}));

app.get('/api/admin/audit-log', requireAdminRole, asyncRoute((req, res) => {
  const db = readDb();
  const entries = [...db.auditLog].reverse().slice(0, 200);
  res.json(entries);
}));

// ---------- Venues ----------
// A curated, admin-approved list of venues, seeded with a starter set (see
// services/seed.js). New venue names typed at registration or in profile
// edits are auto-queued as `pending` (see ensureVenue above) rather than
// requiring a separate submission step; admins approve or reject them from
// here. Deliberately public/no-login-required for GET, since the
// registration form (before an account exists) needs the approved list too.

app.get('/api/venues', asyncRoute((req, res) => {
  const db = readDb();
  const approved = db.venues
    .filter((v) => v.status === 'approved')
    .sort((a, b) => a.name.localeCompare(b.name));

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  const session = token ? verifyUserToken(token) : null;
  const mine = session
    ? db.venues.filter((v) => v.requestedBy === session.userId && v.status !== 'approved')
    : [];

  res.json({ approved, mine });
}));

app.get('/api/admin/venues', requireAdminRole, asyncRoute((req, res) => {
  const db = readDb();
  const statusOrder = { pending: 0, approved: 1, rejected: 2 };
  const venues = [...db.venues].sort((a, b) =>
    statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name)
  );
  res.json(venues);
}));

app.post('/api/admin/venues/:id/approve', requireAdminRole, asyncRoute((req, res) => {
  const db = readDb();
  const venue = db.venues.find((v) => v.id === req.params.id);
  if (!venue) throw new ApiError(404, 'Venue not found');
  venue.status = 'approved';
  venue.approvedBy = req.adminSession.label;
  venue.approvedAt = new Date().toISOString();
  recordAudit(db, {
    actor: req.adminSession.label,
    action: 'venue.approve',
    targetType: 'venue',
    targetId: venue.id,
    details: `Approved venue "${venue.name}"`,
  });
  writeDb(db);
  res.json(venue);
}));

app.post('/api/admin/venues/:id/reject', requireAdminRole, asyncRoute((req, res) => {
  const db = readDb();
  const venue = db.venues.find((v) => v.id === req.params.id);
  if (!venue) throw new ApiError(404, 'Venue not found');
  venue.status = 'rejected';
  venue.approvedBy = req.adminSession.label;
  venue.approvedAt = new Date().toISOString();
  recordAudit(db, {
    actor: req.adminSession.label,
    action: 'venue.reject',
    targetType: 'venue',
    targetId: venue.id,
    details: `Rejected venue "${venue.name}"`,
  });
  writeDb(db);
  res.json(venue);
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
