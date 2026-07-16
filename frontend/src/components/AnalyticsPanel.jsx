import { useMemo, useState } from "react";
import { BarChart3, Eye, EyeOff, Sparkles, Filter, ArrowUpDown } from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area,
} from "recharts";
import { apiPost, getUser } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * Analytics panel — the "Analytics" tab inside the Dashboard page.
 *
 * Read-only, derived from `data`/`missing` passed down by DashboardPage
 * (which owns the single fetch + Refresh button shared by both the
 * Overview and Analytics tabs — no separate fetch/refresh here).
 * "Customization" = each signed-in user can toggle which widgets are
 * visible; the choice is remembered per-username in localStorage.
 */

const TRIP_ID = "t-1";

const COLORS = {
  present: "#16a34a",
  missing: "#e1232a",
  unassigned: "#d97706",
  vip: "#e1232a",
  nonVip: "#6b7280",
};

const WIDGETS = [
  { key: "breakdown", label: "Attendance breakdown" },
  { key: "coachLoad", label: "Coach load" },
  { key: "vipMissing", label: "VIP vs. non-VIP missing" },
  { key: "onboardingTrend", label: "Delegates onboarded over time" },
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

export default function AnalyticsPanel({ data, missing, delegates = [] }) {
  const { t, lang } = useLang();
  const [visible, setVisible] = useState(loadPrefs);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [coachFilter, setCoachFilter] = useState("ALL");
  const [coachSort, setCoachSort] = useState("name"); // name | boarded | remaining | missing
  const [insights, setInsights] = useState(null);
  const [insightsAsOf, setInsightsAsOf] = useState(null);
  const [insightsSource, setInsightsSource] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(null);

  async function generateInsights() {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const { insights: text, asOf, source } = await apiPost(`/trips/${TRIP_ID}/insights`, { lang });
      setInsights(text);
      setInsightsAsOf(asOf);
      setInsightsSource(source);
    } catch (e) {
      // Use our own copy of the message (not the backend's e.message) so the
      // dictionary can translate it.
      setInsightsError(
        e.code === "AI_NOT_CONFIGURED"
          ? "Install Ollama locally (free) or ask an admin to set ANTHROPIC_API_KEY in backend/.env."
          : "AI insights are temporarily unavailable."
      );
    } finally {
      setInsightsLoading(false);
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

  // Cumulative headcount over time, from each delegate's real createdAt
  // (upload timestamp) — no separate tracking needed, this is the same
  // column that already drives the "Uploaded" column on "All delegates".
  // Bucketed by day; a day with zero uploads carries the running total
  // forward flat rather than dropping to zero, so the line reads as "team
  // size over time" rather than "uploads per day".
  const onboardingTrend = useMemo(() => {
    const withDates = delegates
      .filter((d) => d.createdAt)
      .map((d) => new Date(d.createdAt))
      .filter((d) => !isNaN(d))
      .sort((a, b) => a - b);
    if (withDates.length === 0) return [];
    const dayKey = (d) => d.toLocaleDateString([], { day: "2-digit", month: "short" });
    const counts = new Map();
    withDates.forEach((d) => {
      const k = dayKey(d);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    let running = 0;
    return [...counts.entries()].map(([date, added]) => {
      running += added;
      return { date, total: running };
    });
  }, [delegates]);

  return (
    <div>
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
            <Sparkles size={16} /> {insightsLoading ? t("Generating…") : t("Generate Insights")}
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

      {filterOpen && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div className="page-eyebrow" style={{ marginBottom: 10 }}>{t("Filter by coach")}</div>
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
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div className="page-eyebrow" style={{ marginBottom: 10 }}>{t("Sort coach load by")}</div>
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
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div className="page-eyebrow" style={{ marginBottom: 10 }}>{t("Visible widgets")}</div>
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

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 20 }}>
          {visible.breakdown && (
            <div className="card" style={{ padding: 20 }}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>{t("Attendance breakdown")}</h2>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={breakdown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {breakdown.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {visible.coachLoad && (
            <div className="card" style={{ padding: 20 }}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>
                {t("Coach load")}
                {coachFilter !== "ALL" && coachLoad[0] && ` — ${coachLoad[0].name}`}
              </h2>
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
            </div>
          )}

          {visible.vipMissing && (
            <div className="card" style={{ padding: 20 }}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>{t("VIP vs. non-VIP missing")}</h2>
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
            </div>
          )}

          {visible.onboardingTrend && (
            <div className="card" style={{ padding: 20 }}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>{t("Delegates onboarded over time")}</h2>
              {onboardingTrend.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "24px 0" }}>{t("No upload history yet.")}</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={onboardingTrend}>
                    <defs>
                      <linearGradient id="mgTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--scc-red)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--scc-red)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" fontSize={12} />
                    <YAxis fontSize={12} allowDecimals={false} />
                    <Tooltip formatter={(v) => [v, t("Total delegates")]} />
                    <Area type="monotone" dataKey="total" stroke="var(--scc-red)" strokeWidth={2} fill="url(#mgTrendFill)" name={t("Total delegates")} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
