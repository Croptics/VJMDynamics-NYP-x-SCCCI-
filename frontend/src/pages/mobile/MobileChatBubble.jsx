import { useState, useEffect, useRef } from "react";
import { MessageCircle, X } from "lucide-react";
import MobileAssistantPage from "./MobileAssistantPage.jsx";
import { useLang } from "../../lib/i18n.jsx";

// Same reasoning as ChatBubble.jsx (desktop): hidden by default regardless
// of scroll position, fades in only while actively scrolling, fades back
// out 5s after scrolling stops — direct user report that it stayed visible
// indefinitely and blocked other clickable UI further down the page.
const AUTO_HIDE_MS = 5000;
const DRAG_THRESHOLD_PX = 6;
const FAB_SIZE = 50;
const MARGIN_SIDE = 16;
// Bottom corners sit above the fixed .mobile-tabbar; top corners just need
// clear of the safe-area inset (no tab bar up there).
const CORNER_KEY = "mg_mobile_chat_corner";
const CORNERS = {
  br: { bottom: "calc(78px + env(safe-area-inset-bottom, 0px))", right: MARGIN_SIDE },
  bl: { bottom: "calc(78px + env(safe-area-inset-bottom, 0px))", left: MARGIN_SIDE },
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
  const [recentlyActive, setRecentlyActive] = useState(false);
  const [corner, setCorner] = useState(() => {
    try { return localStorage.getItem(CORNER_KEY) || "br"; } catch { return "br"; }
  });
  const [dragPos, setDragPos] = useState(null);
  const hideTimer = useRef(null);
  const dragRef = useRef(null);

  const bumpActivity = () => {
    setRecentlyActive(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRecentlyActive(false), AUTO_HIDE_MS);
  };

  useEffect(() => {
    window.addEventListener("scroll", bumpActivity, { passive: true });
    return () => { window.removeEventListener("scroll", bumpActivity); clearTimeout(hideTimer.current); };
  }, []);

  const visible = recentlyActive || open || !!dragPos;

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
      bumpActivity();
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
      bumpActivity();
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
      </button>

      <style>{`
        .mg-mobile-chat-fab {
          position: fixed; z-index: 25;
          width: 50px; height: 50px; border-radius: 50%;
          background: var(--scc-red); color: #fff; border: none;
          display: flex; align-items: center; justify-content: center;
          box-shadow: var(--shadow-lg); cursor: pointer;
          transition: opacity 0.2s ease, transform 0.2s ease;
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
