/* =============================================================================
 *  OWNED BY:  Vance — MusterChat "quick chat". A compact person-to-person
 *  messaging surface for the floating chat bubbles (desktop + mobile): a recent-
 *  conversation list that opens an inline mini-thread you can read and text-reply
 *  in, without leaving the page. Deliberately simplified — no attachments /
 *  stickers / calls here; "Open full inbox" jumps to the full MusterChat page
 *  (/assistant) for those. Reuses the same /api/messages/* backend.
 * ============================================================================= */
import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Send, ArrowLeft, ExternalLink, Users } from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";
import { listContacts, getThread, sendMessage, markThreadRead } from "../../lib/messagesApi.js";

const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
// One-line preview for a non-text message in the mini-thread (kept simple).
const bodyOf = (m) => m.deleted ? "🚫 This message was deleted"
  : m.kind === "sticker" ? (m.body || "💟 Sticker")
  : m.kind === "doc" ? "📄 Document"
  : m.kind === "video" ? "📹 Video"
  : m.kind === "call" ? (m.body || "📞 Call")
  : m.body;

export default function QuickChat({ onOpenFull }) {
  const { t } = useLang();
  const [contacts, setContacts] = useState([]);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(null);   // peer { kind, id, name } or null (list view)
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const loadContacts = useCallback(async () => {
    try { const { contacts } = await listContacts(); setContacts(contacts || []); } catch { /* transient */ }
  }, []);
  useEffect(() => { loadContacts(); const id = setInterval(loadContacts, 4000); return () => clearInterval(id); }, [loadContacts]);

  // Load + poll the open thread, and mark it read so the bubble badge clears.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const pull = async () => {
      try {
        const r = await getThread(active.kind, active.id);
        if (alive) setMessages(r.messages || []);
      } catch { /* transient */ }
    };
    setMessages([]); pull();
    markThreadRead(active.kind, active.id).then(loadContacts).catch(() => {});
    const id = setInterval(pull, 1800);
    return () => { alive = false; clearInterval(id); };
  }, [active, loadContacts]);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !active) return;
    setDraft(""); setSending(true);
    const opt = { id: `tmp-${Date.now()}`, kind: "text", body, at: new Date().toISOString(), mine: true, pending: true };
    setMessages((m) => [...m, opt]);
    try {
      const { message } = await sendMessage(active.kind, active.id, { kind: "text", body });
      setMessages((m) => m.map((x) => (x.id === opt.id ? message : x)));
      loadContacts();
    } catch { setMessages((m) => m.map((x) => (x.id === opt.id ? { ...x, pending: false, failed: true } : x))); }
    finally { setSending(false); }
  };

  const openFull = () => onOpenFull?.();

  /* ---- list view -------------------------------------------------------- */
  if (!active) {
    const visible = contacts.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));
    // Conversations with history first (most recent), then the rest.
    const sorted = [...visible].sort((a, b) => (b.lastAt ? new Date(b.lastAt) : 0) - (a.lastAt ? new Date(a.lastAt) : 0));
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ padding: 10, borderBottom: "1px solid var(--line)", flexShrink: 0, position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 20, top: 20, color: "var(--ink-3)" }} />
          <input className="input" placeholder={t("Search people…")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ paddingLeft: 30, padding: "7px 8px 7px 30px", fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 6 }}>
          {sorted.length === 0 && <div className="muted" style={{ fontSize: 12.5, textAlign: "center", padding: 20 }}>{t("No contacts found.")}</div>}
          {sorted.map((c) => (
            <button key={`${c.kind}:${c.id}`} onClick={() => setActive({ kind: c.kind, id: c.id, name: c.name })}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <span className="avatar" style={{ background: c.kind === "delegate" ? "var(--ink-2)" : "var(--scc-red)", color: "#fff" }}>{initialsOf(c.name)}</span>
                {c.online && <span style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: "50%", background: "var(--st-present)", border: "2px solid var(--surface,#fff)" }} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row between" style={{ gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  {c.lastAt && <div className="muted" style={{ fontSize: 10, flexShrink: 0 }}>{hhmm(c.lastAt)}</div>}
                </div>
                <div className="row between" style={{ gap: 6 }}>
                  <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {c.lastMessage ? `${c.lastMine ? "You: " : ""}${c.lastMessage}` : c.subtitle}
                  </div>
                  {c.unread > 0 && <span style={{ flexShrink: 0, background: "var(--scc-red)", color: "#fff", fontSize: 10, fontWeight: 700, minWidth: 17, height: 17, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{c.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
        {onOpenFull && (
          <button className="btn btn-ghost" onClick={openFull} style={{ margin: 8, flexShrink: 0, fontSize: 12.5, justifyContent: "center" }}>
            <ExternalLink size={13} /> {t("Open full inbox")}
          </button>
        )}
      </div>
    );
  }

  /* ---- mini-thread view ------------------------------------------------- */
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="row" style={{ gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--line)", flexShrink: 0, alignItems: "center" }}>
        <button className="btn btn-ghost" style={{ padding: 5 }} onClick={() => setActive(null)}><ArrowLeft size={16} /></button>
        <span className="avatar" style={{ background: active.kind === "delegate" ? "var(--ink-2)" : "var(--scc-red)", color: "#fff", flexShrink: 0, width: 30, height: 30, fontSize: 12 }}>{initialsOf(active.name)}</span>
        <div style={{ fontWeight: 600, fontSize: 13.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active.name}</div>
        {onOpenFull && <button className="btn btn-ghost" title={t("Open full inbox")} style={{ padding: 5 }} onClick={openFull}><ExternalLink size={15} /></button>}
      </div>
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {messages.length === 0 && <div className="muted" style={{ margin: "auto", fontSize: 12.5, textAlign: "center", padding: "0 16px" }}>{t("No messages yet. Say hello.")}</div>}
        {messages.map((m) => {
          if (m.kind === "call") return <div key={m.id} style={{ alignSelf: "center", fontSize: 11, color: "var(--ink-3)" }}>{m.body} · {hhmm(m.at)}</div>;
          const mine = m.mine;
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", background: mine ? "var(--scc-red)" : "var(--surface,#fff)", color: mine ? "#fff" : "var(--ink)", border: mine ? "none" : "1px solid var(--line)", borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px", padding: "6px 10px", fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word", fontStyle: m.deleted ? "italic" : "normal", opacity: m.pending ? 0.7 : 1 }}>
              {bodyOf(m)}
            </div>
          );
        })}
      </div>
      <div className="row" style={{ gap: 6, padding: 8, borderTop: "1px solid var(--line)", flexShrink: 0, alignItems: "flex-end" }}>
        <input className="input" placeholder={`${t("Message")} ${active.name}…`} value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          style={{ fontSize: 13, padding: "8px 10px" }} />
        <button className="btn btn-primary" onClick={send} disabled={sending || !draft.trim()} style={{ padding: 9 }}><Send size={15} /></button>
      </div>
    </div>
  );
}
