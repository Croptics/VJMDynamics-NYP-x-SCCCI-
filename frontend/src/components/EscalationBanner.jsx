/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Emergency escalations
 * ============================================================================= */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Siren, Check, ArrowRight } from "lucide-react";
import { apiGet, apiPost } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";
import { isAlertSoundMuted } from "../lib/alertSound.js";
// Trip-scoped (2026-07-31 — "if you escalate, it should be only the trip
// within, not other trip can see that") — this used to poll every open
// escalation across every trip regardless of which one was on screen. Same
// "current trip" signal DashboardPage.jsx's own trip switcher writes to.
import { getActiveTripId, ACTIVE_TRIP_EVENT } from "../lib/activeTrip.js";

// Polls for open escalations on every authenticated page (mounted once in
// Layout.jsx) — deliberately more frequent than most of this app's polls
// (2026-07-24 egress-reduction pass slowed those to 8s) because an open
// escalation is rare (empty array, cheap) but time-sensitive when it isn't.
const POLL_MS = 8000;

export default function EscalationBanner() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [open, setOpen] = useState([]);
  const [busy, setBusy] = useState(false);
  const seenIds = useRef(new Set());
  const originalTitle = useRef(document.title);
  const flashRef = useRef(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const tripId = getActiveTripId();
        const qs = tripId ? `?tripId=${encodeURIComponent(tripId)}` : "";
        const r = await apiGet(`/escalations/open${qs}`);
        if (!alive) return;
        const list = r.escalations || [];
        // Chime once per NEW escalation id, not on every poll tick for one
        // already showing — otherwise it'd beep every 8s until acknowledged.
        const freshIds = list.map((e) => e.id).filter((id) => !seenIds.current.has(id));
        if (freshIds.length && !isAlertSoundMuted()) playChime();
        seenIds.current = new Set(list.map((e) => e.id));
        setOpen(list);
      } catch {
        // Non-fatal — banner just stays at whatever it last knew.
      }
    }
    poll();
    const iv = setInterval(poll, POLL_MS);
    // Re-poll immediately on a trip switch (2026-07-31) — otherwise switching
    // trips left a stale escalation from the PREVIOUS trip showing for up to
    // POLL_MS, or hid a real one for the new trip just as long.
    window.addEventListener(ACTIVE_TRIP_EVENT, poll);
    return () => { alive = false; clearInterval(iv); window.removeEventListener(ACTIVE_TRIP_EVENT, poll); };
  }, []);

  // Tab-title flash (Tier 2) — alternates between the real title and an
  // urgent one so an escalation is noticeable even in a background tab.
  // Stops and restores the real title the instant nothing's open anymore.
  useEffect(() => {
    if (open.length === 0) {
      clearInterval(flashRef.current);
      document.title = originalTitle.current;
      return;
    }
    let flashed = false;
    flashRef.current = setInterval(() => {
      document.title = flashed ? originalTitle.current : `🚨 ${t("Escalation")} — ${open.length}`;
      flashed = !flashed;
    }, 1000);
    return () => clearInterval(flashRef.current);
  }, [open.length, t]);

  // Acknowledges EVERY currently open escalation in one click (2026-07-25)
  // — "if there are 50 escalations, I have to click 50 times" was the exact
  // complaint. Nothing is lost: every one of these still shows up in the
  // Alerts modal's Emergency section (acknowledged escalations stay listed
  // there until explicitly Resolved) — this just clears the noisy banner.
  async function acknowledgeAll() {
    setBusy(true);
    try {
      await apiPost("/escalations/acknowledge-all", {});
      setOpen([]);
    } catch {
      // Leave it showing — next poll will reconcile either way.
    } finally {
      setBusy(false);
    }
  }

  if (open.length === 0) return null;
  const [first, ...rest] = open;

  // Jump to the escalated delegate's OWN trip and open the Alerts modal's
  // full Emergency list (2026-07-26 — "can the view button link to alert
  // page instead, cause i can only see 1 delegate only"). Used to deep-link
  // straight to just the FIRST delegate's profile, which hid however many
  // others ("+N more") were also open — the Alerts modal already shows every
  // active escalation for the trip with Acknowledge/Resolve right there.
  // Reads back out in DashboardPage.jsx (?tripId=/?openAlerts= → select that
  // trip, then setAlertsOpen(true)).
  function viewFirst() {
    if (!first.tripId) return;
    const params = new URLSearchParams({ tripId: first.tripId, openAlerts: "1" });
    navigate(`/dashboard?${params.toString()}`);
  }

  return (
    <div
      style={{
        // z-index 20 — deliberately BELOW the collapsible sidebar drawer
        // (z-index 50) and its backdrop (40, see tokens.css's
        // @media(max-width:1024px) block) so the drawer correctly covers
        // this banner when open, instead of floating on top of it
        // (2026-07-24 bug — was 100, higher than the sidebar it should sit
        // under at narrow widths).
        position: "sticky", top: 0, zIndex: 20,
        background: "var(--st-missing)", color: "#fff",
        padding: "10px 16px", display: "flex", alignItems: "center", gap: 12,
        boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
      }}
    >
      <Siren size={18} style={{ flexShrink: 0 }} />
      <div
        onClick={first.tripId ? viewFirst : undefined}
        style={{ flex: 1, minWidth: 0, fontSize: 13.5, cursor: first.tripId ? "pointer" : "default" }}
        title={first.tripId ? t("Click to view all escalations for this trip") : undefined}
      >
        <strong>{t("Escalation")}</strong>
        {first.delegateName ? ` — ${first.delegateName}` : ""}
        {first.message ? `: ${first.message}` : ""}
        {first.createdBy ? ` (${t("by")} ${first.createdBy})` : ""}
        {/* Which trip this is for — without this, an escalation seen while
            viewing a DIFFERENT trip's dashboard gave no way to tell where it
            actually belonged (2026-07-25). */}
        {first.tripName && <span style={{ opacity: 0.85 }}> · {first.tripName}</span>}
        {rest.length > 0 && <span style={{ opacity: 0.85 }}> · +{rest.length} {t("more")}</span>}
      </div>
      {first.tripId && (
        <button
          onClick={viewFirst}
          style={{
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.35)", color: "#fff",
            borderRadius: "var(--r-sm)", padding: "5px 10px", fontSize: 12.5, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 5, cursor: "pointer", flexShrink: 0,
          }}
        >
          {t("View")} <ArrowRight size={13} />
        </button>
      )}
      <button
        onClick={acknowledgeAll}
        disabled={busy}
        style={{
          background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.4)", color: "#fff",
          borderRadius: "var(--r-sm)", padding: "5px 12px", fontSize: 12.5, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0,
        }}
      >
        <Check size={14} /> {open.length > 1 ? t("Acknowledge all") : t("Acknowledge")}
      </button>
    </div>
  );
}

// Short, unmistakable beep via the Web Audio API — no audio file to ship,
// works the instant this loads. Best-effort: browsers that block autoplay
// audio without a prior user gesture just silently skip it.
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Web Audio unavailable/blocked — silent no-op.
  }
}
