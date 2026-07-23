import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";
import IssuesPanel from "../../components/IssuesPanel.jsx";
import { getDelegates } from "../../lib/exceptionsApi.js";
import { getMobileTripId } from "../../lib/mobileTrip.js";

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
  // Read fresh on every mount — reflects whichever trip is currently picked
  // on Home's trip switcher (lib/mobileTrip.js). NOTE: getDelegates() below
  // (lib/exceptionsApi.js) still always reads its own hardcoded default trip
  // internally — this page's own TRIP_ID only scopes the IssuesPanel prop,
  // not the roster fetch. Not fixed here — see the AI log.
  const TRIP_ID = getMobileTripId();
  const [delegates, setDelegates] = useState([]);

  const loadDelegates = useCallback(async () => {
    try {
      const rows = await getDelegates();
      setDelegates(rows.map((d) => ({ ...d, delegateId: d.id })));
    } catch { /* picker just shows "Unidentified" only */ }
  }, []);

  useEffect(() => { loadDelegates(); }, [loadDelegates]);

  return (
    <div>
      <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 4 }}>
        <button
          className="btn btn-ghost" onClick={() => navigate("/mobile")}
          aria-label={t("Back to Home")} style={{ padding: 8 }}
        >
          <ArrowLeft size={18} />
        </button>
        <h1 style={{ fontSize: 20 }}>{t("Issues")}</h1>
      </div>

      <div style={{ marginTop: 10 }}>
        <IssuesPanel tripId={TRIP_ID} coach={{ delegates }} onLogged={loadDelegates} />
      </div>
    </div>
  );
}
