import { useLang } from "../lib/i18n.jsx";

/**
 * Renders a delegate's "Last known location" as a static embedded Google
 * Map (Maps Embed API — a single <iframe>, not live tracking; see the
 * "lastLocation" comment in backend/data.js). Needs VITE_GOOGLE_MAPS_API_KEY
 * set in frontend/.env (see .env_Future.example) — degrades to a plain
 * message when it's missing instead of rendering a broken iframe.
 */
export default function DelegateLocationMap({ location, height = 200 }) {
  const { t } = useLang();
  if (!location) return null;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return (
      <div className="muted" style={{ fontSize: 12, padding: "8px 0" }}>
        {t("Location:")} {location} — {t("set VITE_GOOGLE_MAPS_API_KEY in frontend/.env to show a map here.")}
      </div>
    );
  }

  const src = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(location)}`;
  return (
    <iframe
      title={`map-${location}`}
      src={src}
      width="100%"
      height={height}
      style={{ border: 0, borderRadius: "var(--r-sm)" }}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}
