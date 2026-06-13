/**
 * Minimal API client. Reads the JWT from memory/session and attaches it.
 * Swap BASE_URL for your deployed Express origin.
 */
const BASE_URL = import.meta.env.VITE_API_URL || "/api";

function authHeader() {
  const token = sessionStorage.getItem("mg_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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
