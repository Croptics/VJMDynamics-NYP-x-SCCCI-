import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";
import IssuesPanel from "../../components/IssuesPanel.jsx";
import { getDelegates } from "../../lib/exceptionsApi.js";

// Trip id comes from the mobile trip switcher, not a hardcoded base trip
// (re-applied 2026-07-29 after taking Vimal's UI, which hardcoded "t-1").
import { getMobileTripId } from "../../lib/mobileTrip.js";
const TRIP_ID_FALLBACK = "t-1";

/**
 * Dedicated mobile Issues/Exceptions page (/mobile/issues).
 *
 * Was an inline expandable accordion on MobileHomePage.jsx (2026-07-20,
 * "Mobile UI Consolidation" Option A); moved to its own route the same day
 * ("Mobile UI State Sync, Revert Actions, & Navigation Fixes" part 3) — the
 * full log-a-ticket form + open-tickets list reads better as its own screen
 * on small viewports than squeezed into an accordion under the KPI cards.
 * The Home card that used to expand it now just navigates here instead.
 *
 * Mounts Jayden's IssuesPanel.jsx unmodified. IssuesPanel wants a `coach`
 * prop shaped `{ delegates: [...] }` keyed `delegateId` (the shape
 * GET /attendance/:tripId/coach/:coachId returns) for its delegate picker,
 * but this page has no single "active coach" — fetches the FULL trip roster
 * via exceptionsApi's getDelegates() (GET /trips/:id/delegates, keyed `id`)
 * and remaps `id` → `delegateId`, so the picker covers every delegate on
 * the trip.
 */
export default function MobileIssuesPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [delegates, setDelegates] = useState([]);

  const loadDelegates = useCallback(async () => {
    try {
      const rows = await getDelegates(getMobileTripId() || TRIP_ID_FALLBACK);
      setDelegates(rows.map((d) => ({ ...d, delegateId: d.id })));
    } catch { /* picker just shows "Unidentified" only */ }
  }, []);

  useEffect(() => { loadDelegates(); }, [loadDelegates]);

  return (
    <div className="m-fade-in">
      <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 6 }}>
        <button
          className="btn btn-ghost" onClick={() => navigate("/mobile")}
          aria-label={t("Back to Home")} style={{ padding: 8, flexShrink: 0 }}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="m-eyebrow">{t("Support")}</div>
          <h1 style={{ fontSize: 20, margin: "1px 0 0" }}>{t("Issues")}</h1>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <IssuesPanel tripId={getMobileTripId() || TRIP_ID_FALLBACK} coach={{ delegates }} onLogged={loadDelegates} />
      </div>
    </div>
  );
}
