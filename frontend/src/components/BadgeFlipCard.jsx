/* =============================================================================
 *  OWNED BY:  Vance — reusable digital badge flip card. QR (front) ↔ company-ID
 *  badge (back), with a ↻ control top-right. Same interaction as the public
 *  /badge page and the desktop pass modal, packaged as a self-contained overlay
 *  so mobile (e.g. the scanner confirmation) can show a scanned delegate's badge
 *  consistently. Fetches the public /api/badge/:code (no auth needed).
 * ============================================================================= */
import { useState, useEffect } from "react";
import { useLang } from "../lib/i18n.jsx";
import QRCode from "qrcode";
import { Star, RotateCw, X } from "lucide-react";

const BRAND_COLORS = ["#1f6feb", "#8250df", "#0f766e", "#b91c1c", "#b45309", "#0e7490", "#4d7c0f", "#9d174d", "#3f3f9e", "#7c3aed"];
const STOP = new Set(["pte", "ltd", "llp", "inc", "co", "corp", "the", "and", "services", "group", "holdings", "solutions", "consulting", "international", "limited"]);
function brandOf(company) {
  const name = (company || "").trim();
  if (!name) return { initials: "—", color: "#64748b" };
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const words = name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  const sig = words.filter((w) => !STOP.has(w.toLowerCase()));
  const initials = ((sig.length ? sig : words).slice(0, 2).map((w) => w[0]).join("") || name[0]).toUpperCase();
  return { initials, color: BRAND_COLORS[h % BRAND_COLORS.length] };
}
function domainOf(website) {
  if (!website) return null;
  const w = String(website).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(w) ? w : null;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function loadCorsImage(src) {
  return new Promise((resolve, reject) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
}
/* Company logo in the QR centre — same branded QR as the in-app pass. */
async function brandedQr(code, company, website, size = 300) {
  try {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, code, { width: size, margin: 1, errorCorrectionLevel: "H", color: { dark: "#111111", light: "#ffffff" } });
    const ctx = canvas.getContext("2d"); const s = canvas.width, cx = s / 2, cy = s / 2;
    const bo = brandOf(company); const box = Math.round(s * 0.22), pad = box + Math.round(s * 0.05);
    ctx.fillStyle = "#ffffff"; roundRect(ctx, cx - pad / 2, cy - pad / 2, pad, pad, Math.round(pad * 0.24)); ctx.fill();
    const domain = domainOf(website); let drew = false;
    if (domain) {
      try {
        const img = await loadCorsImage(`https://unavatar.io/${domain}?fallback=false`);
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, box / 2, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = "#fff"; ctx.fillRect(cx - box / 2, cy - box / 2, box, box);
        ctx.drawImage(img, cx - box / 2, cy - box / 2, box, box); ctx.restore(); drew = true;
      } catch { /* monogram below */ }
    }
    if (!drew) {
      ctx.beginPath(); ctx.arc(cx, cy, box / 2, 0, Math.PI * 2); ctx.fillStyle = bo.color; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(box * 0.42)}px system-ui,-apple-system,Segoe UI,sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(bo.initials, cx, cy + 1);
    }
    return canvas.toDataURL("image/png");
  } catch { return null; }
}

/** Full-screen overlay showing a delegate's flip badge for `code`. */
export default function BadgeFlipCard({ code, onClose }) {
  const { t } = useLang();
  const [badge, setBadge] = useState(null);
  const [qr, setQr] = useState("");
  const [flipped, setFlipped] = useState(false);
  const [err, setErr] = useState(false);
  const [logoOk, setLogoOk] = useState(true);

  useEffect(() => {
    let alive = true;
    const base = import.meta.env.VITE_API_URL || "/api";
    fetch(`${base}/badge/${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => { if (alive) setBadge(b); })
      .catch(() => { if (alive) setErr(true); });
    // Plain QR immediately (needs only the code), then brand it once we know the company.
    QRCode.toDataURL(code, { width: 300, margin: 1, errorCorrectionLevel: "H", color: { dark: "#111111", light: "#ffffff" } })
      .then((u) => { if (alive && !qr) setQr(u); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  useEffect(() => {
    if (!badge) return;
    let alive = true;
    brandedQr(code, badge.company, badge.website, 300).then((u) => { if (alive && u) setQr(u); }).catch(() => {});
    return () => { alive = false; };
  }, [badge, code]);

  const b = brandOf(badge?.company);
  const domain = domainOf(badge?.website);
  const logo = domain && logoOk ? `https://unavatar.io/${domain}` : null;
  const flip = () => setFlipped((f) => !f);

  const FlipBtn = ({ dark }) => (
    <button onClick={(e) => { e.stopPropagation(); flip(); }} aria-label={t("Flip badge")}
      style={{ position: "absolute", top: 10, right: 10, zIndex: 2, width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer",
        background: dark ? "rgba(255,255,255,.22)" : "rgba(0,0,0,.06)", color: dark ? "#fff" : "#333",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      <RotateCw size={17} />
    </button>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(12,12,18,.72)", backdropFilter: "blur(3px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <button onClick={onClose} aria-label={t("Close")} style={{ position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(255,255,255,.16)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><X size={20} /></button>

      {err ? (
        <div style={{ color: "#fff", textAlign: "center" }}><div style={{ fontSize: 34 }}>🎫</div><div style={{ fontWeight: 700, marginTop: 8 }}>{t("Badge not found")}</div></div>
      ) : !badge ? (
        <div style={{ color: "#fff", opacity: 0.85 }}>{t("Loading…")}</div>
      ) : (
        <>
          <div className="mbf-flip" onClick={(e) => { e.stopPropagation(); flip(); }} role="button" aria-label={t("Flip badge")}>
            <div className={"mbf-inner" + (flipped ? " flipped" : "")}>
              {/* FRONT — QR */}
              <div className="mbf-face" style={{ background: "#fff", color: "#1a1a1a" }}>
                <FlipBtn dark={false} />
                <div style={{ height: 40, background: b.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, letterSpacing: 1 }}>{t("BOARDING PASS")}</div>
                <div style={{ padding: "18px 18px 14px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {qr ? <img src={qr} alt="QR" width={188} height={188} style={{ borderRadius: 10, border: "1px solid #eee" }} /> : <div style={{ width: 188, height: 188, background: "#f1f1f4", borderRadius: 10 }} />}
                  <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, marginTop: 12, letterSpacing: 1.5 }}>{badge.code}</div>
                  <div style={{ fontWeight: 700, fontSize: 16, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>{badge.name}{badge.vip && <Star size={14} fill="#e0a800" color="#e0a800" />}</div>
                </div>
              </div>
              {/* BACK — company badge */}
              <div className="mbf-face mbf-back" style={{ background: b.color, color: "#fff" }}>
                <FlipBtn dark />
                <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", textAlign: "center", boxSizing: "border-box" }}>
                  {logo
                    ? <img src={logo} alt={badge.company || ""} width={86} height={86} onError={() => setLogoOk(false)} style={{ borderRadius: 22, objectFit: "contain", background: "#fff", border: "3px solid rgba(255,255,255,.6)" }} />
                    : <div style={{ width: 86, height: 86, borderRadius: 22, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 800, border: "3px solid rgba(255,255,255,.4)" }}>{b.initials}</div>}
                  <div style={{ marginTop: 16, fontWeight: 800, fontSize: 21, display: "flex", alignItems: "center", gap: 6 }}>{badge.name}{badge.vip && <Star size={15} fill="#ffd76a" color="#ffd76a" />}</div>
                  <div style={{ opacity: 0.95, fontSize: 13.5, marginTop: 3 }}>{badge.role || t("Delegate")}</div>
                  <div style={{ width: 40, height: 3, background: "rgba(255,255,255,.5)", borderRadius: 2, margin: "14px 0" }} />
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{badge.company || ""}</div>
                  {badge.industry && <div style={{ opacity: 0.85, fontSize: 12, marginTop: 3 }}>{badge.industry}</div>}
                  {badge.coach && <div style={{ opacity: 0.8, fontSize: 11.5, marginTop: 12 }}>{badge.coach}</div>}
                </div>
              </div>
            </div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); flip(); }} style={{ marginTop: 20, background: "rgba(255,255,255,.16)", color: "#fff", border: "none", borderRadius: 999, padding: "9px 18px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <RotateCw size={15} /> {flipped ? t("Show QR") : t("Show company badge")}
          </button>
        </>
      )}

      <style>{`
        .mbf-flip{perspective:1300px;width:288px;height:340px;cursor:pointer}
        .mbf-inner{position:relative;width:100%;height:100%;transition:transform .6s cubic-bezier(.2,.7,.2,1);transform-style:preserve-3d}
        .mbf-inner.flipped{transform:rotateY(180deg)}
        .mbf-face{position:absolute;inset:0;-webkit-backface-visibility:hidden;backface-visibility:hidden;border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.4)}
        .mbf-back{transform:rotateY(180deg)}
      `}</style>
    </div>
  );
}
