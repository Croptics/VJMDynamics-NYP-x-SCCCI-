/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Account control shared inline-style constants
 *
 *  Extracted from AccountControlPage.jsx.
 * ============================================================================= */
export const S = {
  iconBtn: { background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4, borderRadius: 6 },
  overlay: { position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 },
  modal: { width: "min(460px, 100%)", padding: 24, background: "var(--surface)", maxHeight: "90vh", overflowY: "auto" },
  permRow: {
    display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
    padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
  },
  formErr: {
    display: "flex", alignItems: "center", gap: 8, marginTop: 16, padding: "10px 12px",
    background: "var(--st-missing-bg)", color: "var(--st-missing)", borderRadius: "var(--r-sm)",
    fontSize: 13, fontWeight: 600,
  },
};
