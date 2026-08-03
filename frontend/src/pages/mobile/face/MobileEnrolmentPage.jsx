// frontend/src/pages/mobile/MobileEnrolmentPage.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
//
// Staff "who's enrolled" view — enrolment readiness across the roster before a
// trip. Shows overall coverage, and every delegate grouped by coach with their
// face/voice status, so staff can chase up whoever still needs to enrol. Tapping
// a delegate opens the enrolment flow pre-identified to them (great at a desk).
//
// Reuses the public FaceCheck endpoints: GET /enroll/stats (coverage) and
// GET /enroll/lookup (full roster + per-delegate enrolled status).

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, AlertTriangle, ScanFace, Mic, Bus, ChevronRight, CheckCircle2, Mail, Send, Loader2, Eye, X, Copy, Check } from "lucide-react";
import { apiGet, apiPost } from "../../../lib/api.js";
import { useLang } from "../../../lib/i18n.jsx";
// Scope the roster/coverage to the mobile trip switcher's current trip
// (2026-07-31 — "add the trip change to exception") — this page used to pool
// every delegate from every trip into one combined list regardless of which
// trip Home had selected.
import { getMobileTripId } from "../../../lib/mobileTrip.js";

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const FILTERS = [
  { key: "all", label: "All" },
  { key: "todo", label: "Not enrolled" },
  { key: "face", label: "Face done" },
  { key: "voice", label: "Voice done" },
];

export default function MobileEnrolmentPage() {
  const { t } = useLang();
  const [stats, setStats] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [inviting, setInviting] = useState("");      // delegateId currently sending, or "all"
  const [inviteMsg, setInviteMsg] = useState(null);  // { tone, text }
  const [preview, setPreview] = useState(null);      // rendered invite being viewed
  const [previewing, setPreviewing] = useState("");  // delegateId whose preview is loading
  const [previewTab, setPreviewTab] = useState("html"); // html | text
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const tripId = getMobileTripId();
      const [s, r] = await Promise.all([
        apiGet(`/enroll/stats?tripId=${encodeURIComponent(tripId)}`),
        apiGet(`/enroll/lookup?tripId=${encodeURIComponent(tripId)}`),
      ]);
      setStats(s); setRoster(r.matches || []);
    } catch (e) {
      setError(e.message || "Could not load enrolment data. Is the backend running?");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000); // live: reflects delegates enrolling right now
    return () => clearInterval(id);
  }, [load]);

  /* Invite one delegate. Prompts for an email when none is on file, so staff
   * can fill it in and send in a single action. */
  async function invite(d) {
    let email = d.email || "";
    if (!email) {
      email = (window.prompt(`${t("Email address for")} ${d.name}:`) || "").trim();
      if (!email) return;
    }
    setInviting(d.delegateId); setInviteMsg(null);
    try {
      const r = await apiPost("/enroll/invite", { delegateId: d.delegateId, email });
      setInviteMsg(r.dryRun
        ? { tone: "review", text: `${t("Preview only (dry run) — no email sent to")} ${r.to}` }
        : r.sent
          ? { tone: "present", text: `${t("Invite sent to")} ${r.to}` }
          : { tone: "missing", text: r.error || t("Could not send that invite.") });
      load();
    } catch (e) {
      setInviteMsg({ tone: "missing", text: e.message || t("Could not send that invite.") });
    } finally { setInviting(""); }
  }

  /* Render the exact email a delegate would receive, without sending it. */
  async function openPreview(d) {
    setPreviewing(d.delegateId); setInviteMsg(null); setCopied(false); setPreviewTab("html");
    try {
      const r = await apiGet(`/enroll/invite/preview?delegateId=${encodeURIComponent(d.delegateId)}`);
      setPreview({ ...r, delegate: d });
    } catch (e) {
      setInviteMsg({ tone: "missing", text: e.message || t("Could not render that preview.") });
    } finally { setPreviewing(""); }
  }

  async function copyLink(link) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the link is on screen to copy by hand */ }
  }

  /* Bulk-invite everyone not yet enrolled who has an email on file. */
  async function inviteAll() {
    const outstanding = roster.filter((d) => !d.enrolled?.face && !d.enrolled?.voice);
    if (!outstanding.length) { setInviteMsg({ tone: "present", text: t("Everyone's already enrolled.") }); return; }
    if (!window.confirm(`${t("Email an enrolment link to")} ${outstanding.length} ${t("delegate(s) who haven't enrolled?")}`)) return;
    setInviting("all"); setInviteMsg(null);
    try {
      const r = await apiPost("/enroll/invite-all", { onlyMissing: true, tripId: getMobileTripId() });
      const skipped = (r.skippedNoEmail || []).length;
      const base = r.dryRun
        ? `${t("Preview only (dry run)")} — ${r.previewed} ${t("would be emailed")}`
        : `${r.sent} ${t("invite(s) sent")}${r.failed ? `, ${r.failed} ${t("failed")}` : ""}`;
      setInviteMsg({
        tone: r.dryRun ? "review" : r.failed ? "missing" : "present",
        text: base + (skipped ? ` · ${skipped} ${t("skipped (no email)")}` : ""),
      });
      load();
    } catch (e) {
      setInviteMsg({ tone: "missing", text: e.message || t("Could not send invites.") });
    } finally { setInviting(""); }
  }

  const match = (d) =>
    filter === "todo" ? !d.enrolled?.face && !d.enrolled?.voice
    : filter === "face" ? d.enrolled?.face
    : filter === "voice" ? d.enrolled?.voice
    : true;
  const shown = roster.filter(match);

  // group by coach, stable order
  const order = [];
  const byCoach = {};
  for (const d of shown) {
    const k = d.coachLabel || "No coach yet";
    if (!byCoach[k]) { byCoach[k] = []; order.push(k); }
    byCoach[k].push(d);
  }
  // per-coach coverage from the WHOLE roster (not the filtered view)
  const coachCoverage = (label) => {
    const list = roster.filter((d) => (d.coachLabel || "No coach yet") === label);
    const done = list.filter((d) => d.enrolled?.face || d.enrolled?.voice).length;
    return { done, total: list.length };
  };

  const coveragePct = stats ? pct(stats.enrolled, stats.total) : 0;

  return (
    <div className="m-fade-in">
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div className="m-eyebrow">{t("FaceCheck")}</div>
          <h1 className="m-page-title">{t("Enrolment invites")}</h1>
        </div>
        <button className="btn btn-ghost" onClick={load} aria-label={t("Refresh")} style={{ padding: 8 }}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 14 }}>
            <AlertTriangle size={16} /> {t(error)}
          </div>
        </div>
      )}

      {/* Coverage hero */}
      {stats && (
        <div className="m-hero">
          <div className="m-hero-glow" />
          <div className="m-hero-eyebrow">{t("Roster coverage")}</div>
          <div className="row" style={{ alignItems: "baseline", gap: 8, position: "relative", marginTop: 4 }}>
            <div className="mono" style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{coveragePct}%</div>
            <div style={{ fontSize: 13, opacity: 0.92 }}>{stats.enrolled}/{stats.total} {t("enrolled")}</div>
          </div>
          <div style={{ height: 8, background: "rgba(255,255,255,0.25)", borderRadius: 999, overflow: "hidden", marginTop: 10, position: "relative" }}>
            <div style={{ height: "100%", background: "#fff", borderRadius: 999, width: `${coveragePct}%`, transition: "width .4s" }} />
          </div>
          <div className="row" style={{ gap: 14, marginTop: 12, position: "relative", fontSize: 12.5, fontWeight: 600 }}>
            <span className="row" style={{ gap: 5 }}><ScanFace size={14} /> {stats.face} {t("face")}</span>
            <span className="row" style={{ gap: 5 }}><Mic size={14} /> {stats.voice} {t("voice")}</span>
            <span className="row" style={{ gap: 5, opacity: 0.9 }}>{Math.max(0, stats.total - stats.enrolled)} {t("to go")}</span>
          </div>
        </div>
      )}

      {/* Bulk invite */}
      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 14, padding: "12px 0" }}
        onClick={inviteAll}
        disabled={inviting !== ""}
      >
        {inviting === "all"
          ? <><Loader2 size={16} className="spin" /> {t("Sending…")}</>
          : <><Send size={16} /> {t("Email invites to everyone outstanding")}</>}
      </button>

      {inviteMsg && (
        <div style={{
          marginTop: 10, padding: "10px 12px", borderRadius: "var(--r-sm)", fontSize: 13, fontWeight: 600,
          background: `var(--st-${inviteMsg.tone}-bg)`, color: `var(--st-${inviteMsg.tone})`,
        }}>
          {inviteMsg.text}
        </div>
      )}

      {/* Filter chips */}
      <div className="m-chip-row" style={{ marginTop: 14 }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={"m-chip" + (filter === f.key ? " active" : "")} onClick={() => setFilter(f.key)}>
            {t(f.label)}
          </button>
        ))}
      </div>

      {loading && roster.length === 0 && <div className="muted" style={{ marginTop: 14 }}>{t("Loading…")}</div>}

      {!loading && shown.length === 0 && !error && (
        <div className="m-empty">
          <span className="m-empty-ic" style={{ background: "var(--st-present-bg)", color: "var(--st-present)", borderColor: "transparent" }}>
            <CheckCircle2 size={22} />
          </span>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>
            {filter === "todo" ? t("Everyone's enrolled") : t("No delegates here")}
          </div>
          <div style={{ fontSize: 12.5 }}>{filter === "todo" ? t("Every delegate has a face or voice on file.") : t("Try a different filter.")}</div>
        </div>
      )}

      {/* Roster grouped by coach */}
      {order.map((k) => {
        const cov = coachCoverage(k);
        return (
          <div key={k} className="m-section" style={{ marginTop: 16 }}>
            <div className="m-section-head">
              <span className="m-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Bus size={13} /> {k}</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: cov.done === cov.total ? "var(--st-present)" : "var(--ink-3)" }}>
                {cov.done}/{cov.total}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {byCoach[k].map((d) => {
                const done = d.enrolled?.face || d.enrolled?.voice;
                return (
                  <div key={d.delegateId} className="m-row" style={{ gap: 8 }}>
                    <button
                      onClick={() => { window.location.assign(`/enroll?d=${encodeURIComponent(d.delegateId)}`); }}
                      title={t("Enrol this delegate")}
                      style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, textAlign: "left", color: "inherit", font: "inherit" }}
                    >
                      <span className="avatar" style={{ background: done ? "var(--st-present-bg)" : "var(--surface)", color: done ? "var(--st-present)" : "var(--ink-3)", border: done ? "none" : "1px solid var(--line)" }}>
                        {initials(d.name)}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                        <span style={{ display: "block", fontSize: 11, color: d.email ? "var(--ink-3)" : "var(--st-late)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {d.email || t("No email on file")}
                        </span>
                      </span>
                    </button>
                    <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                      {d.enrolled?.face && <span className="badge badge-present" title={t("Face enrolled")}><ScanFace size={11} /></span>}
                      {d.enrolled?.voice && <span className="badge badge-assigned" title={t("Voice enrolled")}><Mic size={11} /></span>}
                      {!done && <span className="badge badge-missing">{t("To do")}</span>}
                      <button
                        onClick={() => openPreview(d)}
                        disabled={previewing !== ""}
                        aria-label={`${t("Preview invite email for")} ${d.name}`}
                        title={t("Preview the invite email")}
                        style={{ background: "none", border: "none", padding: 5, display: "flex", color: "var(--ink-3)" }}
                      >
                        {previewing === d.delegateId ? <Loader2 size={16} className="spin" /> : <Eye size={16} />}
                      </button>
                      <button
                        onClick={() => invite(d)}
                        disabled={inviting !== ""}
                        aria-label={`${t("Email enrolment invite to")} ${d.name}`}
                        title={d.email ? `${t("Email invite to")} ${d.email}` : t("Add an email and invite")}
                        style={{ background: "none", border: "none", padding: 5, display: "flex", color: "var(--scc-red)" }}
                      >
                        {inviting === d.delegateId ? <Loader2 size={16} className="spin" /> : <Mail size={16} />}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ---- Email preview sheet -------------------------------------------
          Renders the real invite in a sandboxed iframe, so it looks exactly
          as the delegate would see it and its own <body> styles can't leak
          into the app. */}
      {preview && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 70 }}
          onClick={() => setPreview(null)}
        >
          <div
            className="card"
            style={{ width: "100%", borderRadius: "16px 16px 0 0", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="row between" style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
              <div style={{ minWidth: 0 }}>
                <div className="m-eyebrow">{t("Email preview")}</div>
                <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {preview.name}
                </div>
              </div>
              <button onClick={() => setPreview(null)} aria-label={t("Close")}
                style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4, flexShrink: 0 }}>
                <X size={20} />
              </button>
            </div>

            {/* meta */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <MetaRow label={t("To")} value={preview.to || t("No email on file")} tone={preview.to ? null : "late"} />
              <MetaRow label={t("Subject")} value={preview.subject} />
              <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                <span className={"badge " + (preview.dryRun ? "badge-review" : "badge-present")}>
                  {preview.dryRun ? t("Dry run — nothing will send") : t("Live — sending is enabled")}
                </span>
                {!preview.mailConfigured && <span className="badge badge-missing">{t("SMTP not configured")}</span>}
              </div>
            </div>

            {/* html / text toggle */}
            <div className="row" style={{ gap: 8, padding: "10px 16px", flexShrink: 0 }}>
              {["html", "text"].map((tab) => (
                <button key={tab} className={"m-chip" + (previewTab === tab ? " active" : "")} onClick={() => setPreviewTab(tab)}>
                  {tab === "html" ? t("Rendered") : t("Plain text")}
                </button>
              ))}
            </div>

            {/* body */}
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--surface-2)" }}>
              {previewTab === "html" ? (
                <iframe
                  title={t("Email preview")}
                  srcDoc={preview.html}
                  sandbox=""
                  style={{ width: "100%", height: 460, border: "none", display: "block", background: "#f4f5f7" }}
                />
              ) : (
                <pre style={{ margin: 0, padding: 16, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--ink-2)", fontFamily: "ui-monospace, monospace" }}>
                  {preview.text}
                </pre>
              )}
            </div>

            {/* actions */}
            <div style={{ padding: 14, borderTop: "1px solid var(--line)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn btn-ghost btn-block" onClick={() => copyLink(preview.link)}>
                {copied ? <><Check size={15} /> {t("Link copied")}</> : <><Copy size={15} /> {t("Copy enrolment link")}</>}
              </button>
              <button
                className="btn btn-primary btn-block"
                disabled={inviting !== ""}
                onClick={async () => { const d = preview.delegate; setPreview(null); await invite(d); }}
              >
                {inviting ? <><Loader2 size={15} className="spin" /> {t("Sending…")}</>
                  : <><Send size={15} /> {preview.dryRun ? t("Run send (dry run)") : t("Send this invite")}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, value, tone }) {
  return (
    <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)", width: 54, flexShrink: 0, paddingTop: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: tone ? `var(--st-${tone})` : "var(--ink)", wordBreak: "break-word", minWidth: 0 }}>
        {value}
      </span>
    </div>
  );
}
