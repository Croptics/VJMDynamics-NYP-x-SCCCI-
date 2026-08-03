/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Dashboard shared inline-style constants
 *
 *  Extracted from DashboardPage.jsx (2026-08-02 modularization pass) — used
 *  by DashboardPage.jsx itself and by every small widget in DashboardWidgets.jsx.
 * ============================================================================= */
export const S = {
  dot: { width: 10, height: 10, borderRadius: 999, background: "var(--st-present)", display: "inline-block", flexShrink: 0 },
  /* Header fact chips (2026-07-29) — day / local time / delegate count / the
     live stop. Replaces the single "·"-joined sentence, which forced you to
     read the whole string to find one number. Deliberately quieter than
     .badge (plain border, --ink-2 text) so four of them in a row read as
     metadata, not as four status alerts. */
  metaChip: {
    display: "inline-flex", alignItems: "center", gap: 5,
    fontSize: 12.5, color: "var(--ink-2)",
    padding: "4px 9px", borderRadius: 999,
    border: "1px solid var(--line)", background: "var(--surface-2)",
    whiteSpace: "nowrap", minWidth: 0,
  },
  twoCol: { display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginTop: 20 },
  track: { height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999, transition: "width 0.4s ease" },
  iconBtn: { background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4, borderRadius: 6 },
  overlay: { position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 },
  modal: { width: "min(440px, 100%)", maxHeight: "calc(100vh - 48px)", overflowY: "auto", padding: 24, background: "var(--surface)" },
  iconBadge: { width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
};
