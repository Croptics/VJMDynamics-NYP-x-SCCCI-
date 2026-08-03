/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Dashboard's Room Management sub-tab
 *
 *  Extracted from DashboardPage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import { useState, useEffect } from "react";
import { BedDouble, ChevronLeft, ChevronRight, Minus, Plus, Search, Sparkles, X } from "lucide-react";
import { apiPost, apiPatch } from "../../../lib/api.js";
import { bumpRoomNumber, coachDisplayName } from "../../../lib/dashboard/dashboardHelpers.js";

/**
 * Room Management tab (2026-07-26) — hotel/room quick-edit across the whole
 * roster, e.g. an end-of-day pass reassigning rooms. Reuses the SAME
 * `delegates` list the Delegate tab already has (no separate fetch) — edits
 * are per-row, local until "Save" is clicked for that row, so switching away
 * mid-edit never half-saves anything.
 */
export function RoomManagementTab({ delegates, coaches, coachName, onSaved, t, lang, tripId }) {
  const [query, setQuery] = useState("");
  const [coachFilter, setCoachFilter] = useState("ALL"); // ALL | <coachId>
  const [sortMode, setSortMode] = useState("name"); // name | coach | room
  const [edits, setEdits] = useState({}); // { [delegateId]: { hotelName, roomNumber } }
  const [savingId, setSavingId] = useState(null);
  // AI room assignment (2026-07-27 — "add like an ai feature so either i can
  // type it out and it will update the delegate room status, but give user
  // the confirmation before update the changes") — "Suggest" only ever
  // merges into `edits` (the SAME pending-edit state a manual keystroke
  // produces), never writes directly. That reuses every existing dirty-row/
  // Save affordance for free, so the human still has to explicitly click
  // Save (or "Save all suggested" below) before anything is persisted —
  // matching the "give user confirmation before update" requirement exactly.
  const [aiRequest, setAiRequest] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState(null);
  const [aiSuggestedIds, setAiSuggestedIds] = useState(new Set());
  const [savingAll, setSavingAll] = useState(false);
  // Pagination (2026-07-27 — "make sure to add something in all delegate
  // section, so when there alot of delegate") — mirrors the main "All
  // delegates" table's own Rows-per-page/Prev/Next pattern, own local state
  // since this is a separate component instance.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Bulk "everyone's in the same hotel" assignment (2026-07-26 — "it should
  // reflect to all delegate because they should stay in the same hotel").
  // Deliberately overwrites EVERY delegate's hotel unconditionally (a
  // window.confirm gates it, same pattern as "Delete all" elsewhere on this
  // page) — the per-row inputs right below stay there for the special-case
  // delegate who's actually in a different hotel, edited AFTER the bulk set.
  const [bulkHotel, setBulkHotel] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  // Unassigned delegates aren't confirmed for this trip's coach/itinerary yet
  // (2026-07-26 — "if they are not assigned. they should not be going to
  // hotel") — exclude them from Room Management entirely, not just the
  // filter dropdown, so they never get swept into the bulk hotel-for-all
  // either.
  const roomable = delegates.filter((d) => d.coachId);

  function fieldFor(d) {
    return edits[d.id] || { hotelName: d.hotel_name || "", roomNumber: d.room_number || "" };
  }
  function setField(d, key, value) {
    setEdits((prev) => ({ ...prev, [d.id]: { ...fieldFor(d), [key]: value } }));
  }
  async function save(d) {
    const { hotelName, roomNumber } = fieldFor(d);
    setSavingId(d.id);
    try {
      await apiPatch(`/delegates/${d.id}`, { hotelName: hotelName.trim(), roomNumber: roomNumber.trim() });
      setEdits((prev) => { const next = { ...prev }; delete next[d.id]; return next; });
      setAiSuggestedIds((prev) => { if (!prev.has(d.id)) return prev; const next = new Set(prev); next.delete(d.id); return next; });
      onSaved();
    } catch {
      /* leave the local edit in place so nothing typed is lost — the row's
         "Save" stays clickable to retry */
    } finally {
      setSavingId(null);
    }
  }

  async function askAi() {
    const request = aiRequest.trim();
    if (!request) return;
    setAiBusy(true);
    setAiErr(null);
    try {
      const res = await apiPost(`/trips/${tripId}/rooms/ai-suggest`, { request });
      const suggestions = res.suggestions || [];
      if (suggestions.length === 0) {
        setAiErr(t("Nothing to suggest — try naming a delegate, hotel, or room number."));
        return;
      }
      // The local model often handles only the FIRST person in a multi-name
      // request (2026-07-28) — say so rather than letting it look complete.
      if (res.partial) {
        setAiErr(`${t("Only")} ${suggestions.length} ${t("of")} ${res.mentioned} ${t("delegates you named were matched — review below, then ask again for the rest (one person per request works best).")}`);
      }
      setEdits((prev) => {
        const next = { ...prev };
        for (const s of suggestions) next[s.delegateId] = { hotelName: s.hotelName, roomNumber: s.roomNumber };
        return next;
      });
      setAiSuggestedIds(new Set(suggestions.map((s) => s.delegateId)));
      setAiRequest("");
    } catch (e) {
      setAiErr(e.message || t("Could not reach the AI right now."));
    } finally {
      setAiBusy(false);
    }
  }

  async function saveAllSuggested() {
    const ids = [...aiSuggestedIds].filter((id) => edits[id]);
    if (ids.length === 0) return;
    setSavingAll(true);
    try {
      const updates = ids.map((id) => ({ delegateId: id, ...edits[id] }));
      await apiPost(`/trips/${tripId}/rooms/ai-apply`, { updates });
      setEdits((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setAiSuggestedIds(new Set());
      onSaved();
    } catch {
      /* leave the pending edits in place so nothing typed is lost */
    } finally {
      setSavingAll(false);
    }
  }

  // General "save every pending edit at once" (2026-07-27 — "give me button
  // to save all instead of saving one by one") — covers manual keystrokes AND
  // AI suggestions alike, since both live in the same `edits` state. Reuses
  // the rooms/ai-apply endpoint (despite the name it's just a bulk
  // hotel/room write that re-validates every delegateId against the real
  // roster server-side) so this is ONE request, not N.
  async function saveAllEdits() {
    const ids = Object.keys(edits);
    if (ids.length === 0) return;
    setSavingAll(true);
    try {
      const updates = ids.map((id) => ({ delegateId: id, ...edits[id] }));
      await apiPost(`/trips/${tripId}/rooms/ai-apply`, { updates });
      setEdits({});
      setAiSuggestedIds(new Set());
      onSaved();
    } catch {
      /* leave the pending edits in place so nothing typed is lost */
    } finally {
      setSavingAll(false);
    }
  }

  /* Which delegates the bulk hotel applies to (2026-07-28 — "make it so if i
   * filter coach 1 it will apply to coach 1 delegate; if i filter to all coach
   * then apply to all"). Follows the COACH filter only, deliberately not the
   * search box: this button sits above the search row and reads as a
   * coach-level action, and silently narrowing it to whatever someone happened
   * to type would be a nasty surprise on a write that touches everyone. The
   * button label always names the exact target so there's nothing to guess. */
  const bulkTargets = coachFilter === "ALL" ? roomable : roomable.filter((d) => d.coachId === coachFilter);
  const bulkScopeLabel = coachFilter === "ALL" ? null : coachName(coachFilter);

  async function applyHotelToAll() {
    const name = bulkHotel.trim();
    if (!name || bulkTargets.length === 0) return;
    const n = bulkTargets.length;
    const msg = lang === "zh"
      ? (bulkScopeLabel
          ? `将 ${bulkScopeLabel} 的 ${n} 位代表的酒店设为 "${name}"？个别房间号不受影响，之后仍可单独修改。`
          : `将全部 ${n} 位（已分配教练的）代表的酒店设为 "${name}"？个别房间号不受影响，之后仍可单独修改。`)
      : (bulkScopeLabel
          ? `Set the hotel to "${name}" for the ${n} delegate${n === 1 ? "" : "s"} on ${bulkScopeLabel}? Room numbers are untouched — you can still edit individual delegates afterwards for a special case.`
          : `Set the hotel to "${name}" for all ${n} coach-assigned delegates? Room numbers are untouched — you can still edit individual delegates afterwards for a special case.`);
    if (!window.confirm(msg)) return;
    setBulkSaving(true);
    try {
      await Promise.all(bulkTargets.map((d) => apiPatch(`/delegates/${d.id}`, { hotelName: name, roomNumber: d.room_number || "" })));
      setBulkHotel("");
      setEdits({});
      onSaved();
    } finally {
      setBulkSaving(false);
    }
  }

  const filtered = roomable
    .filter((d) => !query.trim() || d.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((d) => coachFilter === "ALL" || d.coachId === coachFilter)
    .sort((a, b) => {
      if (sortMode === "coach") return coachName(a.coachId).localeCompare(coachName(b.coachId)) || a.name.localeCompare(b.name);
      if (sortMode === "room") return (a.room_number || "￿").localeCompare(b.room_number || "￿") || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  useEffect(() => { if (clampedPage !== page) setPage(clampedPage); }, [clampedPage, page]);
  useEffect(() => { setPage(0); }, [query, coachFilter, sortMode, pageSize]);
  const rowsShown = filtered.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);

  return (
    <div style={{ marginTop: 20 }}>
      <p className="page-sub" style={{ margin: "0 0 14px" }}>
        {t("Assign or reassign hotel/room per delegate — handy for an end-of-day pass.")}
      </p>

      {/* ---- AI room assignment (2026-07-27) -------------------------------
       * Bounded + transparent, same pattern as the Excel export's AI-filter:
       * "Suggest" only ever populates the pending-edit state below (the SAME
       * dirty-row/Save affordance a manual keystroke produces) — nothing is
       * written until a human clicks Save (per row, or "Save all suggested"
       * here), and every suggested delegateId is re-validated server-side
       * against the real roster before either the suggest OR apply step. */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Sparkles size={16} color="var(--scc-red)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{t("Ask AI to assign rooms")}</span>
          {/* A textarea, not a one-line input (2026-07-28 — "can you let me put
              in textbox instead of current one"): real requests run long ("Chen
              Hao Ming and Lim Hua into Grand Hyatt, rooms 401 and 402") and a
              single line hid most of what you'd typed. Enter still submits so
              the quick case stays quick; Shift+Enter adds a newline for
              multi-part instructions. */}
          <textarea
            className="input"
            rows={3}
            style={{ flex: "1 1 100%", fontSize: 13, resize: "vertical", minHeight: 62, lineHeight: 1.5, fontFamily: "inherit" }}
            placeholder={t("e.g. Put all VIPs in Grand Hyatt room 501 — Shift+Enter for a new line")}
            value={aiRequest} onChange={(e) => setAiRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!aiBusy && aiRequest.trim()) askAi(); }
            }}
          />
          <button className="btn btn-primary" style={{ fontSize: 12.5, padding: "6px 12px" }}
            onClick={askAi} disabled={aiBusy || !aiRequest.trim()}>
            {aiBusy ? t("Thinking…") : t("Suggest")}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          {t("This only fills in the fields below — nothing saves until you review and click Save.")}
        </p>
        {aiErr && <div style={{ color: "var(--st-missing)", fontSize: 12.5, marginTop: 6 }}>{aiErr}</div>}
        {aiSuggestedIds.size > 0 && (
          <div className="row between" style={{ marginTop: 10, padding: "8px 12px", background: "var(--st-assigned-bg)", borderRadius: "var(--r-sm)", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12.5 }}>
              {t("AI suggested changes for")} {aiSuggestedIds.size} {aiSuggestedIds.size === 1 ? t("delegate") : t("delegates")} — {t("review the highlighted rows below")}.
            </span>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={saveAllSuggested} disabled={savingAll}>
              {savingAll ? t("Saving…") : t("Save all suggested")}
            </button>
          </div>
        )}
      </div>

      {/* ---- Bulk "everyone's in this hotel" ------------------------------ */}
      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <BedDouble size={16} color="var(--ink-3)" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
          {bulkScopeLabel ? t("Set hotel for this coach") : t("Set hotel for everyone")}
        </span>
        <input
          className="input" style={{ maxWidth: 260, fontSize: 13 }}
          placeholder={t("e.g. Grand Hyatt")}
          value={bulkHotel} onChange={(e) => setBulkHotel(e.target.value)}
        />
        <button className="btn btn-primary" style={{ fontSize: 12.5, padding: "6px 12px" }}
          onClick={applyHotelToAll} disabled={bulkSaving || !bulkHotel.trim() || bulkTargets.length === 0}>
          {bulkSaving
            ? t("Applying…")
            : bulkScopeLabel
              ? `${t("Apply to")} ${bulkScopeLabel} (${bulkTargets.length})`
              : `${t("Apply to all")} ${bulkTargets.length}`}
        </button>
        <span className="muted" style={{ fontSize: 11.5, width: "100%" }}>
          {bulkScopeLabel
            ? `${t("Follows the coach filter — only the")} ${bulkTargets.length} ${t("delegate(s) on")} ${bulkScopeLabel} ${t("will change. Switch the filter to \"All coaches\" to apply trip-wide. Room numbers are untouched, and the search box doesn't affect this.")}`
            : t("Room numbers are untouched — edit individual rows below for a delegate in a different hotel. Filter to one coach to apply to just that coach. Delegates without a coach aren't shown here — they aren't confirmed for a hotel yet.")}
        </span>
      </div>

      {/* ---- Search / filter / sort ---------------------------------------- */}
      <div className="row" style={{ gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", maxWidth: 260, flex: "1 1 200px" }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder={t("Search name…")}
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select" style={{ maxWidth: 190 }} value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)}>
          <option value="ALL">{t("All coaches")}</option>
          <optgroup label={t("Coaches")}>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>{coachDisplayName(c)}</option>
            ))}
          </optgroup>
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
          <option value="name">{t("Sort by name")}</option>
          <option value="coach">{t("Sort by coach")}</option>
          <option value="room">{t("Sort by room")}</option>
        </select>
      </div>

      {/* ---- Save-all bar (2026-07-27 — "give me button to save all instead
       * of saving one by one") — appears whenever ANY row has a pending edit,
       * manual or AI-suggested; the per-row Save buttons stay for saving just
       * one delegate while still deciding on the rest. */}
      {Object.keys(edits).length > 0 && (
        <div className="row between" style={{ marginBottom: 14, padding: "10px 14px", background: "var(--st-assigned-bg)", borderRadius: "var(--r-sm)", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 13 }}>
            {Object.keys(edits).length} {Object.keys(edits).length === 1 ? t("unsaved change") : t("unsaved changes")}
          </span>
          <div className="row" style={{ gap: 8 }}>
            {/* Discard (2026-07-28 — "give me option to cancel changes"). Until
                now the only way out of a wrong AI suggestion or a mistyped row
                was to reload the page: the inputs are local pending state, so
                nothing reverted them. Clears every pending edit and the
                AI-suggested highlighting in one go; nothing was ever written, so
                there's nothing to undo server-side. */}
            <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px" }}
              onClick={() => { setEdits({}); setAiSuggestedIds(new Set()); }} disabled={savingAll}>
              <X size={13} /> {t("Discard")}
            </button>
            <button className="btn btn-primary" style={{ fontSize: 12.5, padding: "6px 14px" }}
              onClick={saveAllEdits} disabled={savingAll}>
              {savingAll ? t("Saving…") : `${t("Save all")} (${Object.keys(edits).length})`}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th>{t("Coach")}</th>
              <th>{t("Hotel")}</th>
              <th>{t("Room number")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rowsShown.map((d) => {
              const f = fieldFor(d);
              const dirty = edits[d.id] !== undefined;
              const aiSuggested = aiSuggestedIds.has(d.id);
              return (
                <tr key={d.id} style={aiSuggested ? { background: "var(--st-assigned-bg)" } : undefined}>
                  <td>{d.name}{aiSuggested && <Sparkles size={12} color="var(--scc-red)" style={{ marginLeft: 6, verticalAlign: "middle" }} />}</td>
                  <td className="muted">{coachName(d.coachId)}</td>
                  <td>
                    <input className="input" style={{ fontSize: 13 }} value={f.hotelName}
                      onChange={(e) => setField(d, "hotelName", e.target.value)} placeholder={t("Hotel")} />
                  </td>
                  <td>
                    {/* Increment/decrement stepper (2026-07-27 — "option to
                        do increment for the room number") — handy for
                        assigning consecutive rooms down a delegate list
                        without retyping the whole number each time. */}
                    <div className="row" style={{ gap: 4, alignItems: "center" }}>
                      <button
                        className="btn btn-ghost" style={{ padding: "4px 6px", flexShrink: 0 }}
                        aria-label={t("Decrease room number")}
                        onClick={() => setField(d, "roomNumber", bumpRoomNumber(f.roomNumber, -1))}
                      >
                        <Minus size={12} />
                      </button>
                      <input className="input" style={{ fontSize: 13, maxWidth: 90, textAlign: "center" }} value={f.roomNumber}
                        onChange={(e) => setField(d, "roomNumber", e.target.value)} placeholder={t("Room")} />
                      <button
                        className="btn btn-ghost" style={{ padding: "4px 6px", flexShrink: 0 }}
                        aria-label={t("Increase room number")}
                        onClick={() => setField(d, "roomNumber", bumpRoomNumber(f.roomNumber, 1))}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </td>
                  <td>
                    {dirty && (
                      <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: "4px 10px" }}
                        onClick={() => save(d)} disabled={savingId === d.id}>
                        {savingId === d.id ? t("Saving…") : t("Save")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 20 }}>{t("No delegates match your search.")}</td></tr>
            )}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <div className="row between" style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", flexWrap: "wrap", gap: 10 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {t("Showing")} {clampedPage * pageSize + 1}–{Math.min((clampedPage + 1) * pageSize, filtered.length)} {t("of")} {filtered.length}
            </span>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12.5 }}>{t("Rows per page")}</span>
              <select className="select" style={{ width: 76, padding: "4px 8px" }} value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}>
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <button className="btn btn-ghost" style={{ padding: "4px 10px" }} disabled={clampedPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft size={14} /> {t("Prev")}
              </button>
              <span className="muted" style={{ fontSize: 12.5 }}>{t("Page")} {clampedPage + 1} {t("of")} {pageCount}</span>
              <button className="btn btn-ghost" style={{ padding: "4px 10px" }} disabled={clampedPage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
                {t("Next")} <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Checkpoint history — trip-wide "view past status of delegate" (2026-07-27
 *  — "currently i not able to see the past itinerary, i want to be able to
 *  view past status of delegate"). Previously only reachable one delegate at
 *  a time (their profile panel's DelegateTimeline), buried inside each
 *  individual record; this surfaces it as its own Dashboard tab instead. UI
 *  deliberately styled as a simple search + flat list (2026-07-27 — "i quite
 *  like [the Scanner's Manual tab's] simple list-style ui, just not the
 *  override functionality itself") — a plain searchable list of delegates,
 *  each expandable in place to show their real per-checkpoint history via
 *  the EXISTING `GET /delegates/:id/checkpoint-timeline` endpoint (already
 *  coach-scoped server-side, same as every other delegate read — nothing new
 *  needed there). Fetched lazily per-delegate on first expand, not all
 *  upfront, so opening this tab with a large roster doesn't fire N requests
 *  before anyone's even clicked anything. */
