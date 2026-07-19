import { getStoredToken } from './AuthContext.jsx';

const BASE = '/api';

async function request(path, options = {}) {
  const token = getStoredToken();
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
