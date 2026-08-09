/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Dashboard Analytics (charts + AI)
 * ============================================================================= */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BarChart3, LayoutGrid, Eye, EyeOff, Sparkles, Filter, ArrowUpDown, Wand2 } from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
  LineChart, Line,
} from "recharts";
import { getUser, apiGet, apiPost } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { subscribe as subscribeInsights, getSnapshot as getInsightsSnapshot, generateInsights as runGenerateInsights } from "../../lib/dashboard/insightsStore.js";
import { useElapsedSeconds } from "../../lib/dashboard/useElapsedSeconds.js";
import { registerChart, unregisterChart } from "../../lib/dashboard/chartCapture.js";

/**
 * Analytics panel — the "Analytics" tab inside the Dashboard page.
 *
 * Read-only, derived from `data`/`missing` passed down by DashboardPage
 * (which owns the single fetch + Refresh button shared by both the
 * Overview and Analytics tabs — no separate fetch/refresh here).
 * "Customization" = each signed-in user can toggle which widgets are
 * visible; the choice is remembered per-username in localStorage.
 */

// Filter/Sort/Customize panels — deliberately NOT the plain "card" style
// (solid border, opaque surface) used by the chart widgets below, so the
// two read as visually distinct categories (controls vs. data) at a glance.
const S = {
  controlCard: {
    padding: 16,
    background: "var(--surface-2)",
    border: "1px dashed var(--line)",
    borderRadius: "var(--r-lg)",
  },
};

const COLORS = {
  present: "#16a34a",
  missing: "#e1232a",
  late: "#f97316",
  unassigned: "#d97706",
  vip: "#e1232a",
  nonVip: "#6b7280",
};

const STATUS_LABELS = {
  PRESENT: "Arrived", ARRIVED: "Arrived", ASSIGNED: "Assigned",
  LATE: "Late", MISSING: "Missing", UNASSIGNED: "Unassigned",
};

const WIDGETS = [
  { key: "breakdown", label: "Attendance breakdown" },
  { key: "coachLoad", label: "Coach load" },
  { key: "vipMissing", label: "VIP vs. non-VIP missing" },
  { key: "checkpointBreakdown", label: "Attendance by itinerary stop" },
  { key: "boardingByDay", label: "Boarding over the trip" },
];

/** Split the AI-generated insights text into individual points, stripping
 *  whatever numbering/bullet marker the model used (we render our own via
 *  an <ol>, so "1. ", "- ", "• " etc. at the start of a line are redundant).
 *  Each point is expected to lead with a "Label: " prefix (Overall/Missing/
 *  Advice, per backend/routes/insights.js's buildPrompt) — split that off so
 *  it can be rendered bold, separate from the rest of the sentence. */
function splitInsightPoints(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([^:：]{1,20})[:：]\s*(.+)$/);
      return m ? { label: m[1].trim(), body: m[2].trim() } : { label: null, body: line };
    });
}

/* The per-chart "CSV" buttons that used to live here are GONE (2026-07-29 —
 * "currently if i click download csv button, it will give me number... what i
 * want is to link it to the export section... make it display in image instead
 * of number"). A CSV of raw numbers didn't serve the original purpose ("for
 * report or presentation") — the recipient had to rebuild the chart to see
 * anything. Charts now export as IMAGES on their own sheet of the Excel
 * workbook, chosen in the Export modal, so there's one export flow instead of
 * seven scattered download buttons. See lib/chartCapture.js (the PNG
 * composition), ExportModal.jsx (the picker) and backend/routes/export.js
 * (the "Charts" worksheet). `ChartFrame` below is what registers each chart
 * with the capture registry while it's on screen. */

/**
 * Wraps a chart so it can be captured for the Excel export, and so its title
 * renders consistently. Registers with lib/chartCapture.js on mount and
 * deregisters on unmount, which is what makes the Export modal's chart list
 * reflect exactly what's currently on screen.
 *
 * `legend` is passed explicitly rather than scraped from the DOM because
 * recharts renders its Legend as sibling HTML, outside the <svg> that gets
 * serialised — see the chartCapture.js header for the full reasoning.
 */
function useChartRegistration({ id, label, order, legend, empty }) {
  const hostRef = useRef(null);
  // `legend` is a fresh array literal on every render, so it must NOT be an
  // effect dependency (that would re-register every render). Read through a
  // ref instead — a getter on the registry entry keeps it always-current
  // without re-registering. Same identity trap as useVisiblePolling's.
  const legendRef = useRef(legend);
  legendRef.current = legend;

  useEffect(() => {
    registerChart({
      id,
      label,
      order,
      empty,
      getEl: () => hostRef.current,
      get legend() { return legendRef.current; },
    });
    return () => unregisterChart(id);
  }, [id, label, order, empty]);

  return hostRef;
}

function ChartFrame({ id, label, order, legend, empty, titleExtra, children }) {
  const hostRef = useChartRegistration({ id, label, order, legend, empty });
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>
          {label}{titleExtra}
        </h2>
      </div>
      <div ref={hostRef}>{children}</div>
    </div>
  );
}

function prefsKey() {
  const u = getUser() || {};
  return `mg_analytics_prefs_${u.username || "guest"}`;
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(prefsKey()) || "{}");
    return Object.fromEntries(WIDGETS.map((w) => [w.key, saved[w.key] !== false]));
  } catch {
    return Object.fromEntries(WIDGETS.map((w) => [w.key, true]));
  }
}

export default function AnalyticsPanel({ data, missing, delegates = [], tripId = "t-1" }) {
  const { t, lang } = useLang();
  // Overview (AI Insights + the fixed widgets) vs Custom chart (the builder)
  // sub-tabs. Split 2026-07-24, briefly merged into one scrolling view
  // 2026-07-27 ("can you merge the chart tgh?"), then restored the SAME day
  // ("i don't like the current merge chart. i need to scroll down to see
  // it") — the merge traded one click for a five-chart scroll, and the
  // click won. Don't merge these again without checking first.
  const [analyticsTab, setAnalyticsTab] = useState("overview"); // overview | custom
  const [visible, setVisible] = useState(loadPrefs);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [coachFilter, setCoachFilter] = useState("ALL");
  const [coachSort, setCoachSort] = useState("name"); // name | boarded | remaining | missing

  // Backed by insightsStore.js, a module-level store OUTSIDE this component
  // — not useState — specifically so "Generate Insights" survives switching
  // Dashboard tabs (which unmounts this panel) or navigating away entirely
  // (user report: it used to silently reset because the request's result
  // had nowhere left to land once this component was gone).
  const { loading: insightsLoading, insights, asOf: insightsAsOf, source: insightsSource, error: insightsError, startedAt: insightsStartedAt } =
    useSyncExternalStore(subscribeInsights, () => getInsightsSnapshot(tripId));
  const insightsElapsed = useElapsedSeconds(insightsLoading, insightsStartedAt);

  function generateInsights() {
    runGenerateInsights(tripId, lang);
  }

  // ---- Custom chart builder (2026-07-24) -----------------------------------
  // Lets staff pick their own chart type + grouping instead of only the 3
  // fixed widgets above — "Attendance breakdown"/"Coach load"/"VIP missing"
  // are really just 3 hardcoded instances of the same underlying idea (group
  // delegates by some field, show counts). The AI box below is a thin,
  // BOUNDED layer on top: it only ever picks from the same fixed chartType/
  // groupBy enum the dropdowns use (never sees/writes delegate data), and
  // its answer lands in these same editable dropdowns rather than rendering
  // anything the user can't see/override.
  const CUSTOM_CHART_TYPES = [
    ["bar", t("Bar")], ["pie", t("Pie")], ["donut", t("Donut")], ["line", t("Line")],
  ];
  const CUSTOM_GROUP_BY = [
    ["status", t("Status")], ["coach", t("Coach")], ["company", t("Company")], ["industry", t("Industry")], ["vip", t("VIP")],
  ];
  const [customChartType, setCustomChartType] = useState("bar");
  const [customGroupBy, setCustomGroupBy] = useState("status");
  const [chartPrompt, setChartPrompt] = useState("");
  const [chartAiBusy, setChartAiBusy] = useState(false);
  const [chartAiError, setChartAiError] = useState(null);
  const [chartAiStartedAt, setChartAiStartedAt] = useState(null);
  const chartAiElapsed = useElapsedSeconds(chartAiBusy, chartAiStartedAt);

  const coachNameById = useMemo(() => {
    const m = new Map();
    for (const c of data?.coaches || []) m.set(c.id, c.label || c.name);
    return m;
  }, [data]);

  // Same 5-color palette the fixed widgets already use, cycled for however
  // many distinct groups the chosen field actually produces (e.g. company
  // names aren't a fixed small set like status is).
  const CUSTOM_PALETTE = ["#e1232a", "#16a34a", "#2563eb", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

  const customChartData = useMemo(() => {
    const counts = new Map();
    for (const d of delegates) {
      let key;
      if (customGroupBy === "coach") key = d.coachId ? (coachNameById.get(d.coachId) || t("Unknown coach")) : t("Unassigned");
      else if (customGroupBy === "vip") key = d.vip ? t("VIP") : t("Non-VIP");
      else if (customGroupBy === "status") key = t(STATUS_LABELS[d.status] || d.status || "Unassigned");
      else key = (d[customGroupBy] || "").toString().trim() || t("Not set");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, value], i) => ({ name, value, color: CUSTOM_PALETTE[i % CUSTOM_PALETTE.length] }))
      .sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delegates, customGroupBy, coachNameById]);

  async function askAiForChart() {
    const prompt = chartPrompt.trim();
    if (!prompt) return;
    setChartAiBusy(true); setChartAiError(null); setChartAiStartedAt(Date.now());
    try {
      const res = await apiPost(`/trips/${tripId}/analytics/ai-chart`, { prompt });
      setCustomChartType(res.chartType);
      setCustomGroupBy(res.groupBy);
    } catch (e) {
      setChartAiError(
        e?.code === "AI_NOT_CONFIGURED" || e?.status === 503
          ? t("Install Ollama locally (free) or ask an admin to set ANTHROPIC_API_KEY in backend/.env.")
          : t("Couldn't work out a chart from that — try rephrasing, or use the dropdowns above.")
      );
    } finally {
      setChartAiBusy(false);
    }
  }

  function toggle(key) {
    setVisible((v) => {
      const next = { ...v, [key]: !v[key] };
      localStorage.setItem(prefsKey(), JSON.stringify(next));
      return next;
    });
  }

  const breakdown = useMemo(() => {
    if (!data) return [];
    const k = data.kpis;
    return [
      { name: t("Present"), value: k.present, color: COLORS.present },
      { name: t("Missing"), value: k.missing, color: COLORS.missing },
      { name: t("Unassigned"), value: k.unassigned, color: COLORS.unassigned },
    ].filter((d) => d.value > 0);
  }, [data, t]);

  // "Filter" scopes both this chart and VIP-missing to one coach; "Sort"
  // reorders this chart's bars. Both are UI-only reads over the same data
  // DashboardPage already fetched — no new endpoint or params.
  const coachLoad = useMemo(() => {
    if (!data) return [];
    const missingByCoach = new Map();
    missing.forEach((m) => missingByCoach.set(m.coachId, (missingByCoach.get(m.coachId) || 0) + 1));
    const rows = (data.coaches || [])
      .filter((c) => coachFilter === "ALL" || c.id === coachFilter)
      .map((c) => ({
        id: c.id,
        name: c.label,
        boarded: c.boarded,
        remaining: Math.max(c.capacity - c.boarded, 0),
        missingCount: missingByCoach.get(c.id) || 0,
      }));
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name),
      boarded: (a, b) => b.boarded - a.boarded,
      remaining: (a, b) => b.remaining - a.remaining,
      missing: (a, b) => b.missingCount - a.missingCount,
    };
    return rows.sort(sorters[coachSort] || sorters.name);
  }, [data, missing, coachFilter, coachSort]);

  const vipMissing = useMemo(() => {
    const scoped = coachFilter === "ALL" ? missing : missing.filter((m) => m.coachId === coachFilter);
    const vip = scoped.filter((m) => m.vip).length;
    const nonVip = scoped.length - vip;
    return [
      { name: "VIP", value: vip, color: COLORS.vip },
      { name: t("Non-VIP"), value: nonVip, color: COLORS.nonVip },
    ];
  }, [missing, coachFilter, t]);

  // Missing/Late/Arrived per itinerary stop (2026-07-24) — replaced the old
  // "delegates onboarded over time" line chart, which only ever showed
  // upload volume, not attendance. Fetched separately from the trip-wide
  // `data`/`missing`/`delegates` props this panel otherwise just reads,
  // since per-checkpoint counts aren't part of that payload — refetches
  // whenever the trip changes or the parent's shared poll ticks (`data`
  // changing is that tick), so this stays roughly as live as the rest of
  // the Dashboard without running its own separate interval.
  const [checkpointStats, setCheckpointStats] = useState([]);
  useEffect(() => {
    let alive = true;
    apiGet(`/trips/${tripId}/checkpoint-stats`)
      .then((r) => { if (alive) setCheckpointStats(r.stops || []); })
      .catch(() => { if (alive) setCheckpointStats([]); });
    return () => { alive = false; };
  }, [tripId, data]);

  const checkpointChartData = useMemo(() => (
    checkpointStats.map((s) => ({
      // Short tick label (just the time) so the x-axis doesn't collide with
      // the legend below it (2026-07-24 — "abit messy"); the full stop name
      // still shows in the tooltip via stopLabel below.
      time: s.scheduledTime,
      stopLabel: `${s.scheduledTime} ${s.label}`.trim(),
      [t("Arrived")]: s.arrived,
      [t("Late")]: s.late,
      [t("Missing")]: s.missing,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [checkpointStats, lang]);

  // "Boarding over the trip" (2026-07-25) — one bar per DAY instead of per
  // stop: how much of the whole roster has boarded by the day's LAST stop
  // (checkpointStats is already ordered day/time ascending from the backend,
  // so keeping the last entry per day naturally picks the latest stop that
  // day) vs. everyone else who hasn't yet — a simpler at-a-glance rollup
  // than the full per-stop breakdown above. Bar height is the constant
  // total roster size, split onboard/not — not the stop's own
  // arrived+late+missing sum, since a delegate with no check-in record yet
  // for that stop (still just ASSIGNED) wouldn't be counted by any of those
  // three, which would make the bar shorter than the real roster.
  const boardingByDayData = useMemo(() => {
    const lastPerDay = new Map();
    for (const s of checkpointStats) lastPerDay.set(s.dayNumber, s);
    const total = delegates.length;
    return [...lastPerDay.entries()]
      .sort(([a], [b]) => a - b)
      .map(([day, s]) => ({
        day: `D${day}`,
        onboard: s.arrived,
        missing: Math.max(total - s.arrived, 0),
      }));
  }, [checkpointStats, delegates]);

  // The custom chart registers for export too, but only while its tab is the
  // one on screen — a chart that isn't rendered has no <svg> to capture, so
  // listing it in the export picker would offer something that silently
  // produced nothing.
  const customChartLabel = `${t("Custom chart")} — ${CUSTOM_GROUP_BY.find(([k]) => k === customGroupBy)?.[1] || customGroupBy}`;
  const customChartHostRef = useChartRegistration({
    id: "custom-chart",
    label: customChartLabel,
    order: 6,
    empty: analyticsTab !== "custom" || customChartData.length === 0,
    legend: customChartData.map((d) => ({ label: d.name, color: d.color })),
  });

  return (
    <div>
      {/* Same pill treatment as the Dashboard's "Delegate management" sub-tabs
          (2026-07-28 — "for the analytics subtab, follow the delegate subtab"):
          these are both second-level tabs, so they should read identically
          instead of Analytics using the chunkier top-level button style. */}
      <div className="row" style={{ gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          ["overview", t("Overview"), LayoutGrid],
          ["custom", t("Custom chart"), BarChart3],
        ].map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setAnalyticsTab(k)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
              fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 999,
              background: analyticsTab === k ? "var(--scc-red-tint)" : "var(--surface-2)",
              color: analyticsTab === k ? "var(--scc-red)" : "var(--ink-2)",
              border: `1px solid ${analyticsTab === k ? "var(--scc-red)" : "var(--line)"}`,
            }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {analyticsTab === "overview" && (
      <>
      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 4 }}>
        <p className="page-sub" style={{ margin: 0 }}>{t("Attendance breakdown, coach load, and VIP visibility — live from the trip data.")}</p>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setFilterOpen((v) => !v)}>
            <Filter size={16} /> {t("Filter")}
          </button>
          <button className="btn btn-ghost" onClick={() => setSortOpen((v) => !v)}>
            <ArrowUpDown size={16} /> {t("Sort")}
          </button>
          <button className="btn btn-ghost" onClick={() => setPanelOpen((v) => !v)}>
            <BarChart3 size={16} /> {t("Customize")}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 20 }}>
        <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <Sparkles size={18} color="var(--scc-red)" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t("AI Insights")}</div>
              <div className="muted" style={{ fontSize: 12 }}>{t("A short written summary of the current attendance snapshot.")}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {t("Tip: switch to your preferred language before generating — it won't be re-translated afterward.")}
              </div>
            </div>
          </div>
          <button className="btn btn-primary" onClick={generateInsights} disabled={insightsLoading}>
            <Sparkles size={16} /> {insightsLoading ? `${t("Generating…")} ${insightsElapsed}s` : t("Generate Insights")}
          </button>
        </div>

        {insightsError && (
          <div style={{
            marginTop: 14, padding: "10px 12px", borderRadius: "var(--r-sm)",
            background: "var(--st-unassigned-bg)", color: "var(--st-unassigned)", fontSize: 13, fontWeight: 600,
          }}>
            {t(insightsError)}
          </div>
        )}

        {insightsLoading && (
          <div style={{ marginTop: 14, padding: 14, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
            {/* Live elapsed-time readout (2026-07-24 — "there no time
                tracker when i click ai generate stuff") — local Ollama can
                genuinely take 10-30s+ depending on the machine, so a plain
                spinner with no feedback read as hung/broken. */}
            <div className="row" style={{ gap: 8, marginBottom: 10, fontSize: 12.5 }}>
              <span className="spin" style={{ display: "inline-flex" }}><Sparkles size={13} /></span>
              <span className="muted">
                {t("Thinking…")} {insightsElapsed}s — {t("usually 5–20s, longer if using local AI")}
              </span>
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton-line" style={{
                height: 14, borderRadius: 4, marginBottom: i < 2 ? 10 : 0,
                width: i === 2 ? "60%" : "100%",
              }} />
            ))}
          </div>
        )}

        {insights && !insightsError && !insightsLoading && (
          <div style={{ marginTop: 14, padding: 14, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
              {splitInsightPoints(insights).map((point, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {point.label && <strong>{point.label}: </strong>}
                  {point.body}
                </li>
              ))}
            </ol>
            {insightsAsOf && (
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                {t("As of")} {insightsAsOf}
                {insightsSource === "ollama" && <> · {t("via local Ollama")}</>}
                {insightsSource === "anthropic" && <> · {t("via Claude")}</>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filter/Sort/Customize each used to be their own full-width card
          stacked one under another — with all 3 open at once that pushed
          the actual charts way down the page. Side-by-side in one row
          instead, each only as wide as it needs (2026-07-24). Styled
          visually distinct from the chart cards below (tinted background +
          dashed border + an icon matching the button that opened it) — as
          plain "card"s they were indistinguishable from the data widgets,
          which read as confusing (2026-07-24 feedback: "look the same as
          the chart... can be confuse"). These are CONTROLS, not data. */}
      {(filterOpen || sortOpen || panelOpen) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 16, alignItems: "stretch" }}>
          {filterOpen && (
            <div style={S.controlCard}>
              <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                <Filter size={13} color="var(--ink-3)" />
                <div className="page-eyebrow" style={{ margin: 0 }}>{t("Filter by coach")}</div>
              </div>
              <select
                className="select"
                style={{ maxWidth: 260 }}
                value={coachFilter}
                onChange={(e) => setCoachFilter(e.target.value)}
              >
                <option value="ALL">{t("All coaches")}</option>
                {(data?.coaches || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {t('Scopes "Coach load" and "VIP vs. non-VIP missing" to the selected coach.')}
              </div>
            </div>
          )}

          {sortOpen && (
            <div style={S.controlCard}>
              <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                <ArrowUpDown size={13} color="var(--ink-3)" />
                <div className="page-eyebrow" style={{ margin: 0 }}>{t("Sort coach load by")}</div>
              </div>
              <select
                className="select"
                style={{ maxWidth: 260 }}
                value={coachSort}
                onChange={(e) => setCoachSort(e.target.value)}
              >
                <option value="name">{t("Coach name")}</option>
                <option value="boarded">{t("Most boarded")}</option>
                <option value="remaining">{t("Most remaining capacity")}</option>
                <option value="missing">{t("Most missing")}</option>
              </select>
            </div>
          )}

          {panelOpen && (
            <div style={S.controlCard}>
              <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                <BarChart3 size={13} color="var(--ink-3)" />
                <div className="page-eyebrow" style={{ margin: 0 }}>{t("Visible widgets")}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {WIDGETS.map((w) => (
                  <label key={w.key} className="row" style={{ gap: 10, fontSize: 14, cursor: "pointer" }}>
                    {visible[w.key] ? <Eye size={16} /> : <EyeOff size={16} className="muted" />}
                    <input type="checkbox" checked={visible[w.key]} onChange={() => toggle(w.key)} />
                    {t(w.label)}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 20 }}>
          {visible.breakdown && (
            <ChartFrame id="attendance-breakdown" order={1} label={t("Attendance breakdown")}
              empty={breakdown.length === 0}
              legend={breakdown.map((d) => ({ label: d.name, color: d.color }))}>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={breakdown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {breakdown.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}

          {visible.coachLoad && (
            <ChartFrame id="coach-load" order={2} label={t("Coach load")}
              titleExtra={coachFilter !== "ALL" && coachLoad[0] ? ` — ${coachLoad[0].name}` : null}
              empty={coachLoad.length === 0}
              legend={[
                { label: t("Boarded"), color: COLORS.present },
                { label: t("Remaining capacity"), color: "#e6e8eb" },
              ]}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={coachLoad}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="boarded" stackId="a" fill={COLORS.present} name={t("Boarded")} />
                  <Bar dataKey="remaining" stackId="a" fill="#e6e8eb" name={t("Remaining capacity")} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}

          {visible.vipMissing && (
            <ChartFrame id="vip-missing" order={3} label={t("VIP vs. non-VIP missing")}
              empty={missing.length === 0}
              legend={vipMissing.map((d) => ({ label: d.name, color: d.color }))}>
              {missing.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "24px 0" }}>{t("Nobody's missing right now.")}</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={vipMissing} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                      {vipMissing.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartFrame>
          )}

          {visible.checkpointBreakdown && (
            <ChartFrame id="attendance-by-stop" order={4} label={t("Attendance by itinerary stop")}
              empty={checkpointChartData.length === 0}
              legend={[
                { label: t("Arrived"), color: COLORS.present },
                { label: t("Late"), color: COLORS.late },
                { label: t("Missing"), color: COLORS.missing },
              ]}>
              {checkpointChartData.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "24px 0" }}>{t("No itinerary stops yet.")}</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={checkpointChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="time" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis fontSize={12} allowDecimals={false} width={28} />
                    <Tooltip labelFormatter={(_, p) => p?.[0]?.payload?.stopLabel || ""} />
                    <Legend verticalAlign="top" align="right" height={28} wrapperStyle={{ fontSize: 12.5 }} />
                    <Bar dataKey={t("Arrived")} fill={COLORS.present} radius={[3, 3, 0, 0]} />
                    <Bar dataKey={t("Late")} fill={COLORS.late} radius={[3, 3, 0, 0]} />
                    <Bar dataKey={t("Missing")} fill={COLORS.missing} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartFrame>
          )}

          {visible.boardingByDay && (
            <ChartFrame id="boarding-by-day" order={5} label={t("Boarding over the trip")}
              empty={boardingByDayData.length === 0}
              legend={[
                { label: t("Onboard"), color: COLORS.present },
                { label: t("Missing"), color: COLORS.missing },
              ]}>
              {boardingByDayData.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "24px 0" }}>{t("No itinerary stops yet.")}</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={boardingByDayData} margin={{ top: 20, right: 8, left: 0, bottom: 4 }} barCategoryGap="30%">
                    <XAxis dataKey="day" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis hide allowDecimals={false} />
                    <Tooltip />
                    <Legend verticalAlign="top" align="right" height={28} wrapperStyle={{ fontSize: 12.5 }} />
                    <Bar dataKey="onboard" name={t("Onboard")} stackId="board" fill={COLORS.present} radius={[0, 0, 0, 0]}>
                      <LabelList dataKey="onboard" position="top" style={{ fontWeight: 700, fontSize: 13 }} />
                    </Bar>
                    <Bar dataKey="missing" name={t("Missing")} stackId="board" fill={COLORS.missing} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartFrame>
          )}
        </div>
      )}

      </>
      )}

      {analyticsTab === "custom" && (
      /* Custom chart builder — pick your own chart type + grouping, or ask
         the (bounded) AI box to pre-fill the two dropdowns from a plain
         request. Renders live from the same `delegates` list every fixed
         widget already reads. */
      <div className="card" style={{ padding: 20 }}>
        <div className="row between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <BarChart3 size={18} color="var(--ink-3)" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t("Custom chart")}</div>
              <div className="muted" style={{ fontSize: 12 }}>{t("Pick your own chart type and grouping.")}</div>
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <select className="select" style={{ maxWidth: 160 }} value={customChartType} onChange={(e) => setCustomChartType(e.target.value)}>
            {CUSTOM_CHART_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 190 }} value={customGroupBy} onChange={(e) => setCustomGroupBy(e.target.value)}>
            {CUSTOM_GROUP_BY.map(([k, label]) => <option key={k} value={k}>{t("Group by")}: {label}</option>)}
          </select>
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: "1 1 220px", minWidth: 200 }}
            placeholder={t("Or describe what you want, e.g. \"missing delegates by company\"")}
            value={chartPrompt}
            onChange={(e) => setChartPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && askAiForChart()}
          />
          <button className="btn btn-ghost" onClick={askAiForChart} disabled={chartAiBusy || !chartPrompt.trim()}>
            <Wand2 size={15} /> {chartAiBusy ? `${t("Thinking…")} ${chartAiElapsed}s` : t("Ask AI")}
          </button>
        </div>
        {/* "What you can ask" guidance while idle, the elapsed-time hint
            while busy — never both at once (2026-07-24 — "add validation to
            certain thing i can say and can't and make it so user can
            understand what they can ask"). This box can't reliably reject
            an out-of-scope request client-side (it's natural language, and
            the model itself decides), so the fix is setting expectations
            up front instead: the only things a chart can ever group by are
            these 5 fixed fields, spelled out here, and NOT a date/time
            trend since there's no time dimension in the data at all. */}
        {chartAiBusy ? (
          <div className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 14 }}>
            {t("usually 5–20s, longer if using local AI")}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 11.5, marginTop: -8, marginBottom: 14 }}>
            {t("Can group by: status, coach, company, industry, or VIP. Can't chart trends over time or dates — there's no time dimension to group by.")}
          </div>
        )}
        {chartAiError && (
          <div style={{
            marginBottom: 14, padding: "10px 12px", borderRadius: "var(--r-sm)",
            background: "var(--st-unassigned-bg)", color: "var(--st-unassigned)", fontSize: 13, fontWeight: 600,
          }}>
            {chartAiError}
          </div>
        )}

        {customChartData.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>{t("No delegates to chart yet.")}</div>
        ) : (
          <div ref={customChartHostRef}>
          <ResponsiveContainer width="100%" height={280}>
            {customChartType === "bar" ? (
              <BarChart data={customChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value">
                  {customChartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            ) : customChartType === "line" ? (
              <LineChart data={customChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke={CUSTOM_PALETTE[0]} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            ) : (
              <PieChart>
                <Pie
                  data={customChartData} dataKey="value" nameKey="name"
                  innerRadius={customChartType === "donut" ? 60 : 0} outerRadius={100}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {customChartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            )}
          </ResponsiveContainer>
          </div>
        )}
      </div>
      )}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
