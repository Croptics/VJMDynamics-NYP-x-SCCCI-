import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Home, ClipboardList, User, Bus, ScanFace, QrCode } from "lucide-react";
import { getPermissions, getUser, apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useSessionGuard } from "../../lib/useSessionGuard.js";
import MobileChatBubble from "../../components/mchat/MobileChatBubble.jsx";
// Keep SyncStatus: without it the offline write queue still works but goes
// invisible. Do NOT add EscalationBanner here — mobile-intrusive by design,
// it's a desktop/admin-only surface (see Layout.jsx). AI Log 233.
import SyncStatus from "../../components/localstorage/SyncStatus.jsx";
import { getMobileTripId, setMobileTripId } from "../../lib/mobileTrip.js";
import { pickScopedTripId } from "../../lib/tripScope.js";
import { getCriticalOpenCount, subscribeStream } from "../../lib/exception/exceptionsApi.js";
import "../../styles/mobile.css";

// No-op on desktop and iOS Safari (no Vibration API).
const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* unsupported */ } };

// trip.departsIn ("04:53") is a DURATION, not a clock time — render "4h 53m"
// so it can't be misread as 4:53 AM.
function fmtDepartsIn(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
// Live countdown off trip.departureAt (a real absolute instant from getTrip()).
// No ticker needed — the dashboard poll below re-renders often enough for a
// minute-resolution display. Returns null past departure so the chip hides
// instead of counting negative.
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

/**
 * Mobile UI shell — bottom tab-bar layout for /mobile/*. Independent of the
 * desktop Layout/Sidebar; touches no desktop routes or styles.
 *
 * Persistent: mounts ONCE and survives every in-app tab switch, so anything
 * here that needs to react to changing data must poll or listen — a mount-only
 * effect will never re-run (AI Log 242).
 *
 * useSessionGuard() force-logs-out on a token invalidated elsewhere.
 */
export default function MobileLayout({ onLogout }) {
  const { t } = useLang();
  const location = useLocation();

  useSessionGuard(onLogout);
  const perms = getPermissions();

  // Feeds the roster tab's "missing" pill + topbar trip chip. Best-effort: a
  // failed fetch just means no badge, never broken navigation.
  const [missing, setMissing] = useState(0);
  const [trip, setTrip] = useState(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Staff captaining zero coaches has nothing to do on Ops/QR/Face, so those
  // tabs hide. Defaults true so an assigned staff member never sees tabs flash
  // out while the fetch resolves. Admins exempt (they own no coaches either,
  // but it's not a restriction). MusterChat stays — messaging isn't trip-scoped.
  const [hasAnyCoach, setHasAnyCoach] = useState(true);
  // Gates <Outlet> until the trip-scope check below resolves: child pages read
  // getMobileTripId() on mount, so rendering early fetches the WRONG trip.
  const [tripReady, setTripReady] = useState(false);
  // Lets the dashboard poll force an immediate re-check (see its call site).
  const checkTripScopeRef = useRef(null);
  useEffect(() => {
    if (getUser()?.role === "admin") { setTripReady(true); return undefined; }
    let alive = true;

    // getMobileTripId() is a per-DEVICE localStorage value with no account
    // awareness, and the switcher that writes it is admin-only — so a staff
    // device can't self-correct and just keeps the "t-1" (Beijing) default, or
    // whatever another account left cached. This re-points it at the account's
    // real assignment. Runs on an interval, not just mount, so an
    // already-open session catches up to a reassignment without a reload.
    // AI Log 233, 241-244, 250.
    async function checkTripScope() {
      try {
        const data = await apiGet("/my-captain-coaches");
        if (!alive) return;
        // Completing a trip already unassigns its captains; this is a backstop
        // for an unassign that lagged.
        const coaches = (data.coaches || []).filter((c) => c.tripStatus !== "Completed");
        setHasAnyCoach(coaches.length > 0);
        // Decision shared with desktop DashboardPage — see lib/tripScope.js.
        const scopedId = pickScopedTripId(data.coaches);
        if (scopedId && scopedId !== getMobileTripId()) setMobileTripId(scopedId);
      } catch (err) {
        // Network failure is best-effort: keep the cache, retry next tick.
        // But NEVER swallow a programming error again — a bare `catch {}` here
        // hid a missing setMobileTripId import for hours while the app looked
        // perfectly healthy (AI Log 250).
        if (err instanceof ReferenceError || err instanceof TypeError) throw err;
      } finally { if (alive) setTripReady(true); }
    }
    checkTripScopeRef.current = checkTripScope;
    checkTripScope();
    const id = setInterval(checkTripScope, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const restrictToHomeOnly = getUser()?.role !== "admin" && !hasAnyCoach;

  // Open CRITICAL exception count, badged on the Ops tab so a critical ticket
  // raised by anyone reaches every staff device without them opening the inbox.
  // Driven by the SSE stream (instant) with a slow interval purely as a
  // reconnect backstop — deliberately NOT another fast poll (AI Log 251).
  const [criticalOpen, setCriticalOpen] = useState(0);
  useEffect(() => {
    if (!tripReady) return undefined;
    let alive = true;
    const refresh = () => {
      getCriticalOpenCount(getMobileTripId()).then((n) => { if (alive) setCriticalOpen(n || 0); }).catch(() => {});
    };
    refresh();
    const off = subscribeStream((event) => {
      if (event === "stream:open" || event === "stream:error") return;
      refresh();
    });
    const id = setInterval(refresh, 60000);
    return () => { alive = false; clearInterval(id); off?.(); };
  }, [tripReady]);

  useEffect(() => {
    // Waits on tripReady so it can't fire once against the wrong trip.
    if (!tripReady) return undefined;
    let alive = true;
    async function load() {
      try {
        const dash = await apiGet(`/trips/${getMobileTripId()}/dashboard`);
        if (!alive) return;
        setMissing(dash.kpis ? dash.kpis.missing || 0 : 0);
        setTrip(dash.trip || null);
        // The cached trip being Completed is the strongest signal it's stale —
        // re-check now instead of waiting out the 60s interval (AI Log 244).
        if (dash.trip?.status === "Completed") checkTripScopeRef.current?.();
      } catch { /* best-effort — leave badges as-is */ }
    }
    load();
    // 20s, deliberately slow: this feeds ONLY the badge + topbar chip, never
    // page content, and the mounted child page polls the same endpoint itself.
    // Don't speed it up without checking that duplication (AI Log 251).
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [tripReady]);
  // Tabs mirror the /mobile/* route permission gates in App.jsx. Profile stays
  // ungated (account settings, not a feature view). Home is gated on
  // viewMobileHome only — a coach captain needs it as much as an admin does.
  const scannerMode = perms.viewMobileScannerFace ? "face"
     : perms.viewMobileScannerQr ? "qr"
     : perms.viewMobileScannerManual ? "manual"
     : null;
  const tabs = [
    ...(perms.viewMobileHome
      ? [{ to: "/mobile", label: "Home", icon: Home, end: true }] : []),
    ...(!restrictToHomeOnly && scannerMode
      ? [{ to: `/mobile/scan/${scannerMode}`, label: "Scan", icon: ScanFace }] : []),
    ...(!restrictToHomeOnly && perms.viewMobileScannerQr
      ? [{ to: "/mobile/scan/qr", label: "QR", icon: QrCode, primary: true }] : []),
    // Trips + Attendance are ONE destination now (MobileOpsPage composes both).
    // A CRITICAL open exception takes the badge over the missing count — it's
    // the more urgent of the two and needs to be seen without opening the tab.
    // `critical: true` only changes the badge's styling, not the destination.
    ...(!restrictToHomeOnly && (perms.viewMobileAttendance || perms.viewMobileTrips)
      ? [{
          to: "/mobile/operations", label: "Ops", icon: ClipboardList,
          badge: criticalOpen > 0 ? criticalOpen : missing,
          critical: criticalOpen > 0,
        }] : []),
    { to: "/mobile/profile", label: "Me", icon: User },
  ];

  // MUST stay memoised: React Router passes this to every mobile page via
  // useOutletContext(), so an inline object literal here re-renders the whole
  // mounted page on every poll tick of this shell (AI Log 251).
  // criticalOpen is shared down here rather than re-fetched per page — the Ops
  // segment switch badges it too, and this shell already tracks it live.
  const outletContext = useMemo(
    () => ({ onLogout, restrictToHomeOnly, criticalOpen }),
    [onLogout, restrictToHomeOnly, criticalOpen]
  );

  const departsInDisplay = trip
    ? liveDepartsIn(trip.departureAt) ?? (trip.departsIn ? fmtDepartsIn(trip.departsIn) : null)
    : null;
  // Hidden when the account has no trip work (same reason the tabs hide), and
  // blanked on Home where MobileHomePage's hero already shows these 3 facts.
  // On Home it's `visibility: hidden`, NOT unrendered — the div must keep
  // reserving its height or the topbar jumps between tabs (AI Log 243, 245).
  const onHome = location.pathname === "/mobile";
  const tripContext = trip && !restrictToHomeOnly
    ? [
        trip.name,
        trip.dayOf ? `${t("Day")} ${trip.dayOf}${trip.totalDays ? `/${trip.totalDays}` : ""}` : null,
        departsInDisplay ? `${t("dep")} ${departsInDisplay}` : null,
      ].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="mobile-shell">
      <div className="mobile-topbar">
        <div className="row between">
          <span>MusterGo</span>
          {/* Theme + language toggles live on the Profile ("Me") page. */}
          <span
            className="mobile-sync-chip"
            style={{
              background: online ? "var(--st-present-bg)" : "var(--st-missing-bg)",
              color: online ? "var(--st-present)" : "var(--st-missing)",
            }}
            title={online ? t("Synced to cloud") : t("Offline — changes saved locally")}
          >
            <span
              className={"mobile-sync-dot" + (online ? " pulse" : "")}
              style={{ background: online ? "var(--st-present)" : "var(--st-missing)" }}
            />
            {online ? t("Synced") : t("Offline")}
          </span>
        </div>
        {tripContext && (
          <div className="mobile-trip-chip" style={onHome ? { visibility: "hidden" } : undefined}>
            <Bus size={13} style={{ color: "var(--scc-red)", flexShrink: 0 }} />
            <span>{tripContext}</span>
          </div>
        )}
      </div>
      <div className="mobile-page">
        {/* Gated on tripReady — child pages read getMobileTripId() on mount, so
            rendering early would fetch the wrong trip. */}
        {tripReady ? <Outlet context={outletContext} /> : (
          <div className="muted" style={{ padding: "40px 0", textAlign: "center" }}>{t("Loading…")}</div>
        )}
      </div>
      <nav className="mobile-tabbar" aria-label={t("Mobile navigation")}>
        {tabs.map(({ to, label, icon: Icon, end, badge, primary, critical }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => buzz()}
            className={({ isActive }) => "mobile-tab" + (isActive ? " active" : "") + (primary ? " primary" : "")}
          >
            {/* Wrapper so the active highlight hugs the icon+label, not the
                whole flex:1 cell — see .mobile-tab-pill in mobile.css. */}
            <span className="mobile-tab-pill">
              <span className="mobile-tab-icon">
                <Icon size={primary ? 22 : 20} />
                {badge > 0 && (
                  <span
                    className={"mobile-tab-badge" + (critical ? " critical" : "")}
                    title={critical ? t("Critical exception open") : undefined}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              {t(label)}
            </span>
          </NavLink>
        ))}
      </nav>
      {perms.viewMobileChatbot && <MobileChatBubble restrictToHomeOnly={restrictToHomeOnly} />}
      <SyncStatus />
    </div>
  );
}
