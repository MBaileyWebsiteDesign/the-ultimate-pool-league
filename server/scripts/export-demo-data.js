// Turns a freshly-seeded server/src/data/db.json into
// client/src/demo/demoData.json - the dataset baked into the static demo
// build (see client/src/demo/demoApi.js and the "npm run build:demo"
// script). Run `npm run seed` in server/ first, then this script, then
// `npm run build:demo` in client/ - the deploy-demo.yml GitHub Actions
// workflow does exactly this sequence automatically on every push.
//
// Reuses the real seeded data rather than duplicating the roster arrays a
// second time in a client-only script, so there's exactly one place
// (server/src/services/seed.js) that defines what the demo dataset
// contains.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, '..', 'src', 'data', 'db.json');
const DEST = path.join(__dirname, '..', '..', 'client', 'src', 'demo', 'demoData.json');

const db = JSON.parse(readFileSync(SOURCE, 'utf-8'));

// Never ship a password hash into a client-side bundle, even a fake one -
// the demo doesn't need it, since demoApi.js's login() accepts any password
// for a known demo account (there's nothing real to check it against once
// this ships to a public static site).
//
// Also personalize the seeded ADMIN account specifically: link it to the
// real "Matt Bailey" player (Division 5) so "My Account" / "My Fixtures" has
// something real to show instead of an empty list, and flag it as captain
// too so both the Admin and Captain portals are reachable from the one demo
// account. NB: this used to remap every seeded user's playerId this way,
// which only "worked" because the admin was the only seeded user at the
// time - now that seed.js also creates one User per roster player (each
// already linked to their own Player), only the admin account should be
// touched here; everyone else's own playerId link must survive untouched.
const ADMIN_EMAIL = 'admin@example.com';
const mattBailey = db.players.find((p) => p.name === 'Matt Bailey');
db.users = db.users.map((user) => {
  const { passwordHash, ...rest } = user;
  if (user.email === ADMIN_EMAIL) {
    return { ...rest, isCaptain: true, playerId: mattBailey ? mattBailey.id : rest.playerId };
  }
  return rest;
});

writeFileSync(DEST, JSON.stringify(db));
console.log(`Wrote demo dataset to ${DEST} (${db.leagues.length} league(s), ${db.players.length} players, ${db.fixtures.length} fixtures)`);
