// Single source of truth for auth tokens on the client.
// Kept outside React so the bare `apiFetch` wrapper and the auth context can share it without
// a circular import, and so concurrent requests read the same token.

const ACCESS_KEY = "encodr.accessToken";
const REFRESH_KEY = "encodr.refreshToken";
const USER_KEY = "encodr.user";

let accessToken: string | null = null;
let refreshToken: string | null = null;

function isBrowser() {
  return typeof window !== "undefined";
}

/** localStorage can be missing or blocked (private browsing, tests, SSR edge cases). */
function storage(): Storage | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Hydrate the in-memory cache from localStorage (call once on the client at startup). */
export function hydrateTokens() {
  const store = storage();
  if (!store) return;
  accessToken = store.getItem(ACCESS_KEY);
  refreshToken = store.getItem(REFRESH_KEY);
}

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  return refreshToken;
}

export function setTokens(tokens: { accessToken: string; refreshToken?: string }) {
  accessToken = tokens.accessToken;
  const store = storage();
  if (store) store.setItem(ACCESS_KEY, tokens.accessToken);
  if (tokens.refreshToken) {
    refreshToken = tokens.refreshToken;
    if (store) store.setItem(REFRESH_KEY, tokens.refreshToken);
  }
}

export function setStoredUser(user: unknown) {
  storage()?.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser<T>(): T | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  const store = storage();
  if (store) {
    store.removeItem(ACCESS_KEY);
    store.removeItem(REFRESH_KEY);
    store.removeItem(USER_KEY);
  }
}
