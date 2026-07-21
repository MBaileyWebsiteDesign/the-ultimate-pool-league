// A minimal admin action log: who did what, to whom, and when. Covers score
// overrides and admin edits to user accounts (profile changes, role changes,
// status changes, forced password resets) - the actions an admin can take
// that affect someone else's data without their direct involvement, which is
// exactly the kind of thing an admin panel should be accountable for.
//
// Capped at MAX_ENTRIES (oldest trimmed first) so the JSON file can't grow
// unbounded - fine for a v1 audit trail, not a substitute for a real
// append-only log if this ever needs to survive an audit.
//
// This is a byte-for-byte copy of server/src/services/auditLog.js, with the
// `uuid` package import swapped for the browser's built-in
// crypto.randomUUID() - it's a demo-mode copy running client-side (see
// client/src/demo/demoApi.js) so it can't import a Node-only dependency, and
// the browser API already does the same job without adding a new package.
const uuid = () => crypto.randomUUID();

const MAX_ENTRIES = 500;

export function recordAudit(db, { actor, action, targetType, targetId, details }) {
  db.auditLog.push({
    id: uuid(),
    at: new Date().toISOString(),
    actor,
    action,
    targetType,
    targetId,
    details,
  });
  if (db.auditLog.length > MAX_ENTRIES) {
    db.auditLog.splice(0, db.auditLog.length - MAX_ENTRIES);
  }
}
