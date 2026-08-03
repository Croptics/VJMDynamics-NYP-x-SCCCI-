/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — offline write queue
 * ============================================================================= */
/**
 * Offline outbox — queue a WRITE locally and replay it when the network is back.
 *
 * WHY THIS EXISTS (2026-07-28). Client requirement, recorded as a CRITICAL gap
 * in README/INTEGRATION_NOTES.md: staff must be able to take attendance with no
 * internet signal, which is common on-site. Caching reads doesn't solve that —
 * the thing that fails offline is a WRITE. So this stores the staff member's
 * *intention* ("mark delegate d-7 present, at 09:05, by me") and replays it
 * later, rather than storing server data.
 *
 * WHY IT'S SAFE TO REPLAY. Jayden's `check_in_logs` table already has
 * `client_event_id VARCHAR(64) NOT NULL UNIQUE` and his handler checks it
 * before inserting, returning `{ duplicate: true }` instead of double-counting.
 * The id is generated ONCE here, when the action is queued, and reused on every
 * retry — so a replayed, double-tapped, or two-tabs-at-once write can never
 * create a second attendance record. `client_ts` is captured at queue time too,
 * so a check-in taken at 09:05 and synced at 11:00 is recorded as 09:05.
 * Nothing in this file needed a backend change.
 *
 * DESIGN NOTES
 *  - FIFO, and a failed replay STOPS the flush so order is preserved.
 *  - Senders are registered by the module that owns the endpoint
 *    (see exceptionsApi.js) rather than imported here — keeps this file free of
 *    feature dependencies and avoids a circular import.
 *  - "Offline" means the request never reached the server: fetch() rejects and
 *    api.js's error has no `.status`. An HTTP error DOES have `.status`, and is
 *    a real refusal (403 no permission, 404 gone) — those must NOT be queued
 *    forever, so they go to a separate `failed` list the UI can show.
 *  - Everything is guarded for a missing localStorage / window so this module
 *    can be unit-tested in Node (see tests/jq/outbox.test.js).
 */

const KEY = "mg_outbox_v1";
const FAILED_KEY = "mg_outbox_failed_v1";
const MAX_QUEUE = 500;      // a very long shift of manual check-ins, still bounded
const MAX_ATTEMPTS = 25;    // after this many tries, treat as failed rather than looping forever
const RETRY_MS = 30000;     // periodic retry while something is waiting

/* ---- storage (guarded so this works in Node tests) ---------------------- */
function store() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // Safari private mode etc.
  }
}
function readList(key) {
  const s = store();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(key) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return []; // corrupted — start clean rather than crash the app
  }
}
function writeList(key, list) {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(list));
  } catch { /* quota — the in-flight action still runs, it just isn't durable */ }
}

/* ---- subscribers (drives the sync pill) -------------------------------- */
const listeners = new Set();
function emit() {
  const snap = snapshot();
  for (const fn of listeners) { try { fn(snap); } catch { /* a bad listener mustn't break the queue */ } }
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---- senders ------------------------------------------------------------ */
const senders = new Map(); // kind -> async (payload) => serverResponse
export function registerSender(kind, fn) {
  senders.set(kind, fn);
}

/* ---- public state ------------------------------------------------------- */
export function pending() { return readList(KEY); }
export function pendingCount() { return readList(KEY).length; }
export function failed() { return readList(FAILED_KEY); }
export function clearFailed() { writeList(FAILED_KEY, []); emit(); }

export function isOnline() {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
}

export function snapshot() {
  return { pending: pendingCount(), failed: failed().length, online: isOnline(), flushing };
}

/** True when a request never reached the server (so it's worth queueing).
 *  api.js attaches `.status` for every HTTP response; fetch() rejecting with a
 *  TypeError (offline, DNS, connection refused) leaves it undefined. */
export function isOfflineError(err) {
  return !err || err.status === undefined || err.status === 0;
}

/* ---- queueing ----------------------------------------------------------- */
/**
 * Add an intended write to the queue.
 * @param kind    matches a registerSender() key
 * @param payload the exact request body to replay — MUST already contain its
 *                idempotency key (clientEventId) and clientTs
 * @param meta    optional UI context, e.g. { delegateId, label }
 */
export function enqueue({ kind, payload, meta = {} }) {
  const list = readList(KEY);
  if (list.length >= MAX_QUEUE) {
    // Drop the OLDEST rather than refuse the newest: the most recent attendance
    // action is the one the staff member is watching on screen.
    list.shift();
  }
  const entry = {
    id: payload?.clientEventId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    payload,
    meta,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  list.push(entry);
  writeList(KEY, list);
  emit();
  return entry;
}

/** Move an entry to the failed list (server refused it — retrying won't help). */
function markFailed(entry, message) {
  const f = readList(FAILED_KEY);
  f.push({ ...entry, failedAt: new Date().toISOString(), lastError: message || "Rejected by server" });
  writeList(FAILED_KEY, f.slice(-50));
}

/* ---- replay ------------------------------------------------------------- */
let flushing = false;

/**
 * Replay queued writes, oldest first. Stops at the first entry that still can't
 * reach the server, so ordering is preserved and we don't hammer a dead link.
 * Safe to call concurrently — the `flushing` guard makes extra calls no-ops.
 */
export async function flush() {
  if (flushing) return { sent: 0, stopped: true };
  const first = readList(KEY);
  if (first.length === 0) return { sent: 0, stopped: false };

  flushing = true;
  emit();
  let sent = 0;
  let stopped = false;
  try {
    // Re-read the list each iteration: a UI action may enqueue while we replay.
    for (;;) {
      const list = readList(KEY);
      if (list.length === 0) break;
      const entry = list[0];
      const send = senders.get(entry.kind);

      if (!send) {
        // No handler registered (e.g. the owning module never loaded). Keep it
        // queued rather than dropping a real attendance action.
        stopped = true;
        break;
      }

      try {
        await send(entry.payload);
        // Success — or a duplicate, which means it already landed. Either way
        // it's done, so drop it.
        writeList(KEY, readList(KEY).filter((e) => e.id !== entry.id));
        sent += 1;
        emit();
      } catch (err) {
        if (isOfflineError(err)) {
          stopped = true; // still offline — leave the queue intact, try later
          break;
        }
        if (err.status === 401 || err.status === 408 || err.status === 429 || err.status >= 500) {
          // Reachable but not now: expired session, timeout, throttled, or a
          // server fault. Keep the entry and stop — retrying the rest is futile.
          const bumped = readList(KEY).map((e) =>
            e.id === entry.id ? { ...e, attempts: e.attempts + 1, lastError: err.message } : e);
          writeList(KEY, bumped);
          const now = bumped.find((e) => e.id === entry.id);
          if (now && now.attempts >= MAX_ATTEMPTS) {
            writeList(KEY, bumped.filter((e) => e.id !== entry.id));
            markFailed(now, err.message);
          }
          stopped = true;
          emit();
          break;
        }
        // A real refusal (400/403/404/409…). Retrying can't fix it — surface it
        // instead of silently looping.
        writeList(KEY, readList(KEY).filter((e) => e.id !== entry.id));
        markFailed(entry, err.message);
        emit();
      }
    }
  } finally {
    flushing = false;
    emit();
  }
  return { sent, stopped };
}

/* ---- lifecycle ---------------------------------------------------------- */
let started = false;
/** Attach the retry triggers. Idempotent — safe to call from any mount. */
export function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => { emit(); flush(); });
  window.addEventListener("offline", emit);
  // Another tab may have queued or drained something.
  window.addEventListener("storage", (e) => { if (e.key === KEY || e.key === FAILED_KEY) emit(); });
  setInterval(() => { if (isOnline() && pendingCount() > 0) flush(); }, RETRY_MS);
  // Try immediately: the app may have been reopened after being closed offline.
  if (isOnline() && pendingCount() > 0) flush();
}
