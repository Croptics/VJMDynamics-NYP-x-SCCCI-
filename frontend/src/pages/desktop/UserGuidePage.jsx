/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { useEffect, useState } from "react";
import {
  PlayCircle, HelpCircle, UserCheck2, LogIn, Clock, AlertTriangle, ArrowRight,
  QrCode, PencilLine, Compass, LayoutGrid, ScanFace, ShieldCheck,
  Users, History, BarChart3, Bus, FileText, ScanLine, Mic, Siren, Check, CircleDot,
  Megaphone, BedDouble, RotateCcw, Search, Upload, Trash2,
} from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";
import { apiGet, apiDelete, getPermissions, getToken } from "../../lib/api.js";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

/**
 * Screen — User Guide. Restructured (2026-07-21) from a single scrolling
 * page into a tabbed reference; overhauled again (2026-07-26) to cover what
 * shipped since: the multi-checkpoint per-stop attendance system (replacing
 * the old single trip-wide Late cutoff this guide used to describe — that
 * concept no longer matches how the app actually works), the escalation
 * workflow, Room allocation, and Trip Announcements. Added inline flowchart
 * diagrams (FlowRow/FlowStep below) for the two workflows that are genuinely
 * hard to explain in prose alone: per-checkpoint status, and the escalation
 * lifecycle. See MobileUserGuidePage.jsx for the mobile-specific counterpart.
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

// Top-level tabs now mirror the REAL sidebar nav (2026-07-26 — "put tab like
// dashboard, trip, scanner etc.") instead of an ad-hoc feature grouping, so
// the guide's structure actually matches the app you're looking at. Kept at
// exactly 5. Escalations/Announcements/Rooms all live UNDER Dashboard (as
// its own sub-tab bar) since that's genuinely where they surface from in the
// app — the banner/Alerts modal/Room Management tab are all Dashboard
// features, Announcements is one click from the same nav group. Checkpoints
// moved under Trips instead, since a checkpoint IS an itinerary stop —
// Desmond's Trips board owns the itinerary they're built on.
const TABS = [
  { key: "start", label: "Getting started", icon: Compass },
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { key: "trips", label: "Trips & Checkpoints", icon: Bus },
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

/** Small secondary tab bar — visually distinct (smaller, tinted rail on the
 *  left) from the primary TABS above it, so it reads as "these live UNDER
 *  Dashboard" rather than a second identical row of top-level tabs. */
function SubTabs({ items, active, onChange, t }) {
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

/* ============================================================================
 * Tab 1 — Getting started: video placeholder + the 5-status lifecycle
 * ========================================================================== */
/** Getting Started's walkthrough video slot (2026-07-26). Global, not
 *  per-account — GET /api/guide-video returns whatever an Admin last
 *  uploaded (or null while it's still the "coming soon" placeholder). Only
 *  an Admin (manageAccounts) sees the upload/replace/remove controls; a
 *  Staff account just sees the player once one exists. */
function GuideVideoCard({ t }) {
  const isAdmin = !!getPermissions().manageAccounts;
  const [video, setVideo] = useState(undefined); // undefined = loading, null = none set
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    apiGet("/guide-video").then((r) => setVideo(r.video || null)).catch(() => setVideo(null));
  }
  useEffect(load, []);

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("video", file);
      const res = await fetch(`${API_BASE}/guide-video`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() || ""}` },
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || t("Could not upload the video."));
      }
      load();
    } catch (e2) {
      setError(e2.message || t("Could not upload the video."));
    } finally {
      setUploading(false);
    }
  }

  async function onRemove() {
    if (!window.confirm(t("Remove the walkthrough video? The tab goes back to \"coming soon\" until another one is uploaded."))) return;
    try {
      await apiDelete("/guide-video");
      load();
    } catch {
      /* best-effort — the card just keeps showing the old video if this fails */
    }
  }

  return (
    <div className="card" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
      {video ? (
        <video
          key={video.url}
          src={video.url}
          controls
          style={{ width: "100%", aspectRatio: "16 / 9", display: "block", background: "#000" }}
        />
      ) : (
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
            <p style={{ marginTop: 14, fontWeight: 600, fontSize: 15 }}>
              {t(video === undefined ? "Loading…" : "Walkthrough video — coming soon")}
            </p>
            {video === null && (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{t("A short video covering the basics will go here.")}</p>
            )}
          </div>
        </div>
      )}
      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          {video
            ? t("In the meantime, the guide below covers the one thing worth understanding before you start: how a delegate's status changes.")
            : t("In the meantime, the guide below covers the one thing worth understanding before you start: how a delegate's status changes.")}
        </p>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <label className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px", cursor: uploading ? "default" : "pointer" }}>
              <Upload size={14} /> {uploading ? t("Uploading…") : (video ? t("Replace video") : t("Upload video"))}
              <input type="file" accept="video/*" style={{ display: "none" }} disabled={uploading} onChange={onPick} />
            </label>
            {video && (
              <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px", color: "var(--st-missing)" }} onClick={onRemove}>
                <Trash2 size={14} /> {t("Remove")}
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="muted" style={{ padding: "0 18px 14px", color: "var(--st-missing)", fontSize: 12 }}>{error}</p>}
    </div>
  );
}

function GettingStartedTab({ t }) {
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

/* ============================================================================
 * Tab 2 — Dashboard, Announcements & Rooms
 * ========================================================================== */
const DASHBOARD_SUBTABS = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "announcements", label: "Announcements", icon: Megaphone },
  { key: "rooms", label: "Rooms", icon: BedDouble },
  { key: "escalations", label: "Escalations", icon: Siren },
];

function DashboardTab({ t }) {
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
        <Tip icon={History} title={t("History log")}>
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

/* ============================================================================
 * Tab 3 — Trips & Checkpoints (renamed 2026-07-26 — checkpoints ARE itinerary
 * stops, so they belong with the Trips board rather than off on their own)
 * ========================================================================== */
function TripsTab({ t }) {
  return (
    <>
      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Trips board & itinerary")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Tip icon={Bus} title={t("The Trips board")}>
            {t("Drag a delegate card onto a coach to assign them (this sets Assigned, not Arrived — that only happens on an actual check-in). The journey timeline shows today's itinerary with a moving marker for where the group currently is.")}
          </Tip>
          <Tip icon={QrCode} title={t("The Check-in screen")}>
            {t("A phone-frame staff app with Face, QR, and Manual check-in modes side by side, plus a live per-coach reverse headcount. Functionally the same paths as the dedicated Scanner page — this one's laid out for a smaller screen.")}
          </Tip>
          <Tip icon={PencilLine} title={t("Manual attendance override")}>
            {t("When a scan just won't work, mark someone present by hand from the Manual tab or the Trip board's Attendance modal. Every manual change is also logged to the per-stop history — nothing about it skips the audit trail.")}
          </Tip>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Multi-checkpoint attendance")}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
          {t("Instead of ONE status for the whole day, a delegate gets tracked independently at EVERY scheduled itinerary stop — \"Arrived at Lunch\" and \"Missing at the 4pm Assembly\" can both be true for the same person.")}
        </p>

        <div style={{ padding: "16px", background: "var(--surface-2)", borderRadius: "var(--r-md)", marginBottom: 18 }}>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 12 }}>
            {t("Flowchart — one itinerary stop's lifecycle")}
          </div>
          <FlowRow>
            <FlowStep tone="assigned" icon={UserCheck2} label={t("Assigned")} sub={t("waiting for this stop")} />
            <FlowArrow label={t("scan / manual check-in")} />
            <FlowStep tone="present" icon={LogIn} label={t("Arrived")} sub={t("checked in for THIS stop")} />
          </FlowRow>
          <FlowRow style={{ marginTop: 10 }}>
            <FlowStep tone="assigned" icon={UserCheck2} label={t("Assigned")} sub={t("waiting for this stop")} />
            <FlowArrow label={t("stop's cutoff passes, no scan")} tone="late" />
            <FlowStep tone="late" icon={Clock} label={t("Late")} sub={t("for THIS stop only")} />
          </FlowRow>
          <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
            <FlowStep tone="present" icon={LogIn} label={t("Arrived")} small />
            <span className="muted" style={{ fontSize: 12 }}>{t("or")}</span>
            <FlowStep tone="late" icon={Clock} label={t("Late")} small />
            <ArrowRight size={14} color="var(--ink-3)" />
            <RotateCcw size={14} color="var(--ink-3)" />
            <span className="muted" style={{ fontSize: 12.5 }}>
              {t("resets to")} <b style={{ color: "var(--st-assigned)" }}>{t("Assigned")}</b> {t("within the trip's reset window (default 5 min) before the NEXT stop starts — so they can be freshly scanned in again")}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            {t("Safety rail: a delegate who's already scanned in early for the upcoming stop is never bounced back — only ones with no check-in yet for it get reset.")}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Tip icon={QrCode} title={t("Every scan/edit is per-stop")}>
            {t("Whichever stop is currently \"live\" (based on wall-clock time vs. the itinerary) is what a scan or manual check-in gets recorded against. The Dashboard's \"Now: ...\" chip always shows which one that is.")}
          </Tip>
          <Tip icon={Clock} title={t("Reset window is per-trip, adjustable")}>
            {t("Settings → \"Checkpoint reset window\" lets an admin dial this from 1–120 minutes per trip — shorter for testing, longer (e.g. 30 min) for a real trip.")}
          </Tip>
          <Tip icon={History} title={t("Checkpoint timeline")}>
            {t("A delegate's profile shows their full cross-checkpoint history — every stop, every day, newest first — separate from their single current status shown everywhere else.")}
          </Tip>
        </div>
      </div>
    </>
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
          {t("\"Feature actions\" control what an account can CHANGE (add a delegate, edit a trip, resolve a ticket). \"Desktop/Mobile views\" control what pages an account can even SEE — a view can be granted without the matching edit permission, for a read-only look at a page. Every major page (Dashboard, Trips, Announcements, Documents, Scanner, Exceptions) has its own view toggle.")}
        </Tip>
        <Tip icon={Users} title={t("Manage accounts is Admin-only")}>
          {t("Only a real Admin can ever create, edit, or delete other accounts — this isn't an option Staff can be individually granted, by design.")}
        </Tip>
        <Tip icon={PencilLine} title={t("Changing your own account")}>
          {t("Editing your own profile (name, username, email, phone, photo, password) from Settings takes effect immediately without needing to log in again.")}
        </Tip>
        <Tip icon={BedDouble} title={t("Contact number — why it matters")}>
          {t("An account's own phone number (Settings, or Account Control) is what would let escalation SMS/WhatsApp alerts reach an admin directly — without one on file, that path has nowhere to send to.")}
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

/* ---- Flowchart primitives (2026-07-26) ------------------------------------
 * Small, reusable building blocks for the two "real" flowcharts on the
 * Checkpoints & Escalations tab — a horizontal step + labelled arrow, wraps
 * to a vertical stack on narrow widths so nothing gets clipped. */
function FlowRow({ children, style }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap", ...style }}>
      {children}
    </div>
  );
}

function FlowStep({ tone, icon: Icon, label, sub, small }) {
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

function FlowArrow({ label, tone = "ink-3" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, minWidth: 90 }}>
      <span className="muted" style={{ fontSize: 10.5, textAlign: "center", lineHeight: 1.3, marginBottom: 2 }}>{label}</span>
      <ArrowRight size={16} color={tone === "ink-3" ? "var(--ink-3)" : `var(--st-${tone})`} />
    </div>
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
