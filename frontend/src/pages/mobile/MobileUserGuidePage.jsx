/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, Home, ClipboardList, ScanFace, AlertTriangle, Phone,
  Filter, MapPin, Clock, HelpCircle,
} from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";

/**
 * Mobile-dedicated User Guide (2026-07-21). Previously MobileProfilePage's
 * "User guide" button navigated to the shared desktop `/guide` route — that
 * route only lives inside the desktop Layout's Route group, so opening it on
 * mobile rendered the DESKTOP sidebar/chrome around the guide content,
 * breaking the mobile UX entirely. This page fixes that by being its own
 * route registered inside MobileLayout's Route group (see App.jsx), so it
 * gets the normal mobile topbar + bottom tab bar instead.
 *
 * Content is written fresh for mobile workflows specifically — not a
 * shrunk-down copy of the desktop guide's 5-status explainer. A mobile
 * field-staff member's actual questions are "where do I find X on my
 * phone," not "what does ARRIVED mean" (that's still covered, just briefly,
 * since it's shared knowledge — the bulk of this page is navigation).
 */
export default function MobileUserGuidePage() {
  const { t } = useLang();
  const navigate = useNavigate();

  return (
    <div className="m-fade-in">
      <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 2 }}>
        <button
          onClick={() => navigate(-1)}
          aria-label={t("Back")}
          style={{ background: "none", border: "none", color: "var(--ink-2)", display: "flex", padding: 4 }}
        >
          <ChevronLeft size={20} />
        </button>
        <div className="m-eyebrow">{t("Getting started")}</div>
      </div>
      <h1 className="m-page-title">{t("User guide")}</h1>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        {t("A quick tour of what each tab on your phone does.")}
      </p>

      <GuideCard icon={Home} title={t("Home")}>
        {t("Your dashboard: the active trip, quick Missing/Late/Present counts, and a Coach status list. Tap any number or coach row to jump straight to that filtered list on Attendance — you never need to set the filter by hand first.")}
      </GuideCard>

      <GuideCard icon={ClipboardList} title={t("Attendance")}>
        {t("The full delegate roster. Search by name, filter by status or by coach (the coach dropdown next to the search box), and tap \"Update status\" on any card to change it — a bottom sheet lists all 5 statuses as big buttons, no tiny dropdown to aim for.")}
      </GuideCard>

      <GuideCard icon={Filter} title={t("Filtering by coach")}>
        {t("Tapping a specific coach on Home (not the \"Coach status\" header itself) takes you to Attendance pre-filtered to just that coach's roster — useful when you're physically standing next to one bus and only care about its list.")}
      </GuideCard>

      <GuideCard icon={ScanFace} title={t("Scanning people in")}>
        {t("Open Scanner from Home's Scanner card. Face and QR modes both use your phone's camera (tap the flip-camera icon to switch between selfie and rear camera); Manual mode lists the roster to tap someone present by hand when a scan just won't cooperate.")}
      </GuideCard>

      <GuideCard icon={AlertTriangle} title={t("Reporting an issue")}>
        {t("The Issues card on Home shows how many open critical tickets exist. Tap it to log a new one (missing person, lost badge, dead phone, VIP request, or something else) or check on existing tickets — the same live inbox the desktop team sees, so raising one here reaches everyone instantly.")}
      </GuideCard>

      <GuideCard icon={Phone} title={t("Calling a Missing or Late delegate")}>
        {t("On Attendance, every Missing or Late delegate gets a one-tap call button. The first time you use it for someone, it'll ask for their number and save it — after that, it just calls.")}
      </GuideCard>

      <GuideCard icon={MapPin} title={t("Checking a delegate's last known location")}>
        {t("The map-pin icon next to a Missing delegate opens their last recorded location on a map — only shows up once someone's actually recorded one, so it's not present for delegates who are simply Unassigned or Late.")}
      </GuideCard>

      <GuideCard icon={Clock} title={t("Why did someone turn orange (Late) on their own?")}>
        {t("Each trip has its own check-in cutoff time set by an admin. A delegate who was Assigned but hadn't checked in by that time flips to Late automatically — nobody has to notice and do it by hand. Missing is different: that one is ALWAYS set manually by a staff member, never automatic.")}
      </GuideCard>

      <div className="mobile-card" style={{ marginTop: 4 }}>
        <div className="row" style={{ gap: 8, marginBottom: 6 }}>
          <HelpCircle size={16} color="var(--ink-3)" />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("Want the full picture?")}</span>
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {t("The desktop User Guide (Settings/Sidebar on a computer) covers every status in more depth, plus Dashboard, Account Control, and Trip management — worth a look if you switch between phone and desktop.")}
        </p>
      </div>
    </div>
  );
}

function GuideCard({ icon: Icon, title, children }) {
  return (
    <div className="mobile-card" style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
        <span className="m-tile-ic" style={{ width: 34, height: 34 }}>
          <Icon size={16} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{children}</p>
        </div>
      </div>
    </div>
  );
}
