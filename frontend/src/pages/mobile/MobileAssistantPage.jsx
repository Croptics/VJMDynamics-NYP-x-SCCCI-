import { useEffect, useRef, useState } from "react";
import { Send, Bot } from "lucide-react";
import { apiPost } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";

// Same suggested prompts as the desktop assistant (AssistantConversation.jsx).
const STARTERS = [
  "Who is missing from Coach 2?",
  "Give me an attendance summary.",
  "What open exceptions are there right now?",
  "What's on today's itinerary?",
];

/**
 * Mobile Assistant — thin mobile-styled wrapper around the same
 * POST /api/chat/messages endpoint used by the desktop ChatAssistantPage.
 * No backend changes needed; same auth, same route.
 */
export default function MobileAssistantPage({ embedded = false }) {
  const { t } = useLang();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send(preset) {
    const text = (typeof preset === "string" ? preset : draft).trim();
    if (!text || sending) return;
    const history = [...messages, { role: "USER", content: text }];
    setMessages(history);
    setDraft("");
    setSending(true);
    try {
      const { reply } = await apiPost("/chat/messages", { messages: history });
      setMessages((m) => [...m, { role: "ASSISTANT", content: reply.content }]);
    } catch (e) {
      const notice = e.message || "The AI assistant is temporarily unavailable.";
      setMessages((m) => [...m, { role: "ASSISTANT", content: notice, notice: true }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: embedded ? "100%" : "calc(100vh - 180px)" }}>
      {!embedded && (<>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 4 }}>
          {t("Assistant")}
        </div>
        <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>{t("Ask about the trip")}</h1>
      </>)}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "18px 6px" }}>
            <span className="avatar" style={{ background: "var(--ink-solid)", color: "#fff", width: 42, height: 42, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center" }}><Bot size={20} /></span>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t("Ask about the trip")}</div>
            <p className="muted" style={{ fontSize: 12.5, margin: "0 auto 14px", maxWidth: 300, lineHeight: 1.5 }}>
              {t("Live attendance, missing delegates, coach status, open exceptions or today's itinerary — in English or 中文.")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {STARTERS.map((s) => (
                <button key={s} className="btn btn-ghost" style={{ fontSize: 13, justifyContent: "flex-start", textAlign: "left" }} onClick={() => send(s)}>
                  {t(s)}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "USER" ? (
            <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--scc-red)", color: "#fff", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", fontSize: 14 }}>
              {m.content}
            </div>
          ) : (
            <div key={i} className="row" style={{ alignItems: "flex-start", gap: 8, maxWidth: "90%" }}>
              <span className="avatar" style={{ background: "var(--ink-solid)", color: "#fff", flexShrink: 0 }}><Bot size={14} /></span>
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
        {sending && <div className="muted" style={{ fontSize: 13 }}>{t("Thinking…")}</div>}
        <div ref={endRef} />
      </div>

      <div className="row" style={{ gap: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
        <input
          className="input"
          placeholder={t("Ask anything…")}
          value={draft}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn btn-primary" onClick={send} disabled={sending} aria-label={t("Send")}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
