import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import { RefreshCw, Printer, Star } from "lucide-react";
import { getBadges } from "../lib/claudeParse.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * Boarding passes — one scannable QR badge per delegate (Vance).
 * The document reader onboards delegates; each gets a unique qr_code, shown here
 * as a printable badge. The on-site scanner reads it to board them.
 */
const STATUS_CLS = { PRESENT: "badge-present", MISSING: "badge-review", UNASSIGNED: "badge-muted" };

export default function BoardingPassesView({ tripId }) {
  const { t } = useLang();
  const [data, setData] = useState({ delegates: [], coaches: [], total: 0, present: 0 });
  const [qr, setQr] = useState({}); // delegateId -> data URL
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getBadges(tripId || "t-1");
      setData(res);
      const entries = await Promise.all(
        res.delegates.map(async (d) => [d.id, d.qr_code ? await QRCode.toDataURL(d.qr_code, { width: 150, margin: 1 }) : null])
      );
      setQr(Object.fromEntries(entries));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

  const coachName = (id) => {
    const c = data.coaches.find((x) => x.id === id);
    return c ? `${c.name}${c.city ? ` · ${c.city}` : ""}` : t("Unassigned");
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 16 }}>{t("Boarding passes")}</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {t("A unique QR badge for each delegate. Print them, or show on a phone for the scanner.")}
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-ghost" onClick={load}><RefreshCw size={15} /> {t("Refresh")}</button>
          <button className="btn btn-primary" onClick={() => window.print()}><Printer size={15} /> {t("Print all")}</button>
        </div>
      </div>

      {loading && <div className="muted" style={{ fontSize: 13 }}>{t("Generating passes…")}</div>}
      {!loading && data.delegates.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>{t("No delegates for this trip yet. Onboard some first.")}</div>
      )}

      <div className="mg-pass-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
        {data.delegates.map((d) => (
          <div key={d.id} className="card mg-pass" style={{ padding: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <div className="row between" style={{ width: "100%", alignItems: "flex-start" }}>
              <span className={"badge " + (STATUS_CLS[d.status] || "badge-muted")} style={{ fontSize: 10 }}>{t(d.status)}</span>
              {d.vip && <Star size={15} fill="#e0a800" color="#e0a800" />}
            </div>
            {qr[d.id]
              ? <img src={qr[d.id]} alt={`QR ${d.name}`} width={140} height={140} style={{ borderRadius: 8 }} />
              : <div style={{ width: 140, height: 140, background: "var(--surface-2)", borderRadius: 8 }} />}
            <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{d.company || "—"}</div>
            <div className="muted" style={{ fontSize: 11 }}>{coachName(d.coach_id)}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{d.qr_code}</div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          .page-eyebrow, .page-title, .page-sub, .btn, .mg-tabbar { display: none !important; }
          .mg-pass { break-inside: avoid; border: 1px solid #ccc !important; }
          .mg-pass-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
