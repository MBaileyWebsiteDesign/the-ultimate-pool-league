# The Ultimate Pool League

Live on GitHub: https://github.com/MBaileyWebsiteDesign/the-ultimate-pool-league

A self-hosted pool league management platform: admins create leagues, divisions and
players (or spin up a whole new season in one guided wizard); the app schedules
fixtures per division (round robin or knockout); captains or admins record match
results frame-by-frame; standings update automatically. Built to give a pool league the
full-featured competition management that Wix has no built-in system for.

## What's implemented

- **Single unified login**: every account — admin, player, captain, or any combination —
  signs in through the same one form. There's no more separate "admin login" vs. "player
  login"; who you are and what you can do is just a pair of flags (`isAdmin`,
  `isCaptain`) on your account, checked fresh on every request. See **Accounts & login**
  below.
- **Leagues** with a configurable format (match type, race-to-N frames, default
  scheduling method).
- **Divisions** within a league (unlimited), each independently configured along two
  axes:
  - **Entry type** — `singles` (one player vs. one player) or `teams` (team vs. team).
  - **Scheduling** — `round_robin_single` (everyone/every team plays everyone/every
    team else exactly once), `knockout_single_elim` (single-elimination bracket), or
    `knockout_double_elim` (double-elimination: winners bracket + losers bracket +
    Grand Final, with a bracket-reset decider if needed - see below).
  These are independent choices, so e.g. a knockout team cup and a round-robin singles
  division can coexist in the same league.
- **Season Setup Wizard**: a 5-step guided flow for standing up a brand-new season
  (Admin Portal → "+ New Season") — name it, choose how many leagues and roughly how
  many players each, add the players (CSV/Excel upload with a downloadable template, or
  add them one at a time), set the season's start/end dates, then generate every
  league's fixtures in one click with the games spaced out automatically. See
  **Season Setup Wizard** below for the full walkthrough.
- **Team leagues**: teams are rosters of players; a team fixture is a best-of-N "legs"
  match (N = `legsPerMatch`, admin-configurable per division), each leg a nominated
  player vs. nominated player mini-match scored exactly like a singles frame race. The
  team match is decided the moment one side has an unreachable majority of legs (mirrors
  the singles race-to-N "stop once it's decided" behaviour); an even `legsPerMatch` can
  end level, recorded as a drawn team match (2/1/0 league points for win/draw/loss). Use
  an odd `legsPerMatch` for knockout team divisions so every match has a winner to
  advance. A player can be flagged as a **captain** (see below) ready for when team
  leagues get their own captain-only tools.
- **Knockout / single-elimination format**: standard bracket seeding with byes for
  non-power-of-2 entrant counts (see `server/src/services/bracket.js`), automatic bye
  resolution (a bye winner advances without a match, but two bye-advanced entrants
  meeting in a later round always play a real match — a slot merely waiting on an
  earlier round is never confused with a genuine bye), winner propagation into the next
  round's fixture, and an undo-lock: once a result has advanced a player/team to the
  next round, that frame/leg can't be undone from the completed fixture (it would
  silently corrupt the bracket) — the fixture detail page shows "TBD" for slots that
  haven't been decided yet.
- **Knockout / double-elimination format**: a losing entrant isn't out immediately -
  they drop into a losers bracket and keep going until they lose a second time.
  Structurally this is a winners bracket (identical to single elimination) plus a
  losers bracket that interleaves each round's fresh losers with the losers bracket's
  own survivors, finishing in a Grand Final between the two brackets' champions. Because
  the losers-bracket entrant already has one loss and the winners-bracket entrant has
  none, winning the Grand Final isn't enough for the losers-bracket entrant on its
  own — beating the winners-bracket champion there only draws them level, so a single
  **bracket-reset decider** is automatically created and must be won too; if the
  winners-bracket champion wins the Grand Final outright, the tournament ends there.
  The Fixtures list on the division page groups fixtures into "Winners Bracket",
  "Losers Bracket", "Grand Final" and (if triggered) "Grand Final — Bracket Reset"
  sections rather than one flat round list. **v1 scope**: requires an exact
  power-of-two entrant count (4, 8, 16, 32...) - the interleaving arithmetic only lines
  up cleanly with no byes anywhere in the winners bracket; a non-power-of-two count gets
  a clear error asking you to add/remove an entrant or use single elimination instead.
  See `server/src/services/bracket.js` (`buildDoubleElimBracket`) for the full seeding
  design notes.
- **Player registration** per division (singles) or per team (teams), picked from the
  list of people who've actually created an account (see **Accounts & login** below) -
  rosters can't be padded with made-up names. Rosters lock once fixtures are generated,
  which mirrors how real leagues avoid re-shuffling a season that's already started.
- **Automatic fixture generation**: circle-method round-robin (handling odd counts via
  a bye) or knockout bracket generation, depending on the division's `scheduling`, with
  optional automatic date scheduling (a start date plus a "days between rounds" gap —
  see **Season Setup Wizard**).
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
- **Breadcrumb navigation**: every page below the home list shows a trail back to the
  home page (League › Division › Round N, etc.), rendered as a bar under the header.
- **Player Management Portal** ("My Account"): every logged-in account's home base —
  update your own profile fields, change your password, and see a personal list of your
  upcoming fixtures and recent results across every division/team you're registered in,
  plus a link to your full stats/history if your account is linked to a `Player` roster
  entry.
- **Captain Management Portal**: a dedicated landing page for accounts flagged as
  captain, currently showing the captain's own upcoming matches plus a placeholder for
  the team-management tools (roster management, leg nominations) planned once team
  leagues expand — see the roadmap.
- **Admin Management Portal**: a dashboard linking to every admin tool — the Season
  Setup Wizard, user management, venue approvals, and the audit log. Any account with
  `isAdmin` set gets a link to it in the header.
- **Admin user management**: admins get a searchable list of every registered user,
  clickable through to an edit screen where they can update any profile field,
  grant/revoke admin rights, mark/unmark someone as captain, suspend/reactivate the
  account, and force-set a new password without knowing the old one.
- **Admin score override**: admins can directly correct a fixture's final score at any
  time, bypassing frame-by-frame play — useful for fixing a scoring mistake after the
  fact. It's blocked only when changing the *winner* would silently corrupt a knockout
  bracket that's already progressed past that result; pure score corrections (same
  winner) are always allowed.
- **Mid-season player substitution** (singles divisions): if a player drops out, an
  admin can swap them for a replacement from the division's page. Every fixture of
  theirs that hasn't been played yet moves to the replacement; anything already
  completed - or already partway through - is left exactly as it was, so history and
  standings for the games actually played never change. See **Player substitution**
  below.
- **Audit log**: every admin action that changes something on someone else's behalf
  (score overrides, profile edits, permission/status changes, forced password resets) is
  recorded with who did it and when, visible to admins from the Admin Portal.
- **Venues**: a curated, admin-approved list of venues (seeded with a starter set). New
  venue names typed at registration or in a profile edit are automatically queued for
  approval rather than requiring a separate step - see **Venues** below.

## What's deliberately out of scope for v1

Handicaps, online entry/payment, tablet-specific UI, stream overlays and timers, table
booking, and mini-knockout/mixed formats (double elimination is now implemented - see
**Knockout / double-elimination format** above). Team-specific captain
tools (roster management, leg nominations from the Captain Portal) are also deferred
until team leagues are actively in use — the `isCaptain` flag exists now so accounts are
ready ahead of that.

## Accounts & login

There is exactly one way to sign in: email + password, at "Login" in the header. What an
account can see and do is controlled by two independent boolean flags, not a single
role:

- **`isAdmin`** — unlocks the Admin Portal (season wizard, user management, venue
  approvals, audit log) and the score-override control on every fixture.
- **`isCaptain`** — unlocks the Captain Portal. Currently just a flag with a fixtures
  view; it's in place ahead of team-league captain tools.

An account can be neither, either, or both at once — a league organizer who also plays
can have both flags set on the same login. Every request re-checks these flags against
the database fresh, so granting or revoking either one takes effect immediately, even
for a session that's already logged in.

A seeded admin account is created the first time you run `npm run seed`:

- Email: `admin@example.com`
- Password: `Admin12!@`

**Change this password (or delete/rebuild that account) before deploying anywhere real
people can reach it** — it's checked into this repo and is not a secret. Set
`SESSION_SECRET` to a random string in production too; it's the key used to sign login
tokens (`server/src/userAuth.js`), and the checked-in default is only safe for local use.

Anyone can self-register a regular player account from "Login" → "Create one".
Registration collects:

- First name, last name, email, password (required)
- Phone (optional)
- Venue and team name (required)
- Classification, A through D (optional)

Passwords are salted and hashed with Node's built-in `crypto.scrypt` (never stored in
plaintext), and login issues an HMAC-signed token (24-hour expiry) stored in the
browser's `localStorage`. Every account — self-registered or admin-created via the
Season Setup Wizard's CSV/Excel import — lives in the same `db.users` table and is
auto-linked (by matching name) to a `Player` roster entry where one exists, powering the
"view my stats" link on the account page and letting admins add them to a division or
team roster.

Logged-in users manage their own account from "My Account" (click their name, top
right) — the Player Management Portal described above.

### Admin permission management

From the Admin Portal → "Manage Users", an admin can:

- Search all registered users and click through to edit any of their profile fields.
- Grant or revoke `isAdmin` on any account.
- Mark or unmark any account as a captain (`isCaptain`).
- Suspend an account (blocks that account's login immediately) or reactivate it.
- Force-set a new password for a user without needing their current one.
- **Bulk-add users** ("Bulk Add Users" panel, top of the page) — download a CSV or
  Excel template, fill in a row per player, and upload it back; or add players one at a
  time with the same fields. This creates accounts only, with no season/division
  attached (add them to a specific roster afterwards from that division's page) - for
  standing up a whole new season (leagues + rosters + fixtures) in one guided flow, use
  the Season Setup Wizard instead. Each new account gets a random temporary password,
  shown once in the result so it can be handed to that player; a row whose email
  already has an account is skipped rather than duplicated or overwritten.
- Review the audit log of every admin action taken (who did what, and when).

## Season Setup Wizard

From the Admin Portal → "+ New Season", a 5-step guided flow walks an admin through
standing up an entire season:

1. **Name the season** — e.g. "Autumn 2026". This becomes a `League`.
2. **How many leagues, and how many players in each** — each "league" the admin
   describes becomes its own `Division` inside that season (its own round-robin,
   standings and fixture list). The player count is just a target used to build the
   CSV/Excel template's row count; it doesn't limit how many can actually be added.
3. **Add players** — either:
   - **Upload CSV or Excel**: download a template (pre-filled with one example row per
     league name, so the `division` column's valid values are obvious), fill in a row
     per player, and upload it back. Parsing happens entirely in the browser
     (`papaparse` for `.csv`, `xlsx`/SheetJS for `.xlsx`/`.xls`) — the server only ever
     receives plain JSON rows, regardless of which format was uploaded.
   - **Add players manually**, one at a time, via a form with the same fields.
   Either path creates a full account for each new player (with a random temporary
   password, shown once in the result so it can be handed to that player) and adds them
   to the named division; a row whose email already has an account links the existing
   account into that division instead of creating a duplicate. Rows with missing
   required fields or an unrecognized division name are skipped with a per-row reason,
   without failing the whole batch.
4. **Season start and end dates.**
5. **Generate fixtures** — choose the number of days between rounds, and every league
   (division) with at least 2 players gets its full round-robin fixture list generated,
   spaced out from the start date by that gap. If the last round would fall after the
   season's end date, that division is flagged in the result so the admin can adjust
   before publishing schedules. This step can also be skipped to generate fixtures later
   from the division page itself.

The wizard doesn't introduce a new data type — a "season" is just a `League`, and each
of its "leagues" is a `Division` (singles, round-robin) — so everything built by the
wizard immediately gets the same standings, fixtures and scoring UI as a league built by
hand.

## Player substitution

Real leagues lose players mid-season for two different reasons, and this feature treats
them differently: someone might just be missing a stretch of games (**temporary
cover**), or someone might be leaving the league for good (**retiring**). From a singles
division's page (once fixtures have been generated), an admin sees a "Substitute a
Player" panel: pick who's leaving, who's replacing them, and which of the two reasons
applies, then:

- Every fixture of the outgoing player's that's still `scheduled` (nobody has played it
  yet) gets handed to the incoming player - same round, same opponent, just a new name
  on that side. This happens identically either way.
- Anything already `completed` is left completely untouched - the outgoing player's
  record for the games they actually played stays exactly as it was, permanently,
  regardless of which reason was chosen.
- Anything `in_progress` (some frames already recorded, but not finished) is also left
  alone rather than guessed at - it's reported back separately so the admin knows it
  still needs the outgoing player to finish it out, or an admin score override, before
  it can be reassigned too.
- **Temporary cover** leaves the outgoing player on the division's roster - their
  standings row keeps showing whatever they'd already played, it just stops growing. The
  incoming player is added alongside them and starts accumulating their own record from
  that point on.
- **Retiring** additionally removes the outgoing player from the division's roster, so
  their row disappears from the League Table from that point on. Their already-completed
  matches aren't touched, so nothing about their opponents' won/lost/frame counts
  changes - the standings calculation builds each row purely from that player's own
  fixtures, so removing one player's row can't affect anyone else's numbers. Their full
  match history is still visible on their own player profile page; they just no longer
  show up in this division's live table.
- Every substitution is recorded (who was swapped for whom, when, by which admin, how
  many fixtures moved, and whether it was temporary cover or a retirement) both in the
  division's own history (shown right under the panel) and in the general admin audit
  log.

There's currently no "wipe the score and start the replacement from zero" option - if
that's ever needed, it should be built as its own explicit feature rather than folded
into this one, since it would mean deciding what happens to frames/results that already
count toward someone's record. Team-division substitution isn't covered yet either
(rosters can already be edited directly before fixtures are generated; mid-season team
swaps would need their own design since team fixtures don't reference individual
players directly the way singles ones do).

## Venues

Every player's "home venue" is chosen from a shared, admin-approved list rather than free
text, so it stays tidy across the whole league instead of accumulating typo'd duplicates.
The list is seeded with five starter venues (see `server/src/services/seed.js`).

If a player's venue isn't on the list yet - at registration, or later editing their
profile from "My Account" - they just type it in; there's no separate "request" form to
fill out. That name is saved as their own venue immediately, and a matching entry is
automatically queued as `pending` in the venues table behind the scenes. It won't show up
in the shared dropdown for anyone else until an admin approves it from the Admin Portal
→ "Manage Venues", where pending requests show who asked for each one and can be
approved or rejected with one click.

## Architecture

```
pool-league/
  server/            Node.js + Express REST API
    src/
      index.js          Routes, static hosting of the built client, season wizard
                         endpoints, fixture date scheduling
      db.js              JSON-file persistence layer (see note below)
      userAuth.js        Unified account model: registration/login, password hashing,
                          temp password generation, requireAuth (any logged-in account)
                          and requireAdmin (isAdmin only) route gates
      errors.js
      services/
        roundRobin.js    Circle-method scheduler (singles + teams)
        bracket.js       Single- and double-elimination bracket seeding (bye handling
                         for single elim; double elim requires a power-of-2 count)
        standings.js     Singles points table calculation
        teamStandings.js Team points table calculation
        playerProfile.js Career stats + head-to-head aggregation for a player
        auditLog.js      Records admin actions (overrides, edits, permission/status
                          changes)
        seed.js          Seeds "Top Spin Singles" with 6 divisions + demo data, plus
                          the default admin account
  client/            React (Vite) single-page app
    src/
      pages/                LeagueList, LeagueDetail, DivisionDetail, FixtureDetail,
                            PlayerProfile, Login, Register, PlayerPortal, CaptainPortal,
                            AdminPortal, AdminSeasonWizard, AdminUsers, AdminUserEdit,
                            AdminAuditLog, AdminVenues
      components/
        Breadcrumbs.jsx      Renders the shared breadcrumb trail
        VenueSelect.jsx      Venue dropdown + "not listed" free-text fallback
      AuthContext.jsx       Single unified session (token, user, isAdmin, isCaptain)
      BreadcrumbContext.jsx Shared breadcrumb trail + useSetBreadcrumbs(...) hook
      useAdminSession.js     Re-exports `isAdmin` from AuthContext for readability
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
  ('round_robin_single'|'knockout_single_elim'|'knockout_double_elim'), legsPerMatch
  (teams only), playerIds[] (singles only), teamIds[] (teams only), fixturesGenerated,
  startDate, endDate, gapDays` (the latter three set when fixtures were generated with
  automatic scheduling, either via the Season Setup Wizard or the division page
  directly)
- `Player`: `id, name`
- `Team`: `id, divisionId, name, playerIds[]`
- Singles `Fixture`: `id, leagueId, divisionId, round, homePlayerId, awayPlayerId,
  raceTo, frames[], homeFrameScore, awayFrameScore, status, winnerPlayerId,
  nextFixtureId, nextFixtureSlot, bracketRole, loserNextFixtureId,
  loserNextFixtureSlot, resetFixtureId, scheduledDate`
  - `frames[]`: `{ frameNumber, winnerPlayerId }` — the source of truth; scores are
    derived from this list, never stored independently of it.
  - `scheduledDate`: `YYYY-MM-DD` string, set when the division's fixtures were
    generated with a start date and round gap; `null` otherwise.
- Team `Fixture`: `id, leagueId, divisionId, round, homeTeamId, awayTeamId, legs[],
  homeLegsWon, awayLegsWon, status, winnerTeamId (null = draw), nextFixtureId,
  nextFixtureSlot, bracketRole, loserNextFixtureId, loserNextFixtureSlot,
  resetFixtureId, scheduledDate`
  - `legs[]`: `{ legNumber, homePlayerId, awayPlayerId, frames[], homeFrameScore,
    awayFrameScore, status, winnerPlayerId, raceTo }` — one leg per nominated
    player-vs-player mini-match, structurally identical to a singles fixture.
  - `nextFixtureId`/`nextFixtureSlot` (`'home'|'away'`) link a knockout fixture to the
    one its winner advances into; both are `null` for round-robin fixtures and for a
    knockout final.
  - `bracketRole` (double elimination only, otherwise `'single'`):
    `'winners'|'losers'|'grand_final'|'grand_final_reset'`. `loserNextFixtureId`/
    `loserNextFixtureSlot` (winners-bracket fixtures only) link to where that
    fixture's *loser* drops into the losers bracket. `resetFixtureId` is set on a
    completed `grand_final` fixture once its bracket-reset decider has been created
    (see **Knockout / double-elimination format** above).
- `User` (unified account): `id, firstName, lastName, email, passwordHash, phone,
  venue, teamName, classification ('A'|'B'|'C'|'D'|null), isAdmin (bool), isCaptain
  (bool), status ('active'|'suspended'), playerId (linked Player, or null), createdAt`.
  Distinct from `Player` above — a `Player` is a name entered into a division/team
  roster; a `User` is a login. `playerId` links the two where a case-insensitive name
  match was found at registration/import time (known limitation: two different real
  people who share an exact name will be merged onto the same `Player` record - see
  roadmap).
- `AuditLog` entry: `id, at, actor, action, targetType, targetId, details` — one entry
  per admin action that affects another account or a fixture result; capped at the most
  recent 500 entries.
- `Venue`: `id, name, status ('pending'|'approved'|'rejected'), requestedBy (User id or
  null), requestedByName, requestedAt, approvedBy, approvedAt`. `requestedBy` is `null`
  for the seeded starter venues; everything else is auto-created the first time someone's
  `venue` field is set to a name that isn't already in the table (see `ensureVenue` in
  `server/src/index.js`).

## Running it locally

Requires Node.js 18+.

```bash
# 1. Install and seed the API
cd server
npm install
npm run seed      # creates "Top Spin Singles" with 6 divisions + demo data,
                   # plus the seeded admin account (admin@example.com / Admin12!@)
npm start         # http://localhost:4000

# 2. In a second terminal, build the client
cd client
npm install
npm run build      # produces client/dist, which the server serves automatically

# Now open http://localhost:4000 — the whole app is served from one port.
```

Browsing the site requires being logged in — either register a player account from
"Login" → "Create one", or sign in with the seeded admin account
(`admin@example.com` / `Admin12!@`).

For frontend development with hot reload instead of a static build, run `npm run dev`
in `client/` (http://localhost:5173) instead of `npm run build`; the Vite dev server
proxies `/api` requests to the Express server on port 4000, so run both at once.

## GitHub Pages: static demo build

GitHub Pages only serves static files - it has no way to run the Express API server or
persist the JSON database, so it can never host a real, working deployment of this app.
What it *can* host is a **static demo build**: the real React UI, wired to an in-memory
copy of the seeded dataset instead of a live backend, so every screen looks and behaves
like the real thing without needing a server anywhere.

- `client/src/demo/demoApi.js` is a drop-in stand-in for `client/src/api.js` - same
method names, same request/response shapes - except every "request" runs the same logic
as the matching Express route directly against an in-memory `db`, instead of doing a
`fetch()`. `client/src/demo/logic/` holds the pure standings/bracket/round-robin/player-
profile calculations, copied unmodified from `server/src/services/` (they have no
Node-only dependencies, so they run in the browser as-is).
- A visitor lands already "logged in" as the seeded demo admin account - there's no real
password to check in a static bundle, so there's no login screen to get through. Changes
(recording frames, generating fixtures, admin edits, running the Season Setup Wizard)
actually happen and persist in that visitor's own browser (`localStorage`) for as long as
they keep using it, but nobody else sees them and there's no way to reset short of
clearing site data.
- Routing uses a `HashRouter` in this build only (`client/src/main.jsx`), since Pages has
no server-side rewrite rule to send a refreshed or directly-shared deep link back to
`index.html` the way the Express server's catch-all route does for a real deployment.
- `.github/workflows/deploy-demo.yml` builds and publishes this automatically on every
push to `main` that touches `client/` or `server/`: it seeds a fresh dataset
(`npm run seed` in `server/`), exports it for the client bundle
(`server/scripts/export-demo-data.js` - strips the password hash, since it's never
needed, and links the seeded admin account to the real "Matt Bailey" player so "My
Account" has something to show), then runs `npm run build:demo` in `client/` (sets
`VITE_DEMO_MODE=true`, which is what `api.js`, `AuthContext.jsx` and `vite.config.js` all
branch on) and publishes the result via GitHub's official Pages Actions. The repository's
Pages source is configured to build via that GitHub Actions workflow rather than any
branch/folder.

**This is a demo, not a deployment.** To actually run this app for real people to use, it
needs a host that can run a Node.js process and keep `server/src/data/db.json` around
between requests (Render, Railway, Fly.io, a VPS, etc.) - point that host at `server/`
(after `npm run build` in `client/`, without `VITE_DEMO_MODE`, so `client/dist` exists for
the Express server to serve) rather than Pages.

## API reference (summary)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Unified login (any account), returns a signed token |
| POST | `/api/users/register` | Player account self-registration, returns a signed token |
| GET | `/api/users/me` | The logged-in account's own details (requires login) |
| PATCH | `/api/users/me` | Update the logged-in account's own profile fields |
| POST | `/api/users/me/change-password` | Change the logged-in account's own password (requires current password) |
| GET | `/api/users/me/fixtures` | The logged-in account's own upcoming/recent fixtures across every division/team (requires login) |
| GET | `/api/admin/users` | Search/list all users, `?q=` filters by name/email/venue/team (requires admin) |
| GET | `/api/admin/users/:id` | Full details for one user (requires admin) |
| PATCH | `/api/admin/users/:id` | Update any profile field on a user (requires admin; logged) |
| POST | `/api/admin/users/:id/permissions` | Set `isAdmin` and/or `isCaptain` on a user (requires admin; logged) |
| POST | `/api/admin/users/:id/status` | Set a user's status to `active` or `suspended` (requires admin; logged) |
| POST | `/api/admin/users/:id/reset-password` | Force-set a new password for a user (requires admin; logged) |
| POST | `/api/admin/users/import` | Bulk-create user accounts by row (CSV/Excel/manual) from Manage Users, no season/division attached (requires admin; logged) |
| GET | `/api/admin/audit-log` | Most recent 500 admin actions (requires admin) |
| POST | `/api/admin/seasons` | Season Setup Wizard step 1–2: create a season (League) with N divisions (requires admin) |
| POST | `/api/admin/seasons/:leagueId/import-players` | Season Setup Wizard step 3: bulk-import players by row (CSV/Excel/manual), creating accounts as needed (requires admin; logged) |
| POST | `/api/admin/seasons/:leagueId/generate` | Season Setup Wizard step 5: generate fixtures across every eligible division with date scheduling (requires admin) |
| POST | `/api/fixtures/:id/override` | Directly set a fixture's final score, bypassing frame-by-frame play (requires admin; logged; blocked if it would change a winner that's already advanced a started bracket fixture) |
| GET/POST | `/api/leagues` | List (requires login) / create leagues (requires admin) |
| GET | `/api/leagues/:id` | League + its divisions (requires login) |
| POST | `/api/leagues/:leagueId/divisions` | Add a division (requires admin; accepts `entryType`, `scheduling`, `legsPerMatch`) |
| GET | `/api/divisions/:id` | Division + players/teams, fixtures, standings (requires login) |
| GET | `/api/registered-players` | List of players linked to a registered, active user account (requires login) - the pool a roster picks from |
| POST/DELETE | `/api/divisions/:id/players` | Register / remove a player by `playerId` (singles, pre-fixtures only; `playerId` must belong to a registered, active user) |
| POST/DELETE | `/api/divisions/:id/teams` | Add / remove a team (teams, pre-fixtures only) |
| POST/DELETE | `/api/teams/:teamId/players` | Add / remove a player by `playerId` on a team roster (same registered-user requirement) |
| POST | `/api/divisions/:id/generate-fixtures` | Generate the fixture list (round robin, single-elimination, or double-elimination bracket, per the division's `scheduling`; double elimination requires a power-of-two entrant count); optionally accepts `{ startDate, gapDays }` to also set `scheduledDate` on every fixture |
| POST | `/api/divisions/:id/substitute-player` | Swap a player out for a replacement (singles only) - reassigns not-yet-started fixtures, leaves completed/in-progress ones alone; `reason: 'substitution'` (default) keeps the outgoing player on the League Table, `reason: 'retirement'` removes them from it (requires admin; logged) |
| GET | `/api/fixtures/:id` | Fixture detail (requires login; singles or team, includes `bothEntrantsKnown` for knockout TBD slots) |
| POST | `/api/fixtures/:id/frames` | Record a frame winner (singles) |
| DELETE | `/api/fixtures/:id/frames/last` | Undo the last recorded frame (blocked once the result has advanced a bracket) |
| POST | `/api/fixtures/:id/legs/:legNumber/nominate` | Nominate the two players for a team-fixture leg |
| POST | `/api/fixtures/:id/legs/:legNumber/frames` | Record a frame winner within a leg |
| DELETE | `/api/fixtures/:id/legs/:legNumber/frames/last` | Undo the last frame within a leg |
| GET | `/api/players/:id` | Player profile: career record, head-to-head, match history (requires login) |
| GET | `/api/venues` | Approved venues, plus the logged-in user's own pending/rejected requests if any (no login required, so registration can use it) |
| GET | `/api/admin/venues` | All venues, pending first (requires admin) |
| POST | `/api/admin/venues/:id/approve` | Approve a pending venue (requires admin; logged) |
| POST | `/api/admin/venues/:id/reject` | Reject a pending venue (requires admin; logged) |

## Roadmap

1. Swap the JSON file store for Postgres.
2. Team-league captain tools: roster management and leg nominations from the Captain
   Portal, gated to just the team(s) a captain account actually captains (today
   `isCaptain` is a flag with no team-specific behaviour yet, since the app is
   singles-focused).
3. Password reset via email and email verification at registration (currently a
   forgotten password requires an admin to force-reset it).
4. Further scheduling methods: home/away double round robin, mini-knockouts, and the
   ability to mix formats within one competition (double elimination is now
   implemented - see **Knockout / double-elimination format** above).
5. Seeded/ranked knockout brackets (current v1 seeds in registration order, not by
   past performance) and best-of-N handicaps.
6. Deeper player statistics: form guides, break-and-continue / century-style stats if
   relevant to 8-ball, a "trophy cabinet" across seasons.
7. Live-scoring niceties: tablet-optimized scoring UI, stream overlay endpoint,
   shot/match timers — valuable but explicitly deferred until the core league engine
   above is solid.

## Seeded demo data

Running `npm run seed` creates the **Top Spin Singles** league with six divisions
(Premier League, Division 1–5), each populated with its real current-season 14-player
roster (84 players total) and its full round-robin fixture list (91 fixtures per
division) generated up front - but every fixture starts `scheduled` (no frames
recorded), so standings begin at zero and build up through the normal scoring flow. A
final standings table only records each player's aggregate played/won/lost/frames, not
who played whom or in what order, so there's no way to reconstruct the real historical
match-by-match results from it - seeding the real rosters with an empty fixture list
gives a realistic dataset to test against without inventing results that never happened.
It also seeds 5 pre-approved venues (The Cue Club, Rack 'Em Sports Bar, The Green Baize,
Corner Pocket Tavern, Break & Run Social Club) and the default admin account
(`admin@example.com` / `Admin12!@`) so the app is fully usable on a fresh install.

Note: all 84 seeded players are created directly (not linked to a registered user
account), purely so every division has a full roster to test against out of the box -
they predate, and are an exception to, the "players must be registered users" rule
described above, which only applies to rosters built going forward through the app
itself.
