/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { useState } from "react";
import { Compass, LayoutGrid, Bus, ShieldCheck } from "lucide-react";
import { useLang } from "../../../lib/i18n.jsx";
// Modularization pass (2026-08-02) — the rest of this page's own tabs/pieces
// already live right here, as siblings.
import { GettingStartedTab } from "./GettingStartedTab.jsx";
import { DashboardTab } from "./DashboardTab.jsx";
import { TripsTab } from "./TripsTab.jsx";
import { AccountsTab } from "./AccountsTab.jsx";

/**
 * Screen — User Guide. Restructured (2026-07-21) from a single scrolling
 * page into a tabbed reference; overhauled again (2026-07-26) to cover what
 * shipped since: the multi-checkpoint per-stop attendance system (replacing
 * the old single trip-wide Late cutoff this guide used to describe — that
 * concept no longer matches how the app actually works), the escalation
 * workflow, Room allocation, and Trip Announcements. Added inline flowchart
 * diagrams (FlowRow/FlowStep, now in userguide/FlowChart.jsx) for the two
 * workflows that are genuinely hard to explain in prose alone: per-checkpoint
 * status, and the escalation lifecycle. See MobileUserGuidePage.jsx for the
 * mobile-specific counterpart.
 */

// Top-level tabs now mirror the REAL sidebar nav (2026-07-26 — "put tab like
// dashboard, trip, scanner etc.") instead of an ad-hoc feature grouping, so
// the guide's structure actually matches the app you're looking at.
// Escalations/Announcements/Rooms all live UNDER Dashboard (as its own
// sub-tab bar) since that's genuinely where they surface from in the app —
// the banner/Alerts modal/Room Management tab are all Dashboard features,
// Announcements is one click from the same nav group. Checkpoints moved
// under Trips instead, since a checkpoint IS an itinerary stop — Desmond's
// Trips board owns the itinerary they're built on. The "Scanner & kiosk" tab
// was removed 2026-08-05 along with the quick scanner and kiosk it documented.
const TABS = [
  { key: "start", label: "Getting started", icon: Compass },
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { key: "trips", label: "Trips & Checkpoints", icon: Bus },
  { key: "accounts", label: "Account & permissions", icon: ShieldCheck },
];

export default function UserGuidePage() {
  const { t } = useLang();
  const [tab, setTab] = useState("start");

  return (
    <div className="page">
      <div className="page-eyebrow">{t("Getting started")}</div>
      <h1 className="page-title">{t("User guide")}</h1>
      <p className="page-sub">{t("New here? Pick a tab below — each one covers a different part of MusterGo, in plain language.")}</p>

      {/* ---- Tab switcher --------------------------------------------------- */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className="btn"
            onClick={() => setTab(key)}
            style={{
              background: tab === key ? "var(--scc-red-tint)" : "transparent",
              color: tab === key ? "var(--scc-red)" : "var(--ink-2)",
              border: `1px solid ${tab === key ? "var(--scc-red-tint-2)" : "var(--line)"}`,
            }}
          >
            <Icon size={15} /> {t(label)}
          </button>
        ))}
      </div>

      {tab === "start" && <GettingStartedTab t={t} />}
      {tab === "dashboard" && <DashboardTab t={t} />}
      {tab === "trips" && <TripsTab t={t} />}
      {tab === "accounts" && <AccountsTab t={t} />}
    </div>
  );
}
