import { useLang } from "../lib/i18n.jsx";

/**
 * QR Check-in — mobile-web staff view (Vimal).
 * PRIMARY high-speed check-in method for this phase (facial recognition deferred).
 * Structural placeholder. To build:
 *  - Camera QR scanner frame; scan → resolve delegate → optimistic "boarded"
 *  - Offline-first: write to IndexedDB outbox, flush via POST /api/checkins/sync
 *  - Live headcount counter (X of Y boarded) + scan-fail → manual override
 *  - "Can't scan? → Log exception" hand-off to Jayden's flow
 */
export default function QRCheckInPage() {
  const { t } = useLang();
  return (
    <div className="page">
      <div className="page-eyebrow">{t("Staff · mobile")}</div>
      <h1 className="page-title">{t("QR check-in")}</h1>
      <p className="page-sub">{t("Primary high-speed check-in. Scan a delegate badge to board them.")}</p>
      <div className="scaffold" style={{ marginTop: 20 }}>
        <h2>{t("High-Speed QR Check-in")}</h2>
        <p>{t("Camera scanner, offline queue, live headcount, and manual fallback.")}</p>
        <span className="owner">Owner · Vimal (QR workflows)</span>
      </div>
    </div>
  );
}
