/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Excel export dialog
 * ============================================================================= */
import { useEffect, useState, useRef, useSyncExternalStore } from "react";
import { X, Download, Sparkles, Loader2 } from "lucide-react";
import { apiGet, apiPost, getToken } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useElapsedSeconds } from "../../lib/dashboard/useElapsedSeconds.js";
import { listCharts, subscribeCharts, captureCharts } from "../../lib/dashboard/chartCapture.js";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const UNASSIGNED_KEY = "__unassigned";

/**
 * Export configuration modal — opened from the Dashboard's "Export" button.
 *
 * Picks what the workbook contains (status, coach, VIP, columns) before
 * downloading from POST /api/trips/:id/export. The natural-language box only
 * translates a request into those same structured filters and populates the
 * checkboxes — the AI never produces the file itself.
 */
export default function ExportModal({ tripId, onClose, onExported }) {
  const { t, lang } = useLang();
  const [opts, setOpts] = useState(null);
  const [loadErr, setLoadErr] = useState(null);

  const [statuses, setStatuses] = useState([]);   // [] = all
  const [coachIds, setCoachIds] = useState([]);   // [] = all
  const [vipOnly, setVipOnly] = useState(false);
  const [columns, setColumns] = useState([]);
  const [includeAiSummary, setIncludeAiSummary] = useState(false);
  // Defaults ON: the per-checkpoint record is the real audit trail once a trip
  // ends. The Delegates sheet's status column is only a snapshot of a value the
  // reset/late-cutoff schedulers keep changing.
  const [includeCheckpoints, setIncludeCheckpoints] = useState(true);
  // Workbook language is a per-export choice, not the UI language — staff may
  // work in English but hand off a Chinese report. Defaults to UI lang only.
  const [exportLang, setExportLang] = useState(lang);
  // Charts to embed as images, from lib/chartCapture.js's live registry — only
  // what's rendered on Analytics right now can be captured. Defaults to none.
  const availableCharts = useSyncExternalStore(subscribeCharts, listCharts);
  const [selectedCharts, setSelectedCharts] = useState([]);

  const [prompt, setPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStartedAt, setAiStartedAt] = useState(null);
  const aiElapsed = useElapsedSeconds(aiBusy, aiStartedAt);
  const [aiNote, setAiNote] = useState(null);     // { tone: "ok"|"err", text }

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Native "click" fires on the mouseup target, so without this a drag-select
  // started in the AI prompt field would dismiss the modal.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    let alive = true;
    apiGet(`/trips/${tripId}/export/options`)
      .then((o) => {
        if (!alive) return;
        setOpts(o);
        setColumns(o.defaultColumns || []);
      })
      .catch((e) => alive && setLoadErr(e.message || "Could not load export options."));
    return () => { alive = false; };
  }, [tripId]);

  const toggle = (arr, setArr, value) =>
    setArr(arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]);

  async function applyAi() {
    const q = prompt.trim();
    if (!q) return;
    setAiBusy(true);
    setAiStartedAt(Date.now());
    setAiNote(null);
    try {
      const { filter } = await apiPost(`/trips/${tripId}/export/ai-filter`, { prompt: q });
      setStatuses(filter.statuses || []);
      setCoachIds(filter.coachIds || []);
      setVipOnly(!!filter.vipOnly);
      setAiNote({ tone: "ok", text: t("Filters updated from your description — review and adjust below.") });
    } catch (e) {
      setAiNote({
        tone: "err",
        text: e.status === 503
          ? t("Natural-language filtering isn't configured. Use the checkboxes below instead.")
          : (e.message || t("Couldn't interpret that. Use the checkboxes below.")),
      });
    } finally {
      setAiBusy(false);
    }
  }

  async function download() {
    setBusy(true);
    setErr(null);
    try {
      // Captured at download time, not at tick time — charts are live, so this
      // reflects current numbers, not the numbers when the modal opened.
      const charts = selectedCharts.length ? await captureCharts(selectedCharts) : [];
      const res = await fetch(`${API_BASE}/trips/${tripId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ statuses, coachIds, vipOnly, columns, includeAiSummary, includeCheckpoints, lang: exportLang, charts }),
      });
      if (!res.ok) {
        throw new Error(
          res.status === 403 ? t("You don't have permission to export.")
            : res.status === 401 ? t("Please sign in again.")
            : `${t("Export failed")} (${res.status}).`
        );
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m ? m[1] : "attendance.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // Confirmation toast — matches Jayden's "Exported N tickets" toast on the
      // Exceptions inbox; without it the modal just closes silently.
      onExported?.();
      onClose();
    } catch (e) {
      setErr(e.message || t("Export failed"));
    } finally {
      setBusy(false);
    }
  }

  const chip = (active) => ({
    fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
    border: `1.5px solid ${active ? "var(--scc-red)" : "var(--line)"}`,
    background: active ? "var(--scc-red-tint)" : "var(--surface)",
    color: active ? "var(--scc-red-700)" : "var(--ink-2)",
  });

  return (
    <div
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 20 }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}
      >
        {/* Header */}
        <div className="row between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: 16 }}>{t("Export to Excel")}</h2>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{t("Choose what to include, then download a formatted workbook.")}</p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {loadErr && <div style={{ fontSize: 13, color: "var(--st-missing)" }}>{loadErr}</div>}

          {/* Workbook language — independent of the app's own UI language */}
          <Section title={t("Workbook language")}>
            <div className="row" style={{ gap: 8 }}>
              <button onClick={() => setExportLang("en")} style={chip(exportLang === "en")}>English</button>
              <button onClick={() => setExportLang("zh")} style={chip(exportLang === "zh")}>中文</button>
            </div>
          </Section>

          {/* AI natural-language filter */}
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 14 }}>
            <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
              <Sparkles size={15} color="var(--st-normal)" />
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t("Describe what to export")}</span>
            </div>
            <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <input
                className="input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyAi()}
                placeholder={t("e.g. VIPs still missing from coaches 5 to 8")}
                style={{ flex: 1 }}
              />
              <button className="btn btn-dark" onClick={applyAi} disabled={aiBusy || !prompt.trim()} style={{ flexShrink: 0 }}>
                {aiBusy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {aiBusy ? `${t("Apply")} ${aiElapsed}s` : t("Apply")}
              </button>
            </div>
            {/* Guidance while idle, elapsed time while busy — never both (same
                as the Analytics chart-assist box). The limits are spelled out
                because this only produces status/coach/VIP filters; asking for
                company/industry/date would silently yield a wrong filter. */}
            {aiBusy ? (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {t("usually 5–20s, longer if using local AI")}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                {t("Can filter by: status, coach, or VIP. Can't filter by company, industry, or date.")}
              </div>
            )}
            {aiNote && (
              <div style={{ fontSize: 12, marginTop: 8, color: aiNote.tone === "ok" ? "var(--st-present)" : "var(--st-unassigned)" }}>
                {aiNote.text}
              </div>
            )}
          </div>

          {/* Status */}
          <Section title={t("Status")} hint={statuses.length === 0 ? t("All") : `${statuses.length} ${t("selected")}`}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {(opts?.statuses || []).map((s) => (
                <button key={s.key} onClick={() => toggle(statuses, setStatuses, s.key)} style={chip(statuses.includes(s.key))}>
                  {t(s.label)}
                </button>
              ))}
            </div>
          </Section>

          {/* Coaches */}
          <Section title={t("Coaches")} hint={coachIds.length === 0 ? t("All") : `${coachIds.length} ${t("selected")}`}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {(opts?.coaches || []).map((c) => (
                <button key={c.id} onClick={() => toggle(coachIds, setCoachIds, c.id)} style={chip(coachIds.includes(c.id))}>
                  {c.label}
                </button>
              ))}
              <button onClick={() => toggle(coachIds, setCoachIds, UNASSIGNED_KEY)} style={chip(coachIds.includes(UNASSIGNED_KEY))}>
                {t("Unassigned")}
              </button>
            </div>
          </Section>

          {/* VIP + AI summary toggles */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Toggle checked={vipOnly} onChange={() => setVipOnly((v) => !v)} label={t("VIP delegates only")} />
            <Toggle checked={includeAiSummary} onChange={() => setIncludeAiSummary((v) => !v)}
              label={t("Add an AI summary sheet note")} hint={t("A short written recap of this export (needs AI configured).")} />
            <Toggle checked={includeCheckpoints} onChange={() => setIncludeCheckpoints((v) => !v)}
              label={t("Include per-checkpoint history")} hint={t("A separate sheet: every stop each delegate was arrived/late/missing at, not just their current status.")} />
          </div>

          {/* Charts go in as PICTURES on their own sheet, so they're usable in
              a report or slide (the old per-chart CSVs needed rebuilding by
              hand). Only charts currently rendered on Analytics can be captured
              — no <svg> to read otherwise — so the list is driven by what's on
              screen, and says so when empty rather than exporting blanks. */}
          <Section
            title={t("Charts")}
            hint={availableCharts.length ? `${selectedCharts.length}/${availableCharts.length} ${t("selected")}` : undefined}
          >
            {availableCharts.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>
                {t("Open the Analytics tab to include charts as images.")}
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 6 }}>
                  {availableCharts.map((c) => (
                    <label key={c.id} className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer", padding: "4px 2px" }}>
                      <input
                        type="checkbox"
                        checked={selectedCharts.includes(c.id)}
                        onChange={() => toggle(selectedCharts, setSelectedCharts, c.id)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  {t("Added to the workbook as images on their own \"Charts\" sheet.")}
                </div>
              </>
            )}
          </Section>

          {/* Columns */}
          <Section title={t("Columns")} hint={`${columns.length} ${t("selected")}`}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 6 }}>
              {(opts?.columns || []).map((c) => (
                <label key={c.key} className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer", padding: "4px 2px" }}>
                  <input type="checkbox" checked={columns.includes(c.key)} onChange={() => toggle(columns, setColumns, c.key)} />
                  {t(c.label)}
                </label>
              ))}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="row between" style={{ padding: "14px 20px", borderTop: "1px solid var(--line)", flexShrink: 0, gap: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {statuses.length === 0 && coachIds.length === 0 && !vipOnly ? t("Exporting all delegates") : t("Filtered export")}
          </span>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>{t("Cancel")}</button>
            <button className="btn btn-primary" onClick={download} disabled={busy || !opts || columns.length === 0}>
              {busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />} {busy ? t("Preparing…") : t("Download")}
            </button>
          </div>
        </div>
        {err && <div style={{ padding: "0 20px 14px", fontSize: 12.5, color: "var(--st-missing)" }}>{err}</div>}

        <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</span>
        {hint && <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="row between" style={{ gap: 12, cursor: "pointer" }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        {hint && <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>{hint}</div>}
      </div>
      <span
        onClick={onChange}
        style={{
          width: 40, height: 22, borderRadius: 999, flexShrink: 0, position: "relative", transition: "background .15s",
          background: checked ? "var(--scc-red)" : "var(--line)",
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: "50%",
          background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.2)",
        }} />
      </span>
    </label>
  );
}
