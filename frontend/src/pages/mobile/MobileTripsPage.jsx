import { useLang } from "../../lib/i18n.jsx";

/**
 * Mobile Trips tab — placeholder only. Desktop already has Desmond's full
 * Trip/Coach board (TripCoachPage.jsx at /trips); mobile has no equivalent
 * yet. Left intentionally blank for a teammate to build out.
 */
export default function MobileTripsPage() {
  const { t } = useLang();
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
        {t("Trips")}
      </div>
      <h1 style={{ fontSize: 22, margin: "4px 0 2px" }}>{t("Trips")}</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>{t("Coming soon.")}</p>
    </div>
  );
}
