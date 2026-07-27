/* =============================================================================
 *  OWNED BY:  Vance — MusterChat floating bubble. A fixed, always-visible
 *  launcher (bottom-right, on every page) that opens the AI Trip Assistant
 *  chatbot. It does NOT show person-to-person messaging itself — instead it
 *  NOTIFIES the user of incoming team messages (badge + prompt) and, on click,
 *  navigates to the Chat Assistant page (/assistant) where messaging lives.
 *
 *  The AI chat here uses the same persisted chat_sessions as the /assistant
 *  page's assistant, so a conversation started in the bubble is remembered and
 *  visible there (and vice-versa).
 *
 *  Mounted once, globally (see MOUNT note at bottom).
 * ============================================================================= */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, X, MessageSquare } from "lucide-react";
import { pollUpdates } from "../lib/messagesApi.js";
import { getToken } from "../lib/api.js";
import callManager from "../lib/callManager.js";
import AssistantConversation from "./mchat/AssistantConversation.jsx";
import VideoCallOverlay from "./mchat/VideoCallOverlay.jsx";

export default function ChatBubble() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

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

  if (!getToken()) return null; // hidden on the login screen

  const goMessages = () => { setOpen(false); navigate("/assistant"); };

  return (
    <>
      {/* Global call layer — incoming ring + active call, on any page */}
      <VideoCallOverlay />

      {/* AI chatbot panel */}
      {open && (
        <div className="mc-bubble-panel" role="dialog" aria-label="Trip Assistant">
          {unread > 0 && (
            <button className="mc-bubble-msgbar" onClick={goMessages}>
              <MessageSquare size={14} />
              {unread} new team message{unread > 1 ? "s" : ""} — open Messages →
            </button>
          )}
          <AssistantConversation />
        </div>
      )}

      {/* Incoming-message notification → navigates to the messaging page */}
      {!open && unread > 0 && (
        <button className="mc-bubble-notif" onClick={goMessages}>
          <MessageSquare size={15} />
          {unread} new message{unread > 1 ? "s" : ""} — open Messages
        </button>
      )}

      {/* FAB = AI Trip Assistant */}
      <button className="mc-bubble-fab" aria-label={open ? "Close assistant" : "Open trip assistant"} onClick={() => setOpen((o) => !o)}>
        {open ? <X size={24} /> : <Bot size={24} />}
        {!open && unread > 0 && <span className="mc-bubble-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>

      <style>{`
        .mc-bubble-fab {
          position: fixed; bottom: 24px; right: 24px; z-index: 55;
          width: 58px; height: 58px; border-radius: 50%; border: none; cursor: pointer;
          background: var(--scc-red, #E1232A); color: #fff;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25); transition: transform .15s ease, box-shadow .15s ease;
        }
        .mc-bubble-fab:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(0,0,0,0.3); }
        .mc-bubble-badge {
          position: absolute; top: -3px; right: -3px; min-width: 20px; height: 20px; padding: 0 5px;
          border-radius: 10px; background: #fff; color: var(--scc-red, #E1232A);
          font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center;
          border: 2px solid var(--scc-red, #E1232A);
        }
        .mc-bubble-notif {
          position: fixed; bottom: 92px; right: 24px; z-index: 55; cursor: pointer;
          display: inline-flex; align-items: center; gap: 7px;
          background: var(--ink, #1a1a1a); color: #fff; border: none;
          padding: 9px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
          box-shadow: 0 8px 24px rgba(0,0,0,0.28); animation: mc-bubble-pop .16s ease-out;
        }
        .mc-bubble-panel {
          position: fixed; bottom: 92px; right: 24px; z-index: 55;
          width: min(440px, calc(100vw - 32px));
          display: flex; flex-direction: column; gap: 8px;
          animation: mc-bubble-pop .16s ease-out;
        }
        .mc-bubble-msgbar {
          display: flex; align-items: center; gap: 7px; cursor: pointer;
          background: var(--scc-red-tint); color: var(--scc-red); border: 1px solid var(--scc-red-tint-2, var(--scc-red));
          padding: 8px 12px; border-radius: 10px; font-size: 12.5px; font-weight: 600; text-align: left;
        }
        @keyframes mc-bubble-pop { from { transform: translateY(10px) scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }
        @media (max-width: 640px) {
          .mc-bubble-panel { right: 12px; left: 12px; width: auto; bottom: 88px; }
          .mc-bubble-fab { bottom: 16px; right: 16px; }
          .mc-bubble-notif { right: 16px; bottom: 84px; }
        }
      `}</style>
    </>
  );
}
