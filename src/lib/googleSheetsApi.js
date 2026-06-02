function getEnv(name) {
  return (typeof process !== 'undefined' && process.env && process.env[name]) || '';
}

const API_URL = getEnv('NEXT_PUBLIC_GOOGLE_SHEETS_API_URL') || '/api/si';
const API_TOKEN = getEnv('NEXT_PUBLIC_GOOGLE_SHEETS_API_TOKEN');

const GET_CACHE_TTL_MS = 30_000;
const GET_CACHEABLE_ACTIONS = new Set(['items.list', 'products.list', 'salesConfig.get']);
const _inFlight = new Map();
const _getCache = new Map();

function getSessionToken() {
  try {
    return window.localStorage.getItem('si_session_token') || '';
  } catch {
    return '';
  }
}

function isLocked() {
  try {
    return window.localStorage.getItem('si_locked') === '1';
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function requireConfig() {
  if (!API_URL) {
    throw new ApiError('Missing VITE_GOOGLE_SHEETS_API_URL', 'MISSING_CONFIG');
  }
}

function isPublicAction(action) {
  return action === 'auth.login';
}

function buildAuthParams(action) {
  // Prefer per-user session when available (so staff/admin roles work even if API token is configured).
  const session = getSessionToken();
  if (session) return { session };

  // When locked, force session-based auth even if an API token exists (for "Logout/Lock" behavior).
  if (API_TOKEN && !isLocked()) return { token: API_TOKEN };
  if (isPublicAction(action)) return {};
  throw new ApiError('Not authenticated. Please login.', 'UNAUTHENTICATED');
}

function toQuery(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    usp.set(k, String(v));
  });
  return usp.toString();
}

function cacheKeyFor(action, params) {
  const p = { ...(params || {}) };
  // Avoid caching auth/session tokens; caching is per-tab in-memory anyway.
  delete p.token;
  delete p.session;
  return `${action}?${toQuery(p)}`;
}

function handleInvalidSession(message) {
  if (!/unauthorized:\s*invalid session/i.test(String(message))) return;
  try {
    window.localStorage.removeItem('si_session_token');
    window.localStorage.removeItem('si_user');
    window.localStorage.setItem('si_locked', '1');
  } catch {
    // ignore
  }
  try {
    if (!window.__si_redirecting_to_login) {
      window.__si_redirecting_to_login = true;
      const path = window.location?.pathname || '';
      if (!path.startsWith('/login')) window.location.replace('/login');
    }
  } catch {
    // ignore
  }
}

async function parseEnvelope(response) {
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(`Bad response (${response.status})`, 'BAD_RESPONSE');
  }

  if (!response.ok) {
    const message = json?.error?.message || `Request failed (${response.status})`;
    const code = json?.error?.code || 'HTTP_ERROR';
    handleInvalidSession(message);
    throw new ApiError(message, code);
  }

  if (!json || json.ok !== true) {
    const message = json?.error?.message || 'Unexpected API response';
    const code = json?.error?.code || 'BAD_ENVELOPE';
    handleInvalidSession(message);
    throw new ApiError(message, code);
  }

  return json.data;
}

export async function apiGet(action, params = {}) {
  requireConfig();
  const auth = buildAuthParams(action);
  const query = toQuery({ action, ...auth, ...params });
  const url = `${API_URL}?${query}`;

  // Short-lived in-memory cache for small "list/config" endpoints.
  if (GET_CACHEABLE_ACTIONS.has(action)) {
    const ck = cacheKeyFor(action, params);
    const cached = _getCache.get(ck);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
  }

  // De-dupe identical in-flight requests (helps in dev / fast rerenders).
  if (_inFlight.has(url)) return _inFlight.get(url);
  const p = (async () => {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    const data = await parseEnvelope(res);
    if (GET_CACHEABLE_ACTIONS.has(action)) {
      const ck = cacheKeyFor(action, params);
      _getCache.set(ck, { expiresAt: Date.now() + GET_CACHE_TTL_MS, data });
    }
    return data;
  })();
  _inFlight.set(url, p);
  try {
    return await p;
  } finally {
    _inFlight.delete(url);
  }
}

export async function apiPost(action, payload = {}) {
  requireConfig();
  const auth = buildAuthParams(action);
  const res = await fetch(API_URL, {
    method: 'POST',
    // Use a "simple" content-type to avoid CORS preflight failures with Apps Script Web Apps.
    // Apps Script still receives the body in `e.postData.contents` and we JSON.parse it server-side.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    redirect: 'follow',
    body: JSON.stringify({ action, ...auth, payload }),
  });
  return parseEnvelope(res);
}
