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
  X, ChevronLeft, ChevronRight, PlayCircle,
} from "lucide-react";
import { apiGet } from "../../../lib/api.js";
import { useLang } from "../../../lib/i18n.jsx";
// Trip id comes from the mobile trip switcher, not a hardcoded base trip
// (JQ, 2026-07-29 — the same fix re-applied to every one of Vimal's mobile
// pages after his FaceCheck-Pro merge; his branch predates getMobileTripId()
// and hardcodes "t-1", which silently pins a multi-trip app to Beijing).
import { getMobileTripId } from "../../../lib/mobileTrip.js";
import { useVisiblePolling } from "../../../lib/useVisiblePolling.js";
const TRIP_ID_FALLBACK = "t-1";

/** Images/videos are JSONB arrays of { url, publicId }; `imageUrl` is the
 *  legacy single-image column kept for older posts. Normalise both, and also
 *  flatten into ONE ordered list (2026-08-04, matching desktop's
 *  AnnouncementCard.mediaOf) — that flat list is what the lightbox steps
 *  through with its arrows, since a post can mix images and videos and
 *  navigation has to cross that boundary in the order shown on the card. */
function mediaOf(a) {
  const imgs = Array.isArray(a.images) ? a.images.filter((i) => i && i.url) : [];
  if (imgs.length === 0 && a.imageUrl) imgs.push({ url: a.imageUrl });
  const vids = Array.isArray(a.videos) ? a.videos.filter((v) => v && v.url) : [];
  return {
    images: imgs,
    videos: vids,
    all: [
      ...imgs.map((img) => ({ kind: "image", url: img.url })),
      ...vids.map((v) => ({ kind: "video", url: v.url })),
    ],
  };
}

// Which itinerary-tagged announcement counts as "current/upcoming" right now
// (2026-08-04 — "for the latest section(red). should meant for current
// upcoming event or latest. but priority is upcoming one."): the "Latest"
// hero used to just be `shown[0]` (newest-posted), which could highlight a
// stale notice about a stop that already passed while a genuinely relevant
// upcoming-stop announcement sat further down. Prefers the nearest stop at
// or after the trip's current day (`dayOf`) — today's remaining stops first
// (by time), then future days in order; today's ALREADY-PASSED stops are
// skipped unless nothing else qualifies. Falls back to newest-posted
// (`list[0]`) when nothing is itinerary-tagged at all, or `dayOf` isn't
// known — the exact previous behaviour, so nothing regresses for a
// trip-wide-only announcement list.
function pickHero(list, dayOf) {
  if (!list.length) return null;
  if (dayOf == null) return list[0];
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (hhmm) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(":").map(Number);
    return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
  };
  const tagged = list
    .filter((a) => a.itineraryDayNumber != null && a.itineraryDayNumber >= dayOf)
    .map((a) => {
      const dayDelta = a.itineraryDayNumber - dayOf;
      const mins = toMinutes(a.itineraryTime);
      return { a, dayDelta, mins, isPastToday: dayDelta === 0 && mins != null && mins < nowMinutes };
    });
  if (!tagged.length) return list[0];
  const notPast = tagged.filter((s) => !s.isPastToday);
  const pool = notPast.length ? notPast : tagged;
  pool.sort((x, y) => {
    if (x.dayDelta !== y.dayDelta) return x.dayDelta - y.dayDelta;
    const xm = x.mins ?? Infinity, ym = y.mins ?? Infinity;
    if (xm !== ym) return xm - ym;
    return new Date(y.a.createdAt) - new Date(x.a.createdAt); // tie-break: newest posted
  });
  return pool[0].a;
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
  const [dayOf, setDayOf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [day, setDay] = useState("all");
  const [expanded, setExpanded] = useState(false); // "show more" for the older ones

  // Lightbox (2026-08-04 — "should also let me click to view more and play
  // video. same as desktop"), same shape as desktop's AnnouncementsPage.jsx.
  const [viewer, setViewer] = useState(null); // { items: [{kind,url}], index }
  const openViewer = (viewerItems, index) => setViewer({ items: viewerItems, index });
  const closeViewer = () => setViewer(null);
  const stepViewer = (delta) => setViewer((v) => {
    if (!v || v.items.length < 2) return v;
    const next = (v.index + delta + v.items.length) % v.items.length;
    return { ...v, index: next };
  });
  const viewerItem = viewer ? viewer.items[viewer.index] : null;

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowRight") stepViewer(1);
      else if (e.key === "ArrowLeft") stepViewer(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await apiGet(`/trips/${getMobileTripId() || TRIP_ID_FALLBACK}/announcements`);
      setItems(res.announcements || []);
      setDayOf(res.dayOf ?? null);
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

  // Hero pick now prioritizes the current/upcoming itinerary stop over just
  // "newest posted" (see pickHero above) — everything else stays newest-
  // first, in the same order the API returned, with the chosen hero pulled
  // out of that list rather than always being index 0.
  const latest = pickHero(shown, dayOf);
  const older = shown.filter((a) => a !== latest);
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
      {latest && <FeatureCard a={latest} t={t} onView={openViewer} />}

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
                {visibleOlder.map((a) => <ItemCard key={a.id} a={a} t={t} onView={openViewer} />)}
              </div>
            </>
          )}
        </>
      )}

      {/* Media lightbox (2026-08-04) — one overlay reused for both images and
          videos, mirroring desktop's AnnouncementsPage.jsx lightbox exactly
          ("should also let me click to view more and play video. same as
          desktop"). */}
      {viewerItem && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "grid", placeItems: "center", padding: 16, zIndex: 90 }}
          onClick={closeViewer}
        >
          <button
            onClick={closeViewer}
            style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.14)", border: "none", borderRadius: "50%", width: 34, height: 34, color: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}
            aria-label={t("Close")}
          >
            <X size={18} />
          </button>

          {viewer.items.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); stepViewer(-1); }}
                aria-label={t("Previous")}
                style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.14)", border: "none", borderRadius: "50%", width: 38, height: 38, color: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); stepViewer(1); }}
                aria-label={t("Next")}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.14)", border: "none", borderRadius: "50%", width: 38, height: 38, color: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}
              >
                <ChevronRight size={20} />
              </button>
              <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999 }}>
                {viewer.index + 1} / {viewer.items.length}
              </div>
            </>
          )}

          {viewerItem.kind === "video" ? (
            <video key={viewerItem.url} src={viewerItem.url} controls autoPlay playsInline style={{ maxWidth: "94vw", maxHeight: "80vh", borderRadius: "var(--r-md)" }} onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={viewerItem.url} alt="" style={{ maxWidth: "94vw", maxHeight: "80vh", borderRadius: "var(--r-md)", objectFit: "contain" }} onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}
    </div>
  );
}

/** The most recent update — brand hero so it can't be missed. */
function FeatureCard({ a, t, onView }) {
  const { images, videos, all } = mediaOf(a);
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
      <Media images={images} videos={videos} all={all} onView={onView} onDark />
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
function ItemCard({ a, t, onView }) {
  const { images, videos, all } = mediaOf(a);
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
      <Media images={images} videos={videos} all={all} onView={onView} />
      {a.itineraryTitle && (
        <div className="muted row" style={{ gap: 5, fontSize: 11.5, marginTop: 8 }}>
          <CalendarDays size={12} /> {a.itineraryTitle}{a.itineraryTime ? ` · ${a.itineraryTime}` : ""}
        </div>
      )}
    </div>
  );
}

/** Images + videos. Horizontally scrollable when there's more than one, so a
 *  photo-heavy post never blows up the page height. Click-to-enlarge (2026-
 *  08-04, "should also let me click to view more and play video. same as
 *  desktop") — a video is now a muted, no-controls thumbnail with a play
 *  badge (matching desktop's AnnouncementCard tiles); tapping it, or a
 *  photo, opens the full-screen lightbox above instead of playing/enlarging
 *  inline. `all`/`onView` are only passed once a parent's mediaOf() has
 *  built the flat list — `onView` stays optional so nothing breaks if any
 *  future caller doesn't wire it up. */
function Media({ images, videos, all, onView, onDark = false }) {
  if (!images.length && !videos.length) return null;
  const single = images.length + videos.length === 1;
  const clickable = typeof onView === "function";
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
          onClick={clickable ? () => onView(all, i) : undefined}
          style={{
            width: single ? "100%" : 180, height: single ? "auto" : 120, maxHeight: single ? 220 : 120,
            objectFit: "cover", borderRadius: "var(--r-sm)", flexShrink: 0, cursor: clickable ? "pointer" : undefined,
            border: onDark ? "1px solid rgba(255,255,255,0.25)" : "1px solid var(--line)",
            background: onDark ? "rgba(255,255,255,0.1)" : "var(--surface-2)",
          }}
        />
      ))}
      {videos.map((v, i) => (
        <div
          key={v.publicId || v.url || i}
          onClick={clickable ? () => onView(all, images.length + i) : undefined}
          style={{
            position: "relative", width: single ? "100%" : 220, height: single ? "auto" : 120, maxHeight: single ? 240 : 120,
            aspectRatio: single ? "16/9" : undefined, borderRadius: "var(--r-sm)", flexShrink: 0, overflow: "hidden",
            background: "#000", cursor: clickable ? "pointer" : undefined,
            border: onDark ? "1px solid rgba(255,255,255,0.25)" : "1px solid var(--line)",
          }}
        >
          <video src={v.url} preload="metadata" muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <PlayCircle size={30} color="#fff" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))" }} />
        </div>
      ))}
    </div>
  );
}
