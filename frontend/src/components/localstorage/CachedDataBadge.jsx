/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — offline read cache
 * ============================================================================= */
/**
 * "Cached · Xm ago" banner — the visible half of lib/cachedFetch.js's fallback.
 * Every page using cachedFetch() must render this when `stale` is true, so
 * cached data can never be mistaken for a live view (see that file's header).
 */
import { AlertTriangle } from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";

function agoLabel(iso, t) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return t("just now");
  if (mins < 60) return `${mins}${t("m ago")}`;
  const hrs = Math.round(mins / 60);
  return `${hrs}${t("h ago")}`;
}

export default function CachedDataBadge({ stale, at, style }) {
  const { t } = useLang();
  if (!stale) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600,
        color: "var(--st-late)", background: "var(--st-late-bg)", border: "1px solid var(--st-late)",
        borderRadius: 8, padding: "6px 10px", ...style,
      }}
    >
      <AlertTriangle size={13} style={{ flexShrink: 0 }} />
      {t("Offline — showing cached data from")} {agoLabel(at, t)}
    </div>
  );
}
