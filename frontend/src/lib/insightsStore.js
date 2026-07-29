/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — AI Insights store
 * ============================================================================= */
/**
 * AI Insights — a store that lives OUTSIDE React's component tree.
 *
 * AnalyticsPanel.jsx used to hold `insights`/`insightsLoading`/etc. as plain
 * useState — but that panel only renders while the Analytics tab is active,
 * so switching to another Dashboard tab (or navigating away entirely)
 * unmounts it and throws all of that state away. A user who clicked
 * "Generate Insights" and then switched tabs would come back to find it
 * reset to nothing, even though the request may well have finished
 * successfully in the background — its result just had nowhere left to land.
 *
 * Fixing this means the request and its result can't live in component
 * state at all — they need to survive the component that started them being
 * unmounted, remounted, or never existing again until later. A module-level
 * store (imported, not instantiated per-render) does exactly that: the
 * fetch keeps running regardless of what's mounted, and any component that
 * later subscribes (via useSyncExternalStore) picks up whatever the current
 * state actually is — mid-flight, finished, or errored.
 */
import { apiPost } from "./api.js";

const EMPTY = { loading: false, insights: null, asOf: null, source: null, error: null, startedAt: null };

// Keyed by tripId so switching trips never shows one trip's stale insights
// while another trip's request is still in flight.
const state = new Map();
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Returns the SAME object reference until something actually changes —
 *  required for useSyncExternalStore to avoid re-render loops. */
export function getSnapshot(tripId) {
  return state.get(tripId) || EMPTY;
}

export async function generateInsights(tripId, lang) {
  // `startedAt` (not a local component timer) so the elapsed-time display in
  // AnalyticsPanel.jsx reads correctly even if the panel mounts mid-request
  // (e.g. switched Dashboard tabs away and back while this was still
  // running) — same "state must outlive the component" reasoning as the
  // rest of this store.
  state.set(tripId, { ...getSnapshot(tripId), loading: true, error: null, startedAt: Date.now() });
  emit();
  try {
    const { insights, asOf, source } = await apiPost(`/trips/${tripId}/insights`, { lang });
    state.set(tripId, { loading: false, insights, asOf, source, error: null });
  } catch (e) {
    // Our own copy of the message (not the backend's e.message) so the
    // dictionary can translate it — same reasoning AnalyticsPanel.jsx always used.
    const error = e.code === "AI_NOT_CONFIGURED"
      ? "Install Ollama locally (free) or ask an admin to set ANTHROPIC_API_KEY in backend/.env."
      : "AI insights are temporarily unavailable.";
    state.set(tripId, { ...getSnapshot(tripId), loading: false, error });
  }
  emit();
}
