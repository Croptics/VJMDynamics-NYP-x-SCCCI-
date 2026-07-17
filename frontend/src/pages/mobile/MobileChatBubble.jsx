import { useState } from "react";
import { MessageCircle, X } from "lucide-react";
import MobileAssistantPage from "./MobileAssistantPage.jsx";
import { useLang } from "../../lib/i18n.jsx";

/**
 * Floating chat widget — renders once from MobileLayout.jsx so it persists
 * across every /mobile/* route, replacing the old dedicated "Assistant"
 * bottom tab. Wraps the existing MobileAssistantPage UNCHANGED (via
 * `embedded`, which just hides its own small header — see that file).
 *
 * Positioned ABOVE the fixed bottom tab bar (.mobile-tabbar, ~64-70px tall
 * incl. the safe-area inset) so it doesn't overlap the nav.
 */
export default function MobileChatBubble() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div className="mg-mobile-chat-overlay" onClick={() => setOpen(false)}>
          <div className="mg-mobile-chat-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Trip assistant")}</div>
              <button onClick={() => setOpen(false)} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
              <MobileAssistantPage embedded />
            </div>
          </div>
        </div>
      )}

      <button
        className="mg-mobile-chat-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t("Close") : t("Trip assistant")}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      <style>{`
        .mg-mobile-chat-fab {
          position: fixed; right: 16px; z-index: 25;
          bottom: calc(78px + env(safe-area-inset-bottom, 0px));
          width: 50px; height: 50px; border-radius: 50%;
          background: var(--scc-red); color: #fff; border: none;
          display: flex; align-items: center; justify-content: center;
          box-shadow: var(--shadow-lg); cursor: pointer;
        }
        .mg-mobile-chat-overlay {
          position: fixed; inset: 0; z-index: 60;
          background: rgba(16,24,40,0.45);
          display: flex; align-items: flex-end;
        }
        .mg-mobile-chat-sheet {
          width: 100%; height: 85vh;
          background: var(--surface);
          border-radius: 16px 16px 0 0;
          display: flex; flex-direction: column; overflow: hidden;
        }
      `}</style>
    </>
  );
}
