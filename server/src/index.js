import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';
import { readDb, writeDb } from './db.js';
import { ApiError } from './errors.js';
import { generateRoundRobinFixtures } from './services/roundRobin.js';
import { generateBracket, applyBracketResult } from './services/bracket.js';
import { computeStandings } from './services/standings.js';
import { computeTeamStandings } from './services/teamStandings.js';
import { computePlayerProfile } from './services/playerProfile.js';
import { recordAudit } from './services/auditLog.js';
import {
  CLASSIFICATIONS,
  hashPassword,
  verifyPassword,
  generateTempPassword,
  createSessionToken,
  publicUser,
  requireAuth,
  requireAdmin,
} from './userAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const STATUSES = ['active', 'suspended'];

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---------- Auth: single unified login for every account ----------
// There used to be two entirely separate login flows here (a hardcoded admin
// username/password, and a player email/password) - this is gone. Every
// account, whatever combination of isAdmin/isCaptain it holds, signs in
// through this one endpoint.

app.post('/api/auth/login', asyncRoute((req, res) => {
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

  const { token, expiresAt } = createSessionToken(user.id);
  res.json({ token, expiresAt, user: publicUser(user) });
}));

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

  const user = createUserAccount(db, {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.trim(),
    passwordHash: hashPassword(password),
    phone: phone ? phone.trim() : '',
    venue: venue.trim(),
    teamName: teamName.trim(),
    classification: classification || null,
    isAdmin: false,
    isCaptain: false,
  });
  ensureVenue(db, user.venue, user.id, `${user.firstName} ${user.lastName}`);
  writeDb(db);

  const { token, expiresAt } = createSessionToken(user.id);
  res.status(201).json({ token, expiresAt, user: publicUser(user) });
}));

app.get('/api/users/me', requireAuth, asyncRoute((req, res) => {
  res.json(publicUser(req.auth.user));
}));

// Shared account-creation helper: builds the User record (and its linked
// Player roster entry, find-or-create by name) the same way whether the
// account came from self-registration, the season CSV/Excel import, the
// wizard's "add a player manually" step, or the standalone bulk import on
// Manage Users. Doesn't write to disk - caller batches the writeDb() once
// all rows in a request are processed.
function createUserAccount(db, fields) {
  const fullName = `${fields.firstName} ${fields.lastName}`;
  let linkedPlayer = db.players.find((p) => p.name.toLowerCase() === fullName.toLowerCase());
  if (!linkedPlayer) {
    linkedPlayer = { id: uuid(), name: fullName };
    db.players.push(linkedPlayer);
  }
  const user = {
    id: uuid(),
    firstName: fields.firstName,
    lastName: fields.lastName,
    email: fields.email,
    passwordHash: fields.passwordHash,
    phone: fields.phone || '',
    venue: fields.venue,
    teamName: fields.teamName,
    classification: fields.classification || null,
    isAdmin: !!fields.isAdmin,
    isCaptain: !!fields.isCaptain,
    status: 'active',
    playerId: linkedPlayer.id,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  return user;
}

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

app.patch('/api/users/me', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.auth.userId);
  if (!user) throw new ApiError(404, 'User not found');
  applyProfileFields(db, user, req.body);
  writeDb(db);
  res.json(publicUser(user));
}));

app.post('/api/users/me/change-password', requireAuth, asyncRoute((req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword) throw new ApiError(400, 'Current password is required');
  if (!newPassword || newPassword.length < 8) throw new ApiError(400, 'New password must be at least 8 characters');

  const db = readDb();
  const user = db.users.find((u) => u.id === req.auth.userId);
  if (!user) throw new ApiError(404, 'User not found');
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new ApiError(401, 'Current password is incorrect');
  }
  user.passwordHash = hashPassword(newPassword);
  writeDb(db);
  res.json({ ok: true });
}));

// Every fixture (singles or team-leg) the logged-in account's linked Player
// is involved in, across every division/team - powers the Player Management
// Portal's "My Fixtures" panel and the Captain Portal's match list. Split
// into upcoming (anything not completed) vs. recent (completed) on the
// client; here we just return everything, enriched with league/division/
// opponent names so the client doesn't need extra round-trips.
app.get('/api/users/me/fixtures', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const user = req.auth.user;
  if (!user.playerId) return res.json([]);

  const results = [];
  for (const division of db.divisions) {
    const league = db.leagues.find((l) => l.id === division.leagueId);
    if (division.entryType === 'singles') {
      for (const fixture of db.fixtures.filter((f) => f.divisionId === division.id)) {
        let opponentPlayerId = null;
        if (fixture.homePlayerId === user.playerId) opponentPlayerId = fixture.awayPlayerId;
        else if (fixture.awayPlayerId === user.playerId) opponentPlayerId = fixture.homePlayerId;
        else continue;
        const opponent = db.players.find((p) => p.id === opponentPlayerId);
        results.push({
          id: fixture.id,
          leagueName: league?.name || '',
          divisionName: division.name,
          round: fixture.round,
          opponentName: opponent ? opponent.name : 'TBD',
          status: fixture.status,
          scheduledDate: fixture.scheduledDate || null,
        });
      }
    } else {
      const myTeam = db.teams.find((t) => t.divisionId === division.id && t.playerIds.includes(user.playerId));
      if (!myTeam) continue;
      for (const fixture of db.fixtures.filter((f) => f.divisionId === division.id)) {
        let opponentTeamId = null;
        if (fixture.homeTeamId === myTeam.id) opponentTeamId = fixture.awayTeamId;
        else if (fixture.awayTeamId === myTeam.id) opponentTeamId = fixture.homeTeamId;
        else continue;
        const opponentTeam = db.teams.find((t) => t.id === opponentTeamId);
        results.push({
          id: fixture.id,
          leagueName: league?.name || '',
          divisionName: division.name,
          round: fixture.round,
          opponentName: opponentTeam ? opponentTeam.name : 'TBD',
          status: fixture.status,
          scheduledDate: fixture.scheduledDate || null,
        });
      }
    }
  }

  results.sort((a, b) => (a.scheduledDate || '9999-99-99').localeCompare(b.scheduledDate || '9999-99-99'));
  res.json(results);
}));

// ---------- Leagues & divisions ----------

app.get('/api/leagues', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  res.json(db.leagues);
}));

app.post('/api/leagues', requireAdmin, asyncRoute((req, res) => {
  const { name, sport = 'English 8-Ball Pool', format = {} } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'League name is required');
  const db = readDb();
  const league = {
    id: uuid(),
    name: name.trim(),
    sport,
    format: {
      matchFormat: format.matchFormat || 'singles',
      raceTo: format.raceTo || 6,
      scheduling: format.scheduling || 'round_robin_single',
    },
    startDate: null,
    endDate: null,
    createdAt: new Date().toISOString(),
  };
  db.leagues.push(league);
  writeDb(db);
  res.status(201).json(league);
}));

app.get('/api/leagues/:id', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const league = db.leagues.find((l) => l.id === req.params.id);
  if (!league) throw new ApiError(404, 'League not found');
  const divisions = db.divisions.filter((d) => d.leagueId === league.id).sort((a, b) => a.order - b.order);
  res.json({ ...league, divisions });
}));

app.post('/api/leagues/:leagueId/divisions', requireAdmin, asyncRoute((req, res) => {
  const { name, entryType = 'singles', scheduling = 'round_robin_single', legsPerMatch = null } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Division name is required');
  if (!['singles', 'teams'].includes(entryType)) throw new ApiError(400, "entryType must be 'singles' or 'teams'");
  if (!['round_robin_single', 'knockout_single_elim'].includes(scheduling)) {
    throw new ApiError(400, "scheduling must be 'round_robin_single' or 'knockout_single_elim'");
  }
  const db = readDb();
  const league = db.leagues.find((l) => l.id === req.params.leagueId);
  if (!league) throw new ApiError(404, 'League not found');
  const order = db.divisions.filter((d) => d.leagueId === league.id).length;
  const division = {
    id: uuid(),
    leagueId: league.id,
    name: name.trim(),
    order,
    entryType,
    scheduling,
    legsPerMatch: entryType === 'teams' ? (legsPerMatch || 3) : null,
    playerIds: [],
    teamIds: [],
    fixturesGenerated: false,
    startDate: null,
    endDate: null,
    gapDays: null,
  };
  db.divisions.push(division);
  writeDb(db);
  res.status(201).json(division);
}));

app.get('/api/divisions/:id', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  const fixtures = db.fixtures.filter((f) => f.divisionId === division.id);

  if (division.entryType === 'singles') {
    const players = division.playerIds.map((id) => db.players.find((p) => p.id === id)).filter(Boolean);
    const standings = computeStandings(division, fixtures, players);
    res.json({ ...division, players, fixtures, standings });
  } else {
    const teams = division.teamIds.map((id) => db.teams.find((t) => t.id === id)).filter(Boolean).map((t) => ({
      ...t,
      players: t.playerIds.map((pid) => db.players.find((p) => p.id === pid)).filter(Boolean),
    }));
    const standings = computeTeamStandings(division, fixtures, teams);
    res.json({ ...division, teams, fixtures, standings });
  }
}));

app.get('/api/registered-players', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const activePlayerIds = new Set(db.users.filter((u) => u.status === 'active' && u.playerId).map((u) => u.playerId));
  const players = db.players.filter((p) => activePlayerIds.has(p.id));
  res.json(players);
}));

app.post('/api/divisions/:id/players', requireAuth, asyncRoute((req, res) => {
  const { playerId } = req.body;
  if (!playerId) throw new ApiError(400, 'playerId is required');
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.entryType !== 'singles') throw new ApiError(400, 'This division is not a singles division');
  if (division.fixturesGenerated) throw new ApiError(400, 'Fixtures have already been generated for this division');
  const player = db.players.find((p) => p.id === playerId);
  if (!player) throw new ApiError(404, 'Player not found');
  const registeredUser = db.users.find((u) => u.playerId === playerId && u.status === 'active');
  if (!registeredUser) throw new ApiError(400, 'Only registered, active accounts can be added as players');
  if (division.playerIds.includes(playerId)) throw new ApiError(409, 'Player already in this division');
  division.playerIds.push(playerId);
  writeDb(db);
  res.status(201).json(division);
}));

app.delete('/api/divisions/:id/players/:playerId', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.fixturesGenerated) throw new ApiError(400, 'Fixtures have already been generated for this division');
  division.playerIds = division.playerIds.filter((id) => id !== req.params.playerId);
  writeDb(db);
  res.json(division);
}));

app.post('/api/divisions/:id/teams', requireAuth, asyncRoute((req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Team name is required');
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.entryType !== 'teams') throw new ApiError(400, 'This division is not a teams division');
  if (division.fixturesGenerated) throw new ApiError(400, 'Fixtures have already been generated for this division');
  const team = { id: uuid(), divisionId: division.id, name: name.trim(), playerIds: [] };
  db.teams.push(team);
  division.teamIds.push(team.id);
  writeDb(db);
  res.status(201).json(team);
}));

app.delete('/api/divisions/:id/teams/:teamId', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.fixturesGenerated) throw new ApiError(400, 'Fixtures have already been generated for this division');
  division.teamIds = division.teamIds.filter((id) => id !== req.params.teamId);
  db.teams = db.teams.filter((t) => t.id !== req.params.teamId);
  writeDb(db);
  res.json(division);
}));

app.post('/api/teams/:teamId/players', requireAuth, asyncRoute((req, res) => {
  const { playerId } = req.body;
  if (!playerId) throw new ApiError(400, 'playerId is required');
  const db = readDb();
  const team = db.teams.find((t) => t.id === req.params.teamId);
  if (!team) throw new ApiError(404, 'Team not found');
  const division = db.divisions.find((d) => d.id === team.divisionId);
  if (division.fixturesGenerated) throw new ApiError(400, 'Fixtures have already been generated for this division');
  const registeredUser = db.users.find((u) => u.playerId === playerId && u.status === 'active');
  if (!registeredUser) throw new ApiError(400, 'Only registered, active accounts can be added as players');
  if (team.playerIds.includes(playerId)) throw new ApiError(409, 'Player already on this team');
  team.playerIds.push(playerId);
  writeDb(db);
  res.status(201).json(team);
}));

app.delete('/api/teams/:teamId/players/:playerId', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const team = db.teams.find((t) => t.id === req.params.teamId);
  if (!team) throw new ApiError(404, 'Team not found');
  team.playerIds = team.playerIds.filter((id) => id !== req.params.playerId);
  writeDb(db);
  res.json(team);
}));

// Stamps `scheduledDate` (YYYY-MM-DD) onto each fixture, spacing rounds
// `gapDays` apart starting at `startDate`. Returns the date of the last
// round's games and whether it falls on/before `endDate` (if given), so
// callers can flag a season that won't fit its own end date.
function assignScheduledDates(db, division, startDate, gapDays) {
  const fixtures = db.fixtures.filter((f) => f.divisionId === division.id);
  const rounds = [...new Set(fixtures.map((f) => f.round))].sort((a, b) => a - b);
  const start = new Date(`${startDate}T00:00:00Z`);
  let lastDate = startDate;
  for (const round of rounds) {
    const roundDate = new Date(start.getTime() + (round - 1) * gapDays * 86400000);
    const dateStr = roundDate.toISOString().slice(0, 10);
    lastDate = dateStr;
    for (const fixture of fixtures.filter((f) => f.round === round)) {
      fixture.scheduledDate = dateStr;
    }
  }
  return lastDate;
}

app.post('/api/divisions/:id/generate-fixtures', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const division = db.divisions.find((d) => d.id === req.params.id);
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.fixturesGenerated) throw new ApiError(400, 'Fixtures have already been generated for this division');

  let newFixtures;
  if (division.scheduling === 'round_robin_single') {
    newFixtures = generateRoundRobinFixtures(division);
  } else {
    newFixtures = generateBracket(division);
  }
  db.fixtures.push(...newFixtures);
  division.fixturesGenerated = true;

  const { startDate, gapDays } = req.body || {};
  let lastGameDate = null;
  if (startDate && gapDays) {
    division.startDate = startDate;
    division.gapDays = Number(gapDays);
    lastGameDate = assignScheduledDates(db, division, startDate, Number(gapDays));
  }

  writeDb(db);
  res.status(201).json({ division, fixtures: newFixtures, lastGameDate });
}));

// ---------- Fixtures: singles ----------

function enrichSinglesFixture(db, fixture) {
  const homePlayer = db.players.find((p) => p.id === fixture.homePlayerId) || null;
  const awayPlayer = db.players.find((p) => p.id === fixture.awayPlayerId) || null;
  return {
    ...fixture,
    homePlayer,
    awayPlayer,
    bothEntrantsKnown: !!(fixture.homePlayerId && fixture.awayPlayerId),
  };
}

function enrichTeamFixture(db, fixture) {
  const homeTeam = db.teams.find((t) => t.id === fixture.homeTeamId) || null;
  const awayTeam = db.teams.find((t) => t.id === fixture.awayTeamId) || null;
  return {
    ...fixture,
    homeTeam,
    awayTeam,
    bothEntrantsKnown: !!(fixture.homeTeamId && fixture.awayTeamId),
  };
}

app.get('/api/fixtures/:id', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  const division = db.divisions.find((d) => d.id === fixture.divisionId);
  if (division.entryType === 'singles') {
    res.json(enrichSinglesFixture(db, fixture));
  } else {
    res.json(enrichTeamFixture(db, fixture));
  }
}));

app.post('/api/fixtures/:id/frames', requireAuth, asyncRoute((req, res) => {
  const { winnerPlayerId } = req.body;
  if (!winnerPlayerId) throw new ApiError(400, 'winnerPlayerId is required');
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  if (fixture.status === 'completed') throw new ApiError(400, 'This fixture is already completed');
  if (![fixture.homePlayerId, fixture.awayPlayerId].includes(winnerPlayerId)) {
    throw new ApiError(400, 'winnerPlayerId must be one of the two players in this fixture');
  }

  fixture.frames.push({ frameNumber: fixture.frames.length + 1, winnerPlayerId });
  fixture.homeFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.homePlayerId).length;
  fixture.awayFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.awayPlayerId).length;

  if (fixture.homeFrameScore >= fixture.raceTo || fixture.awayFrameScore >= fixture.raceTo) {
    fixture.status = 'completed';
    fixture.winnerPlayerId = fixture.homeFrameScore > fixture.awayFrameScore ? fixture.homePlayerId : fixture.awayPlayerId;
    if (fixture.nextFixtureId) {
      applyBracketResult(db, fixture);
    }
  }

  writeDb(db);
  res.json(enrichSinglesFixture(db, fixture));
}));

app.delete('/api/fixtures/:id/frames/last', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  if (fixture.frames.length === 0) throw new ApiError(400, 'No frames to undo');
  if (fixture.status === 'completed' && fixture.nextFixtureId) {
    const nextFixture = db.fixtures.find((f) => f.id === fixture.nextFixtureId);
    const advanced = nextFixture && (nextFixture.homePlayerId === fixture.winnerPlayerId || nextFixture.awayPlayerId === fixture.winnerPlayerId || nextFixture.frames?.length > 0);
    if (advanced) throw new ApiError(400, "Can't undo - this result has already advanced the bracket");
  }

  fixture.frames.pop();
  fixture.homeFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.homePlayerId).length;
  fixture.awayFrameScore = fixture.frames.filter((f) => f.winnerPlayerId === fixture.awayPlayerId).length;
  if (fixture.homeFrameScore < fixture.raceTo && fixture.awayFrameScore < fixture.raceTo) {
    fixture.status = fixture.frames.length > 0 ? 'in_progress' : 'scheduled';
    fixture.winnerPlayerId = null;
  }
  writeDb(db);
  res.json(enrichSinglesFixture(db, fixture));
}));

// ---------- Fixtures: teams (legs) ----------

app.post('/api/fixtures/:id/legs/:legNumber/nominate', requireAuth, asyncRoute((req, res) => {
  const { homePlayerId, awayPlayerId } = req.body;
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  const leg = fixture.legs.find((l) => l.legNumber === Number(req.params.legNumber));
  if (!leg) throw new ApiError(404, 'Leg not found');
  if (leg.status !== 'pending') throw new ApiError(400, 'This leg has already started or completed');
  leg.homePlayerId = homePlayerId;
  leg.awayPlayerId = awayPlayerId;
  leg.status = 'scheduled';
  writeDb(db);
  res.json(enrichTeamFixture(db, fixture));
}));

app.post('/api/fixtures/:id/legs/:legNumber/frames', requireAuth, asyncRoute((req, res) => {
  const { winnerPlayerId } = req.body;
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  const leg = fixture.legs.find((l) => l.legNumber === Number(req.params.legNumber));
  if (!leg) throw new ApiError(404, 'Leg not found');
  if (leg.status === 'completed') throw new ApiError(400, 'This leg is already completed');
  if (![leg.homePlayerId, leg.awayPlayerId].includes(winnerPlayerId)) {
    throw new ApiError(400, 'winnerPlayerId must be one of the two nominated players for this leg');
  }

  leg.frames.push({ frameNumber: leg.frames.length + 1, winnerPlayerId });
  leg.homeFrameScore = leg.frames.filter((f) => f.winnerPlayerId === leg.homePlayerId).length;
  leg.awayFrameScore = leg.frames.filter((f) => f.winnerPlayerId === leg.awayPlayerId).length;
  leg.status = 'in_progress';

  if (leg.homeFrameScore >= leg.raceTo || leg.awayFrameScore >= leg.raceTo) {
    leg.status = 'completed';
    leg.winnerPlayerId = leg.homeFrameScore > leg.awayFrameScore ? leg.homePlayerId : leg.awayPlayerId;
  }

  fixture.homeLegsWon = fixture.legs.filter((l) => l.winnerPlayerId === leg.homePlayerId && l.status === 'completed').length;
  // Recompute leg tallies properly based on team, not just this leg's players:
  fixture.homeLegsWon = fixture.legs.filter((l) => l.status === 'completed' && isLegWinnerOnSide(fixture, l, 'home')).length;
  fixture.awayLegsWon = fixture.legs.filter((l) => l.status === 'completed' && isLegWinnerOnSide(fixture, l, 'away')).length;

  const totalLegs = fixture.legs.length;
  const remainingLegs = fixture.legs.filter((l) => l.status !== 'completed').length;
  const majority = Math.floor(totalLegs / 2) + 1;

  if (fixture.homeLegsWon >= majority || fixture.awayLegsWon >= majority) {
    fixture.status = 'completed';
    fixture.winnerTeamId = fixture.homeLegsWon > fixture.awayLegsWon ? fixture.homeTeamId : fixture.awayTeamId;
    if (fixture.nextFixtureId) applyBracketResult(db, fixture);
  } else if (remainingLegs === 0) {
    fixture.status = 'completed';
    if (fixture.homeLegsWon === fixture.awayLegsWon) {
      fixture.winnerTeamId = null; // draw
    } else {
      fixture.winnerTeamId = fixture.homeLegsWon > fixture.awayLegsWon ? fixture.homeTeamId : fixture.awayTeamId;
      if (fixture.nextFixtureId) applyBracketResult(db, fixture);
    }
  }

  writeDb(db);
  res.json(enrichTeamFixture(db, fixture));
}));

function isLegWinnerOnSide(fixture, leg, side) {
  if (!leg.winnerPlayerId) return false;
  const homeTeam = null; // placeholder, replaced by lookup at call site if needed
  return side === 'home' ? leg.winnerPlayerId === leg.homePlayerId : leg.winnerPlayerId === leg.awayPlayerId;
}

app.delete('/api/fixtures/:id/legs/:legNumber/frames/last', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');
  const leg = fixture.legs.find((l) => l.legNumber === Number(req.params.legNumber));
  if (!leg) throw new ApiError(404, 'Leg not found');
  if (leg.frames.length === 0) throw new ApiError(400, 'No frames to undo');
  if (fixture.status === 'completed' && fixture.nextFixtureId) {
    throw new ApiError(400, "Can't undo - this result has already advanced the bracket");
  }

  leg.frames.pop();
  leg.homeFrameScore = leg.frames.filter((f) => f.winnerPlayerId === leg.homePlayerId).length;
  leg.awayFrameScore = leg.frames.filter((f) => f.winnerPlayerId === leg.awayPlayerId).length;
  if (leg.homeFrameScore < leg.raceTo && leg.awayFrameScore < leg.raceTo) {
    leg.status = leg.frames.length > 0 ? 'in_progress' : 'scheduled';
    leg.winnerPlayerId = null;
  }
  fixture.status = 'in_progress';
  fixture.winnerTeamId = null;
  fixture.homeLegsWon = fixture.legs.filter((l) => l.status === 'completed' && isLegWinnerOnSide(fixture, l, 'home')).length;
  fixture.awayLegsWon = fixture.legs.filter((l) => l.status === 'completed' && isLegWinnerOnSide(fixture, l, 'away')).length;
  writeDb(db);
  res.json(enrichTeamFixture(db, fixture));
}));

// ---------- Admin: score override ----------

app.post('/api/fixtures/:id/override', requireAdmin, asyncRoute((req, res) => {
  const { homeScore, awayScore } = req.body;
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    throw new ApiError(400, 'homeScore and awayScore must be non-negative integers');
  }
  const db = readDb();
  const fixture = db.fixtures.find((f) => f.id === req.params.id);
  if (!fixture) throw new ApiError(404, 'Fixture not found');

  const isTeam = fixture.legs !== undefined;
  const currentHome = isTeam ? fixture.homeLegsWon : fixture.homeFrameScore;
  const currentAway = isTeam ? fixture.awayLegsWon : fixture.awayFrameScore;
  const currentWinner = isTeam ? fixture.winnerTeamId : fixture.winnerPlayerId;
  const newWinner = homeScore === awayScore ? null : (homeScore > awayScore
    ? (isTeam ? fixture.homeTeamId : fixture.homePlayerId)
    : (isTeam ? fixture.awayTeamId : fixture.awayPlayerId));

  if (fixture.nextFixtureId && currentWinner && newWinner !== currentWinner) {
    const nextFixture = db.fixtures.find((f) => f.id === fixture.nextFixtureId);
    const advanced = nextFixture && ((nextFixture.homePlayerId === currentWinner || nextFixture.awayPlayerId === currentWinner ||
      nextFixture.homeTeamId === currentWinner || nextFixture.awayTeamId === currentWinner) &&
      (nextFixture.frames?.length > 0 || nextFixture.legs?.some((l) => l.frames?.length > 0)));
    if (advanced) {
      throw new ApiError(400, "Can't change the winner - this result has already advanced the bracket");
    }
  }

  if (isTeam) {
    fixture.homeLegsWon = homeScore;
    fixture.awayLegsWon = awayScore;
    fixture.winnerTeamId = newWinner;
  } else {
    fixture.homeFrameScore = homeScore;
    fixture.awayFrameScore = awayScore;
    fixture.winnerPlayerId = newWinner;
  }
  fixture.status = 'completed';
  if (fixture.nextFixtureId && newWinner) applyBracketResult(db, fixture);

  recordAudit(db, {
    actor: req.adminSession.label,
    action: 'fixture.override',
    targetType: 'fixture',
    targetId: fixture.id,
    details: `Set score to ${homeScore}-${awayScore} (was ${currentHome}-${currentAway})`,
  });

  writeDb(db);
  res.json(fixture);
}));

// ---------- Player profiles ----------

app.get('/api/players/:id', requireAuth, asyncRoute((req, res) => {
  const db = readDb();
  const player = db.players.find((p) => p.id === req.params.id);
  if (!player) throw new ApiError(404, 'Player not found');
  const profile = computePlayerProfile(db, player);
  res.json(profile);
}));

// ---------- Admin: user management ----------
// Everything here requires requireAdmin (isAdmin: true on the account).
// There's no protection against an admin demoting/suspending themselves in
// this v1 - keep at least one other working admin account around if you're
// experimenting with permissions.

app.get('/api/admin/users', requireAdmin, asyncRoute((req, res) => {
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

app.get('/api/admin/users/:id', requireAdmin, asyncRoute((req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  res.json(publicUser(user));
}));

app.patch('/api/admin/users/:id', requireAdmin, asyncRoute((req, res) => {
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

// Sets isAdmin/isCaptain in one call - replaces the old single-value `role`
// toggle now that an account can be both, either or neither.
app.post('/api/admin/users/:id/permissions', requireAdmin, asyncRoute((req, res) => {
  const { isAdmin, isCaptain } = req.body;
  const db = readDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  const changes = [];
  if (isAdmin !== undefined && !!isAdmin !== user.isAdmin) {
    user.isAdmin = !!isAdmin;
    changes.push(user.isAdmin ? 'granted admin' : 'revoked admin');
  }
  if (isCaptain !== undefined && !!isCaptain !== user.isCaptain) {
    user.isCaptain = !!isCaptain;
    changes.push(user.isCaptain ? 'marked as captain' : 'unmarked as captain');
  }
  if (changes.length > 0) {
    recordAudit(db, {
      actor: req.adminSession.label,
      action: 'user.permissions',
      targetType: 'user',
      targetId: user.id,
      details: `${user.firstName} ${user.lastName}: ${changes.join(', ')}`,
    });
  }
  writeDb(db);
  res.json(publicUser(user));
}));

app.post('/api/admin/users/:id/status', requireAdmin, asyncRoute((req, res) => {
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

app.post('/api/admin/users/:id/reset-password', requireAdmin, asyncRoute((req, res) => {
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

// Bulk-imports user accounts straight from Manage Users, independent of any
// season or division - each row becomes a full account (generated temporary
// password handed back once, same as the Season Setup Wizard's import) with
// no roster assignment; add people to a specific division/team afterwards
// from that division's own roster page. A row whose email already matches
// an existing account is skipped (reported back, not treated as an error)
// rather than silently overwriting that account. Shares createUserAccount
// with the wizard's per-season import
// (POST /api/admin/seasons/:leagueId/import-players) - this is just a second
// entry point into the same account-creation logic for when there's no
// season context, e.g. onboarding a batch of players before deciding which
// league they'll go in.
app.post('/api/admin/users/import', requireAdmin, asyncRoute((req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'rows must be a non-empty array');

  const db = readDb();
  const created = [];
  const skipped = [];
  const errors = [];

  rows.forEach((row, index) => {
    const rowNum = index + 1;
    try {
      const firstName = (row.firstName || '').trim();
      const lastName = (row.lastName || '').trim();
      const email = (row.email || '').trim();
      const venue = (row.venue || '').trim();
      const teamName = (row.teamName || '').trim() || 'Unassigned';
      const classification = (row.classification || '').trim().toUpperCase() || null;
      const isAdminFlag = row.isAdmin === true || String(row.isAdmin).trim().toLowerCase() === 'true' || String(row.isAdmin).trim() === '1';
      const isCaptain = row.isCaptain === true || String(row.isCaptain).trim().toLowerCase() === 'true' || String(row.isCaptain).trim() === '1';

      if (!firstName) throw new Error('firstName is required');
      if (!lastName) throw new Error('lastName is required');
      if (!email) throw new Error('email is required');
      if (!venue) throw new Error('venue is required');
      if (classification && !CLASSIFICATIONS.includes(classification)) {
        throw new Error(`classification must be one of: ${CLASSIFICATIONS.join(', ')}`);
      }

      const normalizedEmail = email.toLowerCase();
      const existing = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
      if (existing) {
        skipped.push({ row: rowNum, name: `${existing.firstName} ${existing.lastName}`, email, reason: 'an account with this email already exists' });
        return;
      }

      const tempPassword = generateTempPassword();
      const user = createUserAccount(db, {
        firstName, lastName, email, passwordHash: hashPassword(tempPassword),
        phone: (row.phone || '').trim(), venue, teamName, classification,
        isAdmin: isAdminFlag, isCaptain,
      });
      ensureVenue(db, user.venue, user.id, `${user.firstName} ${user.lastName}`);
      created.push({ row: rowNum, name: `${firstName} ${lastName}`, email, tempPassword });
    } catch (err) {
      errors.push({ row: rowNum, reason: err.message });
    }
  });

  if (created.length > 0) {
    recordAudit(db, {
      actor: req.adminSession.label,
      action: 'user.bulk_import',
      targetType: 'user',
      targetId: null,
      details: `Bulk-imported ${created.length} user account(s) from Manage Users`,
    });
  }

  writeDb(db);
  res.status(created.length > 0 ? 201 : 400).json({ created, skipped, errors });
}));

app.get('/api/admin/audit-log', requireAdmin, asyncRoute((req, res) => {
  const db = readDb();
  const entries = [...db.auditLog].reverse().slice(0, 200);
  res.json(entries);
}));

// ---------- Admin: venues ----------
// A curated, admin-approved list of venues, seeded with a starter set (see
// services/seed.js). New venue names typed at registration or in profile
// edits are auto-queued as `pending` (see ensureVenue above) rather than
// requiring a separate submission step; admins approve or reject them from
// here. Deliberately public/no-login-required for GET, since the
// registration form (before an account exists) needs the approved list too.

app.get('/api/venues', asyncRoute((req, res) => {
  const db = readDb();
  res.json(db.venues.filter((v) => v.status === 'approved'));
}));

app.get('/api/admin/venues', requireAdmin, asyncRoute((req, res) => {
  const db = readDb();
  const venues = [...db.venues].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return a.name.localeCompare(b.name);
  });
  res.json(venues);
}));

app.post('/api/admin/venues/:id/approve', requireAdmin, asyncRoute((req, res) => {
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

app.post('/api/admin/venues/:id/reject', requireAdmin, asyncRoute((req, res) => {
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

// ---------- Admin: season setup wizard ----------
// Backs the 5-step "New Season" wizard in the admin portal:
//   1. name the season            -> POST /api/admin/seasons
//   2. how many leagues/players   -> (same call - leagueCount/playersPerLeague)
//   3. CSV/Excel or manual add    -> POST /api/admin/seasons/:leagueId/import-players
//   4. start/end date             -> (passed straight into step 5's call)
//   5. generate fixtures + gaps   -> POST /api/admin/seasons/:leagueId/generate
//
// A "season" isn't a new top-level entity - it reuses League (the season)
// and Division (each of the N "leagues" within it) so it gets standings,
// fixtures and scoring for free from the existing engine. CSV/Excel parsing
// itself happens client-side (see client/src/pages/AdminSeasonWizard.jsx);
// the server just receives plain row objects either way.

app.post('/api/admin/seasons', requireAdmin, asyncRoute((req, res) => {
  const { name, leagueCount, playersPerLeague } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Season name is required');
  const count = Number(leagueCount);
  const perLeague = Number(playersPerLeague);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new ApiError(400, 'Number of leagues must be a whole number between 1 and 50');
  }
  if (!Number.isInteger(perLeague) || perLeague < 2 || perLeague > 200) {
    throw new ApiError(400, 'Players per league must be a whole number between 2 and 200');
  }

  const db = readDb();
  const league = {
    id: uuid(),
    name: name.trim(),
    sport: 'English 8-Ball Pool',
    format: { matchFormat: 'singles', raceTo: 6, scheduling: 'round_robin_single' },
    startDate: null,
    endDate: null,
    createdAt: new Date().toISOString(),
  };
  db.leagues.push(league);

  const divisions = [];
  for (let i = 0; i < count; i++) {
    const division = {
      id: uuid(),
      leagueId: league.id,
      name: `League ${i + 1}`,
      order: i,
      entryType: 'singles',
      scheduling: 'round_robin_single',
      playerIds: [],
      teamIds: [],
      legsPerMatch: null,
      gapDays: null,
      targetPlayerCount: perLeague,
      fixturesGenerated: false,
    };
    db.divisions.push(division);
    divisions.push(division);
  }

  writeDb(db);
  res.status(201).json({ ...league, divisions });
}));

// Bulk-imports players into one season's divisions - used both for a real
// CSV/Excel upload (client parses the file, posts an array of row objects)
// and for the wizard's "add a player manually" step (posts a single-row
// array). Each row creates a brand-new account (with a generated temporary
// password handed back to the admin) unless the email already matches an
// existing account, in which case that person is just added to the
// requested division instead of being duplicated.
app.post('/api/admin/seasons/:leagueId/import-players', requireAdmin, asyncRoute((req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'rows must be a non-empty array');

  const db = readDb();
  const league = db.leagues.find((l) => l.id === req.params.leagueId);
  if (!league) throw new ApiError(404, 'Season not found');
  const divisions = db.divisions.filter((d) => d.leagueId === league.id);
  const divisionByName = new Map(divisions.map((d) => [d.name.trim().toLowerCase(), d]));

  const created = [];
  const linkedExisting = [];
  const errors = [];

  rows.forEach((row, index) => {
    const rowNum = index + 1;
    try {
      const firstName = (row.firstName || '').trim();
      const lastName = (row.lastName || '').trim();
      const email = (row.email || '').trim();
      const venue = (row.venue || '').trim();
      const teamName = (row.teamName || '').trim() || 'Unassigned';
      const classification = (row.classification || '').trim().toUpperCase() || null;
      const divisionName = (row.division || '').trim();
      const isCaptain = row.isCaptain === true || String(row.isCaptain).trim().toLowerCase() === 'true' || String(row.isCaptain).trim() === '1';

      if (!firstName) throw new Error('firstName is required');
      if (!lastName) throw new Error('lastName is required');
      if (!email) throw new Error('email is required');
      if (!venue) throw new Error('venue is required');
      if (!divisionName) throw new Error('division is required');
      if (classification && !CLASSIFICATIONS.includes(classification)) {
        throw new Error(`classification must be one of: ${CLASSIFICATIONS.join(', ')}`);
      }
      const division = divisionByName.get(divisionName.toLowerCase());
      if (!division) {
        throw new Error(`division "${divisionName}" doesn't match any league in this season (expected one of: ${divisions.map((d) => d.name).join(', ')})`);
      }
      if (division.fixturesGenerated) {
        throw new Error(`fixtures have already been generated for "${division.name}" - can't add more players`);
      }

      const normalizedEmail = email.toLowerCase();
      let user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
      let tempPassword = null;

      if (!user) {
        tempPassword = generateTempPassword();
        user = createUserAccount(db, {
          firstName, lastName, email, passwordHash: hashPassword(tempPassword),
          phone: (row.phone || '').trim(), venue, teamName, classification, isCaptain,
        });
        ensureVenue(db, user.venue, user.id, `${user.firstName} ${user.lastName}`);
        created.push({ row: rowNum, name: `${firstName} ${lastName}`, email, division: division.name, tempPassword });
      } else {
        if (isCaptain && !user.isCaptain) user.isCaptain = true;
        linkedExisting.push({ row: rowNum, name: `${user.firstName} ${user.lastName}`, email, division: division.name });
      }

      if (!division.playerIds.includes(user.playerId)) {
        division.playerIds.push(user.playerId);
      }
    } catch (err) {
      errors.push({ row: rowNum, reason: err.message });
    }
  });

  writeDb(db);
  res.status(created.length + linkedExisting.length > 0 ? 201 : 400).json({ created, linkedExisting, errors });
}));

// Generates round-robin fixtures for every division in the season that has
// at least 2 players and hasn't been generated yet, spacing rounds
// `gapDays` apart starting at `startDate`. Also stamps the season's
// start/end dates onto the League record itself.
app.post('/api/admin/seasons/:leagueId/generate', requireAdmin, asyncRoute((req, res) => {
  const { startDate, endDate, gapDays } = req.body;
  if (!startDate) throw new ApiError(400, 'startDate is required');
  if (!endDate) throw new ApiError(400, 'endDate is required');
  if (!Number.isInteger(Number(gapDays)) || Number(gapDays) < 1) {
    throw new ApiError(400, 'gapDays must be a positive whole number of days between rounds');
  }
  const db = readDb();
  const league = db.leagues.find((l) => l.id === req.params.leagueId);
  if (!league) throw new ApiError(404, 'Season not found');
  league.startDate = startDate;
  league.endDate = endDate;

  const divisions = db.divisions.filter((d) => d.leagueId === league.id);
  const generated = [];
  const skipped = [];

  for (const division of divisions) {
    if (division.fixturesGenerated) {
      skipped.push({ division: division.name, reason: 'fixtures already generated' });
      continue;
    }
    if (division.playerIds.length < 2) {
      skipped.push({ division: division.name, reason: `only ${division.playerIds.length} player(s) registered - needs at least 2` });
      continue;
    }
    const newFixtures = generateRoundRobinFixtures(division);
    db.fixtures.push(...newFixtures);
    division.fixturesGenerated = true;
    division.startDate = startDate;
    division.endDate = endDate;
    division.gapDays = Number(gapDays);
    const lastGameDate = assignScheduledDates(db, division, startDate, Number(gapDays));
    generated.push({
      division: division.name,
      players: division.playerIds.length,
      rounds: [...new Set(newFixtures.map((f) => f.round))].length,
      lastGameDate,
      fitsWithinEndDate: lastGameDate <= endDate,
    });
  }

  writeDb(db);
  res.json({ league, generated, skipped });
}));

// ---------- Static frontend ----------

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Pool League API listening on http://localhost:${PORT}`);
});
