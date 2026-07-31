/* =============================================================================
 *  OWNED BY:  Vance — the MusterChat inbox body (contact rail + AI/human/group
 *  conversation pane). Shared by the /assistant page and the floating ChatBubble
 *  so both render the exact same full inbox — no duplication.
 * ============================================================================= */
import { useState, useEffect, useCallback } from "react";
import { Search, Bot, Users, Plus, X, Check } from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";
import { listContacts, listGroups, createGroup } from "../../lib/messagesApi.js";
import AssistantConversation from "./AssistantConversation.jsx";
import HumanThread from "./HumanThread.jsx";
import GroupThread from "./GroupThread.jsx";
import ContactAvatar from "./ContactAvatar.jsx";
import VideoCallOverlay from "./VideoCallOverlay.jsx";
import callManager from "../../lib/callManager.js";
import { formatListStamp as hhmm } from "../../lib/chatTime.js";


const AI = { kind: "ai", id: "assistant", name: "Trip Assistant" };

export default function MusterChatInbox({ railWidth = 300, initialActive = null }) {
  const { t } = useLang();
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  // Deep-link (2026-07-31): opens straight into a specific thread when the
  // caller passes one (ChatAssistantPage.jsx, from ChatBubble's "open full
  // inbox"); falls back to the pinned AI tab otherwise, same as before.
  const [active, setActive] = useState(() => initialActive || AI);
  const [filter, setFilter] = useState("");
  const [failed, setFailed] = useState(false);
  // Create-group modal
  const [newOpen, setNewOpen] = useState(false);
  const [gName, setGName] = useState("");
  const [gMembers, setGMembers] = useState(() => new Set());
  const [creating, setCreating] = useState(false);
  const [gCoachFilter, setGCoachFilter] = useState("all"); // "all" | a coachId

  const refresh = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([listContacts(), listGroups()]);
      setContacts(c.contacts || []); setGroups(g.groups || []); setFailed(false);
    } catch { setFailed(true); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // Start the incoming-call / signaling poll so calls ring here too (the global
  // ChatBubble also does this; startGlobalPoll is idempotent).
  useEffect(() => { callManager.startGlobalPoll(); }, []);

  const isActive = (kind, id) => active.kind === kind && active.id === id;
  const visible = contacts.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));
  const staff = contacts.filter((c) => c.kind === "account");
  // Coaches represented among the staff list (2026-07-31, "add filter by
  // coach assigned" — the New Group modal's member picker), so a group can be
  // quickly built out of one coach's team instead of scrolling every staff
  // account. Only staff who currently captain a coach show up here. A staff
  // member can captain more than one coach (multi-captain support), hence
  // coachIds/coachLabels are arrays — matching against `.includes()` rather
  // than equality.
  const staffCoaches = Array.from(
    new Map(staff.flatMap((c) => (c.coachIds || []).map((id, i) => [id, c.coachLabels[i] || id]))).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));
  const staffVisible = gCoachFilter === "all" ? staff : staff.filter((c) => (c.coachIds || []).includes(gCoachFilter));

  const rowStyle = (on) => ({
    cursor: "pointer",
    background: on ? "var(--scc-red-tint)" : "transparent",
    border: `1px solid ${on ? "var(--scc-red)" : "transparent"}`,
    borderRadius: 12, padding: "10px 12px", marginBottom: 4,
    display: "flex", alignItems: "center", gap: 10,
  });

  const toggleMember = (id) => setGMembers((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function submitGroup() {
    const name = gName.trim();
    if (!name || gMembers.size === 0 || creating) return;
    setCreating(true);
    try {
      const { group } = await createGroup(name, [...gMembers]);
      setNewOpen(false); setGName(""); setGMembers(new Set()); setGCoachFilter("all");
      await refresh();
      setActive({ kind: "group", id: group.id, name: group.name, memberCount: group.memberCount, createdByMe: group.createdByMe });
    } catch { /* keep modal open */ } finally { setCreating(false); }
  }

  return (
    // FIX (2026-07-31, "the chat conversation is longer than the chat list"):
    // AssistantConversation.jsx's root is now height:"100%" (was a fixed 560,
    // changed so it fits the floating bubble's shorter panel without a double
    // scrollbar — see ChatBubble.jsx). A first attempt just set `height: 560`
    // on this grid CONTAINER, which was wrong — a grid container's own outer
    // height doesn't constrain its implicit ROW track size, which still
    // sizes to content (the sidebar wanting height:"100%" of an unconstrained
    // row, plus the conversation's own content) — so the container clipped at
    // 560 while its single row actually grew to ~990px+ underneath, which is
    // exactly the "list way longer than it should be, chat looks squashed"
    // symptom reported. Setting `gridTemplateRows` (not just `height`) pins
    // the row itself to 560px, so BOTH cells' height:"100%"/560 now resolve
    // against a real, fixed 560px row — matching the original reference
    // layout (Vance's un-modified /assistant page).
    <div style={{ display: "grid", gridTemplateColumns: `${railWidth}px 1fr`, gridTemplateRows: "560px", gap: 16, minHeight: 0, height: 560 }}>
      {/* Contact rail */}
      <div className="card" style={{ padding: 12, height: "100%", minHeight: 0, overflowY: "auto" }}>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-3)" }} />
          <input className="input" placeholder={t("Search people…")} value={filter}
            onChange={(e) => setFilter(e.target.value)} style={{ paddingLeft: 32, padding: "8px 8px 8px 32px" }} />
        </div>

        {/* AI assistant — pinned */}
        <div className="page-eyebrow" style={{ padding: "4px 8px 6px" }}>{t("Assistant")}</div>
        <div onClick={() => setActive(AI)} style={rowStyle(active.kind === "ai")}>
          <span className="avatar" style={{ background: "var(--ink-solid)", color: "#fff", flexShrink: 0 }}><Bot size={16} /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{t("Trip Assistant")}</div>
            <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("Ask about the live trip")}</div>
          </div>
        </div>

        {/* Groups */}
        <div className="row between" style={{ padding: "14px 8px 6px" }}>
          <div className="page-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}><Users size={12} /> {t("Groups")}</div>
          <span role="button" title={t("New group")} onClick={() => setNewOpen(true)} style={{ cursor: "pointer", color: "var(--scc-red)", display: "flex" }}><Plus size={16} /></span>
        </div>
        {groups.filter((g) => g.name.toLowerCase().includes(filter.toLowerCase())).map((g) => {
          const on = isActive("group", g.id);
          return (
            <div key={`group:${g.id}`} onClick={() => setActive({ kind: "group", id: g.id, name: g.name, memberCount: g.memberCount, createdByMe: g.createdByMe })} style={rowStyle(on)}>
              <span className="avatar" style={{ background: "var(--scc-red)", color: "#fff", flexShrink: 0 }}><Users size={15} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row between" style={{ gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                  {g.lastAt && <div className="muted" style={{ fontSize: 10.5, flexShrink: 0 }}>{hhmm(g.lastAt)}</div>}
                </div>
                <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.lastMessage ? `${g.lastMine ? "You: " : ""}${g.lastMessage}` : `${g.memberCount} members`}
                </div>
              </div>
            </div>
          );
        })}
        {groups.length === 0 && <div className="muted" style={{ fontSize: 12, padding: "2px 8px 4px" }}>{t("No groups yet.")}</div>}

        {/* People */}
        <div className="page-eyebrow" style={{ padding: "14px 8px 6px", display: "flex", alignItems: "center", gap: 6 }}>
          <Users size={12} /> {t("People")}
        </div>
        {failed && <div className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>{t("Couldn't load contacts.")}</div>}
        {!failed && visible.length === 0 && <div className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>{t("No contacts found.")}</div>}
        {visible.map((c) => {
          const on = isActive(c.kind, c.id);
          return (
            <div key={`${c.kind}:${c.id}`} onClick={() => setActive(c)} style={rowStyle(on)}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <ContactAvatar name={c.name} kind={c.kind} photoUrl={c.photoUrl} />
                {c.online && <span style={{ position: "absolute", bottom: 0, right: 0, width: 11, height: 11, borderRadius: "50%", background: "var(--st-present)", border: "2px solid var(--surface, #fff)" }} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row between" style={{ gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  {c.lastAt && <div className="muted" style={{ fontSize: 10.5, flexShrink: 0 }}>{hhmm(c.lastAt)}</div>}
                </div>
                <div className="row between" style={{ gap: 6 }}>
                  <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {c.lastMessage ? `${c.lastMine ? "You: " : ""}${c.lastMessage}` : c.subtitle}
                  </div>
                  {c.unread > 0 && !on && (
                    <span style={{ flexShrink: 0, background: "var(--scc-red)", color: "#fff", fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{c.unread}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Conversation pane */}
      {active.kind === "ai" ? <AssistantConversation />
        : active.kind === "group" ? (
          <GroupThread
            key={`group:${active.id}`}
            group={active}
            onActivity={refresh}
            onUpdated={(g) => { setActive((a) => (a.id === g.id ? { ...a, ...g } : a)); refresh(); }}
            onDeleted={() => { setActive(AI); refresh(); }}
          />
        )
        : <HumanThread key={`${active.kind}:${active.id}`} peer={active} onActivity={refresh} />}

      {/* New-group modal */}
      {newOpen && (
        <div onClick={() => setNewOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ padding: 0, width: 380, maxWidth: "92%", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ fontWeight: 700 }}>{t("New group")}</div>
              <span role="button" onClick={() => setNewOpen(false)} style={{ cursor: "pointer", color: "var(--ink-3)", display: "flex" }}><X size={18} /></span>
            </div>
            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
              <input className="input" autoFocus placeholder={t("Group name")} value={gName} onChange={(e) => setGName(e.target.value)} />
              <div className="row between" style={{ padding: 0 }}>
                <div className="page-eyebrow" style={{ padding: 0 }}>{t("Add members")}</div>
                {gMembers.size > 0 && <div className="muted" style={{ fontSize: 11.5 }}>{gMembers.size} {t("selected")}</div>}
              </div>
              {/* Coach filter (2026-07-31, "add filter by coach assigned") — lets
                  a group be built quickly out of one coach's own team instead of
                  scrolling every staff account. Only shown when at least one
                  staff contact actually captains a coach. */}
              {staffCoaches.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button
                    onClick={() => setGCoachFilter("all")}
                    style={{ fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, border: `1px solid ${gCoachFilter === "all" ? "var(--scc-red)" : "var(--line)"}`, background: gCoachFilter === "all" ? "var(--scc-red-tint)" : "transparent", color: gCoachFilter === "all" ? "var(--scc-red)" : "var(--ink-2)", cursor: "pointer" }}
                  >
                    {t("All staff")}
                  </button>
                  {staffCoaches.map(([coachId, label]) => (
                    <button
                      key={coachId}
                      onClick={() => setGCoachFilter(coachId)}
                      style={{ fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, border: `1px solid ${gCoachFilter === coachId ? "var(--scc-red)" : "var(--line)"}`, background: gCoachFilter === coachId ? "var(--scc-red-tint)" : "transparent", color: gCoachFilter === coachId ? "var(--scc-red)" : "var(--ink-2)", cursor: "pointer" }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ overflowY: "auto", display: "grid", gap: 4, maxHeight: 260 }}>
                {staff.length === 0 && <div className="muted" style={{ fontSize: 12 }}>{t("No teammates to add.")}</div>}
                {staff.length > 0 && staffVisible.length === 0 && <div className="muted" style={{ fontSize: 12 }}>{t("No teammates on that coach.")}</div>}
                {staffVisible.map((c) => {
                  const checked = gMembers.has(c.id);
                  return (
                    <div key={c.id} onClick={() => toggleMember(c.id)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: checked ? "var(--scc-red-tint)" : "transparent" }}>
                      <ContactAvatar name={c.name} kind="account" photoUrl={c.photoUrl} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</div>
                        {c.coachLabels?.length > 0 && <div className="muted" style={{ fontSize: 11 }}>{c.coachLabels.join(", ")}</div>}
                      </div>
                      <span style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${checked ? "var(--scc-red)" : "var(--line)"}`, background: checked ? "var(--scc-red)" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {checked && <Check size={13} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="row" style={{ gap: 8, padding: 12, borderTop: "1px solid var(--line)" }}>
              <button className="btn btn-ghost btn-block" onClick={() => setNewOpen(false)}>{t("Cancel")}</button>
              <button className="btn btn-primary btn-block" disabled={!gName.trim() || gMembers.size === 0 || creating} onClick={submitGroup}>
                {creating ? t("Creating…") : `${t("Create")} (${gMembers.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live call screen (ringing / in-call) — fixed overlay, renders above all */}
      <VideoCallOverlay />
    </div>
  );
}
