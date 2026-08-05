/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — User Guide's shared sub-tab switcher
 *
 *  Extracted from UserGuidePage.jsx.
 * ============================================================================= */

export function SubTabs({ items, active, onChange, t }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16, marginBottom: 4, paddingLeft: 14, borderLeft: "2px solid var(--line)" }}>
      {items.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600,
            padding: "6px 12px", borderRadius: 999, border: "none", cursor: "pointer",
            background: active === key ? "var(--scc-red-tint)" : "var(--surface-2)",
            color: active === key ? "var(--scc-red)" : "var(--ink-2)",
          }}
        >
          <Icon size={13} /> {t(label)}
        </button>
      ))}
    </div>
  );
}
