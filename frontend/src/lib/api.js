/**
 * Minimal API client. Reads the JWT from storage and attaches it.
 * Swap BASE_URL for your deployed Express origin.
 */
import { DEFAULT_PERMISSIONS } from "../../../permissions.js";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";
const TOKEN_KEY = "mg_token";
const USER_KEY = "mg_user";

/* ---- Token + user storage ----------------------------------------------- */
/**
 * Stored in localStorage when "keep me signed in" is on (survives closing the
 * browser) or sessionStorage otherwise. Either way it survives a refresh.
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token, remember = true) {
  clearToken();
  (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

/**
 * Effective permissions for the signed-in user. Reads the permissions saved at
 * login; if an older session only has a role, derive sensible defaults so the
 * UI still gates correctly without forcing an immediate re-login. Always
 * includes every known key (from the shared permissions.js).
 */
export function getPermissions() {
  const u = getUser() || {};
  if (u.permissions) return { ...DEFAULT_PERMISSIONS, ...u.permissions };
  if (u.role === "main") return { ...DEFAULT_PERMISSIONS, manageDelegates: true, exportData: true, manageAccounts: true };
  if (u.role === "admin") return { ...DEFAULT_PERMISSIONS, manageDelegates: true, exportData: true };
  return { ...DEFAULT_PERMISSIONS, manageDelegates: true };
}

export function setUser(user, remember = true) {
  (remember ? localStorage : sessionStorage).setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Update the stored token and/or user IN PLACE, in whichever storage currently
 * holds the session (local vs session), preserving the "keep me signed in"
 * choice. Used when you edit your own account so the token (username) and the
 * sidebar name/permissions stay in sync without needing to log in again.
 */
export function updateSession({ token, user } = {}) {
  const store = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
  if (token) store.setItem(TOKEN_KEY, token);
  if (user) {
    let current = {};
    try {
      current = JSON.parse(store.getItem(USER_KEY)) || {};
    } catch { /* ignore */ }
    store.setItem(USER_KEY, JSON.stringify({ ...current, ...user }));
  }
}

/** Clears both token and user from both stores — used by logout. */
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(USER_KEY);
}

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ---- Requests ----------------------------------------------------------- */
export async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { ...authHeader() } });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res.json();
}

export async function apiPost(path, body, isForm = false) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: isForm
      ? { ...authHeader() }
      : { "Content-Type": "application/json", ...authHeader() },
    body: isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed (${res.status})`);
  return res.json();
}

export async function apiPatch(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed (${res.status})`);
  return res.json();
}

export async function apiDelete(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: { ...authHeader() },
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed (${res.status})`);
  return res.json();
}
