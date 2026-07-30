/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — chat shell (hosts Vance's MusterChat assistant)
 * ============================================================================= */
import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MessageCircle, X, MessageSquare } from "lucide-react";
import { useLang } from "../lib/i18n.jsx";
import { getToken } from "../lib/api.js";
import { pollUpdates } from "../lib/messagesApi.js";
import callManager from "../lib/callManager.js";
import AssistantConversation from "./mchat/AssistantConversation.jsx";
import QuickChat from "./mchat/QuickChat.jsx";
import VideoCallOverlay from "./mchat/VideoCallOverlay.jsx";

// Segmented "Assistant | Messages" tab button inside the bubble panel.
const tabBtnStyle = (active) => ({
  border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "5px 14px", borderRadius: 7,
  background: active ? "var(--surface, #fff)" : "transparent", color: active ? "var(--scc-red)" : "var(--ink-2)",
  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.1)" : "none", display: "inline-flex", alignItems: "center",
});

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
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("assistant"); // "assistant" (AI) | "messages" (quick chat)
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

  // The bubble is ALWAYS visible (2026-07-28 — "can you unhide the chat?").
  // The old scroll-triggered auto-hide (fade in only while scrolling, fade out
  // 5s after) made the chat undiscoverable now that it's also the doorway to
  // MusterChat messaging, so the whole visibility state was removed rather
  // than left as an always-true flag. Drag-to-corner still works for moving it
  // off anything it covers.

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
  // Redundant on the full MusterChat page (/assistant) — that page IS the inbox
  // and mounts its own call overlay + poll, so hide the floating bubble there.
  if (location.pathname === "/assistant") return null;

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
          {/* Assistant | Messages tabs — the bubble is the AI chatbot by default;
              the Messages tab is a simplified quick-chat for incoming team DMs. */}
          <div className="row between" style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 3, background: "var(--surface-2)", borderRadius: 9, padding: 3 }}>
              <button onClick={() => setTab("assistant")} style={tabBtnStyle(tab === "assistant")}>{t("Assistant")}</button>
              <button onClick={() => setTab("messages")} style={tabBtnStyle(tab === "messages")}>
                <MessageSquare size={13} style={{ marginRight: 5 }} /> {t("Messages")}
                {unread > 0 && <span style={{ marginLeft: 6, background: "var(--scc-red)", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 9, padding: "1px 6px" }}>{unread > 99 ? "99+" : unread}</span>}
              </button>
            </div>
            <button onClick={() => setOpen(false)} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          {tab === "assistant" ? (
            // AssistantConversation's root card is a fixed 560px tall — give it a
            // scrolling wrapper so its input row stays reachable when clamped.
            <div style={{ flex: 1, minHeight: 0, padding: 12, overflowY: "auto" }}>
              <AssistantConversation />
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0 }}>
              <QuickChat onOpenFull={goMessages} />
            </div>
          )}
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
        style={{ ...fabPosStyle, touchAction: "none" }}
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
