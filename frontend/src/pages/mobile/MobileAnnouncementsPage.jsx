// frontend/src/pages/mobile/MobileAnnouncementsPage.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
//
// Mobile Announcements (/mobile/announcements) — trip notices for staff.
//
// READ-ONLY BY DESIGN. Posting/editing/deleting lives on the desktop
// Announcements page and is gated server-side on the `manageAnnouncements`
// permission (see backend/routes/announcements.js); this screen deliberately
// renders no edit affordances at all, so on-ground staff can read updates on
// their phone without any risk of changing them.
//
// Data: GET /api/trips/:id/announcements (auth-only, so any signed-in staff
// member can read). Each row carries title, message, images[], videos[] and —
// when the post is tagged to an itinerary stop — the day number/title/time,
// which is what lets this group by day.

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Megaphone, Clock, RefreshCw, AlertTriangle, ChevronDown, CalendarDays,
} from "lucide-react";
import { apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
// Trip id comes from the mobile trip switcher, not a hardcoded base trip
// (JQ, 2026-07-29 — the same fix re-applied to every one of Vimal's mobile
// pages after his FaceCheck-Pro merge; his branch predates getMobileTripId()
// and hardcodes "t-1", which silently pins a multi-trip app to Beijing).
import { getMobileTripId } from "../../lib/mobileTrip.js";
import { useVisiblePolling } from "../../lib/useVisiblePolling.js";
const TRIP_ID_FALLBACK = "t-1";

/** Images/videos are JSONB arrays of { url, publicId }; `imageUrl` is the
 *  legacy single-image column kept for older posts. Normalise both. */
function mediaOf(a) {
  const imgs = Array.isArray(a.images) ? a.images.filter((i) => i && i.url) : [];
  if (imgs.length === 0 && a.imageUrl) imgs.push({ url: a.imageUrl });
  const vids = Array.isArray(a.videos) ? a.videos.filter((v) => v && v.url) : [];
  return { images: imgs, videos: vids };
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return sameDay ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} · ${time}`;
}

export default function MobileAnnouncementsPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [day, setDay] = useState("all");
  const [expanded, setExpanded] = useState(false); // "show more" for the older ones

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiGet(`/trips/${getMobileTripId() || TRIP_ID_FALLBACK}/announcements`);
      setItems(res.announcements || []);
    } catch (e) {
      setError(e.message || "Could not load announcements.");
    } finally { setLoading(false); }
  }, []);

  // Pauses while the tab/app is backgrounded, catches up on re-show (JQ,
  // 2026-07-29) — see lib/useVisiblePolling.js. Same fix already applied to
  // every other 15s-or-faster mobile poll in the app.
  useVisiblePolling(load, 15000);

  // Day chips come from whatever days actually have posts.
  const days = [...new Set(items.map((a) => a.itineraryDayNumber).filter((d) => d != null))].sort((a, b) => a - b);
  const shown = day === "all"
    ? items
    : day === "none"
      ? items.filter((a) => a.itineraryDayNumber == null)
      : items.filter((a) => a.itineraryDayNumber === day);

  const [latest, ...older] = shown;           // newest first, from the API
  const visibleOlder = expanded ? older : []; // collapsed by default — keeps it tidy

  return (
    <div className="m-fade-in">
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 2 }}>
        <div className="row" style={{ gap: 10, alignItems: "center", minWidth: 0 }}>
          <button
            className="btn btn-ghost" onClick={() => navigate("/mobile")}
            aria-label={t("Back to Home")} style={{ padding: 8, flexShrink: 0 }}
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="m-eyebrow">{t("Trip updates")}</div>
            <h1 style={{ fontSize: 20, margin: "1px 0 0" }}>{t("Announcements")}</h1>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={load} aria-label={t("Refresh")} style={{ padding: 8, flexShrink: 0 }}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {/* Read-only notice — staff can read these, admins post them on desktop. */}
      <p className="muted" style={{ fontSize: 11.5, margin: "8px 2px 0", lineHeight: 1.5 }}>
        {t("Updates from the trip office. View only — posting is done by admins.")}
      </p>

      {error && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)", marginTop: 12 }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 13.5 }}>
            <AlertTriangle size={15} /> {t(error)}
          </div>
        </div>
      )}

      {/* Day filter — mirrors the desktop page's Day tabs. */}
      {days.length > 0 && (
        <div className="m-chip-row" style={{ marginTop: 14 }}>
          <button className={"m-chip" + (day === "all" ? " active" : "")} onClick={() => { setDay("all"); setExpanded(false); }}>
            {t("All")}
          </button>
          {days.map((d) => (
            <button key={d} className={"m-chip" + (day === d ? " active" : "")} onClick={() => { setDay(d); setExpanded(false); }}>
              {t("Day")} {d}
            </button>
          ))}
          {items.some((a) => a.itineraryDayNumber == null) && (
            <button className={"m-chip" + (day === "none" ? " active" : "")} onClick={() => { setDay("none"); setExpanded(false); }}>
              {t("General")}
            </button>
          )}
        </div>
      )}

      {loading && items.length === 0 && <div className="muted" style={{ marginTop: 16 }}>{t("Loading…")}</div>}

      {!loading && shown.length === 0 && !error && (
        <div className="m-empty">
          <span className="m-empty-ic"><Megaphone size={20} /></span>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{t("No announcements")}</div>
          <div style={{ fontSize: 12.5 }}>{t("Trip notices will show up here.")}</div>
        </div>
      )}

      {/* Newest — featured. */}
      {latest && <FeatureCard a={latest} t={t} />}

      {/* Everything older is behind one button, so the page stays tidy. */}
      {older.length > 0 && (
        <>
          {!expanded ? (
            <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setExpanded(true)}>
              <ChevronDown size={16} /> {t("Show")} {older.length} {older.length === 1 ? t("earlier update") : t("earlier updates")}
            </button>
          ) : (
            <>
              <div className="m-section-head" style={{ marginTop: 20 }}>
                <span className="m-eyebrow"><Megaphone size={13} /> {t("Earlier")}</span>
                <button
                  onClick={() => setExpanded(false)}
                  style={{ background: "none", border: "none", padding: 0, color: "var(--scc-red)", fontSize: 12.5, fontWeight: 700 }}
                >
                  {t("Hide")}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {visibleOlder.map((a) => <ItemCard key={a.id} a={a} t={t} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The most recent update — brand hero so it can't be missed. */
function FeatureCard({ a, t }) {
  const { images, videos } = mediaOf(a);
  return (
    <div className="m-hero" style={{ marginTop: 14 }}>
      <div className="m-hero-glow" />
      <div className="row" style={{ gap: 7, position: "relative", flexWrap: "wrap" }}>
        <span className="m-hero-eyebrow" style={{ opacity: 1 }}>{t("Latest")}</span>
        {a.itineraryDayNumber != null && (
          <span className="m-hero-eyebrow" style={{ opacity: 0.85 }}>· {t("Day")} {a.itineraryDayNumber}</span>
        )}
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginTop: 6, position: "relative" }}>
        {a.title}
      </div>
      {a.message && (
        <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "6px 0 0", opacity: 0.95, position: "relative", whiteSpace: "pre-wrap" }}>
          {a.message}
        </p>
      )}
      <Media images={images} videos={videos} onDark />
      <div className="row" style={{ gap: 10, marginTop: 10, fontSize: 12, opacity: 0.9, position: "relative", flexWrap: "wrap" }}>
        <span className="row" style={{ gap: 5 }}><Clock size={12} /> {when(a.createdAt)}</span>
        {a.itineraryTitle && (
          <span className="row" style={{ gap: 5 }}>
            <CalendarDays size={12} /> {a.itineraryTitle}{a.itineraryTime ? ` · ${a.itineraryTime}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/** An older update — plain card. */
function ItemCard({ a, t }) {
  const { images, videos } = mediaOf(a);
  return (
    <div className="mobile-card" style={{ margin: 0 }}>
      <div className="row between" style={{ marginBottom: 4, gap: 8 }}>
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          {a.itineraryDayNumber != null && (
            <span className="badge badge-assigned" style={{ flexShrink: 0 }}>{t("Day")} {a.itineraryDayNumber}</span>
          )}
        </span>
        <span className="mono muted" style={{ fontSize: 11.5, flexShrink: 0 }}>{when(a.createdAt)}</span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{a.title}</div>
      {a.message && (
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4, whiteSpace: "pre-wrap" }}>{a.message}</p>
      )}
      <Media images={images} videos={videos} />
      {a.itineraryTitle && (
        <div className="muted row" style={{ gap: 5, fontSize: 11.5, marginTop: 8 }}>
          <CalendarDays size={12} /> {a.itineraryTitle}{a.itineraryTime ? ` · ${a.itineraryTime}` : ""}
        </div>
      )}
    </div>
  );
}

/** Images + videos. Horizontally scrollable when there's more than one, so a
 *  photo-heavy post never blows up the page height. */
function Media({ images, videos, onDark = false }) {
  if (!images.length && !videos.length) return null;
  const single = images.length + videos.length === 1;
  return (
    <div
      style={{
        display: "flex", gap: 8, marginTop: 10, position: "relative",
        overflowX: single ? "visible" : "auto", paddingBottom: single ? 0 : 4,
      }}
    >
      {images.map((img, i) => (
        <img
          key={img.publicId || img.url || i}
          src={img.url}
          alt=""
          loading="lazy"
          style={{
            width: single ? "100%" : 180, height: single ? "auto" : 120, maxHeight: single ? 220 : 120,
            objectFit: "cover", borderRadius: "var(--r-sm)", flexShrink: 0,
            border: onDark ? "1px solid rgba(255,255,255,0.25)" : "1px solid var(--line)",
            background: onDark ? "rgba(255,255,255,0.1)" : "var(--surface-2)",
          }}
        />
      ))}
      {videos.map((v, i) => (
        <video
          key={v.publicId || v.url || i}
          src={v.url}
          controls
          preload="metadata"
          playsInline
          style={{
            width: single ? "100%" : 220, maxHeight: single ? 240 : 120,
            borderRadius: "var(--r-sm)", flexShrink: 0, background: "#000",
            border: onDark ? "1px solid rgba(255,255,255,0.25)" : "1px solid var(--line)",
          }}
        />
      ))}
    </div>
  );
}
