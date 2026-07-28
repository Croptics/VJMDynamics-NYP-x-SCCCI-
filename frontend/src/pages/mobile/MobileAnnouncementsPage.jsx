import { useNavigate } from "react-router-dom";
import { ArrowLeft, Megaphone, Pin, Clock, AlertTriangle, Info, CalendarClock, Utensils } from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";

/**
 * Mobile Announcements (/mobile/announcements) — trip-wide notices for staff,
 * reached from a tile on Home.
 *
 * SCAFFOLD: there's no /announcements backend endpoint yet, so ANNOUNCEMENTS
 * below is placeholder content. To wire real data later, fetch your endpoint
 * in a useEffect and drop the result into state with the SAME shape
 * ({ id, category, pinned?, title, body, time }) — the rendering layer needs
 * no other change. Categories map to an icon + status color in CAT.
 */
const ANNOUNCEMENTS = [
  {
    id: "a1", category: "safety", pinned: true,
    title: "Weather advisory — indoor program today",
    body: "A rain warning is in effect until 3pm. Today's outdoor stop is moved indoors. Keep your coach group together and check the itinerary for the updated venue.",
    time: "08:10",
  },
  {
    id: "a2", category: "schedule",
    title: "Departure moved to 08:45",
    body: "Tomorrow's coaches leave 15 minutes earlier than planned. Please have delegates boarded and scanned in by 08:35.",
    time: "Yesterday",
  },
  {
    id: "a3", category: "meals",
    title: "Halal and vegetarian options confirmed",
    body: "Lunch at the convention centre has clearly labelled Halal and vegetarian counters. Flag any other dietary needs via the Issues tab.",
    time: "Yesterday",
  },
  {
    id: "a4", category: "info",
    title: "Hotel Wi-Fi",
    body: "Network: SCCCI-Delegation · password is printed on your room key card. Reception can help with connection issues.",
    time: "Mon",
  },
];

const CAT = {
  safety:   { label: "Safety",   Icon: AlertTriangle, color: "var(--st-missing)",  bg: "var(--st-missing-bg)" },
  schedule: { label: "Schedule", Icon: CalendarClock, color: "var(--st-assigned)", bg: "var(--st-assigned-bg)" },
  meals:    { label: "Meals",    Icon: Utensils,      color: "var(--st-late)",     bg: "var(--st-late-bg)" },
  info:     { label: "Info",     Icon: Info,          color: "var(--ink-3)",       bg: "var(--surface-2)" },
};

export default function MobileAnnouncementsPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const pinned = ANNOUNCEMENTS.filter((a) => a.pinned);
  const rest = ANNOUNCEMENTS.filter((a) => !a.pinned);

  return (
    <div className="m-fade-in">
      <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 2 }}>
        <button
          className="btn btn-ghost" onClick={() => navigate("/mobile")}
          aria-label={t("Back to Home")} style={{ padding: 8, flexShrink: 0 }}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="m-eyebrow">{t("Trip updates")}</div>
          <h1 style={{ fontSize: 20, margin: "1px 0 0" }}>{t("Announcements")}</h1>
        </div>
      </div>

      {/* Pinned — brand-red hero so the most important notice can't be missed. */}
      {pinned.map((a) => (
        <div key={a.id} className="m-hero" style={{ marginTop: 14 }}>
          <div className="m-hero-glow" />
          <div className="row" style={{ gap: 7, position: "relative" }}>
            <Pin size={13} />
            <span className="m-hero-eyebrow" style={{ opacity: 1 }}>{t("Pinned")} · {t(CAT[a.category]?.label || "Info")}</span>
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginTop: 6, position: "relative" }}>{a.title}</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "4px 0 0", opacity: 0.95, position: "relative" }}>{a.body}</p>
          <div className="row" style={{ gap: 6, marginTop: 10, fontSize: 12, opacity: 0.9, position: "relative" }}>
            <Clock size={12} /> {a.time}
          </div>
        </div>
      ))}

      <div className="m-section-head" style={{ marginTop: 20 }}>
        <span className="m-eyebrow"><Megaphone size={13} /> {t("Latest")}</span>
      </div>

      {rest.length === 0 && pinned.length === 0 ? (
        <div className="m-empty">
          <span className="m-empty-ic"><Megaphone size={20} /></span>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{t("No announcements")}</div>
          <div style={{ fontSize: 12.5 }}>{t("Trip notices will show up here.")}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rest.map((a) => {
            const c = CAT[a.category] || CAT.info;
            const Icon = c.Icon;
            return (
              <div key={a.id} className="mobile-card" style={{ margin: 0 }}>
                <div className="row between" style={{ marginBottom: 6 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="m-tile-ic" style={{ width: 28, height: 28, borderRadius: 8, background: c.bg, color: c.color }}>
                      <Icon size={14} />
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: c.color }}>{t(c.label)}</span>
                  </span>
                  <span className="mono muted" style={{ fontSize: 11.5 }}>{a.time}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{a.title}</div>
                <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{a.body}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
