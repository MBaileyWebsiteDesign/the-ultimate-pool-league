// Player/member accounts - separate from the single hardcoded admin account
// in auth.js. Anyone can self-register a player account; it's what gates the
// standard "view the site" experience (browsing leagues, divisions,
// fixtures, player profiles). Stored in the same JSON db as everything else
// (db.users), not a separate store.
//
// Passwords are hashed with Node's built-in `crypto.scrypt` (salted,
// per-user) rather than stored in plaintext - no bcrypt dependency needed for
// that. Session tokens reuse the same HMAC-signed-payload approach as
// auth.js, but with a `player.` prefix so a player token and an admin token
// can never be confused for one another even if compared directly.
import crypto from 'crypto';
import { ApiError } from './errors.js';
import { verifyToken as verifyAdminToken } from './auth.js';
import { readDb } from './db.js';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const CLASSIFICATIONS = ['A', 'B', 'C', 'D'];

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const candidateBuf = Buffer.from(candidate, 'hex');
  const hashBuf = Buffer.from(hash, 'hex');
  return candidateBuf.length === hashBuf.length && crypto.timingSafeEqual(candidateBuf, hashBuf);
}

export function createUserToken(userId) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `player.${userId}.${expiresAt}`;
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const signature = sign(payload);
  return { token: `${payloadB64}.${signature}`, expiresAt };
}

export function verifyUserToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, signature] = token.split('.');
  let payload;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf-8');
  } catch {
    return null;
  }
  const expectedSignature = sign(payload);
  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  const parts = payload.split('.');
  if (parts.length !== 3 || parts[0] !== 'player') return null;
  const [, userId, expiresAtStr] = parts;
  const expiresAt = Number(expiresAtStr);
  if (!expiresAt || Date.now() > expiresAt) return null;
  return { userId, expiresAt };
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

// Looks up the live user record behind a verified token - role and
// suspension status can change after a token was issued (an admin can
// promote/demote or suspend someone mid-session), so both are always read
// fresh from the db rather than trusted from the token payload.
function loadActiveUser(token) {
  const session = verifyUserToken(token);
  if (!session) return null;
  const db = readDb();
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return user;
}

export function requireUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  const user = loadActiveUser(token);
  if (!user) {
    throw new ApiError(401, 'Player login required for this action');
  }
  if (user.status === 'suspended') {
    throw new ApiError(403, 'This account has been suspended');
  }
  req.playerSession = { userId: user.id, user };
  next();
}

// Gates the standard "view the site" experience: browsing leagues,
// divisions, fixtures and player profiles requires being logged in, but
// either kind of account (admin or a self-registered player) is enough -
// there's no extra privilege to viewing as admin vs. as a player.
export function requireAnyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  const adminSession = verifyAdminToken(token);
  if (adminSession) {
    req.session = { role: 'admin', ...adminSession };
    return next();
  }

  const user = loadActiveUser(token);
  if (user && user.status !== 'suspended') {
    req.session = { role: 'player', userId: user.id };
    return next();
  }

  throw new ApiError(401, 'Login required to view this');
}

// Admin panel / admin-only-action gate: accepts EITHER the single hardcoded
// super-admin account (auth.js) OR a player account that's been promoted to
// role: 'admin' (and isn't suspended). Both grant full admin capability -
// there's no tiered admin permission model in this v1, a promoted admin can
// do everything the super-admin can (including promote/demote/suspend other
// accounts). req.adminSession.label is a human-readable actor name for audit
// log entries.
export function requireAdminRole(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  const superSession = verifyAdminToken(token);
  if (superSession) {
    req.adminSession = { type: 'super', label: 'Admin' };
    return next();
  }

  const user = loadActiveUser(token);
  if (user && user.role === 'admin' && user.status !== 'suspended') {
    req.adminSession = { type: 'user', userId: user.id, label: `${user.firstName} ${user.lastName}` };
    return next();
  }

  throw new ApiError(403, 'Admin access required');
}
