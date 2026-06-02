const STORAGE_SESSION = 'si_session_token';
const STORAGE_USER = 'si_user';
const STORAGE_LOCKED = 'si_locked';

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isLocked() {
  const ls = safeStorage();
  if (!ls) return false;
  return ls.getItem(STORAGE_LOCKED) === '1';
}

export function setLocked(locked) {
  const ls = safeStorage();
  if (!ls) return;
  if (locked) ls.setItem(STORAGE_LOCKED, '1');
  else ls.removeItem(STORAGE_LOCKED);
}

export function getSessionToken() {
  const ls = safeStorage();
  if (!ls) return '';
  return ls.getItem(STORAGE_SESSION) || '';
}

export function getUser() {
  if (isLocked()) return null;
  const ls = safeStorage();
  if (!ls) return null;
  const raw = ls.getItem(STORAGE_USER) || '';
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through
    }
  }
  return null;
}

export function setSession({ sessionToken, user }) {
  const ls = safeStorage();
  if (!ls) return;
  setLocked(false);
  if (sessionToken) ls.setItem(STORAGE_SESSION, String(sessionToken));
  if (user) ls.setItem(STORAGE_USER, JSON.stringify(user));
}

export function clearSession() {
  const ls = safeStorage();
  if (!ls) return;
  ls.removeItem(STORAGE_SESSION);
  ls.removeItem(STORAGE_USER);
}

export function isLoggedIn() {
  if (isLocked()) return false;
  return !!getSessionToken();
}
