import { useState, useEffect, useRef } from "react";
import { MessageCircle, X, Bot, MessageSquare } from "lucide-react";
import MobileAssistantPage from "./MobileAssistantPage.jsx";
import QuickChat from "./QuickChat.jsx";
import { useLang } from "../../lib/i18n.jsx";
import { getToken } from "../../lib/api.js";
import { pollUpdates } from "../../lib/musterchat/messagesApi.js";

// Segmented "Assistant | Messages" tab button.
const tabBtnStyle = (active) => ({
  border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 7,
  background: active ? "var(--surface, #fff)" : "transparent", color: active ? "var(--scc-red)" : "var(--ink-2)",
  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.1)" : "none", display: "inline-flex", alignItems: "center",
});

// Always visible (2026-07-30 — "on android i not able to see chat bubble").
// This used to fade in only while actively scrolling and hide again 5s after
// scrolling stopped, invisible-by-default until the first scroll event —
// ChatBubble.jsx (desktop) had the identical mechanism and was already fixed
// to always-visible back on 2026-07-28 ("can you unhide the chat?"), but this
// mobile copy was never updated to match. On a page short enough to need no
// scrolling at all — plausible on plenty of phones/pages — the bubble could
// never fire even one scroll event, so it just never appeared, ever.
const DRAG_THRESHOLD_PX = 6;
const FAB_SIZE = 50;
const MARGIN_SIDE = 16;
// Bottom corners sit above the fixed .mobile-tabbar; top corners just need
// clear of the safe-area inset (no tab bar up there).
const CORNER_KEY = "mg_mobile_chat_corner";
const CORNERS = {
  br: { bottom: "calc(104px + env(safe-area-inset-bottom, 0px))", right: MARGIN_SIDE },
  bl: { bottom: "calc(104px + env(safe-area-inset-bottom, 0px))", left: MARGIN_SIDE },
  tr: { top: "calc(16px + env(safe-area-inset-top, 0px))", right: MARGIN_SIDE },
  tl: { top: "calc(16px + env(safe-area-inset-top, 0px))", left: MARGIN_SIDE },
};

/**
 * Floating chat widget — renders once from MobileLayout.jsx so it persists
 * across every /mobile/* route, replacing the old dedicated "Assistant"
 * bottom tab. Wraps the existing MobileAssistantPage UNCHANGED (via
 * `embedded`, which just hides its own small header — see that file).
 */
export default function MobileChatBubble() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("assistant"); // "assistant" (AI) | "messages" (quick chat)
  const [unread, setUnread] = useState(0);
  const [corner, setCorner] = useState(() => {
    try { return localStorage.getItem(CORNER_KEY) || "br"; } catch { return "br"; }
  });
  const [dragPos, setDragPos] = useState(null);
  const dragRef = useRef(null);

  // Poll unread team messages for the Messages-tab badge.
  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    const tick = async () => { try { const r = await pollUpdates(); if (alive) setUnread(r.unread || 0); } catch { /* transient */ } };
    tick();
    const id = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const visible = true;

  const onPointerDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragRef.current.moved = true;
    if (dragRef.current.moved) {
      setDragPos({ x: e.clientX, y: e.clientY });
    }
  };
  const onPointerUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      const vw = window.innerWidth, vh = window.innerHeight;
      const next = (e.clientY < vh / 2 ? "t" : "b") + (e.clientX < vw / 2 ? "l" : "r");
      setCorner(next);
      try { localStorage.setItem(CORNER_KEY, next); } catch { /* ignore */ }
      setDragPos(null);
    } else {
      setOpen((v) => !v);
    }
  };

  const fabPosStyle = dragPos
    ? { left: dragPos.x - FAB_SIZE / 2, top: dragPos.y - FAB_SIZE / 2, right: "auto", bottom: "auto" }
    : CORNERS[corner];

  return (
    <>
      {open && (
        <div className="mg-mobile-chat-overlay" onClick={() => setOpen(false)}>
          <div className="mg-mobile-chat-sheet" onClick={(e) => e.stopPropagation()}>
            {/* Assistant | Messages tabs — AI chatbot by default, simplified
                quick-chat for incoming team DMs (space-optimized for mobile). */}
            <div className="row between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 3, background: "var(--surface-2)", borderRadius: 9, padding: 3 }}>
                <button onClick={() => setTab("assistant")} style={tabBtnStyle(tab === "assistant")}>
                  <Bot size={13} style={{ marginRight: 5 }} /> {t("Assistant")}
                </button>
                <button onClick={() => setTab("messages")} style={tabBtnStyle(tab === "messages")}>
                  <MessageSquare size={13} style={{ marginRight: 5 }} /> {t("Messages")}
                  {unread > 0 && <span style={{ marginLeft: 6, background: "var(--scc-red)", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 9, padding: "1px 6px" }}>{unread > 99 ? "99+" : unread}</span>}
                </button>
              </div>
              <button onClick={() => setOpen(false)} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
                <X size={20} />
              </button>
            </div>
            {tab === "assistant" ? (
              <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
                <MobileAssistantPage embedded />
              </div>
            ) : (
              <div style={{ flex: 1, minHeight: 0 }}>
                <QuickChat />
              </div>
            )}
          </div>
        </div>
      )}

      <button
        className="mg-mobile-chat-fab"
        style={{
          ...fabPosStyle,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
          transform: visible ? "scale(1)" : "scale(0.7)",
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label={open ? t("Close") : t("Trip assistant")}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && unread > 0 && <span className="mg-mobile-chat-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>

      <style>{`
        .mg-mobile-chat-fab {
          position: fixed; z-index: 25;
          width: 50px; height: 50px; border-radius: 50%;
          background: linear-gradient(135deg, var(--scc-red), var(--scc-red-700)); color: #fff; border: none;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 6px 20px color-mix(in srgb, var(--scc-red) 45%, transparent), var(--shadow-lg); cursor: pointer;
          transition: opacity 0.2s ease, transform 0.2s ease;
        }
        .mg-mobile-chat-badge {
          position: absolute; top: -3px; right: -3px; min-width: 19px; height: 19px; padding: 0 5px;
          border-radius: 10px; background: #fff; color: var(--scc-red);
          font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center;
          border: 2px solid var(--scc-red);
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
