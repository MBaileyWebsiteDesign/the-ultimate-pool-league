// Minimal admin authentication.
//
// This is intentionally simple: a single hardcoded admin account and a
// hand-rolled signed token (HMAC-SHA256 over "username.expiry", using only
// Node's built-in crypto module - no jsonwebtoken dependency needed for one
// static account). This is fine for an internal MVP with one trusted
// operator, but is NOT a substitute for real user accounts/roles - see the
// README roadmap. Before exposing this beyond a small trusted group, replace
// it with per-user accounts, hashed passwords (bcrypt), and a real session
// store.
import crypto from 'crypto';
import { ApiError } from './errors.js';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin12!@';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

export function createToken(username) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${username}.${expiresAt}`;
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const signature = sign(payload);
  return { token: `${payloadB64}.${signature}`, expiresAt };
}

export function verifyToken(token) {
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
  const [username, expiresAtStr] = payload.split('.');
  const expiresAt = Number(expiresAtStr);
  if (!expiresAt || Date.now() > expiresAt) return null;
  return { username, expiresAt };
}

export function login(username, password) {
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    throw new ApiError(401, 'Invalid username or password');
  }
  return createToken(username);
}

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  const session = verifyToken(token);
  if (!session) {
    throw new ApiError(401, 'Admin login required for this action');
  }
  req.admin = session;
  next();
}
