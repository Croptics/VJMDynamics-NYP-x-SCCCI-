/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { useState } from "react";
import {
  PlayCircle, HelpCircle, UserCheck2, LogIn, Clock, AlertTriangle, ArrowRight,
  QrCode, PencilLine, Compass, LayoutGrid, MapPin, ScanFace, ShieldCheck,
  Users, History, BarChart3, Bus, FileText, ScanLine, Mic,
} from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";

/**
 * Screen — User Guide. Restructured (2026-07-21) from a single scrolling
 * page (video placeholder + the 5-status explainer + quick tips) into a
 * tabbed reference covering every major desktop feature — the original
 * content only ever explained the status lifecycle; nothing documented
 * Dashboard, Trips, Scanner, or Account Control at all. See
 * MobileUserGuidePage.jsx for the mobile-specific counterpart (this page
 * still covers desktop only — deliberately not reused there, since a mobile
 * field-staff member's real questions are "where do I find X on my phone,"
 * not "here's how the desktop Trips board's drag-and-drop works").
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

const TABS = [
  { key: "start", label: "Getting started", icon: Compass },
  { key: "dashboard", label: "Dashboard & metrics", icon: LayoutGrid },
  { key: "trips", label: "Live trip & attendance", icon: Bus },
  { key: "scanner", label: "Scanner & kiosk", icon: ScanFace },
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
      {tab === "scanner" && <ScannerTab t={t} />}
      {tab === "accounts" && <AccountsTab t={t} />}
    </div>
  );
}

/* ============================================================================
 * Tab 1 — Getting started: video placeholder + the 5-status lifecycle
 * (unchanged content from the original single-page guide)
 * ========================================================================== */
function GettingStartedTab({ t }) {
  return (
    <>
      <div className="card" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
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
          <Tip icon={Clock} title={t("Late cutoff times are per-trip")}>
            {t("Each trip has its own check-in cutoff (Trip settings on the Trips board) — a delegate flips to Late automatically once it passes, no one has to do it by hand.")}
          </Tip>
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * Tab 2 — Dashboard & metrics
 * ========================================================================== */
function DashboardTab({ t }) {
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
        <Tip icon={BarChart3} title={t("The 4 KPI tiles are shortcuts")}>
          {t("Missing, Late, Present, and Unassigned aren't just counters — tap any one to jump straight to the delegate table pre-filtered to that exact status.")}
        </Tip>
        <Tip icon={Bus} title={t("Coach status → Reverse headcount")}>
          {t("The Coach status card shows every coach's boarded/missing count at a glance. Click \"Reverse headcount\" in its header for a full per-coach breakdown of exactly who's still missing, with their last known location.")}
        </Tip>
        <Tip icon={Users} title={t("All delegates table")}>
          {t("Search by name, filter by status or coach, sort any column, and select rows for a batch delete. The map-pin button next to a Missing delegate opens their last recorded location.")}
        </Tip>
        <Tip icon={History} title={t("History log")}>
          {t("Every delegate change is recorded here with who did it and when — most edits can be rolled back with one click if something was changed by mistake. Reach the full log via \"View full log\" in the History tracker card, or its own page under the Delegate tab.")}
        </Tip>
        <Tip icon={FileText} title={t("Exporting a report")}>
          {t("The Export button opens a configurable Excel export — pick which statuses, coaches, and columns to include, optionally add an AI-written summary, and choose English or Chinese for the whole workbook.")}
        </Tip>
      </div>
    </div>
  );
}

/* ============================================================================
 * Tab 3 — Live trip & attendance
 * ========================================================================== */
function TripsTab({ t }) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Trips, check-in & exceptions")}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {t("Where the actual on-the-ground coordination happens — coach assignment, the itinerary, and issue tracking.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={Bus} title={t("The Trips board")}>
          {t("Drag a delegate card onto a coach to assign them (this sets Assigned, not Arrived — that only happens on an actual check-in). The journey timeline shows today's itinerary with a moving bus marker for where the group currently is.")}
        </Tip>
        <Tip icon={Clock} title={t("Trip settings — the Late cutoff")}>
          {t("Each trip has its own check-in cutoff time, editable from \"Trip settings\" on the Trips board. Past that time, any still-Assigned delegate flips to Late automatically.")}
        </Tip>
        <Tip icon={QrCode} title={t("The Check-in screen")}>
          {t("A phone-frame staff app with Face, QR, and Manual check-in modes side by side, plus a live per-coach reverse headcount. Functionally the same paths as the dedicated Scanner page — this one's laid out for a smaller screen.")}
        </Tip>
        <Tip icon={AlertTriangle} title={t("Raising and resolving exceptions")}>
          {t("The Exceptions inbox tracks tickets (missing person, lost badge, VIP request, etc.) with Critical/Normal/Low priority. A Critical ticket pushes a live alert to every signed-in device instantly — nobody has to be watching the inbox to see it.")}
        </Tip>
        <Tip icon={PencilLine} title={t("Manual attendance override")}>
          {t("When a scan just won't work, mark someone present by hand from the Manual tab. If it was a misclick, the \"Undo\" button right next to their name reverts it back to Assigned — but only right after you mark them, not for an older check-in.")}
        </Tip>
      </div>
    </div>
  );
}

/* ============================================================================
 * Tab 4 — Scanner & kiosk
 * ========================================================================== */
function ScannerTab({ t }) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Scanning delegates in")}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {t("Three different scanner surfaces exist for three different situations — here's when to use which.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={ScanFace} title={t("Face + QR scan (desktop)")}>
          {t("The entrance-kiosk scanner for a laptop at a fixed check-in point. Face and QR modes side by side, with a live boarded/missing tally for whichever coach is selected.")}
        </Tip>
        <Tip icon={ScanLine} title={t("Mobile scanner")}>
          {t("The same Face/QR/Manual scanner, laid out for a phone — reached from within the logged-in mobile app when a staff member wants to scan on the move rather than from a fixed kiosk laptop.")}
        </Tip>
        <Tip icon={ShieldCheck} title={t("The passwordless entrance kiosk")}>
          {t("A shared device (tablet/laptop at a door) can run the kiosk scanner with NO login at all — reached from the Login page's \"Quick Scanner Access\" link. It's tightly locked down: no sidebar, no other pages, and its access token can only ever check delegates in — nothing else in the app is reachable from it.")}
        </Tip>
        <Tip icon={Mic} title={t("Low-light fallback")}>
          {t("If the camera feed gets too dark to reliably read faces, the scanner automatically (or via the \"Simulate low light\" button) switches to an audio passphrase instead — nobody has to fumble with settings mid-event.")}
        </Tip>
      </div>
    </div>
  );
}

/* ============================================================================
 * Tab 5 — Account & permissions
 * ========================================================================== */
function AccountsTab({ t }) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Accounts, roles & permissions")}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {t("Only shown here for reference — most staff never need to touch Account Control themselves.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={ShieldCheck} title={t("Admin vs. Staff — exactly two roles")}>
          {t("Admin bypasses every permission check — full access to everything, always. Staff are limited to exactly what's ticked on their account; nothing is assumed.")}
        </Tip>
        <Tip icon={LayoutGrid} title={t("Feature actions vs. views")}>
          {t("\"Feature actions\" control what an account can CHANGE (add a delegate, edit a trip, resolve a ticket). \"Desktop/Mobile views\" control what pages an account can even SEE — a view can be granted without the matching edit permission, for a read-only look at a page.")}
        </Tip>
        <Tip icon={Users} title={t("Manage accounts is Admin-only")}>
          {t("Only a real Admin can ever create, edit, or delete other accounts — this isn't an option Staff can be individually granted, by design.")}
        </Tip>
        <Tip icon={PencilLine} title={t("Changing your own account")}>
          {t("Editing your own permissions/role takes effect immediately without needing to log in again — the page just refreshes with your new access.")}
        </Tip>
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
