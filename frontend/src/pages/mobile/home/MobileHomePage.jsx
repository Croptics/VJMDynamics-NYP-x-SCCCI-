/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — mobile Home tab
 * ============================================================================= */
import { useEffect, useState, useRef } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { RefreshCw, AlertTriangle, ChevronRight, Clock, Bus, Megaphone, Mail, ChevronDown } from "lucide-react";
import { apiGet, getUser, getPermissions } from "../../../lib/api.js";
import { useLang } from "../../../lib/i18n.jsx";
import { getTrips } from "../../../lib/document/claudeParse.js";

// Trip id comes from the mobile trip switcher, never a hardcoded trip. This
// page is the only renderer of the switcher (admin-only, in the red hero);
// every other mobile page picks the choice up for free by reading
// getMobileTripId().
import { getMobileTripId, setMobileTripId } from "../../../lib/mobileTrip.js";
import { setMobileCoachId } from "../../../lib/mobileCoach.js";
import LogExceptionModal from "../../../components/exception/LogExceptionModal.jsx";
import "../../../styles/ExceptionInboxPage.css"; // required for LogExceptionModal's .exc-modal sheet styles
const TRIP_ID_FALLBACK = "t-1";

// trip.departsIn ("04:53") is a COUNTDOWN duration, not a clock time — must
// not go through a 12h clock formatter, which would print "4:53 AM".
function fmtDepartsIn(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
// Live countdown. trip.departureAt is a real absolute instant computed
// server-side (getTrip(), db/dashboard.js). Computed at render time, not
// stored in state — piggybacks on the nowClock 15s re-render tick. Returns
// null past departure so the pill disappears instead of going negative.
function liveDepartsIn(departureAtIso) {
  if (!departureAtIso) return null;
  const diffMs = new Date(departureAtIso).getTime() - Date.now();
  if (!(diffMs > 0)) return null;
  const totalMin = Math.round(diffMs / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** "Good morning" / "Good afternoon" / "Good evening", by local hour. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Mobile Home — same live summary as the desktop Dashboard
 * (GET /api/trips/:id/dashboard), condensed for a phone: greeting header,
 * live Active Trip hero, quick actions, and a Coach status card. Total
 * delegates is a text line, not a tile, so the tile row stays actionable.
 * Coach rows and KPI tiles are shortcuts into Attendance pre-filtered to a
 * status. Issues/Exceptions live on their own routes, not inline here.
 */
export default function MobileHomePage() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  // Staff account captaining zero coaches: hides the hero, Coach status and
  // total-delegates line. Same flag MobileLayout.jsx computes for the
  // Ops/QR/Face tabs, threaded down via Outlet context instead of re-fetching
  // /my-captain-coaches here.
  const { restrictToHomeOnly } = useOutletContext() || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const isAdmin = getUser()?.role === "admin";
  // Gates the Exceptions quick action below on the same permission the
  // /mobile/exceptions route uses, so the tile never offers something the
  // account can't actually do.
  const perms = getPermissions();
  // "Log exception" opens LogExceptionModal right here rather than navigating —
  // logging an issue is a 10-second interruption mid-muster, so it shouldn't
  // cost you your place on Home.
  const [logOpen, setLogOpen] = useState(false);
  const [logToast, setLogToast] = useState("");
  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState(() => getMobileTripId() || TRIP_ID_FALLBACK);
  const [tripMenuOpen, setTripMenuOpen] = useState(false);
  const tripMenuRef = useRef(null);
  useEffect(() => {
    if (!tripMenuOpen) return;
    const onDocClick = (e) => { if (tripMenuRef.current && !tripMenuRef.current.contains(e.target)) setTripMenuOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [tripMenuOpen]);
  useEffect(() => {
    if (!isAdmin) return; // only admins get the switcher; nothing to fetch otherwise
    getTrips().then((list) => {
      setTrips(list);
      // /all-trips returns real uuids, never the legacy "t-1" short id this
      // page defaults to, so the persisted id may not be in the list. Same
      // correction as the desktop assistant's switcher
      // (AssistantConversation.jsx).
      //
      // MUST call setMobileTripId() as well as setTripId(): every other mobile
      // page reads getMobileTripId() from localStorage, not this state, so
      // correcting only local state leaves Home right and every other screen
      // stuck on the stale trip until a manual re-switch.
      if (list.length && !list.some((tr) => tr.id === tripId)) {
        const seed = list.find((tr) => (tr.name || "").toLowerCase().includes("beijing"));
        const correctedId = seed?.id || list[0].id;
        setTripId(correctedId);
        setMobileTripId(correctedId);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function switchTrip(id) {
    if (id === tripId) return;
    setTripId(id);
    setMobileTripId(id);
  }

  // Live wall clock for the hero. Do NOT use `trip.localTime` — it's a frozen
  // hardcoded seed string (backend/db/constants.js). Ticks every 15s, not 1s:
  // the display is HH:MM, so per-second would re-render 60x/min for nothing.
  // hour12 forced explicitly; locale-driven, this rendered as 24h.
  const [nowClock, setNowClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })
  );
  useEffect(() => {
    const id = setInterval(
      () => setNowClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })),
      15000
    );
    return () => clearInterval(id);
  }, []);

  // Guards against overlapping polls (a slow response still in flight when
  // the next tick fires) — same pattern as the desktop Dashboard.
  const loadingRef = useRef(false);

  useEffect(() => {
    load();
    // Auto-refresh so another staff member's change shows up without a manual
    // Refresh tap. Keep the interval at 6s, not lower: /trips/:id/dashboard is
    // the app's most expensive aggregate read, MobileLayout polls the SAME
    // endpoint alongside this (doubling the cost), and this page doesn't use
    // useVisiblePolling so it runs flat-out even backgrounded.
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
    // Re-runs on tripId change (admin switches trip) so the very next tick
    // fetches the NEW trip immediately instead of waiting for the interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  async function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      // MUST re-read getMobileTripId() FRESH on every poll tick — never cache
      // it in state at mount (AI Log 248). MobileLayout's trip-scope
      // auto-correct (checkTripScope) writes the corrected id straight to
      // localStorage and this page gets no notification; the re-sync effect
      // above is admin-only, so a staff account would otherwise keep fetching
      // whatever was cached at mount. Also write it back into state so
      // everything else on this page reading `tripId` stays correct.
      const liveTripId = getMobileTripId() || TRIP_ID_FALLBACK;
      if (liveTripId !== tripId) setTripId(liveTripId);
      setData(await apiGet(`/trips/${liveTripId}/dashboard`));
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  const trip = data?.trip;
  const k = data?.kpis;
  const staffName = getUser()?.name || getUser()?.staffId || t("Staff");
  const goToAttendance = (status, coachId) => {
    // Remember the coach so the QR / Face / Manual scanners open on it too —
    // they used to auto-pick "first coach with people" independently, so Home →
    // Coach 2 → QR left you scanning into Coach 1 (AI Log 259).
    if (coachId) setMobileCoachId(coachId);
    navigate(`/mobile/operations?status=${status}` + (coachId ? `&coach=${coachId}` : ""));
  };

  return (
    <div className="m-fade-in">
      {/* Greeting header */}
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 13 }}>{t(greeting())}</div>
          <h1 className="m-page-title">{staffName}</h1>
          {/* Don't re-add an "Online · synced" badge here — MobileLayout's
              topbar chip is the real, wired connectivity indicator. */}
          {k && !restrictToHomeOnly && (
            <div style={{ marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>{t("Total delegates")}: {k.total}</span>
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={load} aria-label={t("Refresh")} style={{ padding: 8, flexShrink: 0 }}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)", marginTop: 16 }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 14 }}>
            <AlertTriangle size={16} /> {t("Couldn't reach the backend")}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t(error)}</p>
        </div>
      )}

      {loading && !data && <div className="muted" style={{ marginTop: 16 }}>{t("Loading…")}</div>}

      {/* Active trip — signature red hero. */}
      {trip && !restrictToHomeOnly && (
        <div style={{ marginTop: 18, position: "relative" }}>
        <div className="m-hero" style={{ position: "relative" }}>
          <div className="m-hero-glow" />
          <div className="m-hero-eyebrow">{t("Active trip")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, marginTop: 4, position: "relative" }}>
            {trip.name}{trip.countryTo ? ` (${trip.countryTo})` : ""}
          </div>
          {/* Shows the REAL clock (`nowClock`), ticking — not `trip.localTime`,
              which was a frozen seed value (see the state comment above). Says
              plainly "current time", not "local", for the same reason as the
              desktop fix: `trips` has no timezone column, so there's nothing to
              convert against — this is the viewer's own device clock. */}
          <div style={{ opacity: 0.9, fontSize: 13, marginTop: 2, position: "relative" }}>
            {lang === "zh"
              ? `第 ${trip.dayOf}/${trip.totalDays} 天 · 当前时间 ${nowClock}`
              : `Day ${trip.dayOf} of ${trip.totalDays} · ${nowClock} now`}
          </div>
          {(() => {
            const live = liveDepartsIn(trip.departureAt);
            const d = live ?? (trip.departsIn ? fmtDepartsIn(trip.departsIn) : null);
            // 2026-07-30 — "say departure back to [country] in [x] hour":
            // names WHERE the delegation is heading back to (trip.countryFrom
            // — editable per trip, defaults to Singapore) instead of a bare
            // duration with no destination context.
            return d ? (
              <span className="m-hero-pill" style={{ marginTop: 12 }}>
                <Clock size={13} /> {t("Departure back to")} {trip.countryFrom || "Singapore"} {t("in")} {d}
              </span>
            ) : null;
          })()}
        </div>
        {/* Trip switcher (2026-07-31, "as admin, i should be able to switch
            trip on mobile ... add it in the red box") — admin-only, and only
            shown once there's more than one trip to pick from. Every other
            mobile page already reads getMobileTripId(), so switching here is
            enough to re-scope the whole app — no other page needed changes.
            An icon-only button (2026-07-31, "improve the switcher ... remove
            the text") — a native <select> squeezed into the hero's corner had
            no room for a real trip name ("Yunnan Cross-Bo", arrow
            overlapping). A menu below the button shows every name in full
            instead.
            MOVED OUT of .m-hero (2026-07-31, "make the dropdown visible
            outside of the box") — .m-hero has `overflow: hidden` (needed to
            clip its own corner-glow radial gradient to the card's rounded
            corners), which was ALSO clipping this dropdown's lower items the
            instant the menu grew taller than the hero card itself — with 3+
            trips, anything past the first item or two was invisibly cut off,
            not actually missing. Now a sibling of .m-hero inside a shared
            `position: relative` wrapper, positioned identically (top-right)
            but no longer inside anything with `overflow: hidden`. */}
        {isAdmin && trips.length > 1 && (
          <div style={{ position: "absolute", top: 14, right: 14, zIndex: 2 }} ref={tripMenuRef}>
            <button
              onClick={() => setTripMenuOpen((v) => !v)}
              aria-label={t("Switch trip")}
              title={t("Switch trip")}
              style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.2)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <ChevronDown size={15} style={{ transform: tripMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
            </button>
            {tripMenuOpen && (
              <div className="card" style={{ position: "absolute", top: 36, right: 0, minWidth: 200, maxHeight: 260, overflowY: "auto", padding: 6, zIndex: 3, boxShadow: "0 12px 32px rgba(0,0,0,0.25)" }}>
                {trips.map((tr) => (
                  <button
                    key={tr.id}
                    onClick={() => { switchTrip(tr.id); setTripMenuOpen(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none",
                      background: tr.id === tripId ? "var(--scc-red-tint)" : "transparent",
                      color: tr.id === tripId ? "var(--scc-red)" : "var(--ink)",
                      fontSize: 13, fontWeight: tr.id === tripId ? 700 : 500, cursor: "pointer",
                    }}
                  >
                    {tr.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
      )}

      {/* Quick actions — the at-a-glance KPI numbers live on the Ops page, so
          Home stays focused on the trip hero, jump-ins, and coach status. */}
      <div className="m-section">
        <div className="m-section-head"><span className="m-eyebrow">{t("Quick actions")}</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="m-tile" onClick={() => navigate("/mobile/announcements")}>
            <span className="m-tile-ic"><Megaphone size={18} /></span>
            <div className="m-tile-body">
              <div className="m-tile-title">{t("Announcements")}</div>
              <div className="m-tile-sub">{t("Trip updates for staff")}</div>
            </div>
            <ChevronRight size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          </button>
          <button className="m-tile" onClick={() => navigate("/mobile/enrolment")}>
            <span className="m-tile-ic"><Mail size={18} /></span>
            <div className="m-tile-body">
              <div className="m-tile-title">{t("Enrolment invites")}</div>
              <div className="m-tile-sub">{t("Email delegates their enrol link")}</div>
            </div>
            <ChevronRight size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          </button>
          {/* Exceptions. History: TWO tiles ("Report an issue" + "Exception
              inbox") were removed 2026-07-30 ("remove these 2 button ya") as
              duplicate entry points once Exceptions became a segment in the Ops
              tab. Re-added 2026-08-04 by request — deliberately as ONE tile, not
              two, since the duplication was the original objection. Scoping is
              automatic: MobileExceptionsPage reads getMobileTripId() for both
              its list and the tripId it hands LogExceptionModal, so a ticket
              logged here is always filed against the trip on screen.
              Gated on viewMobileIssues to match the /mobile/exceptions route. */}
          {perms.viewMobileIssues && (
            <button className="m-tile" onClick={() => setLogOpen(true)}>
              <span className="m-tile-ic"><AlertTriangle size={18} /></span>
              <div className="m-tile-body">
                <div className="m-tile-title">{t("Log exception")}</div>
                <div className="m-tile-sub">{t("Report an on-site issue for this trip")}</div>
              </div>
              <ChevronRight size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
            </button>
          )}
        </div>
      </div>

      {/* Coach status — header links to all-missing; each row jumps to that
          coach's roster. Hidden for a staff account with no coach at all
          (2026-08-03) — nothing here would apply to them anyway. */}
      {data?.coaches && !restrictToHomeOnly && (
        <div className="m-section">
          <div className="m-section-head">
            <span className="m-eyebrow">{t("Coach status")}</span>
            <button
              onClick={() => goToAttendance("ALL")}
              className="row" style={{ gap: 3, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--scc-red)", fontSize: 12.5, fontWeight: 700 }}
            >
              {t("See all")} <ChevronRight size={14} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.coaches.map((c) => {
              const missing = c.missing || 0;
              const late = c.late || 0;
              const attn = missing + late;
              // Two bugs fixed here (2026-07-29 — "why when i click coach 1 it
              // show me this filter instead of just one delegate who is
              // missing / i think the coach status for this mobile page not
              // updated"):
              //
              // 1. The tap hardcoded status "ALL", so a row reading "1 missing"
              //    opened that coach's ENTIRE roster with no status filter —
              //    all 5 delegates, leaving you to find the one that needed
              //    attention yourself. It now opens the status the badge is
              //    actually reporting.
              // 2. The badge counted missing + late but LABELLED it all
              //    "missing" — `late` is its own separate count from the
              //    backend (see the coach rows in db/dashboard.js), so a coach
              //    with 0 missing and 2 late read as "2 missing", which is
              //    simply untrue and sends staff looking for the wrong people.
              //    Each is now named, and both show when both exist.
              const focus = missing > 0 ? "MISSING" : late > 0 ? "LATE" : "ALL";
              // "Arrived" was reachable with missing=0 AND late=0 alone
              // (2026-07-30 — "it should not show this arrived until every
              // delegate is arrived... same for mobile"): those two backend
              // counts don't cover plain ASSIGNED — a delegate simply not
              // scanned yet, not late enough to be flagged LATE. A coach of
              // 5 people all still "Assigned" showed missing=0/late=0 and
              // read as fully arrived. `toBoard` (total - boarded) is the
              // same "still needs to board" figure the desktop Coach status
              // card already uses — "Arrived" now requires that to be 0 too.
              const toBoard = Math.max(0, (c.total || 0) - (c.boarded || 0));
              // A coach with NOBODY assigned is empty, not "Arrived" — green
              // there claims a headcount that never happened. Grey "Empty",
              // matching what the desktop Trips board already shows for this
              // (2026-08-04). Checked FIRST: with total=0 every other count is
              // also 0, so it would otherwise fall through to "Arrived".
              const empty = (c.total || 0) === 0;
              const label = empty ? t("Empty")
                : missing && late
                ? `${missing} ${t("missing")} · ${late} ${t("late")}`
                : missing ? `${missing} ${t("missing")}`
                : late ? `${late} ${t("late")}`
                : toBoard ? `${toBoard} ${t("to board")}`
                : t("Arrived");
              const tone = empty ? "unassigned"
                : missing > 0 ? "missing" : late > 0 ? "late" : toBoard ? "assigned" : "present";
              return (
                <button
                  key={c.id}
                  className="m-row"
                  onClick={() => goToAttendance(focus, c.id)}
                  // Says what the tap will do — with both counts present it
                  // opens the missing ones first, which isn't guessable.
                  title={attn > 0 ? `${t("Show")} ${t(focus === "MISSING" ? "missing" : "late")} — ${[c.name, c.city].filter(Boolean).join(" · ")}` : undefined}
                >
                  <span className="avatar" style={{ background: `var(--st-${tone}-bg)`, color: `var(--st-${tone})` }}>
                    <Bus size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[c.name, c.city].filter(Boolean).join(" · ")}
                  </span>
                  <span className={`badge badge-${tone}`}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Log exception — same modal the Ops tab and desktop inbox use, so the
          ticket shape/validation stays in one place. tripId is read fresh at
          open time (not from this page's `tripId` state) so it's filed against
          whatever trip the app is actually scoped to. */}
      {logOpen && (
        <LogExceptionModal
          tripId={getMobileTripId() || TRIP_ID_FALLBACK}
          onClose={() => setLogOpen(false)}
          onCreated={(_tk, wasCritical) => {
            setLogOpen(false);
            setLogToast(wasCritical ? t("Critical alert pushed to all staff devices") : t("Exception logged"));
            setTimeout(() => setLogToast(""), 2800);
            load(); // a new MISSING ticket can change the headcount shown above
          }}
        />
      )}

      {logToast && (
        <div style={{
          position: "fixed", left: "50%", transform: "translateX(-50%)",
          bottom: "calc(104px + env(safe-area-inset-bottom, 0px))", zIndex: 80,
          background: "var(--ink)", color: "var(--surface)", padding: "10px 16px",
          borderRadius: 999, fontSize: 13, fontWeight: 500, maxWidth: "90vw", textAlign: "center",
        }}>
          {logToast}
        </div>
      )}
    </div>
  );
}
