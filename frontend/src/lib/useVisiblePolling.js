/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — App shell & navigation
 * ============================================================================= */
import { useEffect, useRef } from "react";

/**
 * Drop-in replacement for the `load(); setInterval(load, N)` pattern used on
 * every live page — but it STOPS polling while the tab is hidden and catches up
 * on re-show. A background tab used to cost the same backend + Neon load as one
 * being actively watched (Dashboard = 5 calls per 8s tick, per open tab).
 *
 * Usage: `useVisiblePolling(load, 8000, [load])` in place of a
 * `useEffect(() => { load(); const id = setInterval(load, 8000); ... }, [load])`.
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
 * `callback` is deliberately NOT a dependency: an inline function gets a new
 * identity every render, so depending on it restarts the interval every render
 * and on a page re-rendering once a second the interval never survives long
 * enough to fire. Hence the ref + explicit `deps` split (AI Log 154d).
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

    // Fetch once on mount / whenever `deps` change. Runs even when hidden: a
    // page mounting in a background tab (restored session, opened-in-new-tab)
    // should still have data ready by the time it's looked at.
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
