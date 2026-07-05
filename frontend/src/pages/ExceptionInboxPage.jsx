import { useLang } from "../lib/i18n.jsx";

/**
 * Screen 5 — Exception Inbox / Support Tickets (Jayden).
 * Structural placeholder. To build:
 *  - Ticket list with All / Critical / Open / Resolved filters
 *  - Raise ticket + "Mark as critical" → push to all staff devices
 *  - Manual attendance override; QR-fallback identification
 *  - Offline-first via the shared outbox (POST /api/checkins/sync)
 */
export default function ExceptionInboxPage() {
  const { t } = useLang();
  return (
    <div className="page">
      <div className="page-eyebrow">{t("Exceptions")}</div>
      <h1 className="page-title">{t("Exception inbox")}</h1>
      <p className="page-sub">{t("Log and resolve on-site exceptions; critical alerts push to all staff.")}</p>
      <div className="scaffold" style={{ marginTop: 20 }}>
        <h2>{t("Exception Logging & QR Fallback")}</h2>
        <p>{t("Support-ticket inbox, critical-exception push, and manual override.")}</p>
        <span className="owner">Owner · Jayden</span>
      </div>
    </div>
  );
}
