/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Dashboard's Checkpoint history sub-tab
 *
 *  Extracted from DashboardPage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Clock, Crown, Search, X } from "lucide-react";
import { apiGet } from "../../../lib/api.js";
import DelegateAvatar from "../../../components/delegate/DelegateAvatar.jsx";
import StatusBadge from "../../../components/StatusBadge.jsx";
import { coachDisplayName, fmt12h } from "../../../lib/dashboard/dashboardHelpers.js";

export function CheckpointHistoryTab({ coaches, t, tripId }) {
  const [query, setQuery] = useState("");
  const [coachFilter, setCoachFilter] = useState("ALL");   // ALL | NONE | <coachId>
  const [attFilter, setAttFilter] = useState("ALL");       // ALL | CLEAN | ISSUES
  const [dayFilter, setDayFilter] = useState("ALL");       // ALL | <dayNumber>
  // Single-stop drill-down (2026-07-29 — "under the day filter, add filter to
  // see that specific itinerary, so i can see how many was late, arrived,
  // missing for that specific time"). Narrowing `visibleStops` to one stop is
  // all it takes: every count on this tab is already derived from that array
  // (see tally() below), so the summary strip, the chips and the attendance
  // filters all scope themselves to the chosen stop automatically.
  const [stopFilter, setStopFilter] = useState("ALL");     // ALL | <stopId>
  const [expandedId, setExpandedId] = useState(null);
  const [data, setData] = useState(null);                   // { stops, delegates, totalStops }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet(`/trips/${tripId}/checkpoint-matrix`)
      .then((r) => { if (alive) { setData(r); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e.message || "Could not load checkpoint history."); setLoading(false); } });
    return () => { alive = false; };
  }, [tripId]);

  const stops = data?.stops || [];
  const rows = data?.delegates || [];

  // ---- Day handling (2026-07-28 — "can you sort by date instead? like day 1,
  // day 2, day 3"). The backend already returns stops in day/time order, but a
  // flat run of 20 chips gave no clue where one day ended and the next began.
  // So: a Day filter, and when showing every day the chips are GROUPED with a
  // small D1/D2/D3 label per group.
  const days = [...new Set(stops.map((s) => s.dayNumber))].sort((a, b) => a - b);
  // Day narrows first, then the optional single-stop pick narrows within it.
  const dayStops = dayFilter === "ALL" ? stops : stops.filter((s) => s.dayNumber === Number(dayFilter));
  const selectedStop = stopFilter === "ALL" ? null : dayStops.find((s) => s.id === stopFilter) || null;
  const visibleStops = selectedStop ? [selectedStop] : dayStops;

  // A stop chosen on Day 1 doesn't exist once you switch to Day 2, so the
  // selection is dropped whenever it falls outside the current day — otherwise
  // `visibleStops` would silently go empty and every count would read 0.
  useEffect(() => {
    if (stopFilter !== "ALL" && !dayStops.some((s) => s.id === stopFilter)) setStopFilter("ALL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayFilter, stops]);
  // Group the stops actually on screen, preserving day order.
  const stopGroups = days
    .map((day) => ({ day, items: visibleStops.filter((s) => s.dayNumber === day) }))
    .filter((g) => g.items.length > 0);

  // Counts are recomputed over the stops CURRENTLY SHOWN rather than reusing the
  // server's whole-trip totals — otherwise filtering to Day 2 would show Day 2's
  // chips next to trip-wide numbers, which is exactly the kind of quiet
  // mismatch that makes a dashboard untrustworthy.
  function tally(d) {
    let arrived = 0, late = 0, missing = 0, recorded = 0;
    for (const s of visibleStops) {
      const cell = d.cells[s.id];
      if (!cell) continue;
      recorded += 1;
      if (cell.status === "ARRIVED") arrived += 1;
      else if (cell.status === "LATE") late += 1;
      else if (cell.status === "MISSING") missing += 1;
    }
    return { arrived, late, missing, recorded };
  }
  const counted = rows.map((d) => ({ ...d, ...tally(d) }));

  const totals = {
    delegates: counted.length,
    clean: counted.filter((d) => d.missing === 0 && d.late === 0).length,
    issues: counted.filter((d) => d.missing > 0 || d.late > 0).length,
  };

  // With one stop selected, "how many arrived / were late / missing at THIS
  // time" is the whole question being asked, so the summary strip switches to
  // answering exactly that instead of trip-wide roll-ups. Computed over the
  // same full roster the other strip tiles use, so the four numbers always sum
  // to the delegate count. "No record" is the honest fourth bucket: a delegate
  // with no check-in row for this stop is neither present nor confirmed
  // absent, and folding them into Missing would overstate the problem.
  const stopTotals = selectedStop
    ? counted.reduce((acc, d) => {
      const status = d.cells[selectedStop.id]?.status;
      if (status === "ARRIVED") acc.arrived += 1;
      else if (status === "LATE") acc.late += 1;
      else if (status === "MISSING") acc.missing += 1;
      else acc.noRecord += 1;
      return acc;
    }, { arrived: 0, late: 0, missing: 0, noRecord: 0 })
    : null;

  const visible = counted
    .filter((d) => !query.trim() || d.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((d) => {
      if (coachFilter === "ALL") return true;
      if (coachFilter === "NONE") return !d.coachId;
      return d.coachId === coachFilter;
    })
    .filter((d) => {
      if (attFilter === "CLEAN") return d.missing === 0 && d.late === 0;
      if (attFilter === "ISSUES") return d.missing > 0 || d.late > 0;
      return true;
    });

  const toneFor = (status) =>
    status === "ARRIVED" ? { bg: "var(--st-present-bg)", fg: "var(--st-present)" }
      : status === "LATE" ? { bg: "var(--st-late-bg)", fg: "var(--st-late)" }
        : status === "MISSING" ? { bg: "var(--st-missing-bg)", fg: "var(--st-missing)" }
          : { bg: "var(--surface-2)", fg: "var(--line)" }; // no record yet

  const ATT_FILTERS = [
    ["ALL", t("All"), totals.delegates],
    ["ISSUES", t("Late or missing"), totals.issues],
    ["CLEAN", t("Full attendance"), totals.clean],
  ];

  return (
    <div style={{ marginTop: 20 }}>
      <p className="page-sub" style={{ margin: "0 0 14px" }}>
        {t("Every delegate's status at every itinerary stop — click a card for the full timeline.")}
      </p>

      {/* ---- Summary strip ------------------------------------------------ */}
      {/* Two modes: trip/day roll-ups normally, or that ONE stop's
          arrived/late/missing split when a single stop is selected below. */}
      {selectedStop && (
        <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Clock size={14} color="var(--scc-red)" />
          <strong style={{ fontSize: 14 }}>{selectedStop.label}</strong>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {t("Day")} {selectedStop.dayNumber}{selectedStop.scheduledTime ? ` · ${fmt12h(selectedStop.scheduledTime)}` : ""}
          </span>
        </div>
      )}
      <div className="card" style={{ padding: "14px 18px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
        {(stopTotals
          ? [
            [t("Arrived"), stopTotals.arrived, "var(--st-present)"],
            [t("Late"), stopTotals.late, "var(--st-late)"],
            [t("Missing"), stopTotals.missing, "var(--st-missing)"],
            [t("No record"), stopTotals.noRecord, "var(--ink-3)"],
          ]
          : [
            [t("Delegates"), totals.delegates, "var(--ink)"],
            // Reflects the day filter, so it agrees with the chips on the cards.
            [dayFilter === "ALL" ? t("Itinerary stops") : `${t("Stops on day")} ${dayFilter}`, visibleStops.length, "var(--ink)"],
            [t("Full attendance"), totals.clean, "var(--st-present)"],
            [t("Late or missing"), totals.issues, "var(--st-missing)"],
          ]
        ).map(([label, value, color]) => (
          <div key={label}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ---- Search + filters -------------------------------------------- */}
      <div className="row" style={{ gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ position: "relative", maxWidth: 240, flex: "1 1 180px" }}>
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
          <optgroup label={t("Other")}>
            <option value="NONE">{t("Unassigned")}</option>
          </optgroup>
        </select>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {ATT_FILTERS.map(([key, label, n]) => (
            <button key={key} type="button" onClick={() => setAttFilter(key)}
              style={{
                fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                background: attFilter === key ? "var(--scc-red-tint)" : "var(--surface-2)",
                color: attFilter === key ? "var(--scc-red)" : "var(--ink-2)",
                border: `1px solid ${attFilter === key ? "var(--scc-red)" : "var(--line)"}`,
              }}>
              {label} <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---- Day filter --------------------------------------------------- */}
      {days.length > 1 && (
        <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4, marginRight: 2 }}>
            {t("Day")}
          </span>
          {/* No per-day stop count here (2026-07-28 — "what is this number
              beside the day? i think remove it"): "Day 1 5" read as "Day 15".
              The count lives in the summary strip's "Stops on day N" tile,
              which updates with the selection anyway. */}
          {[["ALL", t("All days")], ...days.map((n) => [String(n), `${t("Day")} ${n}`])]
            .map(([key, label]) => (
              <button key={key} type="button" onClick={() => setDayFilter(key)}
                title={key === "ALL"
                  ? `${stops.length} ${t("stops")}`
                  : `${stops.filter((s) => s.dayNumber === Number(key)).length} ${t("stops")}`}
                style={{
                  fontSize: 12.5, fontWeight: 600, padding: "5px 11px", borderRadius: 999, cursor: "pointer",
                  background: dayFilter === key ? "var(--scc-red-tint)" : "var(--surface-2)",
                  color: dayFilter === key ? "var(--scc-red)" : "var(--ink-2)",
                  border: `1px solid ${dayFilter === key ? "var(--scc-red)" : "var(--line)"}`,
                }}>
                {label}
              </button>
            ))}
        </div>
      )}

      {/* ---- Itinerary stop filter (2026-07-29) ---------------------------
          "add filter to see that specific itinerary, so i can see how many was
          late, arrived, missing for that specific time". A <select> rather than
          another chip row: stop names are long ("Airport departure transfer")
          and there can be 20+ across a trip, so chips would wrap into a wall.
          Options carry the time, since two stops can share a name across days.
          Selecting one re-points the whole tab — summary strip, per-card chips
          and counts — at that single stop. */}
      {dayStops.length > 0 && (
        <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4, marginRight: 2 }}>
            {t("Stop")}
          </span>
          <select
            className="select"
            style={{ maxWidth: 330 }}
            value={stopFilter}
            onChange={(e) => setStopFilter(e.target.value)}
          >
            <option value="ALL">
              {dayFilter === "ALL"
                ? `${t("All stops")} (${dayStops.length})`
                : `${t("All stops on day")} ${dayFilter} (${dayStops.length})`}
            </option>
            {dayStops.map((s) => (
              <option key={s.id} value={s.id}>
                {dayFilter === "ALL" ? `${t("Day")} ${s.dayNumber} · ` : ""}
                {s.scheduledTime ? `${fmt12h(s.scheduledTime)} · ` : ""}{s.label}
              </option>
            ))}
          </select>
          {selectedStop && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "5px 10px", fontSize: 12 }}
              onClick={() => setStopFilter("ALL")}
            >
              <X size={13} /> {t("Clear")}
            </button>
          )}
        </div>
      )}

      {loading && <div className="muted" style={{ fontSize: 13 }}>{t("Loading…")}</div>}
      {error && <div style={{ color: "var(--st-missing)", fontSize: 13 }}>{t(error)}</div>}

      {!loading && !error && stops.length === 0 && (
        <div className="card muted" style={{ padding: 24, textAlign: "center", fontSize: 13.5 }}>
          {t("No itinerary stops on this trip yet — nothing to show a history for.")}
        </div>
      )}

      {!loading && !error && stops.length > 0 && visible.length === 0 && (
        <div className="card muted" style={{ padding: 24, textAlign: "center", fontSize: 13.5 }}>
          {t("No delegates match these filters.")}
        </div>
      )}

      {/* ---- Card grid --------------------------------------------------- */}
      {!loading && !error && visible.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 14 }}>
          {visible.map((d) => {
            const isOpen = expandedId === d.id;
            const hasIssue = d.missing > 0 || d.late > 0;
            return (
              <div key={d.id} className="card"
                style={{ padding: 0, overflow: "hidden", borderColor: hasIssue ? "var(--st-missing-bg)" : "var(--line)" }}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : d.id)}
                  className="row between"
                  style={{ width: "100%", padding: "12px 14px 10px", background: "none", border: "none", cursor: "pointer", textAlign: "left", gap: 10 }}
                >
                  <div className="row" style={{ gap: 10, minWidth: 0 }}>
                    <DelegateAvatar delegate={d} />
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 5, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                        {d.vip && <Crown size={12} color="#e0a800" style={{ flexShrink: 0 }} />}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{d.coachLabel || t("Unassigned")}</div>
                    </div>
                  </div>
                  {isOpen ? <ChevronUp size={16} className="muted" /> : <ChevronDown size={16} className="muted" />}
                </button>

                {/* Chips grouped BY DAY, each group labelled D1/D2/… so you can
                    tell at a glance which day a run of red belongs to. When a
                    single day is selected the label is dropped (the filter above
                    already says which day you're looking at). */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "0 14px 10px" }}>
                  {stopGroups.map((g) => (
                    <div key={g.day} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {dayFilter === "ALL" && (
                        <span className="muted" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3 }}>
                          D{g.day}
                        </span>
                      )}
                      <div style={{ display: "flex", gap: 3 }}>
                        {g.items.map((s) => {
                          const cell = d.cells[s.id];
                          const tone = toneFor(cell?.status);
                          const label = cell ? t(CPT_STATUS_LABEL[cell.status] || cell.status) : t("No record");
                          return (
                            <span key={s.id}
                              title={`${t("Day")} ${s.dayNumber} · ${s.scheduledTime ? fmt12h(s.scheduledTime) : ""} ${s.label} — ${label}`}
                              style={{
                                width: 15, height: 15, borderRadius: 4, background: tone.bg,
                                border: `1px solid ${tone.fg}`, flexShrink: 0,
                              }} />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="row" style={{ padding: "7px 14px", borderTop: "1px solid var(--line)", fontSize: 11.5, gap: 10, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--st-present)", fontWeight: 600 }}>{d.arrived} {t("arrived")}</span>
                  <span style={{ color: "var(--st-late)", fontWeight: 600 }}>{d.late} {t("late")}</span>
                  <span style={{ color: "var(--st-missing)", fontWeight: 600 }}>{d.missing} {t("missing")}</span>
                  <span className="muted" style={{ marginLeft: "auto" }}>{d.recorded}/{visibleStops.length}</span>
                </div>

                {isOpen && (
                  <div style={{ padding: "10px 14px 14px", borderTop: "1px solid var(--line)", background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 7, maxHeight: 320, overflowY: "auto" }}>
                    {/* Only the stops in view, so the detail matches the chips
                        above it when a day is selected. */}
                    {visibleStops.map((s) => {
                      const cell = d.cells[s.id];
                      return (
                        <div key={s.id} className="row between" style={{ gap: 10, fontSize: 12.5 }}>
                          <div className="row" style={{ gap: 7, minWidth: 0 }}>
                            <Clock size={12} color="var(--ink-3)" style={{ flexShrink: 0 }} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t("Day")} {s.dayNumber} · {s.label}{s.scheduledTime ? ` · ${fmt12h(s.scheduledTime)}` : ""}
                            </span>
                          </div>
                          {cell
                            ? <StatusBadge state={cell.status} />
                            : <span className="muted" style={{ fontSize: 11.5, flexShrink: 0 }}>{t("No record")}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---- Local styles ------------------------------------------------------- */
