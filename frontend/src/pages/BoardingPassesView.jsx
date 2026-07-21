import { useEffect, useState, useCallback, useMemo } from "react";
import QRCode from "qrcode";
import { RefreshCw, Printer, Star, Search, X, Copy, Check, QrCode } from "lucide-react";
import { getBadges } from "../lib/claudeParse.js";
import { useLang } from "../lib/i18n.jsx";

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
const STATUS_META = {
  PRESENT: { label: "Boarded", color: "var(--st-present)" },
  ARRIVED: { label: "Boarded", color: "var(--st-present)" },
  ASSIGNED: { label: "Not boarded", color: "var(--st-review)" },
  LATE: { label: "Not boarded", color: "var(--st-review)" },
  MISSING: { label: "Not boarded", color: "var(--st-review)" },
  UNASSIGNED: { label: "No coach", color: "var(--ink-3)" },
};
const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function BoardingPassesView({ tripId }) {
  const { t } = useLang();
  const [data, setData] = useState({ delegates: [], coaches: [], total: 0, present: 0 });
  const [qr, setQr] = useState({});           // delegateId -> QR data URL
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | pending | boarded
  const [open, setOpen] = useState(null);      // delegate shown in the pass modal
  const [copied, setCopied] = useState(false);
  const [printOne, setPrintOne] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getBadges(tripId || "t-1");
      setData(res);
      const entries = await Promise.all(
        res.delegates.map(async (d) => [d.id, d.qr_code ? await QRCode.toDataURL(d.qr_code, { width: 260, margin: 1 }) : null])
      );
      setQr(Object.fromEntries(entries));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

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

  const FILTERS = [
    ["all", t("All"), data.total],
    ["pending", t("Not boarded"), pending],
    ["boarded", t("Boarded"), data.present],
  ];

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
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-ghost" onClick={load}><RefreshCw size={15} /> {t("Refresh")}</button>
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
                    <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.company || "—"}
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
        <div onClick={() => setOpen(null)} className="mg-screen-only"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ padding: 0, width: 360, maxWidth: "92%", overflow: "hidden" }}>
            <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  {open.name} {open.vip && <Star size={14} fill="#e0a800" color="#e0a800" />}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{open.company || "—"}</div>
              </div>
              <span role="button" onClick={() => setOpen(null)} style={{ cursor: "pointer", color: "var(--ink-3)", display: "flex" }}><X size={18} /></span>
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

      {/* Print-only sheet (all passes, or just one when printing a single pass) */}
      <div className="mg-print-sheet">
        {printList.map((d) => (
          <div key={d.id} className="mg-pass">
            {qr[d.id] && <img src={qr[d.id]} alt="" width={150} height={150} />}
            <div className="mg-pass-name">{d.name}</div>
            <div className="mg-pass-sub">{d.company || ""}</div>
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
        @media print {
          body * { visibility: hidden !important; }
          .mg-print-sheet, .mg-print-sheet * { visibility: visible !important; }
          .mg-print-sheet{display:grid !important;position:absolute;left:0;top:0;width:100%;
            grid-template-columns:repeat(3,1fr);gap:10px}
          .mg-pass{break-inside:avoid;border:1px solid #bbb;border-radius:8px;padding:10px;text-align:center}
          .mg-pass-name{font-weight:700;font-size:13px;margin-top:6px}
          .mg-pass-sub{font-size:11px;color:#555}
          .mg-pass-code{font-family:monospace;font-size:11px;margin-top:4px}
        }
      `}</style>
    </div>
  );
}
