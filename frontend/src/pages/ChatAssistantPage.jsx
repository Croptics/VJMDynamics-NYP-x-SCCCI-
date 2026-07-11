/* =============================================================================
 *  OWNED BY:  Vance — Trip Assistant (AI Chatbot)
 * ============================================================================= */
import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Plus, Bot, Search, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiDelete } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * Screen 6 — AI Trip Assistant (Vance). Use Case 2.
 *
 * Natural-language questions answered over the LIVE trip snapshot (delegates,
 * coaches, exceptions, check-ins, itinerary — every teammate's data), by
 * backend/routes/vance.js. Chats are SAVED per account, so the sidebar history
 * is real: new chats auto-title from the first question and can be reopened or
 * deleted (the use-case postcondition "the query is logged in the chat history").
 */

const STARTERS = [
  "Who is missing from Coach 2?",
  "Give me an attendance summary.",
  "What open exceptions are there right now?",
  "What's on today's itinerary?",
];

// Group saved chats into Today / Yesterday / Earlier for the sidebar.
function groupByDay(sessions) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const groups = { Today: [], Yesterday: [], Earlier: [] };
  for (const s of sessions) {
    const t = new Date(s.updated_at).getTime();
    if (t >= startOfToday) groups.Today.push(s);
    else if (t >= startOfYesterday) groups.Yesterday.push(s);
    else groups.Earlier.push(s);
  }
  return Object.entries(groups).filter(([, items]) => items.length);
}

const hhmm = (iso) => {
  try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
};

export default function ChatAssistantPage() {
  const { t, lang } = useLang();
  const [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState("");
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  /* ---- load the sidebar list ------------------------------------------- */
  const loadSessions = useCallback(async () => {
    try {
      const { sessions } = await apiGet("/chat/sessions");
      setSessions(sessions);
      return sessions;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    (async () => {
      const list = await loadSessions();
      if (list.length) openSession(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- open / new / delete --------------------------------------------- */
  async function openSession(id) {
    setCurrentId(id);
    setMessages([]);
    try {
      const { messages } = await apiGet(`/chat/sessions/${id}`);
      setMessages(messages.map((m) => ({ role: m.role.toUpperCase(), content: m.content })));
    } catch { /* ignore */ }
  }

  function newChat() {
    setCurrentId(null);
    setMessages([]);
    setDraft("");
  }

  async function removeSession(id, e) {
    e.stopPropagation();
    if (!window.confirm(t("Delete this chat?"))) return;
    try {
      await apiDelete(`/chat/sessions/${id}`);
      const list = await loadSessions();
      if (id === currentId) {
        if (list.length) openSession(list[0].id);
        else newChat();
      }
    } catch { /* ignore */ }
  }

  /* ---- send ------------------------------------------------------------ */
  async function send(text) {
    const content = (text ?? draft).trim();
    if (!content || sending) return;
    setDraft("");
    setSending(true);
    setMessages((m) => [...m, { role: "USER", content }]);

    try {
      // Create a session on the first message of a brand-new chat, and show it
      // in the sidebar IMMEDIATELY (before the slow AI reply) so it's obvious a
      // new chat was started.
      let sessionId = currentId;
      if (!sessionId) {
        const created = await apiPost("/chat/sessions", {});
        sessionId = created.id;
        setCurrentId(sessionId);
        await loadSessions();
      }
      const { reply } = await apiPost(`/chat/sessions/${sessionId}/messages`, { content, lang });
      setMessages((m) => [...m, { role: "ASSISTANT", content: reply.content }]);
      loadSessions(); // refresh titles/order in the sidebar
    } catch (err) {
      setMessages((m) => [...m, { role: "ASSISTANT", content: err.message || t("The assistant is temporarily unavailable."), notice: true }]);
    } finally {
      setSending(false);
    }
  }

  const visible = sessions.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-eyebrow">{t("Assistant")}</div>
      <h1 className="page-title">{t("Trip assistant")}</h1>
      <p className="page-sub">{t("Conversational queries · live data · translation")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, marginTop: 20 }}>
        {/* History sidebar */}
        <div className="card" style={{ padding: 12, height: 520, overflowY: "auto" }}>
          <button className="btn btn-dark btn-block" style={{ marginBottom: 12 }} onClick={newChat}>
            <Plus size={16} /> {t("New chat")}
          </button>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-3)" }} />
            <input
              className="input"
              placeholder={t("Search chats…")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ paddingLeft: 32, padding: "8px 8px 8px 32px" }}
            />
          </div>

          {visible.length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>
              {t("No saved chats yet. Ask something to start one.")}
            </div>
          )}

          {groupByDay(visible).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div className="page-eyebrow" style={{ padding: "8px 8px 4px" }}>{t(group)}</div>
              {items.map((h) => {
                const active = h.id === currentId;
                return (
                  <button
                    key={h.id}
                    className="nav-item"
                    onClick={() => openSession(h.id)}
                    style={{
                      width: "100%", textAlign: "left",
                      background: active ? "var(--scc-red-tint)" : "transparent",
                      color: active ? "var(--scc-red)" : "var(--ink-2)",
                      display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {h.title}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {hhmm(h.updated_at)} · {h.message_count} {t("messages")}
                      </div>
                    </div>
                    <span
                      role="button"
                      aria-label={t("Delete this chat?")}
                      onClick={(e) => removeSession(h.id, e)}
                      style={{ color: "var(--ink-3)", display: "flex", padding: 2 }}
                    >
                      <Trash2 size={14} />
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Conversation panel */}
        <div className="card" style={{ display: "flex", flexDirection: "column", height: 520 }}>
          <div className="row" style={{ gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <span className="avatar" style={{ background: "var(--ink)", color: "#fff" }}><Bot size={16} /></span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t("Trip assistant")}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                <span style={{ color: "var(--st-present)" }}>● {t("Ready")}</span> · scoped to Beijing study mission · Eng/中文
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            {messages.length === 0 && (
              <div style={{ margin: "auto 0", textAlign: "center" }}>
                <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
                  {t("Ask about live attendance, missing delegates, exceptions or the itinerary.")}
                </p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {STARTERS.map((s) => (
                    <button key={s} className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => send(s)}>
                      {t(s)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "USER" ? (
                <div key={i} style={{ alignSelf: "flex-end", maxWidth: "75%" }}>
                  <div style={{ background: "var(--scc-red)", color: "#fff", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", fontSize: 14, whiteSpace: "pre-wrap" }}>
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="row" style={{ alignItems: "flex-start", gap: 10, maxWidth: "85%" }}>
                  <span className="avatar" style={{ background: "var(--ink)", color: "#fff", flexShrink: 0 }}><Bot size={15} /></span>
                  <div style={{
                    background: m.notice ? "var(--st-unassigned-bg)" : "var(--surface-2)",
                    border: m.notice ? "1px solid var(--st-unassigned)" : "1px solid var(--line)",
                    color: m.notice ? "var(--st-unassigned)" : undefined,
                    padding: "10px 14px", borderRadius: "14px 14px 14px 4px", fontSize: 14, whiteSpace: "pre-wrap",
                  }}>
                    {m.content}
                  </div>
                </div>
              )
            )}
            {sending && (
              <div className="row" style={{ alignItems: "flex-start", gap: 10, maxWidth: "85%" }}>
                <span className="avatar" style={{ background: "var(--ink)", color: "#fff", flexShrink: 0 }}><Bot size={15} /></span>
                <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", padding: "13px 16px", borderRadius: "14px 14px 14px 4px" }}>
                  <span className="mg-typing"><i /><i /><i /></span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="row" style={{ gap: 8, padding: 12, borderTop: "1px solid var(--line)" }}>
            <input
              className="input"
              placeholder={t("Ask anything about the trip…")}
              value={draft}
              disabled={sending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button className="btn btn-primary" onClick={() => send()} disabled={sending}>
              <Send size={16} /> {t("Send")}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .mg-typing{display:inline-flex;gap:4px;align-items:center}
        .mg-typing i{width:7px;height:7px;border-radius:50%;background:var(--ink-3);display:inline-block;animation:mg-bounce 1.2s infinite ease-in-out}
        .mg-typing i:nth-child(2){animation-delay:.15s}
        .mg-typing i:nth-child(3){animation-delay:.3s}
        @keyframes mg-bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}
      `}</style>
    </div>
  );
}
