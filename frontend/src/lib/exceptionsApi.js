/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging & QR Fallback
 *
 *  Thin data layer for Screen 5. It deliberately builds on the team's shared
 *  lib/api.js (apiGet/apiPost/apiPatch/apiDelete) rather than calling fetch()
 *  directly, so it inherits the shared token storage, the "keep me signed in"
 *  behaviour, and the typed error objects (err.status / err.code) for free.
 *
 *  Endpoint paths follow HIGH_LEVEL_DESIGN.md §3.6.
 * ============================================================================= */

import { apiGet, apiPost, apiPatch, apiDelete, getToken } from "./api.js";

/** The base build ships a single trip (see data.js TRIP). */
export const TRIP_ID = "t-1";

/** Human labels for the exception_type enum. */
export const ISSUE_LABEL = {
  MISSING_PERSON: "Missing person",
  LOST_BADGE: "Lost badge",
  FACE_MATCH_FAILED: "Face match failed",
  DEAD_PHONE: "Dead phone",
  VIP_REQUEST: "VIP request",
  OTHER: "Other",
};

/**
 * Max characters for the free-text label on the "Others" issue type.
 * Mirrors TYPE_OTHER_MAX in backend/routes/exceptions.js and the
 * exception_tickets.type_other column width. Change all three together.
 */
export const TYPE_OTHER_MAX = 20;

/**
 * Selectable priorities, in the order the buttons appear.
 * `cls` maps onto the badge classes already in tokens.css, so the colours match
 * the pills used in the inbox: CRITICAL red, NORMAL violet, LOW slate.
 */
export const PRIORITIES = [
  { value: "CRITICAL", label: "Critical", cls: "badge-missing", colour: "var(--st-missing)", bg: "var(--st-missing-bg)" },
  { value: "NORMAL",   label: "Normal",   cls: "badge-normal",  colour: "var(--st-normal)",  bg: "var(--st-normal-bg)" },
  { value: "LOW",      label: "Low",      cls: "badge-neutral", colour: "var(--st-neutral)", bg: "var(--st-neutral-bg)" },
];

/** The two non-critical options, for the buttons under the Critical toggle. */
export const BASE_PRIORITIES = PRIORITIES.filter((p) => p.value !== "CRITICAL");

/**
 * Display label for a ticket's issue type.
 * A type='OTHER' ticket carries its own free-text label in `typeOther`; show
 * that rather than the generic word "Other".
 */
export function issueLabel(ticket) {
  if (!ticket) return "";
  if (ticket.type === "OTHER" && ticket.typeOther) return ticket.typeOther;
  return ISSUE_LABEL[ticket.type] || ticket.type;
}

/**
 * List tickets for the active trip.
 * @param {{status?: string, priority?: string}} filter
 * @returns {Promise<{tickets: Array, counts: {all:number,critical:number,open:number,resolved:number}}>}
 */
export async function listExceptions(filter = {}) {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("status", filter.status);
  if (filter.priority) qs.set("priority", filter.priority);
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiGet(`/trips/${TRIP_ID}/exceptions${suffix}`);
}

/**
 * Number of UNRESOLVED CRITICAL tickets — drives the sidebar badge.
 * Cheap: the server returns a single integer, not the ticket list.
 */
export async function getCriticalOpenCount() {
  const data = await apiGet(`/trips/${TRIP_ID}/exceptions/critical-count`);
  return data.criticalOpen ?? 0;
}

/** Delegates for the picker. Reads JQ's existing delegate endpoint. */
export async function getDelegates() {
  const data = await apiGet(`/trips/${TRIP_ID}/delegates`);
  return data.delegates || [];
}

/** Coaches (from the shared dashboard view), keyed id → "Coach 2". */
export async function getCoaches() {
  const data = await apiGet(`/trips/${TRIP_ID}/dashboard`);
  return data.coaches || [];
}

/**
 * Raise a ticket.
 *
 * @param {object}  o
 * @param {string}  o.type          one of the exception_type enum values
 * @param {string} [o.typeOther]    free-text label, required when type === 'OTHER'
 * @param {string} [o.priority]     'CRITICAL' | 'NORMAL' | 'LOW'
 * @param {boolean}[o.markCritical] legacy shorthand — forces CRITICAL
 *
 * `markCritical` is honoured for backwards compatibility and always wins, since
 * the Critical toggle is the escalation switch. Otherwise the explicit
 * `priority` is used, defaulting to NORMAL.
 */
export async function createException({ type, typeOther, delegateId, coachId, note, priority, markCritical }) {
  const finalPriority = markCritical
    ? "CRITICAL"
    : (["CRITICAL", "NORMAL", "LOW"].includes(priority) ? priority : "NORMAL");

  return apiPost(`/trips/${TRIP_ID}/exceptions`, {
    type,
    typeOther: type === "OTHER" ? (typeOther || "").trim().slice(0, TYPE_OTHER_MAX) : null,
    delegateId: delegateId || null,
    coachId: coachId || null,
    note: note || null,
    priority: finalPriority,
    clientEventId: crypto.randomUUID(), // idempotency key (offline outbox)
  });
}

/** Resolve a ticket. Throws err.code === 'ALREADY_RESOLVED' (409) on a race. */
export async function resolveException(id) {
  return apiPatch(`/exceptions/${id}`, { status: "RESOLVED" });
}

/** Change a ticket's priority while it's still open. */
export async function updatePriority(id, priority) {
  return apiPatch(`/exceptions/${id}`, { priority });
}

/** Delete a ticket raised in error. */
export async function deleteException(id) {
  return apiDelete(`/exceptions/${id}`);
}

/** Manual attendance override — count a delegate present without a scan. */
export async function manualOverride(delegateId) {
  return apiPost(`/checkins/manual`, {
    tripId: TRIP_ID,
    delegateId,
    clientEventId: crypto.randomUUID(),
    clientTs: new Date().toISOString(),
  });
}

/** Undo a manual attendance override — reverts the delegate to ASSIGNED and
 *  removes the check-in log row manualOverride() just created. */
export async function undoManualOverride(delegateId) {
  return apiPost(`/checkins/manual/undo`, { delegateId });
}

/**
 * QR badge check-in — count a delegate present from a scanned delegate badge.
 * Writes a method='QR' row to check_in_logs and flips the delegate to PRESENT,
 * so JQ's dashboard head-count updates live. Returns { delegateId, name,
 * status, method, duplicate }.
 */
export async function checkInByQR({ tripId = TRIP_ID, delegateId, coachId = null }) {
  return apiPost(`/checkins/qr`, {
    tripId,
    delegateId,
    coachId,
    clientEventId: crypto.randomUUID(),
    clientTs: new Date().toISOString(),
  });
}

/**
 * Subscribe to live ticket events (Server-Sent Events).
 * EventSource cannot send an Authorization header, so the token goes in the
 * query string; the server accepts either.
 * @returns {() => void} unsubscribe
 */
export function subscribeStream(onEvent) {
  const base = import.meta.env.VITE_API_URL || "/api";
  const token = getToken();
  if (!token) return () => {};

  const es = new EventSource(`${base}/exceptions/stream?token=${encodeURIComponent(token)}`);

  // Connection status — so the UI can show "Live" as soon as the channel is up,
  // not only once the first ticket event happens to arrive.
  es.onopen = () => onEvent("stream:open", null);
  es.onerror = () => onEvent("stream:error", null);
  es.addEventListener("ready", () => onEvent("stream:open", null));

  const events = ["exception:created", "exception:critical", "exception:updated", "exception:deleted", "attendance:override"];
  const handlers = events.map((name) => {
    const fn = (m) => {
      let payload = null;
      try { payload = JSON.parse(m.data); } catch { /* ignore */ }
      onEvent(name, payload);
    };
    es.addEventListener(name, fn);
    return [name, fn];
  });

  return () => {
    handlers.forEach(([name, fn]) => es.removeEventListener(name, fn));
    es.onopen = null;
    es.onerror = null;
    es.close();
  };
}

/** DB returns ISO timestamps; render as HH:MM. */
export function fmtTime(v) {
  if (!v) return "";
  if (/^\d{2}:\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });
}
