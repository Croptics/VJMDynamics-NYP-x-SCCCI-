import { useEffect, useState, useRef, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, CheckCircle2, AlertCircle, Hand } from "lucide-react";
import { getBadges, qrCheckin } from "../lib/claudeParse.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * Scan to board — on-site check-in (Vance, demo of Vimal's future scanner app).
 * Reads a delegate's QR badge (camera or tap-to-simulate), flips them to PRESENT
 * on the chosen coach, and updates the live headcount. Desmond's coach board
 * reads the same PRESENT status, so it updates there too.
 */
export default function ScanToBoardView({ tripId }) {
  const { t } = useLang();
  const [roster, setRoster] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [counts, setCounts] = useState({ present: 0, total: 0 });
  const [sessionCoach, setSessionCoach] = useState("");
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState(null);
  const [result, setResult] = useState(null); // { tone, name, msg }
  const scannerRef = useRef(null);
  const lastRef = useRef({ code: "", t: 0 });
  const trip = tripId || "t-1";

  const load = useCallback(async () => {
    try {
      const r = await getBadges(trip);
      setRoster(r.delegates);
      setCoaches(r.coaches);
      setCounts({ present: r.present, total: r.total });
    } catch { /* ignore */ }
  }, [trip]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { scannerRef.current?.stop?.().catch(() => {}); }, []);

  const board = useCallback(async (code) => {
    const now = Date.now();
    if (code === lastRef.current.code && now - lastRef.current.t < 3000) return; // debounce repeat scans
    lastRef.current = { code, t: now };
    try {
      const r = await qrCheckin({ code, tripId: trip, coachId: sessionCoach || undefined });
      setResult({ tone: r.alreadyBoarded ? "warn" : "ok", name: r.delegate.name, msg: r.alreadyBoarded ? t("was already boarded") : t("boarded") });
      setCounts({ present: r.present, total: r.total });
      setRoster((rs) => rs.map((d) => (d.id === r.delegate.id ? { ...d, status: "PRESENT", coach_id: r.delegate.coachId } : d)));
    } catch (err) {
      setResult({ tone: "error", name: "", msg: err.message || t("That badge isn't recognised.") });
    }
  }, [trip, sessionCoach, t]);

  async function startCam() {
    setCamError(null);
    try {
      const h = new Html5Qrcode("qr-reader");
      scannerRef.current = h;
      await h.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (txt) => board(txt), () => {});
      setScanning(true);
    } catch (err) {
      setCamError(err?.message || t("Camera unavailable — use tap-to-board below."));
      setScanning(false);
    }
  }
  async function stopCam() {
    try { await scannerRef.current?.stop(); } catch { /* ignore */ }
    setScanning(false);
  }

  const pct = counts.total ? Math.round((counts.present / counts.total) * 100) : 0;
  const notBoarded = roster.filter((d) => d.status !== "PRESENT");
  const toneColor = (tone) => (tone === "ok" ? "var(--st-present)" : tone === "warn" ? "var(--st-review)" : "var(--st-missing)");

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 16 }}>{t("Scan to board")}</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{t("Scan a delegate's QR badge to board them. Updates the coach board live.")}</p>
        </div>
        <label className="row" style={{ gap: 8, fontSize: 13 }}>
          <span className="muted">{t("Boarding")}</span>
          <select className="select" value={sessionCoach} onChange={(e) => setSessionCoach(e.target.value)} style={{ padding: "6px 8px", minWidth: 130 }}>
            <option value="">{t("Keep assigned coach")}</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` (${c.city})` : ""}</option>)}
          </select>
        </label>
      </div>

      {/* Headcount */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>{t("Boarded")}</span>
          <span style={{ fontWeight: 700 }}><span style={{ color: "var(--st-present)" }}>{counts.present}</span> / {counts.total}</span>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "var(--st-present)", transition: "width 0.4s", borderRadius: 999 }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Camera scanner */}
        <div className="card" style={{ padding: 16 }}>
          <div id="qr-reader" style={{ width: "100%", minHeight: 240, borderRadius: 8, overflow: "hidden", background: "var(--surface-2)" }} />
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            {!scanning
              ? <button className="btn btn-primary btn-block" onClick={startCam}><Camera size={16} /> {t("Start camera")}</button>
              : <button className="btn btn-dark btn-block" onClick={stopCam}><CameraOff size={16} /> {t("Stop camera")}</button>}
          </div>
          {camError && <div style={{ fontSize: 12, color: "var(--st-missing)", marginTop: 8 }}>{camError}</div>}
          {result && (
            <div className="row" style={{ gap: 8, marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--surface-2)", border: `1px solid ${toneColor(result.tone)}` }}>
              {result.tone === "error" ? <AlertCircle size={18} color={toneColor(result.tone)} /> : <CheckCircle2 size={18} color={toneColor(result.tone)} />}
              <span style={{ fontSize: 14 }}>{result.name ? <b>{result.name}</b> : null} {result.msg}</span>
            </div>
          )}
        </div>

        {/* Tap-to-board fallback */}
        <div className="card" style={{ padding: 16, maxHeight: 340, overflowY: "auto" }}>
          <div className="row" style={{ gap: 6, marginBottom: 10, color: "var(--ink-2)" }}>
            <Hand size={15} /> <span style={{ fontWeight: 600, fontSize: 13 }}>{t("Or tap to board (simulate scan)")}</span>
          </div>
          {notBoarded.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t("Everyone is boarded 🎉")}</div>}
          {notBoarded.map((d) => (
            <button key={d.id} className="nav-item" onClick={() => board(d.qr_code)}
              style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", marginBottom: 6, background: "var(--surface)" }}>
              <span className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{(d.name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("")}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{d.company || "—"}</div>
              </div>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{d.qr_code}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
