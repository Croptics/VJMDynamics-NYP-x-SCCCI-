/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — User Guide's "Account & permissions" tab
 * ============================================================================= */
import { PencilLine, LayoutGrid, ShieldCheck, Users, BedDouble } from "lucide-react";
import { Tip } from "./FlowChart.jsx";

export function AccountsTab({ t }) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Accounts, roles & permissions")}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {t("Only shown here for reference — most staff never need to touch Account Control themselves.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={ShieldCheck} title={t("Admin vs. Staff — exactly two roles")}>
          {t("Admin bypasses every permission check — full access to everything, always. Staff are limited to exactly what's ticked on their account; nothing is assumed.")}
        </Tip>
        <Tip icon={LayoutGrid} title={t("Feature actions vs. views")}>
          {t("\"Feature actions\" control what an account can CHANGE (add a delegate, edit a trip, resolve a ticket). \"Desktop/Mobile views\" control what pages an account can even SEE — a view can be granted without the matching edit permission, for a read-only look at a page. Every major page (Dashboard, Trips, Announcements, Documents, Scanner, Exceptions) has its own view toggle.")}
        </Tip>
        <Tip icon={Users} title={t("Manage accounts is Admin-only")}>
          {t("Only a real Admin can ever create, edit, or delete other accounts — this isn't an option Staff can be individually granted, by design.")}
        </Tip>
        <Tip icon={PencilLine} title={t("Changing your own account")}>
          {t("Editing your own profile (name, username, email, phone, photo, password) from Settings takes effect immediately without needing to log in again.")}
        </Tip>
        <Tip icon={BedDouble} title={t("Contact number — why it matters")}>
          {t("An account's own phone number (Settings, or Account Control) is what would let escalation SMS/WhatsApp alerts reach an admin directly — without one on file, that path has nowhere to send to.")}
        </Tip>
      </div>
    </div>
  );
}

