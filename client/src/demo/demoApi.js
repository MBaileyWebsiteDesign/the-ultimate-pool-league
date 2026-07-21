// A drop-in, client-only stand-in for `../api.js`, used for the static
// GitHub Pages build (see vite.config.js / VITE_DEMO_MODE). There's no
// server to talk to on Pages - so instead of fetch() calls, every method
// here runs the same logic as the real Express routes in
// server/src/index.js directly against an in-memory copy of the seeded demo
// dataset (client/src/demo/demoData.json). Every method still returns a
// Promise that resolves/rejects exactly like the real network version (same
// shapes, same `.message` text on failure), so no page component needs to
// know or care which api it's talking to.
//
// This is a genuine port of the real route logic (not a simplified rewrite)
// so the demo behaves the same as a real deployment - it just keeps its
// state in the browser's localStorage instead of a server-side JSON file,
// which means a visitor's changes (scores, admin edits, new fixtures) stick
// around across a refresh in *their own browser*, but nobody else sees them
// and there's no way to reset short of clearing site data.
import demoDataSeed from './demoData.json';
import { generateRoundRobin } from './logic/roundRobin.js';
import { buildBracketRounds } from './logic/bracket.js';
import { computeStandings } from './logic/standings.js';
import { computeTeamStandings } from './logic/teamStandings.js';
import { buildPlayerProfile } from './logic/playerProfile.js';
import { recordAudit } from './logic/auditLog.js';

const uuid = () => crypto.randomUUID();
const CLASSIFICATIONS = ['A', 'B', 'C', 'D'];
const STATUSES = ['active', 'suspended'];
const SCHEDULING_TYPES = ['round_robin_single', 'knockout_single_elim'];
const DB_KEY = 'poolLeagueDemoDb';
const CURRENT_USER_KEY = 'poolLeagueDemoCurrentUserId';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function loadInitialDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to the bundled seed
  }
  return structuredClone(demoDataSeed);
}

let db = loadInitialDb();

function persist() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    // localStorage can be unavailable (private browsing, quota) - the demo
    // still works for the rest of the page load, it just won't survive a
    // refresh in that case.
  }
}

// Which demo user is "logged in" right now - there's only ever one browser
// tab's worth of state, so this is just an id rather than a real session.
// Starts as the seeded demo account (an admin + captain, linked to the real
// "Matt Bailey" player so "My Account" has real fixtures to show).
let currentUserId = (() => {
  try {
    const stored = localStorage.getItem(CURRENT_USER_KEY);
    if (stored && db.users.some((u) => u.id === stored)) return stored;
  } catch {
    // ignore
  }
  return db.users[0]?.id || null;
})();

function setCurrentUser(userId) {
  currentUserId = userId;
  try {
    localStorage.setItem(CURRENT_USER_KEY, userId);
  } catch {
    // ignore
  }
}

function currentUser() {
  return db.users.find((u) => u.id === currentUserId) || null;
}

function adminLabel() {
  const user = currentUser();
  return user ? `${user.firstName} ${user.lastName}` : 'Demo Admin';
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

// Wraps a synchronous handler so it behaves like the real fetch-backed api.*
// methods: resolves with the return value (after persisting any change to
// localStorage), or rejects with an Error whose `.message` is the same
// user-facing text the real backend would have sent - every page's existing
// `catch (err) { setError(err.message) }` keeps working unmodified.
function op(fn) {
  return (...args) => {
    try {
      const result = fn(...args);
      persist();
      return Promise.resolve(result);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  };
}

// ---------- account creation / profile helpers (ported from server/src/index.js) ----------

function createUserAccount(fields) {
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
    passwordHash: fields.passwordHash || null,
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

function syncLinkedPlayerName(user) {
  if (!user.playerId) return;
  const player = db.players.find((p) => p.id === user.playerId);
  if (player) player.name = `${user.firstName} ${user.lastName}`;
}

function ensureVenue(venueName, requestedByUserId, requestedByName) {
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

function applyProfileFields(user, fields) {
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
    ensureVenue(user.venue, user.id, `${user.firstName} ${user.lastName}`);
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
  syncLinkedPlayerName(user);
}

// ---------- fixture / bracket helpers (ported from server/src/index.js) ----------

function hydrateDivision(division) {
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

function registeredPlayers() {
  const linkedPlayerIds = new Set(
    db.users.filter((u) => u.status === 'active' && u.playerId).map((u) => u.playerId)
  );
  return db.players
    .filter((p) => linkedPlayerIds.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function makeSinglesFixture({ league, division, round }) {
  return {
    id: uuid(),
    leagueId: league.id,
    divisionId: division.id,
    round,
    scheduledDate: null,
    homePlayerId: null,
    awayPlayerId: null,
    raceTo: league.format.raceTo,
    frames: [],
    homeFrameScore: 0,
    awayFrameScore: 0,
    status: 'scheduled',
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
    status: 'pending',
    winnerPlayerId: null,
  }));
  return {
    id: uuid(),
    leagueId: league.id,
    divisionId: division.id,
    round,
    scheduledDate: null,
    homeTeamId: null,
    awayTeamId: null,
    legs,
    homeLegsWon: 0,
    awayLegsWon: 0,
    status: 'scheduled',
    winnerTeamId: null,
    nextFixtureId: null,
    nextFixtureSlot: null,
  };
}

function generateRoundRobinFixtures({ league, division, entrantIds }) {
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

function resolveByeIfNeeded(division, fixture) {
  if (division.entryType === 'teams') {
    if (fixture.homeTeamId && fixture.awayTeamId) return;
    const winnerTeamId = fixture.homeTeamId || fixture.awayTeamId;
    if (!winnerTeamId) return;
    fixture.status = 'completed';
    fixture.winnerTeamId = winnerTeamId;
    propagateWinner(division, fixture, winnerTeamId);
  } else {
    if (fixture.homePlayerId && fixture.awayPlayerId) return;
    const winnerPlayerId = fixture.homePlayerId || fixture.awayPlayerId;
    if (!winnerPlayerId) return;
    fixture.status = 'completed';
    fixture.winnerPlayerId = winnerPlayerId;
    propagateWinner(division, fixture, winnerPlayerId);
  }
}

function propagateWinner(division, fixture, winnerId) {
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
}

function generateKnockoutFixtures({ league, division, entrantIds }) {
  const makeFixture = division.entryType === 'teams' ? makeTeamFixture : makeSinglesFixture;
  const bracketRounds = buildBracketRounds(entrantIds);

  const fixturesByRound = bracketRounds.map((pairs, roundIndex) =>
    pairs.map(() => makeFixture({ league, division, round: roundIndex + 1 }))
  );

  for (let round = 0; round < fixturesByRound.length - 1; round++) {
    fixturesByRound[round].forEach((fixture, i) => {
      const next = fixturesByRound[round + 1][Math.floor(i / 2)];
      fixture.nextFixtureId = next.id;
      fixture.nextFixtureSlot = i % 2 === 0 ? 'home' : 'away';
    });
  }

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
  fixturesByRound[0].forEach((fixture) => resolveByeIfNeeded(division, fixture));
}

function assignScheduledDates(division, startDate, gapDays) {
  if (!startDate || !gapDays) return;
  const base = new Date(`${startDate}T00:00:00`);
  const fixtures = db.fixtures.filter((f) => f.divisionId === division.id);
  for (const fixture of fixtures) {
    const date = new Date(base);
    date.setDate(date.getDate() + (fixture.round - 1) * Number(gapDays));
    fixture.scheduledDate = date.toISOString().slice(0, 10);
  }
}

function recomputeTeamFixture(division, fixture) {
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
    propagateWinner(division, fixture, fixture.winnerTeamId);
  }
}

function findTeamFixtureAndLeg(fixtureId, legNumber) {
  const fixture = db.fixtures.find((f) => f.id === fixtureId);
  if (!fixture || !fixture.legs) throw new ApiError(404, 'Team fixture not found');
  const leg = fixture.legs.find((l) => l.legNumber === Number(legNumber));
  if (!leg) throw new ApiError(404, 'Leg not found');
  return { fixture, leg };
}

// Synchronous session lookup for AuthContext's initial state - there's no
// server round-trip to await in demo mode, so a visitor is "logged in" the
// instant the page loads rather than seeing a login screen first.
export function getDemoSession() {
  const user = currentUser();
  if (!user) return null;
  return { token: 'demo-token', expiresAt: Date.now() + 24 * 60 * 60 * 1000, user: publicUser(user) };
}

// ---------- the api surface (same method names/signatures as ../api.js) ----------

export const demoApi = {
  login: op((email, password) => {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    // Real passwords aren't part of the bundled demo data (nothing to check
    // them against), so any password is accepted for a known demo account -
    // this is a public, throwaway playground, not a real login boundary.
    if (!user) throw new ApiError(401, 'Invalid email or password');
    if (user.status === 'suspended') throw new ApiError(403, 'This account has been suspended');
    setCurrentUser(user.id);
    return { token: 'demo-token', expiresAt: Date.now() + 24 * 60 * 60 * 1000, user: publicUser(user) };
  }),

  register: op((data) => {
    const {
      firstName, lastName, email, phone = '', venue, teamName, classification = null,
    } = data;
    if (!firstName || !firstName.trim()) throw new ApiError(400, 'First name is required');
    if (!lastName || !lastName.trim()) throw new ApiError(400, 'Last name is required');
    if (!email || !email.trim()) throw new ApiError(400, 'Email is required');
    if (!venue || !venue.trim()) throw new ApiError(400, 'Venue is required');
    if (!teamName || !teamName.trim()) throw new ApiError(400, 'Team name is required');
    if (classification && !CLASSIFICATIONS.includes(classification)) {
      throw new ApiError(400, `classification must be one of: ${CLASSIFICATIONS.join(', ')}`);
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      throw new ApiError(409, 'An account with this email already exists');
    }
    const user = createUserAccount({
      firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(),
      phone: phone ? phone.trim() : '', venue: venue.trim(), teamName: teamName.trim(),
      classification: classification || null, isAdmin: false, isCaptain: false,
    });
    ensureVenue(user.venue, user.id, `${user.firstName} ${user.lastName}`);
    setCurrentUser(user.id);
    return { token: 'demo-token', expiresAt: Date.now() + 24 * 60 * 60 * 1000, user: publicUser(user) };
  }),

  getMe: op(() => publicUser(currentUser())),

  updateMe: op((data) => {
    const user = currentUser();
    applyProfileFields(user, data);
    return publicUser(user);
  }),

  changePassword: op(() => ({ ok: true })),

  getMyFixtures: op(() => {
    const user = currentUser();
    if (!user || !user.playerId) return [];
    const playerId = user.playerId;
    const myTeamIds = db.teams.filter((t) => t.playerIds.includes(playerId)).map((t) => t.id);
    const fixtures = db.fixtures.filter((f) => {
      if (f.homePlayerId === playerId || f.awayPlayerId === playerId) return true;
      if (myTeamIds.includes(f.homeTeamId) || myTeamIds.includes(f.awayTeamId)) return true;
      return false;
    });
    const enriched = fixtures.map((f) => {
      const division = db.divisions.find((d) => d.id === f.divisionId);
      const league = db.leagues.find((l) => l.id === f.leagueId);
      const isTeams = !!f.legs;
      const opponentId = isTeams
        ? (myTeamIds.includes(f.homeTeamId) ? f.awayTeamId : f.homeTeamId)
        : (f.homePlayerId === playerId ? f.awayPlayerId : f.homePlayerId);
      const opponentName = isTeams
        ? db.teams.find((t) => t.id === opponentId)?.name
        : db.players.find((p) => p.id === opponentId)?.name;
      return {
        id: f.id,
        leagueName: league?.name,
        divisionName: division?.name,
        round: f.round,
        status: f.status,
        scheduledDate: f.scheduledDate || null,
        opponentName: opponentName || 'TBD',
      };
    });
    enriched.sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || '') || a.round - b.round);
    return enriched;
  }),

  adminListUsers: op((q = '') => {
    const query = (q || '').trim().toLowerCase();
    let users = db.users;
    if (query) {
      users = users.filter((u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        u.venue.toLowerCase().includes(query) ||
        u.teamName.toLowerCase().includes(query)
      );
    }
    users = [...users].sort((a, b) => a.lastName.localeCompare(b.lastName));
    return users.map(publicUser);
  }),

  adminGetUser: op((id) => {
    const user = db.users.find((u) => u.id === id);
    if (!user) throw new ApiError(404, 'User not found');
    return publicUser(user);
  }),

  adminUpdateUser: op((id, data) => {
    const user = db.users.find((u) => u.id === id);
    if (!user) throw new ApiError(404, 'User not found');
    applyProfileFields(user, data);
    recordAudit(db, {
      actor: adminLabel(), action: 'user.edit', targetType: 'user', targetId: user.id,
      details: `Edited profile for ${user.firstName} ${user.lastName}`,
    });
    return publicUser(user);
  }),

  adminSetPermissions: op((id, permissions) => {
    const { isAdmin, isCaptain } = permissions;
    const user = db.users.find((u) => u.id === id);
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
        actor: adminLabel(), action: 'user.permissions', targetType: 'user', targetId: user.id,
        details: `${user.firstName} ${user.lastName}: ${changes.join(', ')}`,
      });
    }
    return publicUser(user);
  }),

  adminSetStatus: op((id, status) => {
    if (!STATUSES.includes(status)) throw new ApiError(400, `status must be one of: ${STATUSES.join(', ')}`);
    const user = db.users.find((u) => u.id === id);
    if (!user) throw new ApiError(404, 'User not found');
    user.status = status;
    recordAudit(db, {
      actor: adminLabel(), action: 'user.status', targetType: 'user', targetId: user.id,
      details: `Set status of ${user.firstName} ${user.lastName} to ${status}`,
    });
    return publicUser(user);
  }),

  adminResetPassword: op((id) => {
    const user = db.users.find((u) => u.id === id);
    if (!user) throw new ApiError(404, 'User not found');
    recordAudit(db, {
      actor: adminLabel(), action: 'user.reset_password', targetType: 'user', targetId: user.id,
      details: `Force-reset password for ${user.firstName} ${user.lastName}`,
    });
    return { ok: true };
  }),

  adminImportUsers: op((rows) => {
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'rows must be a non-empty array');
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
        const user = createUserAccount({
          firstName, lastName, email, phone: (row.phone || '').trim(), venue, teamName, classification,
          isAdmin: isAdminFlag, isCaptain,
        });
        ensureVenue(user.venue, user.id, `${user.firstName} ${user.lastName}`);
        created.push({ row: rowNum, name: `${firstName} ${lastName}`, email, tempPassword: '(not needed in demo mode)' });
      } catch (err) {
        errors.push({ row: rowNum, reason: err.message });
      }
    });
    if (created.length > 0) {
      recordAudit(db, {
        actor: adminLabel(), action: 'user.bulk_import', targetType: 'user', targetId: null,
        details: `Bulk-imported ${created.length} user account(s) from Manage Users`,
      });
    }
    return { created, skipped, errors };
  }),

  adminGetAuditLog: op(() => [...db.auditLog].reverse().slice(0, 200)),

  getVenues: op(() => {
    const approved = db.venues.filter((v) => v.status === 'approved').sort((a, b) => a.name.localeCompare(b.name));
    const user = currentUser();
    const mine = user ? db.venues.filter((v) => v.requestedBy === user.id && v.status !== 'approved') : [];
    return { approved, mine };
  }),

  adminListVenues: op(() => {
    const statusOrder = { pending: 0, approved: 1, rejected: 2 };
    return [...db.venues].sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name));
  }),

  adminApproveVenue: op((id) => {
    const venue = db.venues.find((v) => v.id === id);
    if (!venue) throw new ApiError(404, 'Venue not found');
    venue.status = 'approved';
    venue.approvedBy = adminLabel();
    venue.approvedAt = new Date().toISOString();
    recordAudit(db, {
      actor: adminLabel(), action: 'venue.approve', targetType: 'venue', targetId: venue.id,
      details: `Approved venue "${venue.name}"`,
    });
    return venue;
  }),

  adminRejectVenue: op((id) => {
    const venue = db.venues.find((v) => v.id === id);
    if (!venue) throw new ApiError(404, 'Venue not found');
    venue.status = 'rejected';
    venue.approvedBy = adminLabel();
    venue.approvedAt = new Date().toISOString();
    recordAudit(db, {
      actor: adminLabel(), action: 'venue.reject', targetType: 'venue', targetId: venue.id,
      details: `Rejected venue "${venue.name}"`,
    });
    return venue;
  }),

  adminCreateSeason: op((data) => {
    const { name, leagueCount, playersPerLeague } = data;
    if (!name || !name.trim()) throw new ApiError(400, 'Season name is required');
    const count = Number(leagueCount);
    const perLeague = Number(playersPerLeague);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new ApiError(400, 'Number of leagues must be a whole number between 1 and 50');
    }
    if (!Number.isInteger(perLeague) || perLeague < 2 || perLeague > 200) {
      throw new ApiError(400, 'Players per league must be a whole number between 2 and 200');
    }
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
        id: uuid(), leagueId: league.id, name: `League ${i + 1}`, order: i,
        entryType: 'singles', scheduling: 'round_robin_single', playerIds: [], teamIds: [],
        legsPerMatch: null, gapDays: null, targetPlayerCount: perLeague, fixturesGenerated: false,
      };
      db.divisions.push(division);
      divisions.push(division);
    }
    return { ...league, divisions };
  }),

  adminImportSeasonPlayers: op((leagueId, rows) => {
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'rows must be a non-empty array');
    const league = db.leagues.find((l) => l.id === leagueId);
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
        if (!user) {
          user = createUserAccount({
            firstName, lastName, email, phone: (row.phone || '').trim(), venue, teamName, classification, isCaptain,
          });
          ensureVenue(user.venue, user.id, `${user.firstName} ${user.lastName}`);
          created.push({ row: rowNum, name: `${firstName} ${lastName}`, email, division: division.name, tempPassword: '(not needed in demo mode)' });
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
    return { created, linkedExisting, errors };
  }),

  adminGenerateSeason: op((leagueId, data) => {
    const { startDate, endDate, gapDays } = data;
    if (!startDate) throw new ApiError(400, 'startDate is required');
    if (!endDate) throw new ApiError(400, 'endDate is required');
    if (!Number.isInteger(Number(gapDays)) || Number(gapDays) < 1) {
      throw new ApiError(400, 'gapDays must be a positive whole number of days between rounds');
    }
    if (new Date(endDate) < new Date(startDate)) {
      throw new ApiError(400, 'endDate cannot be before startDate');
    }
    const league = db.leagues.find((l) => l.id === leagueId);
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
        skipped.push({ division: division.name, reason: `only ${division.playerIds.length} player(s) - needs at least 2` });
        continue;
      }
      generateRoundRobinFixtures({ league, division, entrantIds: division.playerIds });
      division.gapDays = Number(gapDays);
      assignScheduledDates(division, startDate, gapDays);
      division.fixturesGenerated = true;
      const divisionFixtures = db.fixtures.filter((f) => f.divisionId === division.id);
      const lastRound = Math.max(...divisionFixtures.map((f) => f.round));
      const lastRoundDate = divisionFixtures.find((f) => f.round === lastRound)?.scheduledDate;
      generated.push({
        division: division.name, players: division.playerIds.length, rounds: lastRound,
        lastGameDate: lastRoundDate, fitsWithinEndDate: !lastRoundDate || lastRoundDate <= endDate,
      });
    }
    return { league: { id: league.id, name: league.name, startDate, endDate }, generated, skipped };
  }),

  overrideFixture: op((fixtureId, homeScore, awayScore) => {
    const fixture = db.fixtures.find((f) => f.id === fixtureId);
    if (!fixture) throw new ApiError(404, 'Fixture not found');
    const division = db.divisions.find((d) => d.id === fixture.divisionId);
    const isTeams = division.entryType === 'teams';
    if (isTeams) {
      if (!fixture.homeTeamId || !fixture.awayTeamId) throw new ApiError(400, 'Both teams for this fixture are not yet known');
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
        ...leg, homePlayerId: null, awayPlayerId: null, frames: [], homeFrameScore: 0, awayFrameScore: 0,
        status: 'pending', winnerPlayerId: null,
      }));
    } else {
      fixture.homeFrameScore = homeScore;
      fixture.awayFrameScore = awayScore;
      fixture.frames = [];
      fixture.winnerPlayerId = newWinnerId;
    }
    fixture.status = 'completed';
    fixture.adminOverride = { at: new Date().toISOString(), by: adminLabel() };
    if (fixture.nextFixtureId && newWinnerId && newWinnerId !== oldWinnerId) {
      propagateWinner(division, fixture, newWinnerId);
    }
    recordAudit(db, {
      actor: adminLabel(), action: 'fixture.override', targetType: 'fixture', targetId: fixture.id,
      details: `Set final score to ${homeScore}-${awayScore}`,
    });
    return fixture;
  }),

  getLeagues: op(() => db.leagues),

  createLeague: op((data) => {
    const { name, sport = 'English 8-Ball Pool', matchFormat = 'singles', raceTo = 6, scheduling = 'round_robin_single' } = data;
    if (!name || !name.trim()) throw new ApiError(400, 'League name is required');
    const league = {
      id: uuid(), name: name.trim(), sport, format: { matchFormat, raceTo, scheduling },
      startDate: null, endDate: null, createdAt: new Date().toISOString(),
    };
    db.leagues.push(league);
    return league;
  }),

  getLeague: op((id) => {
    const league = db.leagues.find((l) => l.id === id);
    if (!league) throw new ApiError(404, 'League not found');
    const divisions = db.divisions.filter((d) => d.leagueId === league.id).sort((a, b) => a.order - b.order);
    return { ...league, divisions };
  }),

  createDivision: op((leagueId, data) => {
    const { name, order = 0, entryType = 'singles', legsPerMatch = 5 } = data;
    const league = db.leagues.find((l) => l.id === leagueId);
    if (!league) throw new ApiError(404, 'League not found');
    const scheduling = data.scheduling || league.format.scheduling || 'round_robin_single';
    if (!name || !name.trim()) throw new ApiError(400, 'Division name is required');
    if (!['singles', 'teams'].includes(entryType)) throw new ApiError(400, 'entryType must be "singles" or "teams"');
    if (!SCHEDULING_TYPES.includes(scheduling)) throw new ApiError(400, `scheduling must be one of: ${SCHEDULING_TYPES.join(', ')}`);
    if (entryType === 'teams' && (!Number.isInteger(Number(legsPerMatch)) || Number(legsPerMatch) < 1)) {
      throw new ApiError(400, 'legsPerMatch must be a positive whole number');
    }
    const division = {
      id: uuid(), leagueId: league.id, name: name.trim(), order, entryType, scheduling,
      playerIds: [], teamIds: entryType === 'teams' ? [] : [],
      legsPerMatch: entryType === 'teams' ? Number(legsPerMatch) : null,
      gapDays: null, fixturesGenerated: false,
    };
    db.divisions.push(division);
    return division;
  }),

  getDivision: op((id) => {
    const division = db.divisions.find((d) => d.id === id);
    if (!division) throw new ApiError(404, 'Division not found');
    return hydrateDivision(division);
  }),

  getRegisteredPlayers: op(() => registeredPlayers()),

  addPlayer: op((divisionId, playerId) => {
    if (!playerId) throw new ApiError(400, 'playerId is required');
    const division = db.divisions.find((d) => d.id === divisionId);
    if (!division) throw new ApiError(404, 'Division not found');
    if (division.entryType !== 'singles') throw new ApiError(400, 'This is a team division - add players to a team instead');
    if (division.fixturesGenerated) throw new ApiError(400, 'Cannot add players after fixtures have been generated for this division');
    const player = registeredPlayers().find((p) => p.id === playerId);
    if (!player) throw new ApiError(400, 'Only registered, active users can be added as players - pick a name from the list');
    if (!division.playerIds.includes(player.id)) division.playerIds.push(player.id);
    return hydrateDivision(division);
  }),

  removePlayer: op((divisionId, playerId) => {
    const division = db.divisions.find((d) => d.id === divisionId);
    if (!division) throw new ApiError(404, 'Division not found');
    if (division.fixturesGenerated) throw new ApiError(400, 'Cannot remove players after fixtures have been generated for this division');
    division.playerIds = division.playerIds.filter((id) => id !== playerId);
    return hydrateDivision(division);
  }),

  generateFixtures: op((divisionId, data = {}) => {
    const { startDate, gapDays } = data;
    const division = db.divisions.find((d) => d.id === divisionId);
    if (!division) throw new ApiError(404, 'Division not found');
    const league = db.leagues.find((l) => l.id === division.leagueId);
    if (division.fixturesGenerated) throw new ApiError(400, 'Fixtures have already been generated for this division');
    const entrantIds = division.entryType === 'teams' ? division.teamIds : division.playerIds;
    const entrantLabel = division.entryType === 'teams' ? 'teams' : 'players';
    if (entrantIds.length < 2) throw new ApiError(400, `A division needs at least 2 ${entrantLabel} before fixtures can be generated`);
    if (division.scheduling === 'knockout_single_elim') {
      generateKnockoutFixtures({ league, division, entrantIds });
    } else {
      generateRoundRobinFixtures({ league, division, entrantIds });
    }
    if (startDate && gapDays) {
      division.gapDays = Number(gapDays);
      assignScheduledDates(division, startDate, gapDays);
    }
    division.fixturesGenerated = true;
    return hydrateDivision(division);
  }),

  substitutePlayer: op((divisionId, outgoingPlayerId, incomingPlayerId, reason = 'substitution') => {
    if (!outgoingPlayerId || !incomingPlayerId) throw new ApiError(400, 'outgoingPlayerId and incomingPlayerId are required');
    if (outgoingPlayerId === incomingPlayerId) throw new ApiError(400, 'The replacement must be a different player from the one dropping out');
    if (!['substitution', 'retirement'].includes(reason)) throw new ApiError(400, "reason must be 'substitution' or 'retirement'");
    const division = db.divisions.find((d) => d.id === divisionId);
    if (!division) throw new ApiError(404, 'Division not found');
    if (division.entryType !== 'singles') throw new ApiError(400, 'Player substitution is only available for singles divisions right now');
    if (!division.playerIds.includes(outgoingPlayerId)) throw new ApiError(400, 'That player is not registered in this division');
    if (division.playerIds.includes(incomingPlayerId)) throw new ApiError(400, 'That replacement is already registered in this division');
    const incoming = registeredPlayers().find((p) => p.id === incomingPlayerId);
    if (!incoming) throw new ApiError(400, 'Only registered, active users can be added as players - pick a name from the list');
    const outgoing = db.players.find((p) => p.id === outgoingPlayerId);
    const divisionFixtures = db.fixtures.filter((f) => f.divisionId === division.id);
    const swapped = [];
    const blockedInProgress = [];
    for (const fixture of divisionFixtures) {
      const isHome = fixture.homePlayerId === outgoingPlayerId;
      const isAway = fixture.awayPlayerId === outgoingPlayerId;
      if (!isHome && !isAway) continue;
      if (fixture.status === 'completed') continue;
      if (fixture.status === 'in_progress') {
        blockedInProgress.push({ fixtureId: fixture.id, round: fixture.round });
        continue;
      }
      if (isHome) fixture.homePlayerId = incomingPlayerId;
      else fixture.awayPlayerId = incomingPlayerId;
      swapped.push({ fixtureId: fixture.id, round: fixture.round });
    }
    division.playerIds.push(incomingPlayerId);
    // A 'retirement' also drops the outgoing player from the roster, so
    // their row disappears from the League Table - unlike a plain
    // 'substitution', where they stay listed with their played-so-far
    // record frozen. Either way, computeStandings only ever aggregates a
    // row from that row's own fixtures, so this never touches opponents'
    // already-completed results.
    if (reason === 'retirement') {
      division.playerIds = division.playerIds.filter((id) => id !== outgoingPlayerId);
    }
    if (!division.substitutions) division.substitutions = [];
    division.substitutions.push({
      id: uuid(), outgoingPlayerId, outgoingPlayerName: outgoing ? outgoing.name : 'Unknown player',
      incomingPlayerId, incomingPlayerName: incoming.name, reason, at: new Date().toISOString(),
      by: adminLabel(), fixturesSwapped: swapped.length,
    });
    recordAudit(db, {
      actor: adminLabel(), action: 'division.substitute_player', targetType: 'division', targetId: division.id,
      details: reason === 'retirement'
        ? `${outgoing ? outgoing.name : 'A player'} retired from "${division.name}" - removed from the League Table, ${incoming.name} took over ${swapped.length} remaining fixture(s)`
        : `Swapped ${outgoing ? outgoing.name : 'a player'} out for ${incoming.name} in "${division.name}" (${swapped.length} remaining fixture(s) reassigned)`,
    });
    return { division: hydrateDivision(division), swapped, blockedInProgress, reason };
  }),

  getFixture: op((id) => {
    const fixture = db.fixtures.find((f) => f.id === id);
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
      return { ...fixture, divisionName, legs, homeTeam, awayTeam, bothEntrantsKnown: !!(fixture.homeTeamId && fixture.awayTeamId) };
    }
    const homePlayer = fixture.homePlayerId ? db.players.find((p) => p.id === fixture.homePlayerId) : null;
    const awayPlayer = fixture.awayPlayerId ? db.players.find((p) => p.id === fixture.awayPlayerId) : null;
    return { ...fixture, divisionName, homePlayer, awayPlayer, bothEntrantsKnown: !!(fixture.homePlayerId && fixture.awayPlayerId) };
  }),

  recordFrame: op((fixtureId, winnerPlayerId) => {
    const fixture = db.fixtures.find((f) => f.id === fixtureId);
    if (!fixture) throw new ApiError(404, 'Fixture not found');
    const division = db.divisions.find((d) => d.id === fixture.divisionId);
    if (division.entryType === 'teams') throw new ApiError(400, 'This is a team fixture - record frames against a specific leg instead');
    if (!fixture.homePlayerId || !fixture.awayPlayerId) throw new ApiError(400, 'Both players for this fixture are not yet known - waiting on an earlier round');
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
    if (fixture.status === 'completed') propagateWinner(division, fixture, fixture.winnerPlayerId);
    return fixture;
  }),

  undoLastFrame: op((fixtureId) => {
    const fixture = db.fixtures.find((f) => f.id === fixtureId);
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
    return fixture;
  }),

  createTeam: op((divisionId, name) => {
    if (!name || !name.trim()) throw new ApiError(400, 'Team name is required');
    const division = db.divisions.find((d) => d.id === divisionId);
    if (!division) throw new ApiError(404, 'Division not found');
    if (division.entryType !== 'teams') throw new ApiError(400, 'This is a singles division - add players directly instead');
    if (division.fixturesGenerated) throw new ApiError(400, 'Cannot add teams after fixtures have been generated for this division');
    const team = { id: uuid(), divisionId: division.id, name: name.trim(), playerIds: [] };
    db.teams.push(team);
    division.teamIds.push(team.id);
    return hydrateDivision(division);
  }),

  removeTeam: op((divisionId, teamId) => {
    const division = db.divisions.find((d) => d.id === divisionId);
    if (!division) throw new ApiError(404, 'Division not found');
    if (division.fixturesGenerated) throw new ApiError(400, 'Cannot remove teams after fixtures have been generated for this division');
    division.teamIds = division.teamIds.filter((id) => id !== teamId);
    return hydrateDivision(division);
  }),

  addTeamPlayer: op((teamId, playerId) => {
    if (!playerId) throw new ApiError(400, 'playerId is required');
    const team = db.teams.find((t) => t.id === teamId);
    if (!team) throw new ApiError(404, 'Team not found');
    const division = db.divisions.find((d) => d.id === team.divisionId);
    if (division.fixturesGenerated) throw new ApiError(400, 'Cannot add players once fixtures have been generated for this division');
    const player = registeredPlayers().find((p) => p.id === playerId);
    if (!player) throw new ApiError(400, 'Only registered, active users can be added as players - pick a name from the list');
    if (!team.playerIds.includes(player.id)) team.playerIds.push(player.id);
    return hydrateDivision(division);
  }),

  removeTeamPlayer: op((teamId, playerId) => {
    const team = db.teams.find((t) => t.id === teamId);
    if (!team) throw new ApiError(404, 'Team not found');
    const division = db.divisions.find((d) => d.id === team.divisionId);
    if (division.fixturesGenerated) throw new ApiError(400, 'Cannot remove players once fixtures have been generated for this division');
    team.playerIds = team.playerIds.filter((id) => id !== playerId);
    return hydrateDivision(division);
  }),

  nominateLeg: op((fixtureId, legNumber, homePlayerId, awayPlayerId) => {
    const { fixture, leg } = findTeamFixtureAndLeg(fixtureId, legNumber);
    if (!fixture.homeTeamId || !fixture.awayTeamId) throw new ApiError(400, 'Both teams for this fixture are not yet known - waiting on an earlier round');
    if (leg.status !== 'pending') throw new ApiError(400, 'This leg already has nominated players - undo its frames first to change them');
    const homeTeam = db.teams.find((t) => t.id === fixture.homeTeamId);
    const awayTeam = db.teams.find((t) => t.id === fixture.awayTeamId);
    if (!homeTeam.playerIds.includes(homePlayerId)) throw new ApiError(400, 'Home player is not registered to the home team');
    if (!awayTeam.playerIds.includes(awayPlayerId)) throw new ApiError(400, 'Away player is not registered to the away team');
    leg.homePlayerId = homePlayerId;
    leg.awayPlayerId = awayPlayerId;
    leg.status = 'scheduled';
    return fixture;
  }),

  recordLegFrame: op((fixtureId, legNumber, winnerPlayerId) => {
    const { fixture, leg } = findTeamFixtureAndLeg(fixtureId, legNumber);
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
    recomputeTeamFixture(division, fixture);
    return fixture;
  }),

  undoLastLegFrame: op((fixtureId, legNumber) => {
    const { fixture, leg } = findTeamFixtureAndLeg(fixtureId, legNumber);
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
    recomputeTeamFixture(division, fixture);
    return fixture;
  }),

  getPlayerProfile: op((playerId) => {
    const profile = buildPlayerProfile(db, playerId);
    if (!profile) throw new ApiError(404, 'Player not found');
    return profile;
  }),
};
