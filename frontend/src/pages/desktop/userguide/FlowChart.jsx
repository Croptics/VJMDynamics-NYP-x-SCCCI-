/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — User Guide's inline flowchart primitives
 *
 *  Extracted from UserGuidePage.jsx — shared by GettingStartedTab/DashboardTab/
 *  TripsTab/ScannerTab/AccountsTab.
 * ============================================================================= */
import { ArrowRight } from "lucide-react";

export function FlowPill({ tone, label }) {
  return (
    <span style={{
      fontSize: 12.5, fontWeight: 700, padding: "5px 12px", borderRadius: 999,
      background: `var(--st-${tone}-bg)`, color: `var(--st-${tone})`, flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

/* ---- Flowchart primitives -------------------------------------------------
 * Building blocks for the flowcharts on the Checkpoints & Escalations tab.
 * Wraps to a vertical stack on narrow widths so nothing gets clipped. */
export function FlowRow({ children, style }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap", ...style }}>
      {children}
    </div>
  );
}

export function FlowStep({ tone, icon: Icon, label, sub, small }) {
  return (
    <div
      className="row"
      style={{
        gap: 8, alignItems: "center", padding: small ? "6px 10px" : "8px 12px",
        background: `var(--st-${tone}-bg)`, border: `1px solid var(--st-${tone})`,
        borderRadius: "var(--r-md)", flexShrink: 0,
      }}
    >
      <Icon size={small ? 14 : 16} color={`var(--st-${tone})`} style={{ flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: small ? 12 : 13, fontWeight: 700, color: `var(--st-${tone})` }}>{label}</div>
        {sub && <div className="muted" style={{ fontSize: 11 }}>{sub}</div>}
      </div>
    </div>
  );
}

export function FlowArrow({ label, tone = "ink-3" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, minWidth: 90 }}>
      <span className="muted" style={{ fontSize: 10.5, textAlign: "center", lineHeight: 1.3, marginBottom: 2 }}>{label}</span>
      <ArrowRight size={16} color={tone === "ink-3" ? "var(--ink-3)" : `var(--st-${tone})`} />
    </div>
  );
}

export function Tip({ icon: Icon, title, children }) {
  return (
    <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
      <span style={{
        width: 32, height: 32, borderRadius: "var(--r-sm)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--scc-red-tint)", color: "var(--scc-red)",
      }}>
        <Icon size={16} />
      </span>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
}
