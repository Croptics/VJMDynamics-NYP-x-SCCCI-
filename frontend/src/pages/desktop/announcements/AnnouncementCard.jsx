/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Trip Announcements card + detail modal
 *
 *  Extracted from AnnouncementsPage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import { useRef } from "react";
import { Megaphone, Pencil, PlayCircle, Trash2, X } from "lucide-react";

/** `images` (2026-07-27) is the new multi-photo array; `imageUrl` is the legacy
 *  single-photo column from before that feature — only ever populated on
 *  announcements posted before this update, so it's the fallback when `images`
 *  is empty rather than something new posts write to.
 *
 *  Also flattens photos + videos into ONE ordered list (2026-07-29), which is
 *  what the lightbox steps through with its arrows — a post can hold both, and
 *  navigation has to cross that boundary in the order shown on the card. */
export function mediaOf(a) {
  const images = a.images && a.images.length ? a.images : (a.imageUrl ? [{ url: a.imageUrl, publicId: null }] : []);
  const videos = a.videos || [];
  return {
    images,
    videos,
    all: [
      ...images.map((img) => ({ kind: "image", url: img.url })),
      ...videos.map((v) => ({ kind: "video", url: v.url })),
    ],
  };
}

export function AnnouncementCard({ a, canManage, onDelete, onEdit, onView, onOpen, t }) {
  const { images, videos, all } = mediaOf(a);
  return (
    // The whole card opens the detail view (2026-07-29). Every control inside
    // it — edit, delete, and each media thumbnail — stops propagation so it
    // keeps doing its own job instead of also opening the detail modal behind
    // itself. Keyboard-reachable too: a card is real content, not decoration,
    // so it takes focus and responds to Enter/Space like a button would.
    <div
      className="card"
      style={{ padding: 14, borderLeft: "3px solid var(--scc-red)", cursor: "pointer" }}
      onClick={() => onOpen(a)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(a); }
      }}
      role="button"
      tabIndex={0}
      title={t("Open announcement")}
    >
      <div className="row between" style={{ gap: 8, alignItems: "flex-start" }}>
        <strong style={{ fontSize: 14 }}>{a.title}</strong>
        {canManage && (
          <div className="row" style={{ gap: 4, flexShrink: 0 }}>
            <button onClick={(e) => { e.stopPropagation(); onEdit(a); }} aria-label={t("Edit")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", cursor: "pointer" }}>
              <Pencil size={14} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(a.id); }} aria-label={t("Delete")} style={{ background: "none", border: "none", color: "var(--st-missing)", display: "flex", cursor: "pointer" }}>
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
      {a.message && <p style={{ fontSize: 13.5, marginTop: 4, whiteSpace: "pre-wrap" }}>{a.message}</p>}
      {all.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {/* Click to enlarge (2026-07-27, "give me option to enlarge the
              photo when click") — a single-image post enlarges as-is; with
              several, thumbnails stay compact and enlarge on click instead of
              blowing up the whole card. The index passed here is the position
              in the FLAT list, so the lightbox's arrows continue from
              whichever item was actually clicked. */}
          {images.map((img, idx) => (
            <img
              key={img.publicId || idx}
              src={img.url} alt=""
              onClick={(e) => { e.stopPropagation(); onView(all, idx); }}
              style={
                images.length === 1 && videos.length === 0
                  ? { maxWidth: "100%", maxHeight: 260, borderRadius: "var(--r-sm)", cursor: "pointer" }
                  : { width: 140, height: 140, objectFit: "cover", borderRadius: "var(--r-sm)", cursor: "pointer" }
              }
            />
          ))}
          {/* Video thumbnails (2026-07-27, "when click can view the video")
              — a small play-badged tile; clicking opens the same lightbox
              with a real <video controls> element instead of an <img>. */}
          {videos.map((v, idx) => (
            <div
              key={v.publicId || idx}
              onClick={(e) => { e.stopPropagation(); onView(all, images.length + idx); }}
              style={{ position: "relative", width: 140, height: 140, borderRadius: "var(--r-sm)", overflow: "hidden", cursor: "pointer", background: "#000" }}
            >
              <video src={v.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
              <PlayCircle size={28} color="#fff" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))" }} />
            </div>
          ))}
        </div>
      )}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        {a.createdBy || t("Admin")} · {new Date(a.createdAt).toLocaleString()}
      </div>
    </div>
  );
}

/**
 * Full read view for one announcement (2026-07-29) — the "detail page" the
 * cards link into. Deliberately mirrors the delegate profile modal on the
 * Dashboard: an overlay card with a header, a labelled body, and the manage
 * actions in a footer, so the two read the same way.
 */
export function AnnouncementDetailModal({ a, canManage, itineraryDays, onClose, onView, onEdit, onDelete, t }) {
  const { images, videos, all } = mediaOf(a);
  // Which itinerary stop this post is tagged to, resolved for display. A
  // trip-wide notice has no stop, which is itself worth stating rather than
  // leaving the field blank and ambiguous.
  const stop = (() => {
    for (const day of itineraryDays || []) {
      const found = (day.checkpoints || []).find((c) => c.id === a.itineraryItemId);
      if (found) return { day: day.dayNumber ?? day.day, item: found };
    }
    return null;
  })();

  // Same drag-to-select-text guard every other modal in this app uses — only
  // dismiss when the whole click gesture started on the backdrop itself.
  const downOnBackdrop = useRef(false);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 65 }}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ width: "min(680px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 0, background: "var(--surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", gap: 12, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 7, marginBottom: 5 }}>
              <Megaphone size={14} color="var(--scc-red)" style={{ flexShrink: 0 }} />
              <span className="muted" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {t("Announcement")}
              </span>
            </div>
            <h2 style={{ fontSize: 17, margin: 0, lineHeight: 1.3 }}>{a.title}</h2>
          </div>
          <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4, cursor: "pointer", flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
            <DetailField label={t("Itinerary stop")} t={t}>
              {stop
                ? `${t("Day")} ${stop.day} · ${stop.item.label}${stop.item.scheduledTime ? ` · ${stop.item.scheduledTime}` : ""}`
                : <span className="muted">{t("Trip-wide (not tied to a stop)")}</span>}
            </DetailField>
            <DetailField label={t("Posted by")} t={t}>{a.createdBy || t("Admin")}</DetailField>
            <DetailField label={t("Posted")} t={t}>{new Date(a.createdAt).toLocaleString()}</DetailField>
          </div>

          {a.message ? (
            <>
              <div className="field-label" style={{ marginBottom: 5 }}>{t("Message")}</div>
              <p style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{a.message}</p>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>{t("No message body.")}</div>
          )}

          {all.length > 0 && (
            <>
              <div className="field-label" style={{ marginTop: 18, marginBottom: 7 }}>
                {t("Attachments")} <span className="muted" style={{ fontWeight: 400 }}>({all.length})</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {images.map((img, idx) => (
                  <img
                    key={img.publicId || idx}
                    src={img.url} alt=""
                    onClick={() => onView(all, idx)}
                    style={{ width: 150, height: 150, objectFit: "cover", borderRadius: "var(--r-sm)", cursor: "pointer" }}
                    title={t("Click to enlarge")}
                  />
                ))}
                {videos.map((v, idx) => (
                  <div
                    key={v.publicId || idx}
                    onClick={() => onView(all, images.length + idx)}
                    style={{ position: "relative", width: 150, height: 150, borderRadius: "var(--r-sm)", overflow: "hidden", cursor: "pointer", background: "#000" }}
                    title={t("Click to play")}
                  >
                    <video src={v.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
                    <PlayCircle size={30} color="#fff" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))" }} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {canManage && (
          <div className="row between" style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", flexShrink: 0, gap: 10 }}>
            <button
              className="btn btn-ghost"
              style={{ color: "var(--st-missing)" }}
              onClick={() => onDelete(a.id)}
            >
              <Trash2 size={15} /> {t("Delete")}
            </button>
            <button className="btn btn-primary" onClick={() => onEdit(a)}>
              <Pencil size={15} /> {t("Edit")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function DetailField({ label, children, t }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="field-label">{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 2, wordBreak: "break-word" }}>{children || <span className="muted">{t("—")}</span>}</div>
    </div>
  );
}
