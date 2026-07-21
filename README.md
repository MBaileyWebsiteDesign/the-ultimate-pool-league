# The Ultimate Pool League

A self-hosted pool league management platform: admins create leagues, divisions and
players; the app schedules fixtures per division (round robin or knockout); captains or
admins record match results frame-by-frame; standings update automatically. Built to
give a pool league the full-featured competition management that Wix has no built-in
system for.

## What's implemented

- **Leagues** with a configurable format (match type, race-to-N frames, default
  scheduling method).
- **Divisions** within a league (unlimited; seeded with the requested six: Premier
  League, Division 1–5), each independently configured along two axes:
  - **Entry type** — `singles` (one player vs. one player) or `teams` (team vs. team).
  - **Scheduling** — `round_robin_single` (everyone/every team plays everyone/every
    team else exactly once) or `knockout_single_elim` (single-elimination bracket).
  These are independent choices, so e.g. a knockout team cup and a round-robin singles
  division can coexist in the same league.
- **Team leagues**: teams are rosters of players; a team fixture is a best-of-N "legs"
  match (N = `legsPerMatch`, admin-configurable per division), each leg a nominated
  player vs. nominated player mini-match scored exactly like a singles frame race. The
  team match is decided the moment one side has an unreachable majority of legs (mirrors
  the singles race-to-N "stop once it's decided" behaviour); an even `legsPerMatch` can
  end level, recorded as a drawn team match (2/1/0 league points for win/draw/loss). Use
  an odd `legsPerMatch` for knockout team divisions so every match has a winner to
  advance.
- **Knockout / single-elimination format**: standard bracket seeding with byes for
  non-power-of-2 entrant counts (see `server/src/services/bracket.js`), automatic bye
  resolution (a bye winner advances without a match, but two bye-advanced entrants
  meeting in a later round always play a real match — a slot merely waiting on an
  earlier round is never confused with a genuine bye), winner propagation into the next
  round's fixture, and an undo-lock: once a result has advanced a player/team to the
  next round, that frame/leg can't be undone from the completed fixture (it would
  silently corrupt the bracket) — the fixture detail page shows "TBD" for slots that
  haven't been decided yet.
- **Player registration** per division (singles) or per team (teams). Rosters lock once
  fixtures are generated, which mirrors how real leagues avoid re-shuffling a season
  that's already started.
- **Automatic fixture generation**: circle-method round-robin (handling odd counts via
  a bye) or knockout bracket generation, depending on the division's `scheduling`.
- **Frame-by-frame scoring**: each frame is recorded as a single winner; the match ends
  automatically the moment either side reaches the race target (e.g. race to 6 ends
  at 6–5, 6–0, 6–3, etc. — never plays on past the target), with the last frame
  reversible for corrections (unless that result already advanced a bracket).
- **Live standings**: singles divisions rank by points (2 for a win)/frames
  for/against/difference; team divisions rank by points (2/1/0 for win/draw/loss)/legs
  for/against/difference — both computed automatically from completed results.
- **Player stats & profiles**: every player has a profile page showing career record
  (played/won/lost, frames for/against, frame difference) aggregated across both singles
  fixtures and legs played inside team fixtures, plus a head-to-head breakdown per
  opponent and a full match history linking back to each fixture.
- **Admin login**: creating a league or division requires signing in as admin (username
  `Admin`, password `Admin12!@` by default - see **Admin login** below).
- **Player accounts**: viewing the site at all — leagues, divisions, fixtures, standings,
  player profiles — requires being logged in, either as admin or as a self-registered
  player (see **Player accounts** below). Registering players/teams into a division,
  generating fixtures, and scoring matches remain open to anyone with the fixture/division
  URL, since that's the day-to-day captain/scorer workflow and doesn't need its own login
  yet - see the roadmap for tightening this further.

## What's deliberately out of scope for v1

Handicaps, online entry/payment, tablet-specific UI, stream overlays and timers, table
booking, double-elimination/mini-knockout/mixed formats, and role-aware accounts (a
player account can view everything but has no captain/league-admin permissions of its
own yet - see **Roadmap** below).

## Admin login

League and division creation are gated behind a single admin account:

- Username: `Admin`
- Password: `Admin12!@`

Override these via the `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables
before deploying anywhere real people can reach it - the defaults are checked into this
repo and are not a secret. Also set `SESSION_SECRET` to a random string in production;
it's the key used to sign login tokens (`server/src/auth.js` and `server/src/userAuth.js`
both use it), and the checked-in default is only safe for local use.

This is a deliberately minimal auth model: one hardcoded account, a hand-rolled signed
token (HMAC-SHA256 via Node's built-in `crypto`, no extra dependency) with a 24-hour
expiry, stored in the browser's `localStorage`. It's enough to stop casual/anonymous
league creation, but it is **not** a substitute for real per-user accounts with hashed
passwords - see the roadmap below for what a multi-admin, role-aware version would need
(league admin vs. captain vs. player, each with their own login).

## Player accounts

Anyone can self-register a player account (top right of the site, next to Admin Login) -
this is what's required to browse the site as a normal visitor. Registration collects:

- First name, last name, email, password (required)
- Phone (optional)
- Venue and team name (required)
- Classification, A through D (optional)

Passwords are salted and hashed with Node's built-in `crypto.scrypt` (never stored in
plaintext), and login issues the same style of HMAC-signed, 24-hour token as the admin
account, stored in `localStorage` separately from the admin session so a browser can be
logged into both an admin session and a player session at once - the header shows both
controls side by side. Player accounts live in the same JSON database as everything else
(`db.users`), not a separate store. See `server/src/userAuth.js` for the implementation,
and the roadmap for what a production version needs on top of this (password reset,
email verification, and real per-account permissions beyond "can view").

## Architecture

```
pool-league/
  server/            Node.js + Express REST API
    src/
      index.js          Routes, static hosting of the built client
      db.js              JSON-file persistence layer (see note below)
      auth.js            Admin login + HMAC-signed session tokens
      userAuth.js        Player account registration/login, password hashing,
                          requireAnyAuth (admin OR player) route gate
      errors.js
      services/
        roundRobin.js    Circle-method scheduler (singles + teams)
        bracket.js       Single-elimination bracket seeding with bye handling
        standings.js     Singles points table calculation
        teamStandings.js Team points table calculation
        playerProfile.js Career stats + head-to-head aggregation for a player
        seed.js          Seeds "Top Spin Singles" with 6 divisions + demo data
  client/            React (Vite) single-page app
    src/
      pages/                LeagueList, LeagueDetail, DivisionDetail, FixtureDetail,
                            PlayerProfile, Login, Register, PlayerLogin
      AuthContext.jsx       Admin session state (token storage, login/logout)
      PlayerAuthContext.jsx Player session state, kept separate from admin
      api.js                Fetch wrapper for the REST API
```

**Why a JSON file instead of a real database?** This v1 is optimized to be cloned and
run with nothing but Node installed — no database server to provision, no native
compiled dependencies. Every route goes through `db.js`'s `readDb()`/`writeDb()`
functions and nothing touches the filesystem directly elsewhere, so swapping this for
Postgres (with Prisma or similar) is a contained change to one file plus a migration
script, not a rewrite. This is the top item in the roadmap.

## Data model

- `League`: `id, name, sport, format { matchFormat, raceTo, scheduling }`
- `Division`: `id, leagueId, name, order, entryType ('singles'|'teams'), scheduling
  ('round_robin_single'|'knockout_single_elim'), legsPerMatch (teams only), playerIds[]
  (singles only), teamIds[] (teams only), fixturesGenerated`
- `Player`: `id, name`
- `Team`: `id, divisionId, name, playerIds[]`
- Singles `Fixture`: `id, leagueId, divisionId, round, homePlayerId, awayPlayerId,
  raceTo, frames[], homeFrameScore, awayFrameScore, status, winnerPlayerId,
  nextFixtureId, nextFixtureSlot`
  - `frames[]`: `{ frameNumber, winnerPlayerId }` — the source of truth; scores are
    derived from this list, never stored independently of it.
- Team `Fixture`: `id, leagueId, divisionId, round, homeTeamId, awayTeamId, legs[],
  homeLegsWon, awayLegsWon, status, winnerTeamId (null = draw), nextFixtureId,
  nextFixtureSlot`
  - `legs[]`: `{ legNumber, homePlayerId, awayPlayerId, frames[], homeFrameScore,
    awayFrameScore, status, winnerPlayerId, raceTo }` — one leg per nominated
    player-vs-player mini-match, structurally identical to a singles fixture.
  - `nextFixtureId`/`nextFixtureSlot` (`'home'|'away'`) link a knockout fixture to the
    one its winner advances into; both are `null` for round-robin fixtures and for a
    knockout final.
- `User` (player account): `id, firstName, lastName, email, passwordHash, phone,
  venue, teamName, classification ('A'|'B'|'C'|'D'|null), createdAt`. Distinct from
  `Player` above — a `Player` is a name entered into a division/team roster (by anyone,
  no account needed); a `User` is a login the site's standard views are gated behind.
  Nothing currently links the two records together (see roadmap).

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

Browsing the site requires being logged in (see **Player accounts** above) - either
register a player account from the "Login" link top right, or sign in as admin
(`Admin` / `Admin12!@`) from "Admin Login" next to it.

For frontend development with hot reload instead of a static build, run `npm run dev`
in `client/` (http://localhost:5173) instead of `npm run build`; the Vite dev server
proxies `/api` requests to the Express server on port 4000, so run both at once.

## API reference (summary)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Admin login, returns a signed token |
| POST | `/api/users/register` | Player account self-registration, returns a signed token |
| POST | `/api/users/login` | Player login, returns a signed token |
| GET | `/api/users/me` | The logged-in player's own account details (requires player login) |
| GET/POST | `/api/leagues` | List (requires login, admin or player) / create leagues (requires admin) |
| GET | `/api/leagues/:id` | League + its divisions (requires login) |
| POST | `/api/leagues/:leagueId/divisions` | Add a division (requires admin; accepts `entryType`, `scheduling`, `legsPerMatch`) |
| GET | `/api/divisions/:id` | Division + players/teams, fixtures, standings (requires login) |
| POST/DELETE | `/api/divisions/:id/players` | Register / remove a player (singles, pre-fixtures only) |
| POST/DELETE | `/api/divisions/:id/teams` | Add / remove a team (teams, pre-fixtures only) |
| POST/DELETE | `/api/teams/:teamId/players` | Add / remove a player on a team roster |
| POST | `/api/divisions/:id/generate-fixtures` | Generate the fixture list (round robin or knockout bracket, per the division's `scheduling`) |
| GET | `/api/fixtures/:id` | Fixture detail (requires login; singles or team, includes `bothEntrantsKnown` for knockout TBD slots) |
| POST | `/api/fixtures/:id/frames` | Record a frame winner (singles) |
| DELETE | `/api/fixtures/:id/frames/last` | Undo the last recorded frame (blocked once the result has advanced a bracket) |
| POST | `/api/fixtures/:id/legs/:legNumber/nominate` | Nominate the two players for a team-fixture leg |
| POST | `/api/fixtures/:id/legs/:legNumber/frames` | Record a frame winner within a leg |
| DELETE | `/api/fixtures/:id/legs/:legNumber/frames/last` | Undo the last frame within a leg |
| GET | `/api/players/:id` | Player profile: career record, head-to-head, match history (requires login) |

## Roadmap

1. Swap the JSON file store for Postgres, and move player/admin accounts toward
   proper role-aware permissions (league admin vs. captain vs. player), including
   linking a `User` account to the `Player` roster entries it corresponds to,
   password reset, and email verification.
2. Further scheduling methods: home/away double round robin, double elimination,
   mini-knockouts, and the ability to mix formats within one competition.
3. Seeded/ranked knockout brackets (current v1 seeds in registration order, not by
   past performance) and best-of-N handicaps.
4. Deeper player statistics: form guides, break-and-continue / century-style stats if
   relevant to 8-ball, a "trophy cabinet" across seasons.
5. Live-scoring niceties: tablet-optimized scoring UI, stream overlay endpoint,
   shot/match timers — valuable but explicitly deferred until the core league engine
   above is solid.

## Seeded demo data

Running `npm run seed` creates the **Top Spin Singles** league with six divisions
(Premier League, Division 1–5), populates Premier League with 8 demo players, generates
its full round-robin fixture list, and plays out round 1 with varied race-to-6
scorelines (6–5, 6–0, 6–3, 6–4) so the standings table and scoring flow are visible
immediately without any manual setup.
