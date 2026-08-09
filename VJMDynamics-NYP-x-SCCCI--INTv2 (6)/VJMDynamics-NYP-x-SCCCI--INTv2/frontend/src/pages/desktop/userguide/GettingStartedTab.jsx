/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — User Guide's "Getting started" tab
 *
 *  Extracted from UserGuidePage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import {
  HelpCircle, UserCheck2, LogIn, Clock, AlertTriangle, ArrowRight,
  QrCode, PencilLine, LayoutGrid, Siren, Check, Megaphone, BedDouble,
} from "lucide-react";
import { GuideVideoCard } from "./GuideVideoCard.jsx";
import { FlowPill, Tip } from "./FlowChart.jsx";

const STATUSES = [
  {
    key: "UNASSIGNED", tone: "unassigned", icon: HelpCircle,
    title: "Unassigned",
    blurb: "On the list, not yet placed on a coach.",
    detail: "This delegate has been added to the trip but hasn't been put on a coach yet. Nobody's actively tracking them as part of a group.",
    action: "What to do: assign them to a coach before the trip departs — drag them onto a coach on the Trips board, or set it from their profile.",
    trigger: "manual",
  },
  {
    key: "ASSIGNED", tone: "assigned", icon: UserCheck2,
    title: "Assigned",
    blurb: "On a coach, expected to check in soon.",
    detail: "This delegate has a coach and is expected to check in when the next itinerary stop starts. Seeing this before a stop is completely normal — it just means they haven't scanned in for it yet.",
    action: "What to do: nothing yet. This is the expected \"waiting to check in\" state.",
    trigger: "manual",
  },
  {
    key: "ARRIVED", tone: "present", icon: LogIn,
    title: "Arrived",
    blurb: "Checked in and accounted for.",
    detail: "This delegate has checked in — by scanning their QR badge, a face scan, or a staff member marking them present by hand. They're with their coach and accounted for.",
    action: "What to do: nothing — this is the goal state for everyone at each stop.",
    trigger: "auto",
  },
  {
    key: "LATE", tone: "late", icon: Clock,
    title: "Late",
    blurb: "Past a checkpoint's cutoff, hasn't scanned in yet.",
    detail: "This delegate was Assigned but didn't check in before THIS checkpoint's own scheduled time passed. Every itinerary stop is its own cutoff — this flips automatically, no one has to notice and change it by hand.",
    action: "What to do: they might just be running behind. Try calling them (Attendance page has a one-tap call button for Late delegates) or check with their coach's guide. See the \"Checkpoints & Escalations\" tab for exactly how this resets before the next stop.",
    trigger: "auto",
  },
  {
    key: "MISSING", tone: "missing", icon: AlertTriangle,
    title: "Missing",
    blurb: "A staff member can't currently account for them.",
    detail: "Missing is always set BY HAND by a staff member — never automatically. It's for when a delegate genuinely can't be found: they stepped away (restroom, wandered off) and didn't come back by an expected time.",
    action: "What to do: this needs immediate follow-up. Call them, check their last-known location on the Attendance page, and use \"Escalate to office\" to pull in offsite admin help if they don't turn up.",
    trigger: "manual",
  },
];

export function GettingStartedTab({ t }) {
  return (
    <>
      <GuideVideoCard t={t} />

      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("How delegate status works")}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
          {t("Every delegate is always in exactly one of these 5 states. Most of them change automatically — you'll mostly be reading this, not setting it.")}
        </p>

        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8,
          padding: "14px 16px", background: "var(--surface-2)", borderRadius: "var(--r-md)", marginBottom: 20,
        }}>
          <FlowPill tone="unassigned" label={t("Unassigned")} />
          <ArrowRight size={14} color="var(--ink-3)" style={{ flexShrink: 0 }} />
          <FlowPill tone="assigned" label={t("Assigned")} />
          <ArrowRight size={14} color="var(--ink-3)" style={{ flexShrink: 0 }} />
          <FlowPill tone="present" label={t("Arrived")} />
          <div className="muted" style={{ fontSize: 12, width: "100%", marginTop: 6 }}>
            {t("↳ if THIS checkpoint's cutoff passes with no scan:")} <b style={{ color: "var(--st-late)" }}>{t("Assigned")} → {t("Late")}</b>
            {"  ·  "}
            {t("↳ if staff can't find them:")} <b style={{ color: "var(--st-missing)" }}>{t("any status")} → {t("Missing")}</b>
          </div>
          <div className="muted" style={{ fontSize: 12, width: "100%" }}>
            {t("↳ shortly before the NEXT stop starts, Arrived/Late auto-resets to")} <b style={{ color: "var(--st-assigned)" }}>{t("Assigned")}</b>
            {" — "}{t("see the Trips & Checkpoints tab for exactly how.")}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {STATUSES.map((s) => (
            <div key={s.key} className="row" style={{ gap: 14, alignItems: "flex-start", padding: "14px", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
              <span style={{
                width: 38, height: 38, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                background: `var(--st-${s.tone}-bg)`, color: `var(--st-${s.tone})`,
              }}>
                <s.icon size={18} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className={"badge badge-" + s.tone}>{t(s.title)}</span>
                  <span className="muted" style={{ fontSize: 12.5 }}>{t(s.blurb)}</span>
                  <span
                    className="muted"
                    title={s.trigger === "auto" ? t("Can change automatically") : t("Only ever set by a staff member")}
                    style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.03em", marginLeft: "auto", flexShrink: 0 }}
                  >
                    {s.trigger === "auto" ? t("● Automatic") : t("● Manual")}
                  </span>
                </div>
                <p style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>{t(s.detail)}</p>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>{t(s.action)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t("Quick tips")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Tip icon={QrCode} title={t("The fastest way to check someone in")}>
            {t("Scan their QR badge on the Check-in screen — this flips them straight to Arrived, no typing needed.")}
          </Tip>
          <Tip icon={PencilLine} title={t("Marking someone Missing always needs a location")}>
            {t("You'll be asked for a last-known location so they can actually be found — this is the one status change that's always deliberate, never automatic.")}
          </Tip>
          <Tip icon={Clock} title={t("Every itinerary stop is its own cutoff")}>
            {t("There's no single trip-wide check-in time anymore — each scheduled stop (Trips board itinerary) has its own cutoff. A delegate flips to Late automatically once THAT stop's time passes, no one has to do it by hand.")}
          </Tip>
        </div>
      </div>
    </>
  );
}

