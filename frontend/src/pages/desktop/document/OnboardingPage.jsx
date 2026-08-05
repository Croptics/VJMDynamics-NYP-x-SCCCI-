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
  X,
} from "lucide-react";
import { ConfidenceBadge } from "../../../components/StatusBadge.jsx";
import {
  startParseJob,
  getParseJob,
  getOnboardingContext,
  getTrips,
  confirmDelegates,
  exportRowsCsv,
  getBadges,
} from "../../../lib/document/claudeParse.js";
import { useLang } from "../../../lib/i18n.jsx";
import BoardingPassesView from "./BoardingPassesView.jsx";
import TripPulse from "../../../components/TripPulse.jsx";
import { getActiveTripId, resolveActiveTripId, ACTIVE_TRIP_EVENT } from "../../../lib/activeTrip.js";
import { apiGet, getUser } from "../../../lib/api.js";
import { scopedTripIds } from "../../../lib/tripScope.js";

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
  { key: "passportNumber", label: "Passport" },
  { key: "nationality", label: "Nationality" },
  { key: "passportExpiry", label: "Expiry", type: "date" },
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
  const [passesKpi, setPassesKpi] = useState(null); // trip-scoped numbers reported by BoardingPassesView's trip switcher
  const [parseKpi, setParseKpi] = useState(null);   // trip-scoped numbers for the "Assign to trip" selection
  const [tripId, setTripId] = useState(() => localStorage.getItem(LS_TRIP) || "");
  const [trips, setTrips] = useState([]);
  // Boarding passes FOLLOWS the Dashboard's trip switcher, same as the
  // Exceptions inbox — it's a read-only view, so it should always show the
  // trip you're currently looking at rather than keeping its own selection.
  //
  // Deliberately does NOT drive the "Assign to trip" selector on the parsing
  // tab: that one is a WRITE destination for the delegates you're about to
  // create, so silently repointing it at whatever the Dashboard shows could
  // onboard people into the wrong trip. Those two stay independent on purpose.
  const [activeTripId, setActiveTripId] = useState(() => getActiveTripId());
  useEffect(() => {
    // Same-tab CustomEvent — a bare localStorage write fires no `storage`
    // event in the tab that made it (see lib/activeTrip.js).
    const onSwitch = (e) => setActiveTripId(e.detail || getActiveTripId());
    window.addEventListener(ACTIVE_TRIP_EVENT, onSwitch);
    return () => window.removeEventListener(ACTIVE_TRIP_EVENT, onSwitch);
  }, []);

  // "Assign to trip" is restricted to the staff member's OWN trip(s) — they
  // could otherwise onboard delegates into a trip they aren't assigned to.
  // null = admin (unrestricted); a Set = only these trip uuids.
  const isAdmin = getUser()?.role === "admin";
  const [myTripIds, setMyTripIds] = useState(null);
  useEffect(() => {
    if (isAdmin) { setMyTripIds(null); return; }
    apiGet("/my-captain-coaches")
      .then((r) => setMyTripIds(new Set(scopedTripIds(r.coaches))))
      .catch(() => setMyTripIds(new Set()));
  }, [isAdmin]);
  const assignableTrips = myTripIds ? trips.filter((tr) => myTripIds.has(tr.id)) : trips;
  // With one assignable trip, select it for real — the label below is only a
  // display, and confirmAndAdd() hard-requires a non-empty tripId. The
  // existing trips effect only auto-selects when the WHOLE system has one
  // trip, which isn't the staff case.
  // Depends on the id STRING, not the array — assignableTrips is a fresh
  // identity every render, which would re-run this on each one.
  const onlyAssignableId = !isAdmin && assignableTrips.length === 1 ? assignableTrips[0].id : null;
  useEffect(() => {
    if (!onlyAssignableId) return;
    setTripId((cur) => (cur === onlyAssignableId ? cur : onlyAssignableId));
  }, [onlyAssignableId]);

  // "Assign to trip" tracks the Dashboard's trip rather than its own remembered
  // mg_parse_trip value — landing here with a trip other than the one you're
  // looking at is the surprising behaviour. Keyed on the RESOLVED id (so the
  // "t-1" alias becomes a real uuid the <select> can match) and only re-runs
  // when the Dashboard actually switches, so an admin's manual pick afterwards
  // isn't clobbered on every render.
  const resolvedActiveTripId = resolveActiveTripId(activeTripId, trips);
  useEffect(() => {
    if (!resolvedActiveTripId) return;
    setTripId((cur) => (cur === resolvedActiveTripId ? cur : resolvedActiveTripId));
  }, [resolvedActiveTripId]);
  const [job, setJob] = useState(null); // {id, fileName, status, done, total, method, error}
  const [rows, setRows] = useState([]);
  const [elapsed, setElapsed] = useState(0); // seconds the current parse has run (live) / took (frozen when done)
  const startRef = useRef(0);
  const fmtMMSS = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
  const [editAll, setEditAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("parse"); // parse | passes | scan
  const [context, setContext] = useState({ existingNames: [], coaches: [] });

  // Inline toast — replaces blocking alert() dialogs (Vance's v2, integrated
  // 2026-07-27). Auto-dismisses after 4.5s unless a newer toast replaced it.
  const [toast, setToast] = useState(null); // { type: "ok"|"error"|"warn", msg }
  const notify = useCallback((type, msg) => setToast({ type, msg, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast((c) => (c && c.at === toast.at ? null : c)), 4500);
    return () => clearTimeout(id);
  }, [toast]);

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
        // Keep a valid saved choice; auto-select when there's only ONE trip (so
        // the user doesn't parse a doc then get "choose a trip" at confirm time);
        // otherwise clear a stale id and let them pick. (Vance's v2, 2026-07-27.)
        setTripId((cur) => {
          if (cur && list.some((tr) => tr.id === cur)) return cur;
          if (list.length === 1) return list[0].id;
          return "";
        });
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

  /* ---- KPI card for the "Assign to trip" selection (parse tab) ---------
   * Same idea as BoardingPassesView's onKpiChange — keeps the header's
   * TripPulse card in sync with whichever trip is actually selected, instead
   * of the global assistant snapshot. */
  useEffect(() => {
    let alive = true;
    const currentTrip = trips.find((tr) => tr.id === tripId);
    getBadges(tripId || "t-1")
      .then((res) => alive && setParseKpi({ trip: { name: currentTrip?.name, dayOf: currentTrip?.dayOf }, kpis: { total: res.total, present: res.present } }))
      .catch(() => {});
    return () => { alive = false; };
  }, [tripId, trips]);

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
    if (saved?.id) { startRef.current = Date.now(); setJob(saved); startPolling(saved.id); }
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- live elapsed timer while a parse runs (freezes at the total when done) */
  useEffect(() => {
    if (job?.status !== "running") return;
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startRef.current) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [job?.status]);

  /* ---- upload / start a job -------------------------------------------- */
  const ingest = useCallback(async (fileList) => {
    const file = Array.from(fileList)[0];
    if (!file) return;
    clearInterval(pollRef.current);
    setRows([]);
    setSearch("");
    setEditAll(false);
    startRef.current = Date.now(); setElapsed(0);
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
    if (!tripId) { notify("error", t("Please choose a trip to assign these delegates to first.")); return; }
    if (reviewNeeded > 0 && !window.confirm(t("Some rows still need review. Add them anyway?"))) return;
    const toAdd = rows.filter((r) => !isDup(r));
    const skipped = rows.length - toAdd.length;
    if (toAdd.length === 0) { notify("warn", t("Every extracted delegate is already in this trip.")); return; }
    setSaving(true);
    try {
      const { added, skippedInvalid = 0 } = await confirmDelegates(tripId, toAdd);
      const notes = [];
      if (skipped) notes.push(`${skipped} ${t("duplicates skipped")}`);
      if (skippedInvalid) notes.push(`${skippedInvalid} ${t("invalid skipped")}`);
      notify("ok", `${added} ${t("delegates added to the trip.")}${notes.length ? ` (${notes.join(", ")})` : ""}`);
      setRows([]);
      setJob(null);
      localStorage.removeItem(LS_JOB);
      localStorage.removeItem(LS_ROWS);
      getOnboardingContext(tripId).then(setContext).catch(() => {});
    } catch (err) {
      notify("error", err.message || t("Couldn't save the delegates. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  /* Cancel a running/queued parse and clear the workspace. (Vance's v2.) */
  const cancelJob = () => {
    clearInterval(pollRef.current);
    pollRef.current = null;
    setJob(null);
    setRows([]);
    setSearch("");
    localStorage.removeItem(LS_JOB);
    localStorage.removeItem(LS_ROWS);
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
        <TripPulse mode="onboarding" data={view === "passes" ? passesKpi : parseKpi} />
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

      {view === "passes" && <div style={{ marginTop: 20 }}><BoardingPassesView tripId={resolvedActiveTripId} onKpiChange={setPassesKpi} /></div>}

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
                // 2026-08-04 ("idk why but have to upload 3 time to make it
                // work") — this never reset its own value after a selection.
                // A file input's `change` event only fires when its value
                // STRING actually changes; picking the exact same file twice
                // in a row through this same picker leaves the value
                // identical, so the second attempt fires no event at all —
                // no error, nothing — looking exactly like the upload just
                // silently did nothing until a later, different attempt
                // (e.g. drag-and-drop, which has no such quirk) finally
                // worked. Clearing the value after reading the file(s) means
                // re-picking the same file always re-fires the event.
                onChange={(e) => {
                  if (e.target.files?.length) ingest(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            <label className="field-label" style={{ marginTop: 16 }}>{t("Assign to trip")}</label>
            {/* Scoped to the account's own trip(s) — see assignableTrips. With
                exactly one there's nothing to choose, so it renders as a plain
                read-only label instead of a one-option dropdown. */}
            {!isAdmin && assignableTrips.length === 1 ? (
              <div className="select" style={{ display: "flex", alignItems: "center", color: "var(--ink-2)" }}>
                {assignableTrips[0].name}
                {assignableTrips[0].dateRange ? ` · ${assignableTrips[0].dateRange}` : ""}
              </div>
            ) : (
              <select className="select" value={tripId} onChange={(e) => setTripId(e.target.value)}>
                <option value="">{t("Select a trip…")}</option>
                {assignableTrips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}{trip.dateRange ? ` · ${trip.dateRange}` : ""}
                  </option>
                ))}
              </select>
            )}
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
                  {job.status === "running" && <span className="muted" style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmtMMSS(elapsed)}</span>}
                  {job.method && <span className="badge badge-present" style={{ fontSize: 11 }}>{job.method}</span>}
                  <button className="mg-iconbtn" title={job.status === "running" ? t("Cancel parse") : t("Clear")} onClick={cancelJob} style={{ color: "var(--ink-3)" }}>
                    <X size={15} />
                  </button>
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
                    {rows.length} {t("delegates extracted")}{reviewNeeded ? ` · ${reviewNeeded} ${t("need review")}` : ""}{elapsed > 0 ? ` · ${t("done in")} ${fmtMMSS(elapsed)}` : ""}
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

      {/* Inline toast — replaces blocking alert() dialogs (Vance's v2) */}
      {toast && (
        <div role="status" style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 80, maxWidth: 380,
          background: toast.type === "error" ? "var(--st-missing)" : toast.type === "warn" ? "var(--st-review)" : "var(--st-present)",
          color: "#fff", padding: "12px 16px", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.20)",
          display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 500,
        }}>
          {toast.type === "ok" ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
          <span style={{ flex: 1 }}>{toast.msg}</span>
          <span role="button" onClick={() => setToast(null)} style={{ cursor: "pointer", opacity: 0.85, display: "flex" }}><X size={15} /></span>
        </div>
      )}

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
