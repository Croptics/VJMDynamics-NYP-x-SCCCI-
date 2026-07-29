/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — App shell & navigation
 * ============================================================================= */
import { useEffect, useRef } from "react";

/**
 * Drop-in replacement for the `load(); setInterval(load, N)` pattern that was
 * copy-pasted across every live page — but it STOPS polling while the tab is
 * hidden, and catches up the moment you come back (2026-07-29).
 *
 * WHY (this is a real production cost, not a micro-optimisation): every poller
 * in this app used to run flat-out regardless of whether anyone was looking.
 * The Dashboard fires FIVE API calls per tick every 8s — ~2,250 calls/hour, or
 * ~18,000 across an 8-hour event day, PER OPEN TAB. So an admin who opened the
 * Dashboard on Monday and left it in a background tab all week generated
 * exactly the same backend + Neon load as someone actively watching a muster.
 * That's the same problem the 2s -> 8s slowdown (2026-07-24) was reaching for;
 * it treated the symptom (tick rate) rather than the cause (nobody's looking).
 * Pausing on `visibilitychange` is the actual fix, and it costs the UI nothing:
 * a hidden tab has no numbers on screen to keep fresh, and the catch-up fetch
 * on re-show means what you see when you switch back is never stale.
 *
 * Usage — replaces this:
 *     useEffect(() => {
 *       load();
 *       const id = setInterval(load, 8000);
 *       return () => clearInterval(id);
 *     }, [load]);
 * with this:
 *     useVisiblePolling(load, 8000, [load]);
 *
 * @param callback   the refetch to run. Always invoked via a ref, so the timer
 *                   calls the LATEST version and can never fire a stale
 *                   closure — even between `deps` changes.
 * @param intervalMs tick rate. Falsy (0/null) disables polling entirely.
 * @param deps       same semantics as the dependency array on the `useEffect`
 *                   this replaces: when one changes, the poller restarts AND
 *                   fetches immediately. Pass `[load]` when `load` is a
 *                   `useCallback` keyed on something like the selected trip,
 *                   so switching trips still refetches at once — that
 *                   behaviour is load-bearing on several pages and would
 *                   silently break if `callback` were only read from the ref.
 *
 * NOTE on why `callback` itself is deliberately NOT a dependency: a plain
 * inline function gets a new identity on every render, so depending on it
 * would restart the interval every render — which, on a page that re-renders
 * once a second, means the interval never survives long enough to fire. That
 * exact identity trap cost real debugging time earlier the same day on the
 * shared page-header chrome (see AI Log 154d), hence the ref + explicit
 * `deps` split here.
 */
export function useVisiblePolling(callback, intervalMs, deps = []) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!intervalMs) return undefined;

    // Treat a non-browser/unknown environment as visible — never silently
    // disable a page's only refresh path because `document` looked odd.
    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";

    let timer = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => cbRef.current?.(), intervalMs);
    };
    const stop = () => {
      if (timer !== null) { clearInterval(timer); timer = null; }
    };

    // Fetch once on mount / whenever `deps` change, exactly as the hand-rolled
    // `load(); setInterval(...)` did. Runs even when hidden: a page mounting in
    // a background tab (a restored session, an opened-in-new-tab link) should
    // still have data ready by the time it's looked at.
    cbRef.current?.();
    if (isVisible()) start();

    const onVisibilityChange = () => {
      if (isVisible()) {
        cbRef.current?.(); // catch up first, so re-showing never shows stale data
        start();
      } else {
        stop();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
