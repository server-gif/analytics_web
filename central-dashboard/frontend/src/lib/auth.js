/**
 * Client-side auth for the dashboard's in-app login page.
 *
 * We reuse the backend's HTTP Basic Auth (the Worker still validates every /api
 * route against DASHBOARD_PASSWORD). The SPA just stores the credential and
 * attaches it as an `Authorization: Basic` header on each /api call - so there is
 * no browser-native login prompt and no new server-side session machinery.
 *
 * Storage: sessionStorage by default (cleared when the tab closes); localStorage
 * when the user ticks "Remember me". The value is base64("user:password") - the
 * exact token Basic Auth expects. This is an admin tool behind a password; the
 * credential never leaves the browser except as the Authorization header.
 */

const KEY = "cfj_auth";
export const UNAUTHORIZED_EVENT = "cfj:unauthorized";

// UTF-8-safe base64 (btoa alone throws on non-Latin1 passwords).
function b64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

export function makeAuthValue(user, pass) {
  return b64(`${user || "admin"}:${pass}`);
}

export function getAuthValue() {
  try {
    return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setAuthValue(value, remember) {
  try {
    // keep exactly one copy: clear the other store first
    if (remember) {
      sessionStorage.removeItem(KEY);
      localStorage.setItem(KEY, value);
    } else {
      localStorage.removeItem(KEY);
      sessionStorage.setItem(KEY, value);
    }
  } catch {}
}

export function clearAuth() {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {}
}

export function isAuthed() {
  return !!getAuthValue();
}

// A 401 from any /api call (initial load, live poll, or login attempt) means the
// stored credential is missing/invalid -> tell the app to show the login page.
export function notifyUnauthorized() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

export function logout() {
  clearAuth();
  notifyUnauthorized();
}
