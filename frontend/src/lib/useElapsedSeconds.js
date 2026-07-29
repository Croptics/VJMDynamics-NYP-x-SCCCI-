/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — shared AI timing hook
 * ============================================================================= */
import { useState, useEffect } from "react";

/**
 * Elapsed-seconds ticker for an in-flight AI call (2026-07-24 — "there no
 * time tracker when i click ai generate stuff"). Extracted from
 * AnalyticsPanel.jsx so ExportModal.jsx's own AI-filter box can show the
 * same live counter instead of a silent spinner.
 *
 * `startedAt` is an epoch-ms timestamp (not a local "when this effect first
 * ran" ref) so it reads correctly even for state that can outlive the
 * component — e.g. AnalyticsPanel's Insights store, which may already be
 * mid-request when the component mounts (switched Dashboard tabs away and
 * back). Callers that only ever start/stop within one mounted lifetime
 * (like ExportModal's own local busy state) can just pass `Date.now()` at
 * the moment they set busy=true.
 */
export function useElapsedSeconds(active, startedAt) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active || !startedAt) { setSeconds(0); return; }
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);
  return seconds;
}
