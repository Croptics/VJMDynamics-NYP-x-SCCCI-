import { useEffect, useState, useCallback } from "react";
import {
  Download,
  RefreshCw,
  AlertTriangle,
  UserCheck,
  HelpCircle,
  Bell,
  Activity,
  Crown,
  Plus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api.js";
import StatusBadge from "../components/StatusBadge.jsx";

/**
 * Screen 2 — Admin Dashboard & Analytics (Jun Qi).
 *
 * Use Case 5 — Real-Time "Missing Person" Identification & Analytics.
 *
 * CRUD build: the delegate list starts empty. Create / edit / delete delegates
 * from the "All delegates" card and every read view above it (KPI tiles, coach
 * bars, live activity, reverse-headcount missing list) recomputes live.
 *
 * Endpoints:
 *   GET    /api/trips/:id/dashboard    → KPIs + coach status + activity
 *   GET    /api/trips/:id/missing      → reverse-headcount list
 *   GET    /api/trips/:id/delegates    → all delegates (read)
 *   POST   /api/trips/:id/delegates    → create
 *   PATCH  /api/delegates/:id          → update
 *   DELETE /api/delegates/:id          → delete
 *   GET    /api/trips/:id/export       → Excel download
 */

const TRIP_ID = "t-1";
const API_BASE = import.meta.env.VITE_API_URL || "/api";

const EMPTY_FORM = { name: "", coachId: "", status: "PRESENT", vip: false, lastSeen: "" };

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState([]);
  const [delegates, setDelegates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = creating
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, miss, dels] = await Promise.all([
        apiGet(`/trips/${TRIP_ID}/dashboard`),
        apiGet(`/trips/${TRIP_ID}/missing`),
        apiGet(`/trips/${TRIP_ID}/delegates`),
      ]);
      setData(dash);
      setMissing(miss.missing || []);
      setDelegates(dels.delegates || []);
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function exportXlsx() {
    window.open(`${API_BASE}/trips/${TRIP_ID}/export?format=xlsx`, "_blank");
  }

  /* ---- CRUD handlers ---------------------------------------------------- */
  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(d) {
    setEditingId(d.id);
    setForm({
      name: d.name || "",
      coachId: d.coachId || "",
      status: d.status || "PRESENT",
      vip: !!d.vip,
      lastSeen: d.lastSeen || "",
    });
    setModalOpen(true);
  }

  async function saveForm() {
    if (!form.name.trim()) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      coachId: form.status === "UNASSIGNED" ? null : form.coachId || null,
      status: form.status,
      vip: form.vip,
      lastSeen: form.lastSeen.trim(),
    };
    try {
      if (editingId) {
        await apiPatch(`/delegates/${editingId}`, payload);
      } else {
        await apiPost(`/trips/${TRIP_ID}/delegates`, payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(d) {
    if (!window.confirm(`Delete ${d.name}? This cannot be undone.`)) return;
    try {
      await apiDelete(`/delegates/${d.id}`);
      await load();
    } catch (e) {
      setError(e.message || "Delete failed.");
    }
  }

  const trip = data?.trip;
  const k = data?.kpis;
  const coaches = data?.coaches || [];
  const coachName = (id) => {
    const c = coaches.find((x) => x.id === id);
    return c ? `${c.name} · ${c.city}` : "Unassigned";
  };

  return (
    <div className="page">
      {/* ---- Header ------------------------------------------------------- */}
      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div className="page-eyebrow">Active trip</div>
          <h1 className="page-title">Dashboard</h1>
          {trip ? (
            <p className="page-sub">
              {trip.name} · Day {trip.dayOf} of {trip.totalDays} · {trip.localTime} local ·{" "}
              {k?.total} delegates
            </p>
          ) : (
            <p className="page-sub">Live present / missing / unassigned visibility.</p>
          )}
        </div>

        <div className="row" style={{ gap: 10 }}>
          {data && (
            <span className="badge badge-present">
              <span style={S.dot} /> Live · synced
            </span>
          )}
          <button className="btn btn-ghost" onClick={load} title="Refresh">
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={exportXlsx} disabled={!data}>
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      {/* ---- Error banner ------------------------------------------------- */}
      {error && (
        <div
          className="card"
          style={{ marginTop: 20, padding: 16, borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}
        >
          <div className="row" style={{ gap: 10, color: "var(--st-missing)", fontWeight: 600 }}>
            <AlertTriangle size={18} /> Couldn’t reach the backend
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {error} — make sure it’s running (<code>cd backend &amp;&amp; npm run dev</code>), then hit Refresh.
          </p>
        </div>
      )}

      {loading && !data && (
        <div className="muted" style={{ marginTop: 24 }}>Loading…</div>
      )}

      {/* ---- KPI tiles ---------------------------------------------------- */}
      {k && (
        <div style={S.kpiGrid}>
          <Kpi tone="missing" icon={AlertTriangle} label="Missing right now" value={`${k.missing}`}
            suffix={`of ${k.total}`} foot={trip ? `Departure in ${trip.departsIn}` : null} big />
          <Kpi tone="present" icon={UserCheck} label="Present" value={`${k.present}`}
            foot={`+${k.presentDelta} in last 5 mins`} />
          <Kpi tone="unassigned" icon={HelpCircle} label="Unassigned" value={`${k.unassigned}`}
            foot="No coach yet" />
          <Kpi tone="normal" icon={Bell} label="Open exceptions" value={`${k.openExceptions}`}
            foot={`${k.criticalExceptions} critical · ${k.normalExceptions} normal`} />
        </div>
      )}

      {/* ---- Coach status + Live activity -------------------------------- */}
      {data && (
        <div style={S.twoCol}>
          <div className="card" style={{ padding: 22 }}>
            <div className="row between" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 16 }}>Coach status</h2>
              <span className="muted" style={{ fontSize: 13 }}>{coaches.length} coaches</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {coaches.map((c) => (
                <CoachBar key={c.id} coach={c} />
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 22 }}>
            <div className="row" style={{ marginBottom: 16, gap: 8 }}>
              <Activity size={18} color="var(--ink-3)" />
              <h2 style={{ fontSize: 16 }}>Live activity</h2>
            </div>
            {data.activity.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                No activity yet. Add or update a delegate to see events here.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {data.activity.map((a) => (
                  <div key={a.id} className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                    <span style={{ ...S.dot, background: activityColor(a.kind), marginTop: 6 }} />
                    <div>
                      <div style={{ fontSize: 14 }}>{a.text}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{a.time} · {a.via}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- Reverse-headcount missing list ------------------------------ */}
      {data && (
        <div className="card" style={{ marginTop: 20, overflow: "hidden" }}>
          <div className="row between" style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <h2 style={{ fontSize: 16 }}>Missing right now</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                Reverse headcount — delegates who haven’t boarded yet
              </p>
            </div>
            <span className="badge badge-missing">{missing.length} missing</span>
          </div>

          {missing.length === 0 ? (
            <div className="muted" style={{ padding: 24, fontSize: 14 }}>
              {k?.total ? "Everyone’s accounted for. 🎉" : "No delegates yet."}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Delegate</th><th>Coach</th><th>Last seen</th><th style={{ width: 90 }} /></tr>
              </thead>
              <tbody>
                {missing.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <span className="avatar" style={{ background: "var(--st-missing-bg)", color: "var(--st-missing)" }}>
                          {m.initials}
                        </span>
                        <span style={{ fontWeight: 500 }}>{m.name}</span>
                        {m.vip && (
                          <span className="badge badge-review" style={{ padding: "2px 8px" }}>
                            <Crown size={12} /> VIP
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{m.coach}</td>
                    <td className="muted">{m.lastSeen || "—"}</td>
                    <td><span className="badge badge-missing">Missing</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ---- All delegates (CRUD surface) -------------------------------- */}
      {data && (
        <div className="card" style={{ marginTop: 20, overflow: "hidden" }}>
          <div className="row between" style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <h2 style={{ fontSize: 16 }}>All delegates</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                Create, edit, and remove attendance records
              </p>
            </div>
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /> Add delegate
            </button>
          </div>

          {delegates.length === 0 ? (
            <div className="muted" style={{ padding: 24, fontSize: 14 }}>
              No delegates yet. Click <strong>Add delegate</strong> to create your first record.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Delegate</th><th>Coach</th><th>Status</th><th>Last seen</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {delegates.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <span className="avatar">{d.initials}</span>
                        <span style={{ fontWeight: 500 }}>{d.name}</span>
                        {d.vip && (
                          <span className="badge badge-review" style={{ padding: "2px 8px" }}>
                            <Crown size={12} /> VIP
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{coachName(d.coachId)}</td>
                    <td><StatusBadge state={d.status} /></td>
                    <td className="muted">{d.lastSeen || "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button onClick={() => openEdit(d)} aria-label={`Edit ${d.name}`}
                          style={S.iconBtn}>
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => remove(d)} aria-label={`Delete ${d.name}`}
                          style={{ ...S.iconBtn, color: "var(--st-missing)" }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ---- Create / Edit modal ----------------------------------------- */}
      {modalOpen && (
        <div style={S.overlay} onClick={() => !saving && setModalOpen(false)}>
          <div className="card" style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ marginBottom: 18 }}>
              <h2 style={{ fontSize: 18 }}>{editingId ? "Edit delegate" : "Add delegate"}</h2>
              <button onClick={() => setModalOpen(false)} style={S.iconBtn} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <label className="field-label">Full name</label>
            <input className="input" autoFocus value={form.name}
              placeholder="e.g. Lim Wei Jie"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />

            <label className="field-label" style={{ marginTop: 14 }}>Status</label>
            <select className="select" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="PRESENT">Present</option>
              <option value="MISSING">Missing</option>
              <option value="UNASSIGNED">Unassigned</option>
            </select>

            <label className="field-label" style={{ marginTop: 14 }}>Coach</label>
            <select className="select" value={form.coachId}
              disabled={form.status === "UNASSIGNED"}
              onChange={(e) => setForm({ ...form, coachId: e.target.value })}>
              <option value="">{form.status === "UNASSIGNED" ? "No coach (unassigned)" : "Select a coach…"}</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.city}</option>
              ))}
            </select>

            <label className="field-label" style={{ marginTop: 14 }}>Last seen (optional)</label>
            <input className="input" value={form.lastSeen}
              placeholder="e.g. Lobby · 14:08"
              onChange={(e) => setForm({ ...form, lastSeen: e.target.value })} />

            <label className="row" style={{ gap: 8, marginTop: 16, fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={form.vip}
                onChange={(e) => setForm({ ...form, vip: e.target.checked })} />
              Mark as VIP
            </label>

            <div className="row" style={{ gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveForm} disabled={saving || !form.name.trim()}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Add delegate"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* ---- KPI tile ----------------------------------------------------------- */
function Kpi({ tone, icon: Icon, label, value, suffix, foot, big }) {
  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row between">
        <span className="page-eyebrow" style={{ color: `var(--st-${tone})` }}>{label}</span>
        <Icon size={18} color={`var(--st-${tone})`} />
      </div>
      <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
        <span className="mono"
          style={{ fontSize: big ? 44 : 40, fontWeight: 700, color: `var(--st-${tone})`, lineHeight: 1 }}>
          {value}
        </span>
        {suffix && <span className="muted" style={{ fontSize: 16 }}>{suffix}</span>}
      </div>
      {foot && <div className="muted" style={{ fontSize: 13 }}>{foot}</div>}
    </div>
  );
}

/* ---- Coach progress bar ------------------------------------------------- */
function CoachBar({ coach }) {
  const pct = coach.capacity ? Math.round((coach.boarded / coach.capacity) * 100) : 0;
  const allIn = coach.total > 0 && coach.missing === 0;
  const barColor = coach.missing > 0 ? "var(--st-missing)" : "var(--st-present)";
  return (
    <div>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="avatar" style={{ background: "var(--st-neutral-bg)", color: "var(--ink-2)" }}>
            {coach.label}
          </span>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{coach.name} · {coach.city}</span>
        </div>
        {coach.missing > 0 ? (
          <span className="badge badge-missing">{coach.missing} missing</span>
        ) : allIn ? (
          <span className="badge badge-present">All in</span>
        ) : (
          <span className="badge badge-neutral">Empty</span>
        )}
      </div>
      <div style={S.track}>
        <div style={{ ...S.fill, width: `${pct}%`, background: barColor }} />
      </div>
      <div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>
        {coach.boarded}/{coach.capacity} boarded
      </div>
    </div>
  );
}

function activityColor(kind) {
  if (kind === "exception") return "var(--st-missing)";
  if (kind === "reassign") return "var(--st-unassigned)";
  return "var(--st-present)";
}

/* ---- Local styles ------------------------------------------------------- */
const S = {
  dot: { width: 10, height: 10, borderRadius: 999, background: "var(--st-present)", display: "inline-block", flexShrink: 0 },
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16, marginTop: 22 },
  twoCol: { display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginTop: 20 },
  track: { height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999, transition: "width 0.4s ease" },
  iconBtn: { background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4, borderRadius: 6 },
  overlay: { position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 },
  modal: { width: "min(440px, 100%)", padding: 24, background: "#fff" },
};
