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

import { apiGet, apiPost, apiPatch, apiDelete, getToken } from "../api.js";
// Offline write queue (JQ, 2026-07-28) — see manualOverride() below.
import { enqueue, registerSender, isOfflineError, pending } from "../localstorage/outbox.js";

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
 * List tickets for a trip (defaults to the base TRIP_ID for any caller that
 * hasn't been updated to pass one).
 * @param {{status?: string, priority?: string}} filter
 * @param {string} [tripId]  trip switcher's current trip (uuid_id), or "t-1"
 * @returns {Promise<{tickets: Array, counts: {all:number,critical:number,open:number,resolved:number}}>}
 */
export async function listExceptions(filter = {}, tripId = TRIP_ID) {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("status", filter.status);
  if (filter.priority) qs.set("priority", filter.priority);
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiGet(`/trips/${tripId}/exceptions${suffix}`);
}

/**
 * Number of UNRESOLVED CRITICAL tickets — drives the sidebar badge.
 * Cheap: the server returns a single integer, not the ticket list.
 */
export async function getCriticalOpenCount(tripId = TRIP_ID) {
  const data = await apiGet(`/trips/${tripId}/exceptions/critical-count`);
  return data.criticalOpen ?? 0;
}

/** Delegates for the picker. Reads JQ's existing delegate endpoint. */
export async function getDelegates(tripId = TRIP_ID) {
  const data = await apiGet(`/trips/${tripId}/delegates`);
  return data.delegates || [];
}

/** Coaches (from the shared dashboard view), keyed id → "Coach 2". */
export async function getCoaches(tripId = TRIP_ID) {
  const data = await apiGet(`/trips/${tripId}/dashboard`);
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
 * @param {string} [o.tripId]       trip switcher's current trip; defaults to TRIP_ID
 *
 * `markCritical` is honoured for backwards compatibility and always wins, since
 * the Critical toggle is the escalation switch. Otherwise the explicit
 * `priority` is used, defaulting to NORMAL.
 */
export async function createException({ type, typeOther, delegateId, coachId, note, priority, markCritical, tripId = TRIP_ID }) {
  const finalPriority = markCritical
    ? "CRITICAL"
    : (["CRITICAL", "NORMAL", "LOW"].includes(priority) ? priority : "NORMAL");

  return apiPost(`/trips/${tripId}/exceptions`, {
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

/** Manual attendance override — count a delegate present without a scan.
 *  `tripId` (the body field written into check_in_logs.trip_id) stays the
 *  historical TRIP_ID/"t-1" default always — that column has a foreign key
 *  to trips' LEGACY id, which only the original Beijing trip has populated;
 *  any other trip's real uuid there 500s. `checkpointTripId` (2026-07-23) is
 *  a SEPARATE, optional override for a caller scoped to a different trip
 *  (e.g. the scanner page's own trip switcher) — the backend resolves it via
 *  uuid_id (which every trip has) purely to sync the checkpoint-scoped view,
 *  never for the check_in_logs write. */
export async function manualOverride(delegateId, checkpointTripId, meta = {}) {
  const body = {
    tripId: TRIP_ID,
    checkpointTripId,
    delegateId,
    clientEventId: crypto.randomUUID(),
    clientTs: new Date().toISOString(),
  };
  try {
    return await apiPost(`/checkins/manual`, body);
  } catch (err) {
    // OFFLINE FALLBACK (JQ, 2026-07-28 — the client's "must work with no signal"
    // requirement; see README/INTEGRATION_NOTES.md). If the request never
    // reached the server, queue the INTENT and resolve as if it succeeded, so
    // the caller's optimistic UI stands. Replay is safe because `clientEventId`
    // is generated once, above, and reused on every retry — the UNIQUE
    // constraint on check_in_logs.client_event_id makes a double-write
    // impossible. An HTTP error (403/404/…) is a real refusal and still throws.
    //
    // ⚠️ This is the ONLY line of JQ's offline work inside Jayden's files; all
    // the queue logic lives in lib/outbox.js. If this function gets rewritten,
    // re-adding this try/catch restores offline support — nothing else needed.
    if (!isOfflineError(err)) throw err;
    enqueue({
      kind: "checkins/manual",
      payload: { ...body, isOfflineOrigin: true },
      meta: { delegateId, label: meta.name || delegateId },
    });
    return { delegateId, status: "ARRIVED", queued: true };
  }
}

/* Replay handler for the queue above. Registered here (not in outbox.js) so the
 * outbox stays free of feature imports — it just calls back into this module. */
registerSender("checkins/manual", (payload) => apiPost(`/checkins/manual`, payload));

/** Is this delegate's manual check-in still waiting to sync? Lets a panel show
 *  them as present after a reload, before the queue has drained. */
export function isCheckinQueued(delegateId) {
  return pending().some((e) => e.kind === "checkins/manual" && e.meta?.delegateId === delegateId);
}

/** Delegate ids with a queued manual check-in (for seeding optimistic UI). */
export function queuedCheckinIds() {
  return pending().filter((e) => e.kind === "checkins/manual").map((e) => e.meta?.delegateId).filter(Boolean);
}

/** Undo a manual attendance override — reverts the delegate to whatever
 *  status they actually had before the override (the backend restores it
 *  from check_in_logs.prev_status; ASSIGNED only if there's none to restore)
 *  and removes the check-in log row manualOverride() just created.
 *  checkpointTripId (2026-07-23, optional) mirrors manualOverride()'s own —
 *  see its comment for why it's separate from tripId. */
export async function undoManualOverride(delegateId, checkpointTripId) {
  return apiPost(`/checkins/manual/undo`, { delegateId, checkpointTripId });
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

/* ---- Delegate status ----------------------------------------------------- *
 * The five-status model is UNASSIGNED → ASSIGNED → ARRIVED / LATE / MISSING.
 * PRESENT is the pre-migration value and is still accepted as an alias for
 * ARRIVED (see normalize() in backend/db/delegates.js), so anything asking
 * "is this delegate checked in?" has to accept both.
 * -------------------------------------------------------------------------- */

/** Statuses that mean "checked in". */
export const CHECKED_IN_STATUSES = ["ARRIVED", "PRESENT"];

/** True when the delegate is already counted as boarded. */
export function isCheckedIn(status) {
  return CHECKED_IN_STATUSES.includes(status);
}

/* ---- Ageing -------------------------------------------------------------- *
 * How long a ticket has been sitting. On a live trip the difference between a
 * ticket raised 2 minutes ago and one raised 40 minutes ago is the whole point
 * of the screen, but both render identically as an HH:MM stamp — so rows also
 * show an age, tinted once it crosses the thresholds below.
 * -------------------------------------------------------------------------- */
export const AGE_WARN_MINS = 15;
export const AGE_LATE_MINS = 30;

/** Whole minutes between `iso` and `now` (never negative). null if unparseable. */
export function ageMinutes(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60000));
}

/** Compact age: "just now" · "8m" · "2h 05m" · "3d". */
export function fmtAge(mins) {
  if (mins == null) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${String(mins % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d`;
}

/** "" | "warn" | "late" — drives the age tint. Only OPEN tickets age. */
export function ageLevel(ticket, now = Date.now()) {
  if (!ticket || ticket.status !== "OPEN") return "";
  const m = ageMinutes(ticket.createdAt, now);
  if (m == null) return "";
  if (m >= AGE_LATE_MINS) return "late";
  if (m >= AGE_WARN_MINS) return "warn";
  return "";
}

/** Minutes a resolved ticket took, or null if it isn't resolved. */
export function resolveMinutes(ticket) {
  if (!ticket || ticket.status !== "RESOLVED" || !ticket.resolvedAt) return null;
  const a = new Date(ticket.createdAt).getTime();
  const b = new Date(ticket.resolvedAt).getTime();
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return Math.round((b - a) / 60000);
}

/* ---- CSV export (opens in Excel) ----------------------------------------- *
 * Mirrors exportRowsCsv() in claudeParse.js — same escaping and UTF-8 BOM, so
 * every CSV the app produces behaves identically in Excel.
 * -------------------------------------------------------------------------- */
const TICKET_COLUMNS = [
  ["priority", "Priority"], ["issue", "Issue"], ["delegate", "Delegate"],
  ["coach", "Coach"], ["note", "Note"], ["status", "Status"],
  ["raisedAt", "Raised at"], ["raisedBy", "Raised by"],
  ["resolvedAt", "Resolved at"], ["resolvedBy", "Resolved by"],
  ["ageMins", "Age (mins)"],
];

function toExportRow(t, now = Date.now()) {
  return {
    priority: t.priority,
    issue: issueLabel(t),
    delegate: t.delegateName || "Unidentified",
    coach: t.coach || "",
    note: t.note || "",
    status: t.status,
    raisedAt: t.createdAt ? new Date(t.createdAt).toLocaleString("en-SG") : "",
    raisedBy: t.raisedBy || "",
    resolvedAt: t.resolvedAt ? new Date(t.resolvedAt).toLocaleString("en-SG") : "",
    resolvedBy: t.resolvedBy || "",
    ageMins: t.status === "RESOLVED" ? (resolveMinutes(t) ?? "") : (ageMinutes(t.createdAt, now) ?? ""),
  };
}

/** Download the given tickets as CSV. Returns the number of rows written. */
export function exportTicketsCsv(tickets, filename = "exceptions.csv") {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const now = Date.now();
  const header = TICKET_COLUMNS.map(([, label]) => label).join(",");
  const lines = tickets.map((t) => {
    const row = toExportRow(t, now);
    return TICKET_COLUMNS.map(([key]) => esc(row[key])).join(",");
  });
  const csv = [header, ...lines].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }); // BOM so Excel reads UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return tickets.length;
}
