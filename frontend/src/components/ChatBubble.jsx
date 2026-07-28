import { useState, useEffect, useRef } from "react";
import { MessageCircle, X } from "lucide-react";
import ChatAssistantPage from "../pages/desktop/ChatAssistantPage.jsx";
import { useLang } from "../lib/i18n.jsx";

// Hidden by default, regardless of scroll position — fades in only while the
// page is actively being scrolled, then fades back out 5s after scrolling
// stops. Direct user report: it stayed visible indefinitely once revealed
// and sat over other clickable UI (e.g. "Delete" buttons) further down the
// page. The only way it stays permanently on-screen is once you've actually
// opened it (see `visible` below).
const AUTO_HIDE_MS = 5000;
const DRAG_THRESHOLD_PX = 6;
const FAB_SIZE = 52;
const MARGIN = 24;
const CORNER_KEY = "mg_chatbubble_corner";
const CORNERS = {
  br: { bottom: MARGIN, right: MARGIN },
  bl: { bottom: MARGIN, left: MARGIN },
  tr: { top: MARGIN, right: MARGIN },
  tl: { top: MARGIN, left: MARGIN },
};

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
  const [recentlyActive, setRecentlyActive] = useState(false);
  const [corner, setCorner] = useState(() => {
    try { return localStorage.getItem(CORNER_KEY) || "br"; } catch { return "br"; }
  });
  const [dragPos, setDragPos] = useState(null); // {x,y} while actively being dragged
  const hideTimer = useRef(null);
  const dragRef = useRef(null); // {startX, startY, moved}

  const bumpActivity = () => {
    setRecentlyActive(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRecentlyActive(false), AUTO_HIDE_MS);
  };

  useEffect(() => {
    window.addEventListener("scroll", bumpActivity, { passive: true });
    return () => { window.removeEventListener("scroll", bumpActivity); clearTimeout(hideTimer.current); };
  }, []);

  // Once open, the panel/FAB stay interactive regardless of scroll/timer
  // state — only the CLOSED fab's visibility is scroll+timer-gated, so it
  // never traps you unable to close it because the timer fired.
  const visible = recentlyActive || open || !!dragPos;

  /* ---- drag-to-corner (pointer events cover mouse + touch uniformly) --- */
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
  const panelPosStyle = {
    ...(corner.includes("b") ? { bottom: MARGIN + FAB_SIZE + 12, top: "auto" } : { top: MARGIN + FAB_SIZE + 12, bottom: "auto" }),
    ...(corner.includes("r") ? { right: MARGIN, left: "auto" } : { left: MARGIN, right: "auto" }),
  };

  return (
    <>
      {open && (
        <div className="mg-chatbubble-panel card" style={panelPosStyle}>
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
        .mg-chatbubble-fab {
          position: fixed; z-index: 55;
          width: 52px; height: 52px; border-radius: 50%;
          background: var(--scc-red); color: #fff; border: none;
          display: flex; align-items: center; justify-content: center;
          box-shadow: var(--shadow-lg); cursor: pointer;
          transition: opacity 0.2s ease, transform 0.2s ease;
        }
        .mg-chatbubble-panel {
          position: fixed; z-index: 54;
          width: 380px; max-width: calc(100vw - 32px);
          height: 560px; max-height: calc(100vh - 140px);
          display: flex; flex-direction: column; padding: 0; overflow: hidden;
        }
      `}</style>
    </>
  );
}
