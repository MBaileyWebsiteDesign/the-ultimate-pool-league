// Seeds "Top Spin Singles": 6 divisions (Premier, Division 1-5), singles,
// race-to-6, single round-robin. Premier is populated with 8 demo players
// and fixtures generated, with a few frame results recorded, so a reviewer
// can see standings/scoring working end-to-end without doing manual setup.
import { v4 as uuid } from 'uuid';
import { resetDb, readDb, writeDb } from '../db.js';
import { generateRoundRobin } from './roundRobin.js';

resetDb();
const db = readDb();

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

// Demo players for Premier League only.
const premierPlayerNames = [
  'Alex Turner', 'Sam Whitfield', 'Jordan Blake', 'Casey Morgan',
  'Riley Stone', 'Taylor Reed', 'Morgan Price', 'Jamie Fox',
];
const premier = divisions[0];
const premierPlayers = premierPlayerNames.map((name) => ({ id: uuid(), name }));
db.players.push(...premierPlayers);
premier.playerIds = premierPlayers.map((p) => p.id);
premier.fixturesGenerated = true;

const rounds = generateRoundRobin(premier.playerIds);
rounds.forEach((pairs, roundIndex) => {
  pairs.forEach(([homePlayerId, awayPlayerId]) => {
    db.fixtures.push({
      id: uuid(),
      leagueId: league.id,
      divisionId: premier.id,
      round: roundIndex + 1,
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

// Play out round 1 as a demo, with varied scorelines (6-5, 6-0, 6-3, 6-4).
const demoScores = [
  [6, 5],
  [6, 0],
  [6, 3],
  [6, 4],
];
const round1Fixtures = db.fixtures.filter((f) => f.divisionId === premier.id && f.round === 1);
round1Fixtures.forEach((fixture, i) => {
  const [homeFrames, awayFrames] = demoScores[i % demoScores.length];
  const frames = [];
  let h = 0;
  let a = 0;
  while (h < homeFrames || a < awayFrames) {
    // Interleave frame wins roughly in proportion, finishing exactly at the target score.
    if (h < homeFrames && (a >= awayFrames || (h + a) % 2 === 0)) {
      frames.push({ frameNumber: frames.length + 1, winnerPlayerId: fixture.homePlayerId });
      h++;
    } else {
      frames.push({ frameNumber: frames.length + 1, winnerPlayerId: fixture.awayPlayerId });
      a++;
    }
  }
  fixture.frames = frames;
  fixture.homeFrameScore = homeFrames;
  fixture.awayFrameScore = awayFrames;
  fixture.status = 'completed';
  fixture.winnerPlayerId = homeFrames > awayFrames ? fixture.homePlayerId : fixture.awayPlayerId;
});

writeDb(db);

console.log('Seeded "Top Spin Singles" league:');
console.log(`  League ID: ${league.id}`);
divisions.forEach((d) => console.log(`  - ${d.name} (${d.id})`));
console.log(`Premier League has ${premierPlayers.length} demo players, fixtures generated, round 1 results recorded.`);
