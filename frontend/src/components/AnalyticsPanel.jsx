import { useEffect, useMemo, useState } from "react";
import { BarChart3, Eye, EyeOff, RefreshCw, AlertTriangle } from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { apiGet, getUser } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * Analytics panel — the "Analytics" tab inside the Dashboard page.
 *
 * Read-only, built entirely on top of the existing GET
 * /api/trips/:id/dashboard and /missing endpoints (no new backend routes or
 * schema). "Customization" = each signed-in user can toggle which widgets
 * are visible; the choice is remembered per-username in localStorage.
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
];

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

export default function AnalyticsPanel() {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visible, setVisible] = useState(loadPrefs);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [dash, miss] = await Promise.all([
        apiGet(`/trips/${TRIP_ID}/dashboard`),
        apiGet(`/trips/${TRIP_ID}/missing`),
      ]);
      setData(dash);
      setMissing(miss.missing || []);
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
    } finally {
      setLoading(false);
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

  const coachLoad = useMemo(() => {
    if (!data) return [];
    return (data.coaches || []).map((c) => ({
      name: c.label,
      boarded: c.boarded,
      remaining: Math.max(c.capacity - c.boarded, 0),
    }));
  }, [data]);

  const vipMissing = useMemo(() => {
    const vip = missing.filter((m) => m.vip).length;
    const nonVip = missing.length - vip;
    return [
      { name: "VIP", value: vip, color: COLORS.vip },
      { name: t("Non-VIP"), value: nonVip, color: COLORS.nonVip },
    ];
  }, [missing, t]);

  return (
    <div>
      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 4 }}>
        <p className="page-sub" style={{ margin: 0 }}>{t("Attendance breakdown, coach load, and VIP visibility — live from the trip data.")}</p>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-ghost" onClick={load} title={t("Refresh")}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> {t("Refresh")}
          </button>
          <button className="btn btn-ghost" onClick={() => setPanelOpen((v) => !v)}>
            <BarChart3 size={16} /> {t("Customize")}
          </button>
        </div>
      </div>

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

      {error && (
        <div className="card" style={{ marginTop: 20, padding: 16, borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 10, color: "var(--st-missing)", fontWeight: 600 }}>
            <AlertTriangle size={18} /> {t("Couldn't reach the backend")}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{error}</p>
        </div>
      )}

      {loading && !data && <div className="muted" style={{ marginTop: 24 }}>{t("Loading…")}</div>}

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
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>{t("Coach load")}</h2>
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
        </div>
      )}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
