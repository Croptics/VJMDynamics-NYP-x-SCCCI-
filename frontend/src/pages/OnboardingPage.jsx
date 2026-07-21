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
  Mail,
  Phone,
  Globe,
  Check,
} from "lucide-react";
import { ConfidenceBadge } from "../components/StatusBadge.jsx";
import {
  startParseJob,
  getParseJob,
  getOnboardingContext,
  getTrips,
  confirmDelegates,
  exportRowsCsv,
} from "../lib/claudeParse.js";
import { useLang } from "../lib/i18n.jsx";
import BoardingPassesView from "./BoardingPassesView.jsx";
import TripPulse from "../components/TripPulse.jsx";

/**
 * Screen 4 — AI Document Parsing & Attendee Onboarding (Vance).
 *
 * The document is read by a server-side JOB (page by page), so this page can be
 * left and re-attached — the parse keeps going in the background. Extracted
 * rows stream in with a progress bar, then the admin can review, flag VIPs,
 * assign coaches, search/export and Confirm into the shared delegate list.
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

/* Review-time passport check — mirrors the backend rule: flag a parsed row whose
 * passport is expired or expires within 6 months (the overseas-travel rule), so
 * the organiser can catch it before confirming. Returns null when there's no
 * usable expiry (never a false alarm). */
const passportFlag = (expiry) => {
  if (!expiry) return null;
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const six = new Date(now); six.setMonth(six.getMonth() + 6);
  if (d < now) return "expired";
  if (d < six) return "expiring";
  return null;
};

export default function OnboardingPage() {
  const { t } = useLang();
  const inputRef = useRef(null);
  const pollRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [tripId, setTripId] = useState(() => localStorage.getItem(LS_TRIP) || "");
  const [trips, setTrips] = useState([]);
  const [job, setJob] = useState(null); // {id, fileName, status, done, total, method, error}
  const [rows, setRows] = useState([]);
  const [editAll, setEditAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("parse"); // parse | passes | scan
  const [context, setContext] = useState({ existingNames: [], coaches: [] });

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

  /* ---- real trips for the picker (ids that actually exist in the DB) --- */
  useEffect(() => {
    let alive = true;
    getTrips()
      .then((list) => {
        if (!alive) return;
        setTrips(list);
        // Drop a stale saved trip id (e.g. the old hardcoded t-2/t-3) that no
        // longer matches a real trip, so we never submit against a dead id.
        setTripId((cur) => (cur && !list.some((tr) => tr.id === cur) ? "" : cur));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

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
  const [editKeys, setEditKeys] = useState(() => new Set());
  const toggleEdit = (k) =>
    setEditKeys((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

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
      const { added, skippedInvalid = 0 } = await confirmDelegates(tripId, toAdd);
      const notes = [];
      if (skipped) notes.push(`${skipped} ${t("duplicates skipped")}`);
      if (skippedInvalid) notes.push(`${skippedInvalid} ${t("invalid skipped")}`);
      alert(`${added} ${t("delegates added to the trip.")}${notes.length ? ` (${notes.join(", ")})` : ""}`);
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
      <div className="row between" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-eyebrow">{t("Onboarding")}</div>
          <h1 className="page-title">{t("Document parsing")}</h1>
          <p className="page-sub">{t("Read documents into delegates, print QR boarding passes, and board them on-site.")}</p>
        </div>
        <TripPulse mode="onboarding" />
      </div>

      {/* Tabs — rounded tinted pills, matching the Dashboard's tab group
          (Delegate/Analytics/Staff operations) so the whole app's tab
          treatment is consistent. Was a flat borderRadius:0 underline
          before, which clashed with the design system's rounded controls. */}
      <div className="row" style={{ gap: 8, marginTop: 16 }}>
        {[["parse", "Document parsing"], ["passes", "Boarding passes"]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className="btn"
            style={{
              background: view === k ? "var(--scc-red-tint)" : "transparent",
              color: view === k ? "var(--scc-red)" : "var(--ink-2)",
              border: `1px solid ${view === k ? "var(--scc-red-tint-2)" : "var(--line)"}`,
              fontWeight: 600,
            }}>
            {t(label)}
          </button>
        ))}
      </div>

      {view === "passes" && <div style={{ marginTop: 20 }}><BoardingPassesView tripId={tripId} /></div>}

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
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}{trip.dateRange ? ` · ${trip.dateRange}` : ""}
                </option>
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
              <button className="btn btn-primary" onClick={confirmAndAdd}
                disabled={saving || job?.status === "running" || rows.length - dupCount === 0}>
                <CheckCircle2 size={16} /> {saving ? t("Adding…") : `${t("Confirm & add")} ${rows.length - dupCount}`}
              </button>
            </div>
          </div>
          {rows.length > 0 && dupCount === rows.length && (
            <div style={{ padding: "10px 20px", fontSize: 12.5, color: "var(--st-missing)", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
              {t("All extracted delegates are already in this trip — nothing new to add.")}
            </div>
          )}

          <div style={{ padding: "12px 16px 16px" }}>
            {visibleRows.length === 0 && (
              <div className="muted" style={{ fontSize: 13, padding: 8 }}>{t("No matching delegates.")}</div>
            )}
            {visibleRows.map((r) => {
              const editing = editAll || editKeys.has(r._key);
              const flagged = r.needsReview;
              const dup = isDup(r);
              const accent = dup ? "var(--st-missing)" : flagged ? "var(--st-review)" : "transparent";
              const initials = (r.fullName || "?").split(" ").map((s) => s[0]).slice(0, 2).join("");
              const details = [
                r.industry && { icon: Briefcase, text: r.industry },
                r.email && { icon: Mail, text: r.email },
                r.phone && { icon: Phone, text: r.phone },
                r.website && { icon: Globe, text: r.website },
              ].filter(Boolean);
              return (
                <div key={r._key} className="mg-drow" style={{
                  border: "1px solid var(--line)", borderLeft: `3px solid ${accent}`,
                  borderRadius: 12, padding: "14px 16px", marginBottom: 10, background: "var(--surface)",
                }}>
                  <div className="row" style={{ gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <span className="avatar" style={{ flexShrink: 0 }}>{initials}</span>

                    {/* Identity + details */}
                    <div style={{ flex: 1, minWidth: 220 }}>
                      {editing ? (
                        <input className="input" style={{ padding: "7px 10px", maxWidth: 320, fontWeight: 600, fontSize: 15 }}
                          value={r.fullName} placeholder={t("Name")}
                          onChange={(e) => updateField(r._key, "fullName", e.target.value)} />
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, fontSize: 15.5 }}>{r.fullName}</span>
                          {dup && <span className="mg-pill" style={{ color: "var(--st-missing)", background: "var(--surface-2)" }}>{t("Already in trip")}</span>}
                          {flagged && !dup && <span className="mg-pill" style={{ color: "var(--st-review)", background: "var(--surface-2)" }}>{t("Needs review")}</span>}
                          {passportFlag(r.passportExpiry) && (
                            <span className="mg-pill" style={{ color: passportFlag(r.passportExpiry) === "expired" ? "var(--st-missing)" : "var(--st-review)", background: "var(--surface-2)" }}>
                              {passportFlag(r.passportExpiry) === "expired" ? t("Passport expired") : t("Passport expiring")}
                            </span>
                          )}
                        </div>
                      )}

                      {!editing && (r.role || r.company) && (
                        <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                          {[r.role, r.company].filter(Boolean).join(" · ")}
                        </div>
                      )}

                      {!editing && details.length > 0 && (
                        <div className="row" style={{ gap: 18, flexWrap: "wrap", marginTop: 10 }}>
                          {details.map((d, i) => (
                            <span key={i} className="muted" style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                              <d.icon size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{d.text}</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {editing && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 10 }}>
                          {activeColumns.map((c) => (
                            <label key={c.key} style={{ fontSize: 11 }}>
                              <span className="muted" style={{ display: "block", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.03em", fontSize: 10.5 }}>{t(c.label)}</span>
                              <input className="input" type={c.type || "text"} style={{ padding: "7px 10px", width: "100%" }}
                                value={r[c.key] || ""} onChange={(e) => updateField(r._key, c.key, e.target.value)} />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Controls */}
                    <div className="row" style={{ gap: 8, alignItems: "center", flexShrink: 0 }}>
                      <button className="mg-iconbtn" onClick={() => setVip(r._key, !r.vip)} title={r.vip ? t("VIP") : t("Mark VIP")}
                        style={{ color: r.vip ? "#e0a800" : "var(--ink-3)" }}>
                        <Star size={18} fill={r.vip ? "#e0a800" : "none"} />
                      </button>
                      <select className="select" style={{ padding: "7px 8px", minWidth: 130 }}
                        value={r.coachId || ""} onChange={(e) => setCoach(r._key, e.target.value)}>
                        <option value="">{t("No coach")}</option>
                        {context.coaches.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}{c.city ? ` (${c.city})` : ""}</option>
                        ))}
                      </select>
                      <ConfidenceBadge value={r.confidence} />
                      <button className="mg-iconbtn" onClick={() => toggleEdit(r._key)} title={editing ? t("Done") : t("Edit")}
                        style={{ color: editing ? "var(--st-present)" : "var(--ink-3)" }}>
                        {editing ? <Check size={17} /> : <Pencil size={16} />}
                      </button>
                      <button className="mg-iconbtn" onClick={() => removeRow(r._key)} title={t("Remove")} style={{ color: "var(--ink-3)" }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      </>)}

      <style>{`
        .spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}
        .mg-drow{transition:box-shadow .15s ease, border-color .15s ease}
        .mg-drow:hover{box-shadow:0 3px 12px rgba(0,0,0,.07)}
        .mg-iconbtn{background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:7px;border-radius:9px;transition:background .12s ease}
        .mg-iconbtn:hover{background:var(--surface-2)}
        .mg-pill{font-size:10.5px;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
      `}</style>
    </div>
  );
}

/* Compact inline stat — a quiet strip, not a row of dashboard tiles. Zero-value
 * chips stay muted so the eye lands on what actually needs attention. */
function SummaryChip({ icon: Icon, label, value, tone }) {
  const active = Number(value) > 0;
  const color = !active ? "var(--ink-3)"
    : tone === "review" ? "var(--st-review)"
    : tone === "missing" ? "var(--st-missing)"
    : "var(--ink)";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      padding: "6px 12px", borderRadius: 999,
      background: "var(--surface-2)", border: "1px solid var(--line)",
    }}>
      <Icon size={14} color={color} />
      <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
    </div>
  );
}
