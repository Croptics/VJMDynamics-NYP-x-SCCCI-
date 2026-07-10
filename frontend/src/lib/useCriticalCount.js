/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging & QR Fallback
 *
 *  Live count of UNRESOLVED CRITICAL exceptions, for the sidebar badge.
 *
 *  Kept in its own file so the only change needed in JQ's Layout.jsx is a
 *  single import + one line, instead of any fetching logic living in her file.
 *
 *  The count refreshes:
 *    - once on mount,
 *    - whenever a ticket is created / resolved / deleted (via the SSE channel),
 *    - and on a slow safety-net poll, in case the stream drops.
 *
 *  Returns 0 (not null) when nothing is critical, so the caller can simply do
 *  `{count ? <badge/> : null}` — a badge should never show a zero.
 * ============================================================================= */

import { useEffect, useState, useCallback } from "react";
import { getCriticalOpenCount, subscribeStream } from "./exceptionsApi.js";

// Safety net only — the SSE stream does the real work.
const POLL_MS = 60000;

export default function useCriticalCount() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setCount(await getCriticalOpenCount());
    } catch {
      // A failed count must never break the shell; leave the last known value.
    }
  }, []);

  useEffect(() => {
    refresh();

    // Any ticket change can move the critical count, so re-read on all of them.
    const unsub = subscribeStream((event) => {
      if (event === "stream:open" || event === "stream:error") return;
      refresh();
    });

    const poll = setInterval(refresh, POLL_MS);
    return () => {
      unsub();
      clearInterval(poll);
    };
  }, [refresh]);

  return count;
}
