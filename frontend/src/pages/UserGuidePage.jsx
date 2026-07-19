/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { PlayCircle, HelpCircle, UserCheck2, LogIn, Clock, AlertTriangle, ArrowRight, QrCode, PencilLine } from "lucide-react";
import { useLang } from "../lib/i18n.jsx";

/**
 * Screen — User Guide. A friendly onboarding page for anyone new to
 * MusterGo: a placeholder for a future walkthrough video, and a plain-
 * language explanation of the 5-status delegate lifecycle (the one concept
 * every screen in the app builds on, and the thing a first-time user is
 * least likely to intuit on their own — "Late" and "Missing" in particular
 * look similar at a glance but mean very different things and need very
 * different responses).
 */

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
    detail: "This delegate has a coach and is expected to check in when the event starts. Seeing this before departure is completely normal — it just means they haven't scanned in yet.",
    action: "What to do: nothing yet. This is the expected \"waiting to check in\" state.",
    trigger: "manual",
  },
  {
    key: "ARRIVED", tone: "present", icon: LogIn,
    title: "Arrived",
    blurb: "Checked in and accounted for.",
    detail: "This delegate has checked in — by scanning their QR badge, a face scan, or a staff member marking them present by hand. They're with their coach and accounted for.",
    action: "What to do: nothing — this is the goal state for everyone before departure.",
    trigger: "auto",
  },
  {
    key: "LATE", tone: "late", icon: Clock,
    title: "Late",
    blurb: "Past the check-in cutoff, hasn't scanned in yet.",
    detail: "This delegate was Assigned but didn't check in before the trip's cutoff time (set per-trip in Trip settings). This flips automatically — no one has to notice and change it by hand.",
    action: "What to do: they might just be running behind. Try calling them (Attendance page has a one-tap call button for Late delegates) or check with their coach's guide.",
    trigger: "auto",
  },
  {
    key: "MISSING", tone: "missing", icon: AlertTriangle,
    title: "Missing",
    blurb: "A staff member can't currently account for them.",
    detail: "Missing is always set BY HAND by a staff member — never automatically. It's for when a delegate genuinely can't be found: they stepped away (restroom, wandered off) and didn't come back by an expected time.",
    action: "What to do: this needs immediate follow-up. Call them, check their last-known location on the Attendance page, and escalate to the mission lead if they don't turn up.",
    trigger: "manual",
  },
];

export default function UserGuidePage() {
  const { t } = useLang();

  return (
    <div className="page">
      <div className="page-eyebrow">{t("Getting started")}</div>
      <h1 className="page-title">{t("User guide")}</h1>
      <p className="page-sub">{t("New here? This page walks through how MusterGo tracks delegates, in plain language.")}</p>

      {/* ---- Video placeholder ------------------------------------------- */}
      <div className="card" style={{ marginTop: 20, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            position: "relative", width: "100%", aspectRatio: "16 / 9",
            background: "linear-gradient(135deg, var(--surface-2), var(--surface))",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <span style={{
              display: "inline-flex", width: 64, height: 64, borderRadius: "50%",
              background: "var(--scc-red)", color: "#fff", alignItems: "center", justifyContent: "center",
              boxShadow: "var(--shadow-lg)",
            }}>
              <PlayCircle size={30} />
            </span>
            <p style={{ marginTop: 14, fontWeight: 600, fontSize: 15 }}>{t("Walkthrough video — coming soon")}</p>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{t("A short video covering the basics will go here.")}</p>
          </div>
        </div>
        <div style={{ padding: "14px 18px" }}>
          <p className="muted" style={{ fontSize: 12.5 }}>
            {t("In the meantime, the guide below covers the one thing worth understanding before you start: how a delegate's status changes.")}
          </p>
        </div>
      </div>

      {/* ---- Status lifecycle overview ------------------------------------ */}
      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("How delegate status works")}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
          {t("Every delegate is always in exactly one of these 5 states. Most of them change automatically — you'll mostly be reading this, not setting it.")}
        </p>

        {/* Simple flow strip: the "normal" path plus the two branches */}
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
            {t("↳ if a trip's check-in cutoff passes first:")} <b style={{ color: "var(--st-late)" }}>{t("Assigned")} → {t("Late")}</b>
            {"  ·  "}
            {t("↳ if staff can't find them:")} <b style={{ color: "var(--st-missing)" }}>{t("any status")} → {t("Missing")}</b>
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
                  <span className={"badge badge-" + s.tone}>
                    {t(s.title)}
                  </span>
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

      {/* ---- Quick tips ---------------------------------------------------- */}
      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t("Quick tips")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Tip icon={QrCode} title={t("The fastest way to check someone in")}>
            {t("Scan their QR badge on the Check-in screen — this flips them straight to Arrived, no typing needed.")}
          </Tip>
          <Tip icon={PencilLine} title={t("Marking someone Missing always needs a location")}>
            {t("You'll be asked for a last-known location so they can actually be found — this is the one status change that's always deliberate, never automatic.")}
          </Tip>
          <Tip icon={Clock} title={t("Late cutoff times are per-trip")}>
            {t("Each trip has its own check-in cutoff (Trip settings on the Trips board) — a delegate flips to Late automatically once it passes, no one has to do it by hand.")}
          </Tip>
        </div>
      </div>
    </div>
  );
}

function FlowPill({ tone, label }) {
  return (
    <span style={{
      fontSize: 12.5, fontWeight: 700, padding: "5px 12px", borderRadius: 999,
      background: `var(--st-${tone}-bg)`, color: `var(--st-${tone})`, flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function Tip({ icon: Icon, title, children }) {
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
