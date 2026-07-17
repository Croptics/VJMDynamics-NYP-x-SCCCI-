import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import {
  UploadCloud,
  AlertCircle,
  CheckCircle2,
  Pencil,
  Trash2,
  Search,
  Download,
  Star,
  Users,
  Building2,
  Briefcase,
  Loader2,
} from "lucide-react";
import { ConfidenceBadge } from "../components/StatusBadge.jsx";
import {
  startParseJob,
  getParseJob,
  getOnboardingContext,
  confirmDelegates,
  exportRowsCsv,
} from "../lib/claudeParse.js";
import { apiGet } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";
import BoardingPassesView from "./BoardingPassesView.jsx";
import ScanToBoardView from "./ScanToBoardView.jsx";

/**
 * Screen 4 — AI Document Parsing & Attendee Onboarding (Vance).
 *
 * The document is read by a server-side JOB (page by page), so this page can be
 * left and re-attached — the parse keeps going in the background. Extracted
 * rows stream in with a progress bar, then the admin can review, flag VIPs,
 * assign coaches, search/export and Confirm into the shared delegate list.
 *
 * "Assign to trip" used to be a hardcoded stub list (t-1/t-2/t-3, only one of
 * which — t-1 — was ever a real trip) totally disconnected from the actual
 * trips table. Assigning an upload to "Shanghai"/"Shenzhen" from that stub
 * silently created delegates with no real trip attached — invisible on the
 * Trips board and the arrival check-in module, since neither one ever
 * queries for an unscoped/orphaned delegate. Fixed by fetching the REAL trip
 * list the same way DashboardPage.jsx's trip switcher does (GET /all-trips +
 * the base trip's own name), so every trip actually in the database is a
 * real, working option here.
 */

// Optional columns rendered only when at least one row has data for them.
const OPTIONAL_COLUMNS = [
  { key: "role", label: "Role" },
  { key: "company", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "passportNumber", label: "Passport", mono: true },
  { key: "nationality", label: "Nationality" },
  { key: "passportExpiry", label: "Expiry", type: "date", mono: true },
];

const LS_JOB = "mg_parse_job";
const LS_ROWS = "mg_parse_rows";
const LS_TRIP = "mg_parse_trip";
const POLL_MS = 2500;

const keyOf = (name) => (name || "").trim().toLowerCase();

export default function OnboardingPage() {
  const { t } = useLang();
  const inputRef = useRef(null);
  const pollRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [tripId, setTripId] = useState(() => localStorage.getItem(LS_TRIP) || "");
  const [job, setJob] = useState(null); // {id, fileName, status, done, total, method, error}
  const [rows, setRows] = useState([]);
  const [editAll, setEditAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [context, setContext] = useState({ existingNames: [], coaches: [] });
  const [view, setView] = useState("parse"); // parse | passes | scan
  const [baseTrip, setBaseTrip] = useState(null); // the real base ("t-1") trip's own name/uuid
  const [otherTrips, setOtherTrips] = useState([]); // every OTHER real trip, from /api/all-trips

  /* ---- real trip list (replaces the old hardcoded t-1/t-2/t-3 stub) ----- */
  useEffect(() => {
    apiGet("/trips/t-1").then(setBaseTrip).catch(() => {});
    apiGet("/all-trips").then((r) => setOtherTrips(r.trips || [])).catch(() => {});
  }, []);

  const tripOptions = useMemo(() => {
    const opts = [{ id: "t-1", name: baseTrip?.name || "Beijing study mission" }];
    for (const tr of otherTrips) {
      if (baseTrip && tr.id === baseTrip.uuid_id) continue; // skip dup of the base trip
      opts.push({ id: tr.id, name: tr.name });
    }
    return opts;
  }, [otherTrips, baseTrip]);

  // A trip id saved to localStorage before this fix (the old "t-2"/"t-3" stub
  // options) no longer matches anything real — clear it once the real list is
  // in, rather than silently keeping an upload pointed at a trip that doesn't
  // exist.
  useEffect(() => {
    if (tripId && tripOptions.length > 0 && !tripOptions.some((o) => o.id === tripId)) {
      setTripId("");
    }
  }, [tripOptions, tripId]);

  /* ---- duplicate set (names already in the selected trip) --------------- */
  const existingSet = useMemo(
    () => new Set((context.existingNames || []).map(keyOf)),
    [context]
  );
  const isDup = useCallback((r) => existingSet.has(keyOf(r.fullName)), [existingSet]);

  /* ---- persistence ----------------------------------------------------- */
  useEffect(() => { localStorage.setItem(LS_TRIP, tripId); }, [tripId]);
  useEffect(() => {
    try { localStorage.setItem(LS_ROWS, JSON.stringify(rows)); } catch { /* quota */ }
  }, [rows]);
  useEffect(() => {
    if (job?.id) localStorage.setItem(LS_JOB, JSON.stringify({ id: job.id, fileName: job.fileName, status: job.status }));
  }, [job]);

  /* ---- onboarding context (existing names + coaches) ------------------- */
  useEffect(() => {
    let alive = true;
    getOnboardingContext(tripId).then((c) => alive && setContext(c)).catch(() => {});
    return () => { alive = false; };
  }, [tripId]);

  /* ---- merge server rows into client rows (preserving edits) ----------- */
  const mergeRows = (client, server) => {
    const map = new Map(client.map((r) => [r._key, r]));
    for (const sr of server) {
      const k = keyOf(sr.fullName);
      if (!k) continue;
      if (!map.has(k)) map.set(k, { ...sr, _key: k, _id: k, vip: false, coachId: "" });
    }
    return [...map.values()];
  };

  /* ---- polling --------------------------------------------------------- */
  const poll = useCallback(async (jobId) => {
    try {
      const j = await getParseJob(jobId);
      setJob((prev) => (prev ? { ...prev, status: j.status, done: j.done, total: j.total, method: j.method, error: j.error } : prev));
      setRows((prev) => mergeRows(prev, j.rows || []));
      if (j.status !== "running") { clearInterval(pollRef.current); pollRef.current = null; }
    } catch {
      clearInterval(pollRef.current); pollRef.current = null;
      setJob((prev) => (prev ? { ...prev, status: "error", error: t("This parse job expired. Please upload again.") } : prev));
    }
  }, [t]);

  const startPolling = useCallback((jobId) => {
    clearInterval(pollRef.current);
    poll(jobId);
    pollRef.current = setInterval(() => poll(jobId), POLL_MS);
  }, [poll]);

  /* ---- resume any job in progress after navigating back / reloading ---- */
  useEffect(() => {
    const savedRows = JSON.parse(localStorage.getItem(LS_ROWS) || "[]");
    if (savedRows.length) setRows(savedRows);
    const saved = JSON.parse(localStorage.getItem(LS_JOB) || "null");
    if (saved?.id) { setJob(saved); startPolling(saved.id); }
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- upload / start a job -------------------------------------------- */
  const ingest = useCallback(async (fileList) => {
    const file = Array.from(fileList)[0];
    if (!file) return;
    clearInterval(pollRef.current);
    setRows([]);
    setSearch("");
    setEditAll(false);
    setJob({ id: null, fileName: file.name, status: "running", done: 0, total: 0, method: null, error: null });
    try {
      const { jobId } = await startParseJob(file);
      setJob((j) => ({ ...j, id: jobId }));
      localStorage.setItem(LS_JOB, JSON.stringify({ id: jobId, fileName: file.name, status: "running" }));
      startPolling(jobId);
    } catch (err) {
      setJob((j) => ({ ...j, status: "error", error: err.message }));
    }
  }, [startPolling]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) ingest(e.dataTransfer.files);
  };

  /* ---- row edits ------------------------------------------------------- */
  const updateField = (k, field, value) =>
    setRows((prev) => prev.map((r) => (r._key === k ? { ...r, [field]: value, needsReview: false } : r)));
  const setVip = (k, val) => setRows((prev) => prev.map((r) => (r._key === k ? { ...r, vip: val } : r)));
  const setCoach = (k, val) => setRows((prev) => prev.map((r) => (r._key === k ? { ...r, coachId: val } : r)));
  const removeRow = (k) => setRows((prev) => prev.filter((r) => r._key !== k));

  /* ---- derived --------------------------------------------------------- */
  const reviewNeeded = useMemo(() => rows.filter((r) => r.needsReview).length, [rows]);
  const dupCount = useMemo(() => rows.filter(isDup).length, [rows, isDup]);
  const activeColumns = useMemo(
    () => OPTIONAL_COLUMNS.filter((c) => rows.some((r) => r[c.key])),
    [rows]
  );
  const companies = useMemo(() => new Set(rows.map((r) => (r.company || "").trim()).filter(Boolean)).size, [rows]);
  const industries = useMemo(() => new Set(rows.map((r) => (r.industry || "").trim()).filter(Boolean)).size, [rows]);
  const visibleRows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.fullName, r.company, r.role, r.email, r.industry].some((v) => (v || "").toLowerCase().includes(s)));
  }, [rows, search]);

  /* ---- confirm --------------------------------------------------------- */
  const confirmAndAdd = async () => {
    if (!tripId) { alert(t("Please choose a trip to assign these delegates to first.")); return; }
    if (reviewNeeded > 0 && !window.confirm(t("Some rows still need review. Add them anyway?"))) return;
    const toAdd = rows.filter((r) => !isDup(r));
    const skipped = rows.length - toAdd.length;
    if (toAdd.length === 0) { alert(t("Every extracted delegate is already in this trip.")); return; }
    setSaving(true);
    try {
      const { added } = await confirmDelegates(tripId, toAdd);
      alert(`${added} ${t("delegates added to the trip.")}${skipped ? ` (${skipped} ${t("duplicates skipped")})` : ""}`);
      setRows([]);
      setJob(null);
      localStorage.removeItem(LS_JOB);
      localStorage.removeItem(LS_ROWS);
      getOnboardingContext(tripId).then(setContext).catch(() => {});
    } catch (err) {
      alert(err.message || t("Couldn't save the delegates. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const pct = job && job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;

  /* --------------------------------------------------------------------- */
  return (
    <div className="page">
      <div className="page-eyebrow">{t("Onboarding")}</div>
      <h1 className="page-title">{t("Document parsing")}</h1>
      <p className="page-sub">{t("Drop a delegate directory, attendee list, or passport scan — AI reads it and builds your delegate list.")}</p>

      {/* Tabs */}
      <div className="mg-tabbar row" style={{ gap: 4, marginTop: 16, borderBottom: "1px solid var(--line)" }}>
        {[["parse", "Document parsing"], ["passes", "Boarding passes"], ["scan", "Scan to board"]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className="btn btn-ghost"
            style={{ borderRadius: 0, borderBottom: `2px solid ${view === k ? "var(--scc-red)" : "transparent"}`, color: view === k ? "var(--scc-red)" : "var(--ink-2)", fontWeight: 600 }}>
            {t(label)}
          </button>
        ))}
      </div>

      {view === "passes" && <div style={{ marginTop: 20 }}><BoardingPassesView tripId={tripId} /></div>}
      {view === "scan" && <div style={{ marginTop: 20 }}><ScanToBoardView tripId={tripId} /></div>}

      {view === "parse" && (<>

      {/* Upload + job status */}
      <div className="card" style={{ padding: 24, marginTop: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }}>
          {/* Dropzone */}
          <div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                border: `1.5px dashed ${dragOver ? "var(--scc-red)" : "var(--line)"}`,
                background: dragOver ? "var(--scc-red-tint)" : "var(--surface-2)",
                borderRadius: "var(--r-md)",
                padding: "40px 24px",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <UploadCloud size={34} color="var(--ink-3)" />
              <p style={{ margin: "12px 0 4px", fontWeight: 600 }}>{t("Drop a file or click to upload")}</p>
              <p className="muted" style={{ fontSize: 13 }}>{t("PDF or scanned image · reads in the background")}</p>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/*"
                hidden
                onChange={(e) => e.target.files?.length && ingest(e.target.files)}
              />
            </div>

            <label className="field-label" style={{ marginTop: 16 }}>{t("Assign to trip")}</label>
            <select className="select" value={tripId} onChange={(e) => setTripId(e.target.value)}>
              <option value="">{t("Select a trip…")}</option>
              {tripOptions.map((trip) => (
                <option key={trip.id} value={trip.id}>{trip.name}</option>
              ))}
            </select>
          </div>

          {/* Job status / progress */}
          <div>
            {!job && (
              <div className="muted" style={{ fontSize: 13, paddingTop: 8 }}>
                {t("Uploaded documents appear here with live extraction progress. You can leave this page while it reads.")}
              </div>
            )}
            {job && (
              <div className="card" style={{ padding: 16, borderColor: job.status === "error" ? "var(--st-missing)" : job.status === "done" ? "var(--st-present)" : "var(--st-review)" }}>
                <div className="row" style={{ gap: 10, alignItems: "center" }}>
                  {job.status === "running" ? <Loader2 size={18} className="spin" color="var(--st-review)" />
                    : job.status === "done" ? <CheckCircle2 size={18} color="var(--st-present)" />
                    : <AlertCircle size={18} color="var(--st-missing)" />}
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {job.fileName}
                  </div>
                  {job.method && <span className="badge badge-present" style={{ fontSize: 11 }}>{job.method}</span>}
                </div>

                {job.status === "running" && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${job.total ? pct : 8}%`, background: "var(--scc-red)", transition: "width 0.4s", borderRadius: 999 }} />
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      {job.total
                        ? `${t("Reading page")} ${job.done}/${job.total} · ${rows.length} ${t("found so far")}`
                        : t("Starting…")}
                      {" · "}{t("you can leave this page")}
                    </div>
                  </div>
                )}
                {job.status === "done" && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    {rows.length} {t("delegates extracted")}{reviewNeeded ? ` · ${reviewNeeded} ${t("need review")}` : ""}
                  </div>
                )}
                {job.status === "error" && (
                  <div style={{ fontSize: 12, marginTop: 8, color: "var(--st-missing)" }}>{job.error}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary strip */}
      {rows.length > 0 && (
        <div className="row" style={{ gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <SummaryChip icon={Users} label={t("Delegates")} value={rows.length} />
          <SummaryChip icon={Building2} label={t("Companies")} value={companies} />
          <SummaryChip icon={Briefcase} label={t("Industries")} value={industries} />
          <SummaryChip icon={AlertCircle} label={t("Need review")} value={reviewNeeded} tone={reviewNeeded ? "review" : undefined} />
          <SummaryChip icon={Trash2} label={t("Already in trip")} value={dupCount} tone={dupCount ? "missing" : undefined} />
        </div>
      )}

      {/* Extracted table */}
      {rows.length > 0 && (
        <div className="card" style={{ marginTop: 16, overflow: "hidden" }}>
          <div className="row between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", gap: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative", minWidth: 220, flex: 1 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "var(--ink-3)" }} />
              <input
                className="input"
                placeholder={t("Search extracted delegates…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 32 }}
              />
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setEditAll((v) => !v)}>
                <Pencil size={15} /> {editAll ? t("Done editing") : t("Edit all")}
              </button>
              <button className="btn btn-ghost" onClick={() => exportRowsCsv(rows, "delegates.csv")}>
                <Download size={15} /> {t("Export")}
              </button>
              <button className="btn btn-primary" onClick={confirmAndAdd} disabled={saving || job?.status === "running"}>
                <CheckCircle2 size={16} /> {saving ? t("Adding…") : `${t("Confirm & add")} ${rows.length - dupCount}`}
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Name")}</th>
                  {activeColumns.map((c) => (
                    <th key={c.key}>{t(c.label)}</th>
                  ))}
                  <th>{t("VIP")}</th>
                  <th>{t("Coach")}</th>
                  <th>{t("Confidence")}</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const editing = editAll || r.needsReview;
                  const flagged = r.needsReview;
                  const dup = isDup(r);
                  const initials = (r.fullName || "?").split(" ").map((s) => s[0]).slice(0, 2).join("");
                  return (
                    <tr key={r._key} style={flagged ? { background: "var(--st-review-bg)" } : dup ? { opacity: 0.6 } : undefined}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <span className="avatar" style={flagged ? { background: "var(--st-review-bg)", color: "var(--st-review)" } : undefined}>
                            {initials}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            {editing ? (
                              <input className="input" style={{ padding: "6px 8px", maxWidth: 160 }}
                                value={r.fullName} onChange={(e) => updateField(r._key, "fullName", e.target.value)} />
                            ) : (
                              <span style={{ fontWeight: 500 }}>{r.fullName}</span>
                            )}
                            {dup && <div style={{ fontSize: 11, color: "var(--st-missing)", fontWeight: 600 }}>{t("already in trip")}</div>}
                          </div>
                        </div>
                      </td>
                      {activeColumns.map((c) => (
                        <td key={c.key} className={c.mono ? "mono" : undefined}>
                          {editing ? (
                            <input className="input" type={c.type || "text"}
                              style={{ padding: "6px 8px", maxWidth: c.type === "date" ? 150 : 160 }}
                              value={r[c.key] || ""} onChange={(e) => updateField(r._key, c.key, e.target.value)} />
                          ) : c.type === "date" && r[c.key] ? (
                            new Date(r[c.key]).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                          ) : (
                            <span style={!r[c.key] ? { color: "var(--ink-3)" } : undefined}>{r[c.key] || "—"}</span>
                          )}
                        </td>
                      ))}
                      <td>
                        <button
                          onClick={() => setVip(r._key, !r.vip)}
                          aria-label={r.vip ? "Unmark VIP" : "Mark VIP"}
                          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", color: r.vip ? "#e0a800" : "var(--ink-3)" }}
                        >
                          <Star size={17} fill={r.vip ? "#e0a800" : "none"} />
                        </button>
                      </td>
                      <td>
                        <select className="select" style={{ padding: "6px 28px 6px 8px", minWidth: 110 }}
                          value={r.coachId || ""} onChange={(e) => setCoach(r._key, e.target.value)}>
                          <option value="">{t("—")}</option>
                          {context.coaches.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}{c.city ? ` (${c.city})` : ""}</option>
                          ))}
                        </select>
                      </td>
                      <td><ConfidenceBadge value={r.confidence} /></td>
                      <td>
                        <button onClick={() => removeRow(r._key)} aria-label={`Remove ${r.fullName}`}
                          style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex" }}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      </>)}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function SummaryChip({ icon: Icon, label, value, tone }) {
  const color = tone === "review" ? "var(--st-review)" : tone === "missing" ? "var(--st-missing)" : "var(--ink)";
  return (
    <div className="card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, minWidth: 130 }}>
      <Icon size={18} color={color} />
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color }}>{value}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}
