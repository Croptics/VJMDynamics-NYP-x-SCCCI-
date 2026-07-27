/* =============================================================================
 *  OWNED BY:  Vance — Screen 6, "MusterChat": one WhatsApp-style inbox holding
 *  the AI Trip Assistant (pinned) + person-to-person messaging (staff↔staff,
 *  staff→delegate) with live video calls and inline document sharing.
 *
 *  The inbox body is the shared MusterChatInbox component — the same one the
 *  global floating ChatBubble opens — so the page and the bubble stay in sync.
 * ============================================================================= */
import { useLang } from "../lib/i18n.jsx";
import TripPulse from "../components/TripPulse.jsx";
import MusterChatInbox from "../components/mchat/MusterChatInbox.jsx";

export default function ChatAssistantPage() {
  const { t } = useLang();
  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="row between" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-eyebrow">{t("Assistant")}</div>
          <h1 className="page-title">MusterChat</h1>
          <p className="page-sub">{t("AI assistant + team messaging, video calls and document sharing — in one inbox.")}</p>
        </div>
        <TripPulse mode="assistant" />
      </div>

      <div style={{ marginTop: 20 }}>
        <MusterChatInbox />
      </div>
    </div>
  );
}
