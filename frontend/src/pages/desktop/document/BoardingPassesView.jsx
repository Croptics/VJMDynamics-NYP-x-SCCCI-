import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { RefreshCw, Printer, Star, Search, X, Copy, Check, QrCode, Link2, ScanLine, Keyboard, Mail } from "lucide-react";
import { getBadges, getTrips, linkPhysicalBadge, emailPass } from "../../../lib/document/claudeParse.js";
import { getUser } from "../../../lib/api.js";
import { useLang } from "../../../lib/i18n.jsx";

/**
 * Boarding passes — the organiser's pass desk (Vance).
 *
 * The document reader onboards delegates; each gets a unique `qr_code`, which is
 * the badge the on-site scanner reads. Rather than a wall of QR tiles (unusable
 * past ~20 delegates), this is a working list: search / filter / grouped by
 * coach, and you open ONE delegate to see, copy or print their pass.
 *
 * Design borrows from the team: Desmond's "operational workspace, not a KPI
 * report" (counts folded into the header, no stat-card row), Jayden's filter
 * tabs, and Vimal's per-coach grouping.
 */
// PRESENT (legacy) and ARRIVED (the team's 5-status value) both mean "boarded";
// ASSIGNED/LATE are the newer "expected but not boarded yet" values.
// (Vance's v2, integrated 2026-07-27.)
const STATUS_META = {
  PRESENT: { label: "Boarded", color: "var(--st-present)" },
  ARRIVED: { label: "Boarded", color: "var(--st-present)" },
  ASSIGNED: { label: "Not boarded", color: "var(--st-review)" },
  LATE: { label: "Not boarded", color: "var(--st-review)" },
  MISSING: { label: "Not boarded", color: "var(--st-review)" },
  UNASSIGNED: { label: "No coach", color: "var(--ink-3)" },
};
const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/* ---------------------------------------------------------------------------
 *  Company identity (Vance's v2, integrated 2026-07-27). The directory gives
 *  each delegate a company (e.g. "CTES Consulting Pte Ltd") but no logo image.
 *  We synthesise a stable, branded "logo" from the company name — a monogram on
 *  a colour hashed from the name — so every company reads as its own brand
 *  across the pass, the badge and the QR. `logoUrl` (an uploaded real logo)
 *  overrides the monogram when present.
 * ------------------------------------------------------------------------- */
const BRAND_COLORS = ["#1f6feb", "#8250df", "#0f766e", "#b91c1c", "#b45309", "#0e7490", "#4d7c0f", "#9d174d", "#3f3f9e", "#7c3aed"];
const STOPWORDS = new Set(["pte", "ltd", "llp", "inc", "co", "corp", "corporation", "the", "and", "services", "service", "group", "holdings", "solutions", "consulting", "international"]);
function companyBrand(company) {
  const name = (company || "").trim();
  if (!name) return { initials: "—", bg: "#94a3b8", fg: "#fff" };
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const bg = BRAND_COLORS[h % BRAND_COLORS.length];
  const words = name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  const significant = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const pick = (significant.length ? significant : words).slice(0, 2);
  const initials = (pick.map((w) => w[0]).join("") || name[0]).toUpperCase();
  return { initials, bg, fg: "#fff" };
}

/** Normalise a company website into a bare domain (for the logo lookup). */
function domainOf(website) {
  if (!website) return null;
  let w = String(website).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  w = w.split(/[/?#\s]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(w) ? w : null;
}

/** A company logo chip. Prefers a REAL logo — an explicit uploaded `logoUrl`,
 *  else the company's brand logo resolved from its website domain via unavatar.io
 *  (`fallback=false` → it 404s when no logo exists) — and falls back to the
 *  generated monogram when there's no logo / we're offline (so it degrades
 *  gracefully in the China / Great-Firewall scenario). */
function CompanyLogo({ company, logoUrl, website, size = 34, radius }) {
  const b = companyBrand(company);
  const r = radius ?? Math.round(size * 0.28);
  const domain = domainOf(website);
  const sources = [];
  if (logoUrl) sources.push(logoUrl);
  if (domain) sources.push(`https://unavatar.io/${domain}?fallback=false`);
  const [step, setStep] = useState(0);
  useEffect(() => { setStep(0); }, [logoUrl, domain]);
  const src = sources[step];
  if (src) {
    return <img src={src} alt={company || ""} width={size} height={size}
      onError={() => setStep((s) => s + 1)}
      style={{ borderRadius: r, objectFit: "contain", background: "#fff", flexShrink: 0, border: "1px solid var(--line)" }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: r, background: b.bg, color: b.fg, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.4, letterSpacing: -0.5 }}>
      {b.initials}
    </span>
  );
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Load an image cross-origin (unavatar sends ACAO:* so the canvas doesn't
 *  taint → toDataURL still works). Rejects on error / no logo. */
function loadCorsImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

/** Generate a QR with the company's REAL logo in its centre (from the website
 *  domain via unavatar), falling back to the coloured monogram when there's no
 *  logo / it won't load. High error-correction so the overlay never breaks
 *  scannability; falls back to a plain QR on any failure. */
async function brandedQrDataUrl(code, company, website, size = 280) {
  try {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, code, { width: size, margin: 1, errorCorrectionLevel: "H", color: { dark: "#111111", light: "#ffffff" } });
    const ctx = canvas.getContext("2d");
    const s = canvas.width;
    const b = companyBrand(company);
    // 2026-07-30 — "still having hard time scanning in the laptop... is the
    // qr code not good enough?": the covered area (logo + white plate) sat
    // right at ~27% of the code's width, close to the edge of what "H"-level
    // error correction nominally allows (~30%) — and jsQR (the actual
    // scanning library this app uses, on QRScannerPanel.jsx) doesn't realize
    // that full theoretical margin in practice, especially stacked with a
    // webcam's own resolution/focus limits. Shrunk for a real safety margin
    // rather than living right at the edge of tolerance. PRESERVED as-is
    // when the real-logo feature (2026-07-31, merged from Vance) was added
    // on top — this sizing is unrelated to whether a monogram or a real
    // fetched logo gets drawn into the same plate.
    const box = Math.round(s * 0.15);         // logo diameter
    const pad = box + Math.round(s * 0.04);   // white plate behind it
    const cx = s / 2, cy = s / 2;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, cx - pad / 2, cy - pad / 2, pad, pad, Math.round(pad * 0.24));
    ctx.fill();

    const domain = domainOf(website);
    let drewLogo = false;
    if (domain) {
      try {
        const img = await loadCorsImage(`https://unavatar.io/${domain}?fallback=false`);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, box / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
        ctx.fillStyle = "#fff"; ctx.fillRect(cx - box / 2, cy - box / 2, box, box);
        ctx.drawImage(img, cx - box / 2, cy - box / 2, box, box);
        ctx.restore();
        drewLogo = true;
      } catch { /* no logo — monogram below */ }
    }
    if (!drewLogo) {
      ctx.beginPath(); ctx.arc(cx, cy, box / 2, 0, Math.PI * 2); ctx.fillStyle = b.bg; ctx.fill();
      ctx.fillStyle = b.fg;
      ctx.font = `700 ${Math.round(box * 0.42)}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(b.initials, cx, cy + 1);
    }
    return canvas.toDataURL("image/png");
  } catch {
    return QRCode.toDataURL(code, { width: size, margin: 1 });
  }
}

/* Link a delegate's EXTERNAL physical pass (Feature 4b). Scans the pass's
 * QR/barcode with the camera (jsQR, HTTPS-only) OR takes a typed code. Calls
 * onLink(code) — which may throw (e.g. code already taken) — and shows the error. */
function PassLinker({ delegate, onLink, onClose }) {
  const { t } = useLang();
  const [mode, setMode] = useState("scan");   // "scan" | "manual"
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const videoRef = useRef(null);
  const rafRef = useRef(0);
  const streamRef = useRef(null);
  const doneRef = useRef(false);

  const submit = useCallback(async (raw) => {
    const c = (raw || "").toString().trim();
    if (!c || doneRef.current) return;
    doneRef.current = true; setBusy(true); setErr(null);
    try { await onLink(c); }
    catch (e) { setErr(e?.message || t("Couldn't link that pass.")); doneRef.current = false; setBusy(false); }
  }, [onLink, t]);

  // Camera + jsQR decode loop while in scan mode.
  useEffect(() => {
    if (mode !== "scan") return;
    let alive = true;
    const canvas = document.createElement("canvas");
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!alive) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        const tick = () => {
          if (!alive) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.videoWidth) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(img.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
            if (found?.data) { submit(found.data); return; }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (alive) { setErr(t("Camera unavailable — type the code instead.")); setMode("manual"); }
      }
    })();
    return () => { alive = false; cancelAnimationFrame(rafRef.current); streamRef.current?.getTracks().forEach((tr) => tr.stop()); streamRef.current = null; };
  }, [mode, submit, t]);

  return (
    <div className="mg-screen-only" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ padding: 0, width: 380, maxWidth: "92%", overflow: "hidden" }}>
        <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{t("Link physical pass")} · {delegate.name}</div>
          <span role="button" onClick={onClose} style={{ cursor: "pointer", color: "var(--ink-3)", display: "flex" }}><X size={18} /></span>
        </div>
        {mode === "scan" ? (
          <div style={{ padding: 16 }}>
            <div style={{ position: "relative", width: "100%", aspectRatio: "1", background: "#000", borderRadius: 12, overflow: "hidden" }}>
              <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: "18%", border: "3px solid rgba(255,255,255,0.85)", borderRadius: 12 }} />
            </div>
            <div className="muted" style={{ fontSize: 12.5, textAlign: "center", marginTop: 10 }}>{t("Point the camera at the QR/barcode on the physical pass.")}</div>
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <label className="page-eyebrow" style={{ padding: 0 }}>{t("Physical pass code")}</label>
            <input autoFocus className="input" placeholder="e.g. SCCCI-00842" value={manual} onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(manual); }} style={{ marginTop: 6 }} />
          </div>
        )}
        {err && <div style={{ margin: "0 16px", color: "var(--st-missing)", fontSize: 12.5 }}>{err}</div>}
        <div className="row" style={{ gap: 8, padding: 12, borderTop: "1px solid var(--line)" }}>
          <button className="btn btn-ghost btn-block" onClick={() => { doneRef.current = false; setErr(null); setMode(mode === "scan" ? "manual" : "scan"); }}>
            {mode === "scan" ? <><Keyboard size={15} /> {t("Type code")}</> : <><ScanLine size={15} /> {t("Scan")}</>}
          </button>
          {mode === "manual" && (
            <button className="btn btn-primary btn-block" disabled={busy || !manual.trim()} onClick={() => submit(manual)}>
              <Link2 size={15} /> {busy ? t("Linking…") : t("Link")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BoardingPassesView({ tripId, onKpiChange }) {
  const { t } = useLang();
  const [data, setData] = useState({ delegates: [], coaches: [], total: 0, present: 0 });
  const [qr, setQr] = useState({});           // delegateId -> QR data URL
  const qrRef = useRef({});                    // authoritative QR cache (survives polls)
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | pending | boarded
  const [open, setOpen] = useState(null);      // delegate shown in the pass modal
  const [linking, setLinking] = useState(null); // delegate whose physical pass is being linked
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState(null); // { ok, text } after an email attempt
  // Only dismiss if the WHOLE click gesture started on the backdrop itself.
  const downOnBackdrop = useRef(false);
  const [copied, setCopied] = useState(false);
  const [printOne, setPrintOne] = useState(null);

  // ---- Trip switcher — ADMIN ONLY. Staff are locked to the trip they're
  // assigned to (the `tripId` prop, which follows the Dashboard's own
  // already-staff-scoped switcher); letting them pick from /all-trips exposed
  // every other trip's roster and boarding passes. NOTE: this is a UI
  // restriction only — GET /api/onboarding/badges is requireAuth() with no
  // per-trip check, so it is NOT real enforcement (AI Log 255).
  const isAdmin = getUser()?.role === "admin";
  const [trips, setTrips] = useState([]);
  const [selectedTrip, setSelectedTrip] = useState(tripId || "t-1");
  useEffect(() => { getTrips().then(setTrips).catch(() => {}); }, []);
  useEffect(() => { setSelectedTrip(tripId || "t-1"); }, [tripId]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await getBadges(selectedTrip || "t-1");
      setData(res);
      // Generate QR data URLs only for delegates we haven't rendered yet — cheap
      // on every poll, and it scales to large trips (no full re-render each time).
      const need = res.delegates.filter((d) => d.qr_code && !qrRef.current[d.id]);
      if (need.length) {
        const entries = await Promise.all(need.map(async (d) => [d.id, await brandedQrDataUrl(d.qr_code, d.company, d.website)]));
        qrRef.current = { ...qrRef.current, ...Object.fromEntries(entries) };
        setQr(qrRef.current);
      }
    } catch { /* ignore */ } finally { if (!silent) setLoading(false); }
  }, [selectedTrip]);

  // Load once, then poll silently so boarding counts/statuses stay live during
  // muster without a manual Refresh (the "watch people board" use case).
  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 5000);
    return () => clearInterval(id);
  }, [load]);

  const coachOf = useCallback((id) => data.coaches.find((c) => c.id === id) || null, [data.coaches]);
  const coachLabel = (c) => (c ? `${c.name}${c.city ? ` · ${c.city}` : ""}` : t("No coach assigned"));

  const pending = data.total - data.present;

  /* ---- search + filter + group by coach -------------------------------- */
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return data.delegates.filter((d) => {
      const boarded = d.status === "PRESENT" || d.status === "ARRIVED";
      if (filter === "boarded" && !boarded) return false;
      if (filter === "pending" && boarded) return false;
      if (!s) return true;
      return [d.name, d.company, d.qr_code].some((v) => (v || "").toLowerCase().includes(s));
    });
  }, [data.delegates, search, filter]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const d of visible) {
      const k = d.coach_id || "__none";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(d);
    }
    const out = [];
    for (const c of data.coaches) if (m.has(c.id)) out.push({ key: c.id, label: coachLabel(c), items: m.get(c.id) });
    if (m.has("__none")) out.push({ key: "__none", label: t("No coach assigned"), items: m.get("__none") });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, data.coaches]);

  /* ---- printing --------------------------------------------------------- */
  // "Print all" prints whatever the list is currently showing — so filtering to
  // e.g. "Not boarded" and printing gives just those passes, not the whole trip.
  const filtered = search.trim() !== "" || filter !== "all";
  const printList = printOne ? [printOne] : visible;
  const doPrint = (one) => {
    setPrintOne(one || null);
    setTimeout(() => { window.print(); setPrintOne(null); }, 80);
  };

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Link / unlink a delegate's external physical pass. doLink throws on a taken
  // code so the PassLinker can surface the message; both refresh the list.
  const doLink = async (delegateId, code) => {
    await linkPhysicalBadge(delegateId, code);
    setOpen((o) => (o && o.id === delegateId ? { ...o, external_badge_code: code || null } : o));
    setLinking(null);
    load(true);
  };
  const doUnlink = async (delegateId) => {
    try {
      await linkPhysicalBadge(delegateId, "");
      setOpen((o) => (o && o.id === delegateId ? { ...o, external_badge_code: null } : o));
      load(true);
    } catch { /* ignore — list refresh will reconcile */ }
  };

  // Email a delegate their branded pass (sends the client-rendered QR-with-logo).
  const doEmailPass = async (d) => {
    setEmailing(true); setEmailMsg(null);
    try {
      const dataUrl = qr[d.id] || await brandedQrDataUrl(d.qr_code, d.company, d.website);
      const r = await emailPass(d.id, dataUrl);
      setEmailMsg({ ok: true, text: `${t("Sent to")} ${r.to}` });
    } catch (e) {
      setEmailMsg({ ok: false, text: e?.message || t("Couldn't send the email.") });
    } finally { setEmailing(false); }
  };
  useEffect(() => { setEmailMsg(null); }, [open?.id]);

  const FILTERS = [
    ["all", t("All"), data.total],
    ["pending", t("Not boarded"), pending],
    ["boarded", t("Boarded"), data.present],
  ];

  const currentTrip = trips.find((tr) => tr.id === selectedTrip);
  // Report the trip-scoped numbers up so the page header's TripPulse card
  // (rendered by the parent, in its original spot) can show THIS trip's
  // figures instead of the global assistant snapshot's. Additive only — a
  // parent that doesn't pass onKpiChange behaves exactly as before.
  useEffect(() => {
    onKpiChange?.({ trip: { name: currentTrip?.name, dayOf: currentTrip?.dayOf }, kpis: { total: data.total, present: data.present } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrip, data.total, data.present]);

  return (
    <div>
      {/* Header — counts folded into context, no stat-card row */}
      <div className="mg-screen-only row between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 16 }}>{t("Boarding passes")}</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {loading
              ? t("Generating passes…")
              : <>
                  <b>{data.total}</b> {t("passes issued")} · <b style={{ color: "var(--st-present)" }}>{data.present}</b> {t("boarded")}
                  {pending > 0 && <> · <b style={{ color: "var(--st-review)" }}>{pending}</b> {t("still to board")}</>}
                </>}
          </p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {isAdmin ? (
            <select className="select" style={{ width: 160, maxWidth: "40vw", textOverflow: "ellipsis" }} value={selectedTrip}
              onChange={(e) => setSelectedTrip(e.target.value)}>
              {/* `trips` comes from /all-trips, which only ever returns real
                  uuids — so the legacy "t-1" base-trip alias (what the Dashboard
                  switcher persists for Beijing) matches no option and would
                  render the select blank even though the data below loaded fine.
                  This keeps a matching option so the label never goes empty. */}
              {!trips.some((tr) => tr.id === selectedTrip) && (
                <option value={selectedTrip}>{t("Current trip")}</option>
              )}
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}{trip.dateRange ? ` · ${trip.dateRange}` : ""}
                </option>
              ))}
            </select>
          ) : (
            // Staff: read-only label, no way to reach another trip.
            currentTrip?.name && (
              <span className="badge badge-neutral" style={{ padding: "5px 10px", fontSize: 12.5 }}>
                {currentTrip.name}
              </span>
            )
          )}
          <button className="btn btn-ghost" onClick={() => load()}><RefreshCw size={15} /> {t("Refresh")}</button>
          <button className="btn btn-primary" onClick={() => doPrint(null)} disabled={!visible.length}>
            <Printer size={15} /> {filtered ? `${t("Print filtered")} (${visible.length})` : t("Print all")}
          </button>
        </div>
      </div>

      {/* Search + filter tabs */}
      <div className="mg-screen-only card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "var(--ink-3)" }} />
          <input className="input" placeholder={t("Search name, company or code…")} value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <div className="row" style={{ gap: 6 }}>
          {FILTERS.map(([k, label, n]) => (
            <button key={k} onClick={() => setFilter(k)} className="mg-chip"
              style={{
                background: filter === k ? "var(--scc-red-tint)" : "var(--surface-2)",
                color: filter === k ? "var(--scc-red)" : "var(--ink-2)",
                border: `1px solid ${filter === k ? "var(--scc-red)" : "var(--line)"}`,
              }}>
              {label} <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Grouped list */}
      <div className="mg-screen-only">
        {!loading && visible.length === 0 && (
          <div className="muted" style={{ fontSize: 13, padding: 10 }}>
            {data.total === 0 ? t("No delegates for this trip yet. Onboard some first.") : t("No delegates match.")}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key} style={{ marginBottom: 16 }}>
            <div className="row between" style={{ padding: "6px 2px 8px" }}>
              <div className="page-eyebrow">{g.label}</div>
              <span className="muted" style={{ fontSize: 12 }}>{g.items.length}</span>
            </div>
            {g.items.map((d) => {
              const meta = STATUS_META[d.status] || STATUS_META.UNASSIGNED;
              return (
                <button key={d.id} className="mg-passrow" onClick={() => setOpen(d)}>
                  <span className="avatar" style={{ flexShrink: 0 }}>{initialsOf(d.name)}</span>
                  <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                    <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      {d.name}
                      {d.vip && <Star size={13} fill="#e0a800" color="#e0a800" />}
                    </div>
                    <div className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                      <CompanyLogo company={d.company} logoUrl={d.logo_url} website={d.website} size={18} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.company || "—"}{d.industry ? ` · ${d.industry}` : ""}
                      </span>
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", flexShrink: 0 }}>{d.qr_code}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, minWidth: 82, textAlign: "right", flexShrink: 0 }}>
                    {t(meta.label)}
                  </span>
                  <QrCode size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* One-delegate pass modal */}
      {open && (
        <div
          onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) setOpen(null); }}
          className="mg-screen-only"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ padding: 0, width: 360, maxWidth: "92%", overflow: "hidden" }}>
            <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  {open.name} {open.vip && <Star size={14} fill="#e0a800" color="#e0a800" />}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{open.role || t("Delegate")}</div>
              </div>
              <span role="button" onClick={() => setOpen(null)} style={{ cursor: "pointer", color: "var(--ink-3)", display: "flex" }}><X size={18} /></span>
            </div>
            {/* Company identity band — the "who they represent" line of the badge */}
            <div className="row" style={{ gap: 10, alignItems: "center", padding: "12px 18px", background: "var(--surface-2)", borderBottom: "1px solid var(--line)" }}>
              <CompanyLogo company={open.company} logoUrl={open.logo_url} website={open.website} size={40} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{open.company || t("No company")}</div>
                {open.industry && <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{open.industry}</div>}
              </div>
            </div>
            <div style={{ padding: 18, textAlign: "center" }}>
              {qr[open.id]
                ? <img src={qr[open.id]} alt={`QR ${open.name}`} width={200} height={200} style={{ borderRadius: 10 }} />
                : <div style={{ width: 200, height: 200, background: "var(--surface-2)", borderRadius: 10, margin: "0 auto" }} />}
              <div className="mono" style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>{open.qr_code}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {coachLabel(coachOf(open.coach_id))} · {t((STATUS_META[open.status] || STATUS_META.UNASSIGNED).label)}
              </div>
            </div>
            {/* Physical pass (Feature 4b) — link SCCCI's own pass; check-in accepts either code */}
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="page-eyebrow" style={{ padding: 0 }}>{t("Physical pass")}</div>
                {open.external_badge_code
                  ? <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{open.external_badge_code}</div>
                  : <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("Not linked — using our QR")}</div>}
              </div>
              {open.external_badge_code
                ? <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => doUnlink(open.id)}>{t("Unlink")}</button>
                : <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setLinking(open)}><Link2 size={14} /> {t("Link")}</button>}
            </div>
            {open.email && (
              <div style={{ padding: "10px 12px 0" }}>
                <button className="btn btn-ghost btn-block" disabled={emailing} onClick={() => doEmailPass(open)} style={{ justifyContent: "center" }}>
                  <Mail size={15} /> {emailing ? t("Sending…") : t("Email pass")}
                </button>
                {emailMsg && <div style={{ fontSize: 12, marginTop: 5, textAlign: "center", color: emailMsg.ok ? "var(--st-present)" : "var(--st-missing)" }}>{emailMsg.text}</div>}
              </div>
            )}
            <div className="row" style={{ gap: 8, padding: 12, borderTop: "1px solid var(--line)" }}>
              <button className="btn btn-ghost btn-block" onClick={() => copyCode(open.qr_code)}>
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t("Copied") : t("Copy code")}
              </button>
              <button className="btn btn-primary btn-block" onClick={() => doPrint(open)}>
                <Printer size={15} /> {t("Print pass")}
              </button>
            </div>
          </div>
        </div>
      )}

      {linking && (
        <PassLinker delegate={linking} onLink={(code) => doLink(linking.id, code)} onClose={() => setLinking(null)} />
      )}

      {/* Print-only sheet (all passes, or just one when printing a single pass) */}
      <div className="mg-print-sheet">
        {printList.map((d) => (
          <div key={d.id} className="mg-pass">
            {qr[d.id] && <img src={qr[d.id]} alt="" width={150} height={150} />}
            <div className="mg-pass-name">{d.name}</div>
            {d.role && <div className="mg-pass-sub">{d.role}</div>}
            <div className="mg-pass-company"><CompanyLogo company={d.company} logoUrl={d.logo_url} website={d.website} size={16} /> <span>{d.company || ""}</span></div>
            {d.industry && <div className="mg-pass-sub">{d.industry}</div>}
            <div className="mg-pass-sub">{coachLabel(coachOf(d.coach_id))}</div>
            <div className="mg-pass-code">{d.qr_code}</div>
          </div>
        ))}
      </div>

      <style>{`
        .mg-chip{font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;cursor:pointer;transition:background .12s ease}
        .mg-passrow{width:100%;display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:6px;
          background:var(--surface);border:1px solid var(--line);border-radius:10px;cursor:pointer;
          transition:box-shadow .15s ease,border-color .15s ease}
        .mg-passrow:hover{box-shadow:0 3px 12px rgba(0,0,0,.07);border-color:var(--ink-3)}
        .mg-print-sheet{display:none}
        .mg-pass-company{display:flex;align-items:center;justify-content:center;gap:5px;font-size:11px;font-weight:600;margin-top:5px}
        @media print {
          body * { visibility: hidden !important; }
          .mg-print-sheet, .mg-print-sheet * { visibility: visible !important; }
          .mg-print-sheet{display:grid !important;position:absolute;left:0;top:0;width:100%;
            grid-template-columns:repeat(3,1fr);gap:10px;
            -webkit-print-color-adjust:exact;print-color-adjust:exact}
          .mg-pass{break-inside:avoid;border:1px solid #bbb;border-radius:8px;padding:10px;text-align:center}
          .mg-pass-name{font-weight:700;font-size:13px;margin-top:6px}
          .mg-pass-sub{font-size:11px;color:#555}
          .mg-pass-code{font-family:monospace;font-size:11px;margin-top:4px}
        }
      `}</style>
    </div>
  );
}
