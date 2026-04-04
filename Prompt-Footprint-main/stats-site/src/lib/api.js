const API_BASE_URL = 'https://promptfootprint-production.up.railway.app/api';

export function getUserIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('userId');
}

async function request(endpoint, params = {}) {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

export async function fetchSessions(userId) {
  return request('/sessions', { userId });
}

export async function fetchWeeklyStats(userId) {
  return request('/sessions/weekly', { userId });
}

export async function fetchQueries(sessionId) {
  return request('/queries', { sessionId });
}
