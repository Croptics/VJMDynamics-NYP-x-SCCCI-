import { useState } from "react";
import { MessageCircle, X } from "lucide-react";
import ChatAssistantPage from "../pages/ChatAssistantPage.jsx";
import { useLang } from "../lib/i18n.jsx";

/**
 * Floating chat widget — renders once from Layout.jsx so it persists across
 * every desktop route, replacing the old dedicated "/assistant" sidebar
 * destination. Wraps Vance's existing ChatAssistantPage UNCHANGED (rendered
 * with `embedded`, which just hides its page chrome/history sidebar — see
 * that file) rather than rebuilding the chat logic here.
 */
export default function ChatBubble() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div className="mg-chatbubble-panel card">
          <div className="row between" style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t("Trip assistant")}</div>
            <button onClick={() => setOpen(false)} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
            <ChatAssistantPage embedded />
          </div>
        </div>
      )}

      <button
        className="mg-chatbubble-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t("Close") : t("Trip assistant")}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      <style>{`
        .mg-chatbubble-fab {
          position: fixed; bottom: 24px; right: 24px; z-index: 55;
          width: 52px; height: 52px; border-radius: 50%;
          background: var(--scc-red); color: #fff; border: none;
          display: flex; align-items: center; justify-content: center;
          box-shadow: var(--shadow-lg); cursor: pointer;
        }
        .mg-chatbubble-panel {
          position: fixed; bottom: 88px; right: 24px; z-index: 54;
          width: 380px; max-width: calc(100vw - 32px);
          height: 560px; max-height: calc(100vh - 140px);
          display: flex; flex-direction: column; padding: 0; overflow: hidden;
        }
      `}</style>
    </>
  );
}
