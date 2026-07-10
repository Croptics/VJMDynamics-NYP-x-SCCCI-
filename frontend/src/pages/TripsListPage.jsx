// frontend/src/pages/TripsListPage.jsx
// Owner: Desmond — "TransitFlow" — Trip Booking & Dynamic Coach Management
//
// Grid of every trip. Clicking a card navigates to /trips?tripId=<uuid> —
// NOT /trips/<uuid> — because App.jsx (owned by JQ, off-limits) only ever
// routes a bare "/trips" to TripCoachPage.jsx. TripCoachPage.jsx renders THIS
// component itself whenever ?tripId= is absent from the URL.
//
// Data comes from GET /all-trips (Desmond's own endpoint), not GET /trips —
// JQ's GET /api/trips always returns just the single hardcoded Beijing trip.
//
// Styling: TripCoachPage.css (new, scoped under .tf-root — see that file's
// header). tokens.css is not touched; nothing here can leak onto other pages.
//
// This file also owns the shared light/dark theme hook (useTfTheme) used by
// both this page and TripCoachPage.jsx, so the two stay in sync. It's a
// self-contained toggle for just these two pages (localStorage key "tf_theme")
// — it doesn't touch tokens.css or affect any other page in the app.
//
// v3: trip cards now show a real progress indicator (dayOf/totalDays, which
// GET /all-trips added in v3 — see desmond.js) and the empty state got a
// small illustration, per the "operational workspace" redesign brief.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertCircle, Bus, Users, Sparkles, Moon, Sun, Search, MapPin } from "lucide-react";
import { apiGet, apiPost, getPermissions } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";
import "./TripCoachPage.css";

const THEME_KEY = "tf_theme";

/** Shared light/dark toggle for the Trips feature only. Persisted so it stays
 *  put across visits; independent of every other page's (light-only) theme. */
export function useTfTheme() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === "dark"; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !d;
      try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return [dark, toggle];
}

const STATUS_COLOR = {
  "In progress": "green",
  Planning: "blue",
  Completed: "grey",
  Cancelled: "red",
};

function StatusChip({ status }) {
  const { t } = useLang();
  const color = STATUS_COLOR[status] || "grey";
  return (
    <span className="tf-status-chip" style={{ color: `var(--tf-${color})`, background: `var(--tf-${color}-bg)` }}>
      {t(status || "—")}
    </span>
  );
}

/** v3: per-trip progress bar. Only shown for statuses where "progress" is a
 *  meaningful concept — a trip still in Planning hasn't started day 1 yet,
 *  so showing a bar there would imply travel is underway when it isn't. */
function TripProgress({ trip }) {
  const { t } = useLang();
  if (trip.status === "Completed") {
    return (
      <div>
        <div className="tf-trip-progress-track"><div className="tf-trip-progress-fill is-complete" style={{ width: "100%" }} /></div>
        <div className="tf-trip-progress-label">{t("Completed")}</div>
      </div>
    );
  }
  if (trip.status !== "In progress" || !trip.totalDays) return null;
  const pct = Math.round(Math.min(1, Math.max(0, (trip.dayOf || 0) / trip.totalDays)) * 100);
  return (
    <div>
      <div className="tf-trip-progress-track"><div className="tf-trip-progress-fill" style={{ width: `${pct}%` }} /></div>
      <div className="tf-trip-progress-label">{t("Day")} {trip.dayOf} {t("of")} {trip.totalDays}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="tf-card" style={{ margin: 0 }}>
      <div className="tf-skeleton" style={{ height: 18, width: "70%", marginBottom: 10 }} />
      <div className="tf-skeleton" style={{ height: 12, width: "40%", marginBottom: 14 }} />
      <div className="tf-skeleton" style={{ height: 12, width: "90%" }} />
    </div>
  );
}

/** v3: small illustrated empty state (soft gradient badge + bus/map icons)
 *  instead of a bare heading — built entirely from lucide-react icons + CSS
 *  already in this project, so no new dependency or hand-authored SVG. */
function EmptyIllustration() {
  return (
    <div className="tf-empty-illustration">
      <Bus size={38} color="#fff" />
      <span className="tf-empty-deco" style={{ top: -6, right: -8 }}><MapPin size={13} color="var(--tf-purple)" /></span>
      <span className="tf-empty-deco" style={{ bottom: -6, left: -8 }}><Sparkles size={12} color="var(--tf-yellow)" /></span>
    </div>
  );
}

export default function TripsListPage() {
  const navigate = useNavigate();
  const { t } = useLang();
  const [dark, toggleDark] = useTfTheme();
  const [trips, setTrips] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [query, setQuery] = useState("");
  const canEdit = getPermissions().manageTrips; // gate edit controls (see permissions.js)

  const fetchTrips = useCallback(async () => {
    try {
      const data = await apiGet("/all-trips");
      setTrips(data.trips);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => { fetchTrips(); }, [fetchTrips]);

  async function handleSeed() {
    setSeeding(true);
    try {
      await apiPost("/trips/seed", {});
      await fetchTrips();
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setSeeding(false);
    }
  }

  const filteredTrips = useMemo(() => {
    if (!trips) return [];
    const q = query.trim().toLowerCase();
    if (!q) return trips;
    return trips.filter((tr) => tr.name.toLowerCase().includes(q) || (tr.lead || "").toLowerCase().includes(q));
  }, [trips, query]);

  return (
    <div className={`tf-root${dark ? " tf-dark" : ""}`}>
      <div className="tf-page">
        <div className="tf-topbar">
          <div>
            <div className="tf-hero-eyebrow" style={{ color: "var(--tf-text-3)" }}>{t("Trip management")}</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 2 }}>{t("Trips & coaches")}</h1>
          </div>
          <button className="tf-icon-toggle" onClick={toggleDark} title={t(dark ? "Light mode" : "Dark mode")}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        <p className="tf-muted" style={{ fontSize: 14, marginBottom: 20 }}>
          {t("Manage itineraries and reassign delegates between coaches on the fly.")}
        </p>

        {!trips && !loadError && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {loadError && (
          <div className="tf-card" style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--tf-red)" }}>
            <AlertCircle size={20} />
            <span>{t("Couldn't reach the backend")} — {loadError}</span>
          </div>
        )}

        {trips && !loadError && trips.length === 0 && (
          <div className="tf-card" style={{ textAlign: "center", padding: "48px 20px" }}>
            <EmptyIllustration />
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{t("No trips yet")}</h2>
            <p className="tf-muted" style={{ fontSize: 13.5, marginBottom: 16, maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}>
              {canEdit
                ? t("Seed a set of demo trips to explore the board, or wait for the admin team to add one.")
                : t("No trips have been added yet. Please check back later.")}
            </p>
            {canEdit && (
            <button className="tf-btn tf-btn-primary" style={{ margin: "0 auto" }} onClick={handleSeed} disabled={seeding}>
              {seeding ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {t("Seed demo trips")}
            </button>
            )}
          </div>
        )}

        {trips && !loadError && trips.length > 0 && (
          <>
            <div className="tf-search" style={{ maxWidth: 340, marginBottom: 18 }}>
              <Search size={15} color="var(--tf-text-3)" />
              <input placeholder={t("Search trips…")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              {filteredTrips.map((trip) => (
                <button
                  key={trip.id}
                  onClick={() => navigate(`/trips?tripId=${trip.id}`)}
                  className="tf-card"
                  style={{ margin: 0, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10, transition: "transform 0.15s ease, box-shadow 0.15s ease" }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--tf-shadow-md)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "var(--tf-shadow-sm)"; }}
                >
                  <div className="tf-between" style={{ alignItems: "flex-start" }}>
                    <h3 style={{ fontSize: 16.5, fontWeight: 800 }}>{trip.name}</h3>
                    <StatusChip status={trip.status} />
                  </div>

                  {trip.dateRange && <div className="tf-muted" style={{ fontSize: 13 }}>{trip.dateRange}</div>}
                  {trip.lead && <div className="tf-muted" style={{ fontSize: 12 }}>{t("Lead")}: {trip.lead}</div>}

                  <TripProgress trip={trip} />

                  <div className="tf-flex tf-gap-12" style={{ marginTop: 2, fontSize: 13, color: "var(--tf-text-2)" }}>
                    <span className="tf-flex tf-gap-6" style={{ alignItems: "center" }}>
                      <Bus size={14} /> {trip.coachCount} {t("coaches")}
                    </span>
                    <span className="tf-flex tf-gap-6" style={{ alignItems: "center" }}>
                      <Users size={14} /> {trip.delegateCount} {t(trip.delegateCount === 1 ? "delegate" : "delegates")}
                    </span>
                  </div>

                  <span className="tf-flex tf-gap-6" style={{ alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "var(--tf-blue)", marginTop: 2 }}>
                    {t("Open board")} →
                  </span>
                </button>
              ))}
              {filteredTrips.length === 0 && (
                <p className="tf-muted" style={{ fontSize: 13.5, gridColumn: "1 / -1" }}>{t("No trips match your search.")}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
