// Seeds "Top Spin Singles": 6 divisions (Premier, Division 1-5), singles,
// race-to-6, single round-robin - populated with the real current-season
// rosters (84 players total, 14 per division) so there's a realistic dataset
// to test against. Every division gets its full round-robin fixture list
// generated up front, but every fixture is left `scheduled` (unplayed) - the
// rosters here are real, but there's no way to reconstruct the actual
// match-by-match history (who played whom, in what order) from a final
// standings table alone, so no results are invented. Score fixtures through
// the normal app flow to build up real standings for testing.
import { v4 as uuid } from 'uuid';
import { resetDb, readDb, writeDb } from '../db.js';
import { generateRoundRobin } from './roundRobin.js';
import { hashPassword } from '../userAuth.js';

resetDb();
const db = readDb();

// Seed a handful of pre-approved venues so registration/profile venue
// dropdowns aren't empty on a fresh install. Players can request more from
// the registration or account page; an admin approves them from there.
const seedVenueNames = [
  'The Cue Club', "Rack 'Em Sports Bar", 'The Green Baize', 'Corner Pocket Tavern', 'Break & Run Social Club',
];
const now = new Date().toISOString();
db.venues.push(...seedVenueNames.map((name) => ({
  id: uuid(),
  name,
  status: 'approved',
  requestedBy: null,
  requestedByName: null,
  requestedAt: now,
  approvedBy: 'Admin',
  approvedAt: now,
})));

// Seed one admin account - login is unified now (no separate hardcoded admin
// login), so a real account with isAdmin: true has to exist for anyone to
// reach the admin portal on a fresh install. Change this password (or use
// "Force Password Reset" from Manage Users) before deploying anywhere real
// people can reach it.
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin12!@';
db.users.push({
  id: uuid(),
  firstName: 'League',
  lastName: 'Admin',
  email: ADMIN_EMAIL,
  passwordHash: hashPassword(ADMIN_PASSWORD),
  phone: '',
  venue: seedVenueNames[0],
  teamName: 'Admin',
  classification: null,
  isAdmin: true,
  isCaptain: false,
  status: 'active',
  playerId: null,
  createdAt: now,
});

const league = {
  id: uuid(),
  name: 'Top Spin Singles',
  sport: 'English 8-Ball Pool',
  format: {
    matchFormat: 'singles',
    raceTo: 6,
    scheduling: 'round_robin_single',
    description: 'Singles league. Every player in a division plays every other player once. Matches are races to 6 frames.',
  },
  createdAt: new Date().toISOString(),
};
db.leagues.push(league);

// Real current-season rosters, one array per division - pulled from the
// current standings tables (Prem/Div1-5) rather than invented demo names.
// These are seed/demo `Player` records only, not linked to a registered
// `User` account (same exception the old demo data relied on - see the
// README's "Seeded demo data" section) purely so the divisions have full
// rosters to test against out of the box.
const rosters = {
  'Premier League': [
    'Suraj Singh Rathor', 'Neil Cummins', 'Simon Hendry', 'Josh Barnes',
    'Daniel Hemphill', 'Tony Brine', 'Adrian Sturgess', 'Ryan Watts',
    'Dan Shaw', 'Parvan Singh', 'Tinks Singh', 'Matthew Burgess',
    'Joe Mckeown', 'John Guttridge',
  ],
  'Division 1': [
    'Atul Modha', 'Dean Hutson', 'Ronnie Digwa', 'David Hampson',
    'Richard Maiden', 'Luke Baker', 'Bobby Nijar', 'Ricky Goodwin',
    'Michael Halton', 'Lewis Seagrave', 'David Spring', 'Daniel Richardson',
    'Henry Morris', 'Phil West',
  ],
  'Division 2': [
    'James Wood', 'Rhys Ho', 'Dale Baker', 'Aaron Roberts',
    'Martin Sinclair', 'Simon McDougall', 'Owen Herridge', 'Jason Plant',
    'Martyn Furey-Dear', 'Johnnie Digwa', 'Daniel Baird', 'Brandon Caine',
    'Matthew Kennett', 'Mark Trusler',
  ],
  'Division 3': [
    'Karol Zboch', 'Paul Nicholas', 'Christopher Brackstone', 'Sean Nicholas',
    'Carl Gregory', 'Lloyd Treadgold', 'Ben Rankin', 'Liam Hodder',
    'Joe Proctor', 'Luke Northover', 'Jordan Bassett', 'Nick Warren',
    'Dotty Murphy', 'Justin Ware',
  ],
  'Division 4': [
    'Matthew Lindsay', 'Oscar Carson', 'Paul Dunne', 'Max Vince',
    'Michael Fonda', 'Martyn Bond', 'Gary Price', 'Gurdev Rathor',
    'Marcus Smith', 'Adam Parnell', 'Stu Bridle', 'Ray Spong',
    'Matty Stride', 'Doz Bernstein',
  ],
  'Division 5': [
    'Jamie Pickersgill', 'Peter Carson', 'Brian Eley', 'Graham Uzell',
    'Graham Davies', 'Wes Pack', 'Ally Modha', 'Ethan Parnell',
    'Lee Walshe', 'Matt Bailey', 'Louie English', 'Mich Mich',
    'Lia Hall', 'Jamie Fitzpatrick',
  ],
};

const divisionNames = ['Premier League', 'Division 1', 'Division 2', 'Division 3', 'Division 4', 'Division 5'];
const divisions = divisionNames.map((name, order) => ({
  id: uuid(),
  leagueId: league.id,
  name,
  order,
  entryType: 'singles',
  scheduling: 'round_robin_single',
  legsPerMatch: null,
  playerIds: [],
  teamIds: [],
  fixturesGenerated: false,
}));
db.divisions.push(...divisions);

// Build each division's roster, then generate its full round-robin fixture
// list - every fixture starts `scheduled` (no frames recorded), so standings
// start blank and get built up through the normal scoring flow, same as a
// real season in progress.
divisions.forEach((division) => {
  const names = rosters[division.name] || [];
  const players = names.map((name) => ({ id: uuid(), name }));
  db.players.push(...players);
  division.playerIds = players.map((p) => p.id);
  division.fixturesGenerated = true;

  const rounds = generateRoundRobin(division.playerIds);
  rounds.forEach((pairs, roundIndex) => {
    pairs.forEach(([homePlayerId, awayPlayerId]) => {
      db.fixtures.push({
        id: uuid(),
        leagueId: league.id,
        divisionId: division.id,
        round: roundIndex + 1,
        scheduledDate: null,
        homePlayerId,
        awayPlayerId,
        raceTo: league.format.raceTo,
        frames: [],
        homeFrameScore: 0,
        awayFrameScore: 0,
        status: 'scheduled',
        winnerPlayerId: null,
        nextFixtureId: null,
        nextFixtureSlot: null,
      });
    });
  });
});

writeDb(db);

console.log('Seeded "Top Spin Singles" league:');
console.log(`  League ID: ${league.id}`);
divisions.forEach((d) => {
  const fixtureCount = db.fixtures.filter((f) => f.divisionId === d.id).length;
  console.log(`  - ${d.name} (${d.id}): ${d.playerIds.length} players, ${fixtureCount} fixtures generated (all unplayed)`);
});
console.log(`Seeded ${seedVenueNames.length} approved venues: ${seedVenueNames.join(', ')}`);
console.log(`Seeded admin account: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (change this before deploying anywhere real people can reach it)`);
