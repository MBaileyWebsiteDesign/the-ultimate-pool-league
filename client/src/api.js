import { getStoredToken } from './AuthContext.jsx';
import { getStoredPlayerToken } from './PlayerAuthContext.jsx';

const BASE = '/api';

async function request(path, options = {}) {
  // Prefer the admin token when both exist - an admin session can do
  // everything a player session can (browsing), plus admin-only actions.
  const token = getStoredToken() || getStoredPlayerToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return body;
}

export const api = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  // Player/member accounts
  registerPlayer: (data) =>
    request('/users/register', { method: 'POST', body: JSON.stringify(data) }),
  loginPlayer: (email, password) =>
    request('/users/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  getMe: () => request('/users/me'),
  updateMe: (data) => request('/users/me', { method: 'PATCH', body: JSON.stringify(data) }),
  changePassword: (currentPassword, newPassword) =>
    request('/users/me/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  // Admin: user management
  adminListUsers: (q = '') => request(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  adminGetUser: (id) => request(`/admin/users/${id}`),
  adminUpdateUser: (id, data) => request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  adminSetRole: (id, role) => request(`/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
  adminSetStatus: (id, status) => request(`/admin/users/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  adminResetPassword: (id, newPassword) =>
    request(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) }),
  adminGetAuditLog: () => request('/admin/audit-log'),

  // Admin: score override
  overrideFixture: (fixtureId, homeScore, awayScore) =>
    request(`/fixtures/${fixtureId}/override`, { method: 'POST', body: JSON.stringify({ homeScore, awayScore }) }),

  getLeagues: () => request('/leagues'),
  createLeague: (data) => request('/leagues', { method: 'POST', body: JSON.stringify(data) }),
  getLeague: (id) => request(`/leagues/${id}`),

  createDivision: (leagueId, data) =>
    request(`/leagues/${leagueId}/divisions`, { method: 'POST', body: JSON.stringify(data) }),
  getDivision: (id) => request(`/divisions/${id}`),
  addPlayer: (divisionId, name) =>
    request(`/divisions/${divisionId}/players`, { method: 'POST', body: JSON.stringify({ name }) }),
  removePlayer: (divisionId, playerId) =>
    request(`/divisions/${divisionId}/players/${playerId}`, { method: 'DELETE' }),
  generateFixtures: (divisionId) =>
    request(`/divisions/${divisionId}/generate-fixtures`, { method: 'POST' }),

  getFixture: (id) => request(`/fixtures/${id}`),
  recordFrame: (fixtureId, winnerPlayerId) =>
    request(`/fixtures/${fixtureId}/frames`, { method: 'POST', body: JSON.stringify({ winnerPlayerId }) }),
  undoLastFrame: (fixtureId) => request(`/fixtures/${fixtureId}/frames/last`, { method: 'DELETE' }),

  // Teams (team divisions only)
  createTeam: (divisionId, name) =>
    request(`/divisions/${divisionId}/teams`, { method: 'POST', body: JSON.stringify({ name }) }),
  removeTeam: (divisionId, teamId) =>
    request(`/divisions/${divisionId}/teams/${teamId}`, { method: 'DELETE' }),
  addTeamPlayer: (teamId, name) =>
    request(`/teams/${teamId}/players`, { method: 'POST', body: JSON.stringify({ name }) }),
  removeTeamPlayer: (teamId, playerId) =>
    request(`/teams/${teamId}/players/${playerId}`, { method: 'DELETE' }),

  // Leg scoring (team fixtures only)
  nominateLeg: (fixtureId, legNumber, homePlayerId, awayPlayerId) =>
    request(`/fixtures/${fixtureId}/legs/${legNumber}/nominate`, {
      method: 'POST',
      body: JSON.stringify({ homePlayerId, awayPlayerId }),
    }),
  recordLegFrame: (fixtureId, legNumber, winnerPlayerId) =>
    request(`/fixtures/${fixtureId}/legs/${legNumber}/frames`, {
      method: 'POST',
      body: JSON.stringify({ winnerPlayerId }),
    }),
  undoLastLegFrame: (fixtureId, legNumber) =>
    request(`/fixtures/${fixtureId}/legs/${legNumber}/frames/last`, { method: 'DELETE' }),

  getPlayerProfile: (playerId) => request(`/players/${playerId}`),
};
