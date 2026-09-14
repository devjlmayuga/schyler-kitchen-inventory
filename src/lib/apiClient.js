const API_URL = '/api/si';

const GET_CACHE_TTL_MS = 30_000;
const GET_CACHEABLE_ACTIONS = new Set(['items.list', 'products.list', 'salesConfig.get', 'inventory.getOrSeed']);
const _inFlight = new Map();
const _getCache = new Map();

const INVALIDATE_AFTER_WRITE = {
  'inventory.submit': ['inventory.getOrSeed'],
  'inventory.deleteDay': ['inventory.getOrSeed'],
  'inventory.setClosed': ['inventory.getOrSeed'],
  'inventory.seedTemplate': ['inventory.getOrSeed'],
  'items.upsert': ['items.list', 'inventory.getOrSeed'],
  'items.upsertMany': ['items.list', 'inventory.getOrSeed'],
  'items.delete': ['items.list', 'inventory.getOrSeed'],
  'thresholds.update': ['items.list', 'inventory.getOrSeed'],
  'products.upsert': ['products.list'],
  'products.upsertMany': ['products.list'],
  'products.delete': ['products.list'],
  'salesConfig.save': ['salesConfig.get'],
};

function invalidateActions(actions) {
  const prefixes = (actions || []).map((action) => `${action}?`);
  for (const key of _getCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) _getCache.delete(key);
  }
}

function getSessionToken() {
  try {
    return window.localStorage.getItem('si_session_token') || '';
  } catch {
    return '';
  }
}

export class ApiError extends Error {
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function isPublicAction(action) {
  return action === 'auth.login' || action === 'face.clock';
}

function buildAuthParams(action) {
  const session = getSessionToken();
  if (session) return { session };
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
  const auth = buildAuthParams(action);
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...auth, payload }),
  });
  const data = await parseEnvelope(res);
  invalidateActions(INVALIDATE_AFTER_WRITE[action]);
  return data;
}
