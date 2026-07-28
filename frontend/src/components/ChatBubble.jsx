/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — chat shell (hosts Vance's MusterChat assistant)
 * ============================================================================= */
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, X, MessageSquare } from "lucide-react";
import { useLang } from "../lib/i18n.jsx";
import { getToken } from "../lib/api.js";
import { pollUpdates } from "../lib/messagesApi.js";
import callManager from "../lib/callManager.js";
import AssistantConversation from "./mchat/AssistantConversation.jsx";
import VideoCallOverlay from "./mchat/VideoCallOverlay.jsx";

// Always visible (2026-07-28 — "can you unhide the chat?"). This bubble used
// to auto-hide until the page was scrolled (an earlier fix for it covering
// clickable UI), but now that it's also the doorway to Vance's MusterChat
// messaging (unread badge, "Messages" jump to /assistant, incoming-call
// overlay) hiding it made the whole chat feature undiscoverable. If it covers
// something, drag it to any other corner — that behaviour was kept.
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
 * every desktop route. The panel hosts Vance's AssistantConversation (the AI
 * chat, same persisted chat_sessions as the /assistant page); person-to-person
 * messaging lives on /assistant (MusterChat inbox), which the unread bar/badge
 * here links to.
 */
export default function ChatBubble() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [corner, setCorner] = useState(() => {
    try { return localStorage.getItem(CORNER_KEY) || "br"; } catch { return "br"; }
  });
  const [dragPos, setDragPos] = useState(null); // {x,y} while actively being dragged
  const dragRef = useRef(null); // {startX, startY, moved}

  // Start the global incoming-call / signaling poll once, so a call can ring
  // on any page. Idempotent — safe to call on every mount.
  useEffect(() => { callManager.startGlobalPoll(); }, []);

  // Poll unread TEAM messages for the notification (independent of the AI chat).
  // Opening the AI bubble does not mark human messages read — only viewing the
  // thread on /assistant does — so the badge persists until they go there.
  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    const tick = async () => {
      try { const r = await pollUpdates(); if (alive) setUnread(r.unread || 0); }
      catch { /* signed out / transient */ }
    };
    tick();
    const id = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Always visible (2026-07-28 — "can you unhide the chat?"). The old
  // scroll-triggered auto-hide (fade in only while scrolling, fade out 5s
  // after) made the chat undiscoverable now that it's also the doorway to
  // MusterChat messaging. Drag-to-corner still works for moving it off
  // anything it covers.
  const visible = true;

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

  if (!getToken()) return null; // hidden on the login screen

  const goMessages = () => { setOpen(false); navigate("/assistant"); };

  const fabPosStyle = dragPos
    ? { left: dragPos.x - FAB_SIZE / 2, top: dragPos.y - FAB_SIZE / 2, right: "auto", bottom: "auto" }
    : CORNERS[corner];
  const panelPosStyle = {
    ...(corner.includes("b") ? { bottom: MARGIN + FAB_SIZE + 12, top: "auto" } : { top: MARGIN + FAB_SIZE + 12, bottom: "auto" }),
    ...(corner.includes("r") ? { right: MARGIN, left: "auto" } : { left: MARGIN, right: "auto" }),
  };

  return (
    <>
      {/* Global call layer — incoming ring + active call, on any page */}
      <VideoCallOverlay />

      {open && (
        <div className="mg-chatbubble-panel card" style={panelPosStyle}>
          <div className="row between" style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t("Trip assistant")}</div>
            <div className="row" style={{ gap: 4 }}>
              {/* Always-visible jump to the full MusterChat inbox (2026-07-28 —
                  "where the chat?": without this, /assistant was only linked
                  when unread > 0, so team messaging was undiscoverable). */}
              <button className="btn btn-ghost" onClick={goMessages} style={{ fontSize: 12, padding: "4px 10px" }}>
                <MessageSquare size={14} /> {t("Messages")}
              </button>
              <button onClick={() => setOpen(false)} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
                <X size={18} />
              </button>
            </div>
          </div>
          {unread > 0 && (
            <button className="mg-chatbubble-msgbar" onClick={goMessages}>
              <MessageSquare size={14} />
              {unread} {unread > 1 ? t("new team messages") : t("new team message")} — {t("open Messages")} →
            </button>
          )}
          {/* AssistantConversation's root card is a fixed 560px tall — give it
              a scrolling wrapper so its input row stays reachable when the
              viewport clamps the panel shorter than that. */}
          <div style={{ flex: 1, minHeight: 0, padding: 12, overflowY: "auto" }}>
            <AssistantConversation />
          </div>
        </div>
      )}

      {/* Incoming-message notification → navigates to the messaging page */}
      {!open && unread > 0 && (
        <button className="mg-chatbubble-notif" style={panelPosStyle} onClick={goMessages}>
          <MessageSquare size={15} />
          {unread} {unread > 1 ? t("new messages") : t("new message")} — {t("open Messages")}
        </button>
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
        {!open && unread > 0 && <span className="mg-chatbubble-badge">{unread > 99 ? "99+" : unread}</span>}
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
        .mg-chatbubble-badge {
          position: absolute; top: -3px; right: -3px; min-width: 20px; height: 20px; padding: 0 5px;
          border-radius: 10px; background: #fff; color: var(--scc-red);
          font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center;
          border: 2px solid var(--scc-red);
        }
        .mg-chatbubble-msgbar {
          display: flex; align-items: center; gap: 7px; cursor: pointer; flex-shrink: 0;
          background: var(--scc-red-tint); color: var(--scc-red); border: none;
          border-bottom: 1px solid var(--line);
          padding: 8px 14px; font-size: 12.5px; font-weight: 600; text-align: left;
        }
        .mg-chatbubble-notif {
          position: fixed; z-index: 55; cursor: pointer;
          display: inline-flex; align-items: center; gap: 7px;
          background: var(--ink); color: var(--surface, #fff); border: none;
          padding: 9px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
          box-shadow: var(--shadow-lg);
        }
        .mg-chatbubble-panel {
          position: fixed; z-index: 54;
          width: 440px; max-width: calc(100vw - 32px);
          height: 660px; max-height: calc(100vh - 140px);
          display: flex; flex-direction: column; padding: 0; overflow: hidden;
        }
      `}</style>
    </>
  );
}
