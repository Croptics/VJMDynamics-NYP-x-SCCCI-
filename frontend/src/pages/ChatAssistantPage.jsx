import { useState, useRef, useEffect } from "react";
import { Send, Plus, Bot, Search } from "lucide-react";
import { useLang } from "../lib/i18n.jsx";

/**
 * Screen 6 — AI Trip Assistant (Vance).
 *
 * Use Case 2 — Real-Time Attendance & Exception Tracking via AI Chatbot.
 * Natural-language queries over live trip data, with quick-action chips.
 *
 * This is a working demo: messages render and a simulated assistant reply
 * comes back. In production, POST /api/chat/sessions/:id/messages routes the
 * query to Claude server-side, which answers over the live attendance DB and
 * returns structured actions (Send ping / Open Coach).
 */

const HISTORY = [
  { id: "h1", title: "Coach 2 missing list", time: "14:26", count: 4, group: "Today" },
  { id: "h2", title: "Today's exceptions", time: "13:14", count: 7, group: "Today" },
  { id: "h3", title: "VIP seating check", time: "11:02", count: 3, group: "Today" },
  { id: "h4", title: "Day 2 attendance report", time: "18:40", count: 12, group: "Yesterday" },
  { id: "h5", title: "Translate dinner menu", time: "19:22", count: 5, group: "Yesterday" },
];

const SEED = [
  { role: "USER", content: "Who is missing from Coach 2?", time: "14:26" },
  {
    role: "ASSISTANT",
    time: "14:26",
    content: "5 delegates haven't boarded Coach 2 yet:",
    list: [
      { name: "Lim Wei Jie", note: "VIP · last 14:08", vip: true },
      { name: "Ng Soo Peng", note: "phone unreachable" },
      { name: "Tan Boon Heng" },
      { name: "Wong Pei Shan" },
      { name: "Goh Mei Ling" },
    ],
    footer: "Departure in 4 mins. Ping the staff?",
    actions: ["Send ping", "Open Coach 2"],
  },
];

export default function ChatAssistantPage() {
  const { t } = useLang();
  const [messages, setMessages] = useState(SEED);
  const [draft, setDraft] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    setMessages((m) => [...m, { role: "USER", content: text, time: now }]);
    setDraft("");

    // Simulated assistant reply — production calls Claude over live data.
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          role: "ASSISTANT",
          time: now,
          content:
            "Reading live data… 143 of 158 delegates are present. 12 missing across Coach 1 (7) and Coach 2 (5); 3 unassigned. Want the full missing list or a coach breakdown?",
          actions: ["Full missing list", "By coach"],
        },
      ]);
    }, 700);
  }

  const grouped = HISTORY.reduce((acc, h) => {
    (acc[h.group] = acc[h.group] || []).push(h);
    return acc;
  }, {});

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-eyebrow">{t("Assistant")}</div>
      <h1 className="page-title">{t("Trip assistant")}</h1>
      <p className="page-sub">{t("Conversational queries · live data · translation")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, marginTop: 20 }}>
        {/* History */}
        <div className="card" style={{ padding: 12, height: 520, overflowY: "auto" }}>
          <button className="btn btn-dark btn-block" style={{ marginBottom: 12 }}>
            <Plus size={16} /> {t("New chat")}
          </button>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-3)" }} />
            <input className="input" placeholder={t("Search chats…")} style={{ paddingLeft: 32, padding: "8px 8px 8px 32px" }} />
          </div>
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div className="page-eyebrow" style={{ padding: "8px 8px 4px" }}>{t(group)}</div>
              {items.map((h, i) => (
                <button
                  key={h.id}
                  className="nav-item"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: group === "Today" && i === 0 ? "var(--scc-red-tint)" : "transparent",
                    color: group === "Today" && i === 0 ? "var(--scc-red)" : "var(--ink-2)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h.title}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{h.time} · {h.count} messages</div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Conversation */}
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
            {messages.map((m, i) =>
              m.role === "USER" ? (
                <div key={i} style={{ alignSelf: "flex-end", maxWidth: "75%" }}>
                  <div style={{ background: "var(--scc-red)", color: "#fff", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", fontSize: 14 }}>
                    {m.content}
                  </div>
                  <div className="muted" style={{ fontSize: 11, textAlign: "right", marginTop: 4 }}>{m.time}</div>
                </div>
              ) : (
                <div key={i} className="row" style={{ alignItems: "flex-start", gap: 10, maxWidth: "85%" }}>
                  <span className="avatar" style={{ background: "var(--ink)", color: "#fff" }}><Bot size={15} /></span>
                  <div>
                    <div style={{ background: m.list ? "var(--st-missing-bg)" : "var(--surface-2)", border: "1px solid var(--line)", padding: "10px 14px", borderRadius: "14px 14px 14px 4px", fontSize: 14 }}>
                      <div>{m.content}</div>
                      {m.list && (
                        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                          {m.list.map((p, j) => (
                            <li key={j} style={{ fontWeight: 600, marginBottom: 2 }}>
                              {p.name}{" "}
                              {p.note && <span className="muted" style={{ fontWeight: 400 }}>· {p.note}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {m.footer && <div style={{ marginTop: 8 }}>{m.footer}</div>}
                      {m.actions && (
                        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                          {m.actions.map((a, k) => (
                            <button key={k} className={k === 0 ? "btn btn-primary" : "btn btn-ghost"} style={{ padding: "6px 12px", fontSize: 13 }}>
                              {a}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{m.time}</div>
                  </div>
                </div>
              )
            )}
            <div ref={endRef} />
          </div>

          <div className="row" style={{ gap: 8, padding: 12, borderTop: "1px solid var(--line)" }}>
            <input
              className="input"
              placeholder={t("Ask anything about the trip…")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button className="btn btn-primary" onClick={send}><Send size={16} /> {t("Send")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
