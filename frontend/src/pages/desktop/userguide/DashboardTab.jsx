/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — User Guide's "Dashboard" tab (+ its 4 sub-tabs)
 *
 *  Extracted from UserGuidePage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import { useState } from "react";
import {
  LogIn, AlertTriangle, PencilLine, LayoutGrid, ShieldCheck, Users, History,
  BarChart3, Bus, FileText, Siren, Check, CircleDot, Megaphone, BedDouble, Search,
} from "lucide-react";
import { SubTabs } from "./SubTabs.jsx";
import { FlowRow, FlowStep, FlowArrow, Tip } from "./FlowChart.jsx";

/* ============================================================================
 * Tab 2 — Dashboard, Announcements & Rooms
 * ========================================================================== */
const DASHBOARD_SUBTABS = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "announcements", label: "Announcements", icon: Megaphone },
  { key: "rooms", label: "Rooms", icon: BedDouble },
  { key: "escalations", label: "Escalations", icon: Siren },
];

export function DashboardTab({ t }) {
  const [sub, setSub] = useState("overview");
  return (
    <>
      <SubTabs items={DASHBOARD_SUBTABS} active={sub} onChange={setSub} t={t} />
      {sub === "overview" && <DashboardOverviewSub t={t} />}
      {sub === "announcements" && <DashboardAnnouncementsSub t={t} />}
      {sub === "rooms" && <DashboardRoomsSub t={t} />}
      {sub === "escalations" && <DashboardEscalationsSub t={t} />}
    </>
  );
}

function DashboardOverviewSub({ t }) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("The main Dashboard")}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {t("Your home base for a live trip — KPI tiles, the full delegate table, coach status, and the history log all live here.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={LayoutGrid} title={t("Delegate tab vs. Analytics tab")}>
          {t("Delegate is the working view — search, filter, sort, add/edit/delete, export. Analytics (if your account can see it) is read-only charts and an AI-generated summary of the trip so far.")}
        </Tip>
        <Tip icon={BarChart3} title={t("The KPI tiles are shortcuts")}>
          {t("Missing, Late, and the Roster breakdown aren't just counters — tap any one to jump straight to the delegate table pre-filtered to that exact status.")}
        </Tip>
        <Tip icon={Bus} title={t("Coach status → Reverse headcount")}>
          {t("The Coach status card shows every coach's boarded/missing count at a glance. Click \"More details\" in its header for a full per-coach breakdown of exactly who's still missing, with their last known location.")}
        </Tip>
        <Tip icon={Users} title={t("All delegates table")}>
          {t("Search by name, filter by status or coach, sort any column, and select rows for a batch delete. Clicking a delegate opens their full profile — phone, email, room, last known location, and checkpoint history.")}
        </Tip>
        <Tip icon={History} title={t("Delegate history log")}>
          {t("Every delegate change is recorded here with who did it and when — most edits can be rolled back with one click if something was changed by mistake. Reach the full log via \"View full log\" in the History tracker card, or its own page under the Delegate tab.")}
        </Tip>
        <Tip icon={FileText} title={t("Exporting a report")}>
          {t("The Export button opens a configurable Excel export — pick which statuses, coaches, and columns to include, optionally include the full per-checkpoint history sheet (on by default) and/or an AI-written summary, and choose English or Chinese for the whole workbook.")}
        </Tip>
      </div>
    </div>
  );
}

function DashboardAnnouncementsSub({ t }) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Trip Announcements")}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {t("Its own page (sidebar → Announcements) for admin-posted critical updates — \"Departure moved to 7am,\" a gate change, etc.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={Megaphone} title={t("Tag to an itinerary stop, or keep it general")}>
          {t("Optionally tag an announcement to a specific itinerary stop and it groups under that stop instead of a flat list; untagged ones show under \"General.\"")}
        </Tip>
        <Tip icon={FileText} title={t("Attach an image")}>
          {t("Add a photo — a gate number, a meeting-point map, whatever helps delegates find the next location — stored alongside the announcement.")}
        </Tip>
        <Tip icon={ShieldCheck} title={t("Who can post")}>
          {t("Anyone signed in can view the Announcements page; only Admin can post or delete.")}
        </Tip>
      </div>
    </div>
  );
}

function DashboardRoomsSub({ t }) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Room Management")}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {t("A dedicated Dashboard tab for assigning hotel + room number across the roster — handy for an end-of-day pass.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={BedDouble} title={t("Set the hotel for everyone at once")}>
          {t("Most trips put the whole group in one hotel — type it once and apply it to every coach-assigned delegate in one click, then only touch the individual rows that are actually different.")}
        </Tip>
        <Tip icon={PencilLine} title={t("Per-delegate exceptions")}>
          {t("Edit any row's hotel or room number inline and Save just that one — the same info also shows on the delegate's own profile.")}
        </Tip>
        <Tip icon={Users} title={t("Only shows coach-assigned delegates")}>
          {t("A delegate isn't shown here until they're assigned to a coach — someone not confirmed on the trip roster yet shouldn't be routed to a hotel room.")}
        </Tip>
        <Tip icon={Search} title={t("Filter and sort for a big roster")}>
          {t("Search by name, filter by coach, and sort by name/coach/room — built for scanning a large group quickly rather than one delegate at a time.")}
        </Tip>
      </div>
    </div>
  );
}

function DashboardEscalationsSub({ t }) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Emergency escalation")}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {t("For when a Missing delegate needs more than a phone call — pull in offsite admin/office help immediately, with one click.")}
      </p>

      <div style={{ padding: "16px", background: "var(--surface-2)", borderRadius: "var(--r-md)", marginBottom: 18 }}>
        <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 12 }}>
          {t("Flowchart — escalation lifecycle")}
        </div>
        <FlowRow>
          <FlowStep tone="missing" icon={Siren} label={t("Escalate to office")} sub={t("staff clicks, picks who to alert")} />
          <FlowArrow label={t("instant")} />
          <FlowStep tone="missing" icon={CircleDot} label={t("Open")} sub={t("banner + chime + email/SMS")} />
        </FlowRow>
        <FlowRow style={{ marginTop: 10 }}>
          <FlowStep tone="missing" icon={CircleDot} label={t("Open")} small />
          <FlowArrow label={t("someone clicks Acknowledge")} />
          <FlowStep tone="late" icon={Check} label={t("Acknowledged")} sub={t("banner clears, stays in Emergency list")} />
        </FlowRow>
        <FlowRow style={{ marginTop: 10 }}>
          <FlowStep tone="late" icon={Check} label={t("Acknowledged")} small />
          <FlowArrow label={t("delegate found — click Resolve")} tone="present" />
          <FlowStep tone="present" icon={LogIn} label={t("Resolved")} sub={t("delegate auto-set to Arrived")} />
        </FlowRow>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={Siren} title={t("One click, not a multi-step modal")}>
          {t("\"Escalate to office\" is available directly from a Missing delegate's profile. Pick who to alert (defaults to the trip's own lead + every admin with an email on file), add a short message, and send — that's it.")}
        </Tip>
        <Tip icon={AlertTriangle} title={t("Duplicate-proof")}>
          {t("If the SAME delegate already has an open escalation, clicking Escalate again doesn't create a second one or re-spam notifications — you'll just see it's already open.")}
        </Tip>
        <Tip icon={Megaphone} title={t("The top banner — Acknowledge all")}>
          {t("Shows on every page (not just Dashboard), with the trip name and a \"View →\" button that jumps straight to that trip + delegate. If many are open at once, \"Acknowledge all\" clears the noisy banner in one click — nothing is lost, they all still show in the Emergency list.")}
        </Tip>
        <Tip icon={ShieldCheck} title={t("Where acknowledged ones go")}>
          {t("Open the bell icon → Alerts → Emergency section. They stay there (reviewable, resolvable) until someone explicitly clicks Resolve — never silently disappear.")}
        </Tip>
      </div>
    </div>
  );
}
