/* =============================================================================
 *  OWNED BY:  Vance — Screen 6, "MusterChat": one WhatsApp-style inbox holding
 *  the AI Trip Assistant (pinned) + person-to-person messaging (staff↔staff,
 *  staff→delegate) with live video calls and inline document sharing.
 *
 *  The inbox body is the shared MusterChatInbox component; the global floating
 *  ChatBubble hosts the same AI conversation and links here for messaging.
 *
 *  (Integrated from Vance's v2 branch 2026-07-27 — this fully replaced the old
 *  standalone AI-chat page; import paths adjusted for pages/desktop/ depth.)
 * ============================================================================= */
import { useLang } from "../../lib/i18n.jsx";
import { useLocation } from "react-router-dom";
import MusterChatInbox from "../../components/mchat/MusterChatInbox.jsx";

export default function ChatAssistantPage() {
  const { t } = useLang();
  // Deep-link support (2026-07-31) — the floating ChatBubble's "open full
  // inbox" button, when a specific person/group thread is already open there,
  // navigates here with { state: { openThread } } instead of always landing
  // on the generic pinned AI tab. See ChatBubble.jsx's goMessages().
  const location = useLocation();
  const openThread = location.state?.openThread || null;
  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div>
        <div className="page-eyebrow">{t("Assistant")}</div>
        <h1 className="page-title">MusterChat</h1>
        <p className="page-sub">{t("AI assistant + team messaging, video calls and document sharing — in one inbox.")}</p>
      </div>

      {/* TripPulse ("What to watch") moved 2026-07-31 into AssistantConversation.jsx
          itself — a toggleable "Watch" button in its own header, instead of a
          separate card sitting above the whole inbox — see that file. */}
      <div style={{ marginTop: 20 }}>
        <MusterChatInbox initialActive={openThread} />
      </div>
    </div>
  );
}
