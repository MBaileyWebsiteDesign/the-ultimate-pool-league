# The Ultimate Pool League

A self-hosted pool league management platform: admins create leagues, divisions and
players; the app schedules a single round-robin fixture list per division; captains or
admins record match results frame-by-frame; standings update automatically. Built as a
replacement for [RackEmApp](https://www.rackemapp.com/) because Wix has no equivalent
built-in system for running a real pool league.

This is not affiliated with, endorsed by, or a copy of RackEmApp's code or design — it's
an independent implementation of the subset of functionality needed to run our own
league, informed by an assessment of what RackEmApp offers (below).

## Assessment of RackEmApp

RackEmApp (rackemapp.com) is a mature, single-developer SaaS product aimed at English
8-ball pool leagues, competition organizers, streamers and venues. Its published feature
set is broad: automated free websites per league, electronic scorecards submitted by
captains, live scores and in-play scorecards, flexible season/division/points
configuration, smart fixture generation that avoids table clashes, a full competition
engine (round robin groups, single/double elimination, mini-knockouts, mixed formats,
handicaps), tablet scoring, stream overlays with shot/match timers and StreamDeck
integration, arena screens, online table booking, portable player profiles with
statistics and a "trophy cabinet," and a published API. Pricing is tiered by entry cap
for competitions (free up to 16 entries, rising to unlimited) and a flat per-team,
per-season fee for team leagues.

For a single-developer product it is impressively complete, particularly the
streaming/venue tooling (overlays, timers, arena screens) and the "smart" fixture
scheduling that accounts for physical table constraints — both of which are
non-trivial engineering and go beyond what this MVP attempts. Its main structural
limitation, from a technical standpoint, is that it appears to be a fairly monolithic
product built and maintained by one person; there's no indication of a plugin/extension
model, and pricing is oriented around entry caps rather than feature tiers, which is a
sensible SaaS lever but means smaller organizers pay the same for a subset of features.

This MVP deliberately scopes down to the core administrative loop that Wix cannot
provide at all — competition structure, round-robin scheduling, and frame-level
scoring — rather than attempting to match RackEmApp's streaming and venue features on
day one. Those are called out explicitly in the roadmap below.

## What's implemented

- **Leagues** with a configurable format (match type, race-to-N frames, scheduling
  method). Currently one scheduling method is implemented: single round robin (every
  player in a division plays every other player exactly once).
- **Divisions** within a league (unlimited; seeded with the requested six: Premier
  League, Division 1–5).
- **Player registration** per division. The player list locks once fixtures are
  generated, which mirrors how real leagues avoid re-shuffling a season that's already
  started.
- **Automatic fixture generation** using the standard circle-method round-robin
  algorithm, correctly handling odd numbers of players via a bye.
- **Frame-by-frame scoring**: each frame is recorded as a single winner; the match ends
  automatically the moment either player reaches the race target (e.g. race to 6 ends
  at 6–5, 6–0, 6–3, etc. — never plays on past the target), with the last frame
  reversible for corrections.
- **Live standings**: points (2 for a win), frames for/against, frame difference,
  ranked automatically from completed results.
- **Admin login**: creating a league or a division requires signing in as admin
  (username `Admin`, password `Admin12!@` by default - see **Admin login** below).
  Browsing leagues, registering players, generating fixtures and scoring matches all
  remain open to anyone, since that's the day-to-day captain/player workflow.

## What's deliberately out of scope for v1

Team leagues/doubles-triples, elimination/knockout formats, handicaps, online
entry/payment, tablet-specific UI, stream overlays and timers, table booking, player
statistics beyond the standings table, and per-user accounts (there's one shared admin
account, not individual logins per league admin/captain/player). See **Roadmap** below.

## Admin login

League and division creation are gated behind a single admin account:

- Username: `Admin`
- Password: `Admin12!@`

Override these via the `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables
before deploying anywhere real people can reach it - the defaults are checked into this
repo and are not a secret. Also set `SESSION_SECRET` to a random string in production;
it's the key used to sign login tokens (`server/src/auth.js`), and the checked-in
default is only safe for local use.

This is a deliberately minimal auth model: one hardcoded account, a hand-rolled signed
token (HMAC-SHA256 via Node's built-in `crypto`, no extra dependency) with a 24-hour
expiry, stored in the browser's `localStorage`. It's enough to stop casual/anonymous
league creation, but it is **not** a substitute for real per-user accounts with hashed
passwords - see the roadmap below for what a multi-admin, role-aware version would need
(league admin vs. captain vs. player, each with their own login).

## Architecture

```
pool-league/
  server/            Node.js + Express REST API
    src/
      index.js        Routes, static hosting of the built client
      db.js            JSON-file persistence layer (see note below)
      errors.js
      services/
        roundRobin.js  Circle-method scheduler
        standings.js   Points table calculation
        seed.js        Seeds "Top Spin Singles" with 6 divisions + demo data
  client/            React (Vite) single-page app
    src/
      pages/           LeagueList, LeagueDetail, DivisionDetail, FixtureDetail
      api.js           Fetch wrapper for the REST API
```

**Why a JSON file instead of a real database?** This v1 is optimized to be cloned and
run with nothing but Node installed — no database server to provision, no native
compiled dependencies. Every route goes through `db.js`'s `readDb()`/`writeDb()`
functions and nothing touches the filesystem directly elsewhere, so swapping this for
Postgres (with Prisma or similar) is a contained change to one file plus a migration
script, not a rewrite. This is the top item in the roadmap.

## Data model

- `League`: `id, name, sport, format { matchFormat, raceTo, scheduling }`
- `Division`: `id, leagueId, name, order, playerIds[], fixturesGenerated`
- `Player`: `id, name`
- `Fixture`: `id, leagueId, divisionId, round, homePlayerId, awayPlayerId, raceTo, frames[], homeFrameScore, awayFrameScore, status, winnerPlayerId`
  - `frames[]`: `{ frameNumber, winnerPlayerId }` — the source of truth; scores are
    derived from this list, never stored independently of it.

## Running it locally

Requires Node.js 18+.

```bash
# 1. Install and seed the API
cd server
npm install
npm run seed      # creates "Top Spin Singles" with 6 divisions + demo Premier data
npm start         # http://localhost:4000

# 2. In a second terminal, build the client
cd client
npm install
npm run build      # produces client/dist, which the server serves automatically

# Now open http://localhost:4000 — the whole app is served from one port.
```

For frontend development with hot reload instead of a static build, run `npm run dev`
in `client/` (http://localhost:5173) instead of `npm run build`; the Vite dev server
proxies `/api` requests to the Express server on port 4000, so run both at once.

## API reference (summary)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/leagues` | List / create leagues |
| GET | `/api/leagues/:id` | League + its divisions |
| POST | `/api/leagues/:leagueId/divisions` | Add a division |
| GET | `/api/divisions/:id` | Division + players, fixtures, standings |
| POST | `/api/divisions/:id/players` | Register a player |
| DELETE | `/api/divisions/:id/players/:playerId` | Remove a player (pre-fixtures only) |
| POST | `/api/divisions/:id/generate-fixtures` | Generate the round-robin fixture list |
| GET | `/api/fixtures/:id` | Fixture detail |
| POST | `/api/fixtures/:id/frames` | Record a frame winner |
| DELETE | `/api/fixtures/:id/frames/last` | Undo the last recorded frame |
| POST | `/api/auth/login` | Admin login, returns a signed token |

## Roadmap toward RackEmApp feature parity

1. Swap the JSON file store for Postgres and replace the single hardcoded admin
   account with real per-user accounts and roles (league admin vs. player vs.
   captain), since a real league needs more than one trusted operator.
2. Additional scheduling methods: home/away double round robin, single/double
   elimination, mini-knockouts, and the ability to mix formats within one competition.
3. Team leagues (players grouped into teams, with team-level fixtures made up of
   multiple individual frames/legs) alongside the existing singles format.
4. Player statistics beyond the league table: head-to-head history, form guides,
   break-and-continue / century-style stats if relevant to 8-ball.
5. Live-scoring niceties RackEmApp already has: tablet-optimized scoring UI, stream
   overlay endpoint, shot/match timers — valuable but explicitly deferred until the
   core league engine above is solid.

## Seeded demo data

Running `npm run seed` creates the **Top Spin Singles** league with six divisions
(Premier League, Division 1–5), populates Premier League with 8 demo players, generates
its full round-robin fixture list, and plays out round 1 with varied race-to-6
scorelines (6–5, 6–0, 6–3, 6–4) so the standings table and scoring flow are visible
immediately without any manual setup.
