/* =============================================================================
 *  OWNED BY:  Vance — public digital badge (Feature 4c). Opened from the emailed
 *  boarding pass ("Open your boarding pass"). Matches the in-app boarding pass:
 *  a BRANDED QR (the company logo in its centre) leads, with the company
 *  identity shown right below it; a ↻ control (top-right) flips to the full
 *  digital company-ID badge. No login — the code in the URL is the shared
 *  secret, like an e-ticket link. Standalone, so it works from any email client.
 *  The QR is generated from the URL code, so it renders even before / without
 *  the badge lookup resolving.
 * ============================================================================= */
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import { ClipboardCheck, Star, RotateCw } from "lucide-react";

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
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function loadCorsImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => resolve(im); im.onerror = reject; im.src = src;
  });
}
/* Same branded QR as the desktop pass: the company's real logo (unavatar, by
 * website domain) drawn into the centre over a white plate, monogram fallback,
 * high error-correction so the overlay never breaks scannability. */
async function brandedQr(code, company, website, size = 300) {
  try {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, code, { width: size, margin: 1, errorCorrectionLevel: "H", color: { dark: "#111111", light: "#ffffff" } });
    const ctx = canvas.getContext("2d");
    const s = canvas.width, cx = s / 2, cy = s / 2;
    const bo = brandOf(company);
    const box = Math.round(s * 0.22), pad = box + Math.round(s * 0.05);
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

export default function BadgePage() {
  const { code } = useParams();
  const [badge, setBadge] = useState(null);
  const [qr, setQr] = useState("");
  const [flipped, setFlipped] = useState(false); // false = QR (front), true = company badge
  const [notFound, setNotFound] = useState(false);
  const [logoOk, setLogoOk] = useState(true);

  // Badge lookup (company / name / logo). The page doesn't block on this.
  useEffect(() => {
    let alive = true;
    const base = import.meta.env.VITE_API_URL || "/api";
    fetch(`${base}/badge/${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => { if (alive) setBadge(b); })
      .catch(() => { if (alive) setNotFound(true); });
    return () => { alive = false; };
  }, [code]);

  // QR renders from the URL code alone (no backend needed): a plain QR first,
  // then upgraded to the branded (logo-centre) version once we know the company.
  useEffect(() => {
    let alive = true;
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

  const wrap = (children) => (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#e1232a 0%,#1a1a22 100%)", padding: 20, fontFamily: "-apple-system,Segoe UI,Arial,sans-serif", color: "#fff", textAlign: "center" }}>{children}</div>
  );
  if (notFound) return wrap(<div><div style={{ fontSize: 40, marginBottom: 10 }}>🎫</div><div style={{ fontWeight: 700, fontSize: 18 }}>Badge not found</div><div style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>This pass link isn't recognised.</div></div>);

  const b = brandOf(badge?.company);
  const domain = domainOf(badge?.website);
  const logo = domain && logoOk ? `https://unavatar.io/${domain}` : null;
  const flip = () => setFlipped((f) => !f);
  const name = badge?.name || "";
  const company = badge?.company || "";

  const FlipBtn = ({ dark }) => (
    <button onClick={(e) => { e.stopPropagation(); flip(); }} aria-label="Flip badge"
      style={{ position: "absolute", top: 12, right: 12, zIndex: 2, width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer",
        background: dark ? "rgba(255,255,255,.22)" : "rgba(0,0,0,.06)", color: dark ? "#fff" : "#333",
        display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)", boxShadow: "0 2px 8px rgba(0,0,0,.15)" }}>
      <RotateCw size={19} />
    </button>
  );
  const smallLogo = (
    logo
      ? <img src={logo} alt="" width={30} height={30} onError={() => setLogoOk(false)} style={{ borderRadius: 8, objectFit: "contain", background: "#fff", border: "1px solid #eee" }} />
      : <div style={{ width: 30, height: 30, borderRadius: 8, background: b.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>{b.initials}</div>
  );

  return wrap(
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 800, letterSpacing: 0.3, marginBottom: 16, opacity: 0.95 }}>
        <ClipboardCheck size={20} /> MusterGo
      </div>

      <div className="bdg-flip" onClick={flip} role="button" aria-label="Flip badge">
        <div className={"bdg-inner" + (flipped ? " flipped" : "")}>
          {/* FRONT — branded QR + company identity (matches the in-app pass) */}
          <div className="bdg-face" style={{ background: "#fff", color: "#1a1a1a" }}>
            <FlipBtn dark={false} />
            <div style={{ height: 42, background: b.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 12, letterSpacing: 1 }}>
              BOARDING PASS
            </div>
            {/* company identity band */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 16px", borderBottom: "1px solid #eee" }}>
              {smallLogo}
              <div style={{ textAlign: "left", minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{company || "—"}</div>
                {badge?.industry && <div style={{ fontSize: 11, color: "#999" }}>{badge.industry}</div>}
              </div>
            </div>
            <div style={{ padding: "16px 20px 14px", display: "flex", flexDirection: "column", alignItems: "center" }}>
              {qr
                ? <img src={qr} alt="QR" width={184} height={184} style={{ borderRadius: 10 }} />
                : <div style={{ width: 184, height: 184, borderRadius: 10, background: "#f1f1f4" }} />}
              <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, marginTop: 10, letterSpacing: 1.5 }}>{badge?.code || code}</div>
              {name && <div style={{ fontWeight: 700, fontSize: 15, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>{name}{badge?.vip && <Star size={14} fill="#e0a800" color="#e0a800" />}</div>}
              <div style={{ color: "#999", fontSize: 11.5, marginTop: 5 }}>Scan at muster · tap ↻ for badge</div>
            </div>
          </div>

          {/* BACK — the digital company-ID badge */}
          <div className="bdg-face bdg-back" style={{ background: b.color, color: "#fff" }}>
            <FlipBtn dark />
            <div style={{ padding: "26px 22px", display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "center", boxSizing: "border-box" }}>
              {logo
                ? <img src={logo} alt={company} width={92} height={92} onError={() => setLogoOk(false)} style={{ borderRadius: 22, objectFit: "contain", background: "#fff", border: "3px solid rgba(255,255,255,.6)", boxShadow: "0 6px 18px rgba(0,0,0,.2)" }} />
                : <div style={{ width: 92, height: 92, borderRadius: 22, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 800, border: "3px solid rgba(255,255,255,.4)" }}>{b.initials}</div>}
              <div style={{ marginTop: 18, fontWeight: 800, fontSize: 22, display: "flex", alignItems: "center", gap: 7, textAlign: "center" }}>
                {name}{badge?.vip && <Star size={16} fill="#ffd76a" color="#ffd76a" />}
              </div>
              <div style={{ opacity: 0.95, fontSize: 13.5, marginTop: 4 }}>{badge?.role || "Delegate"}</div>
              <div style={{ width: 44, height: 3, background: "rgba(255,255,255,.5)", borderRadius: 2, margin: "15px 0" }} />
              <div style={{ fontWeight: 700, fontSize: 16 }}>{company}</div>
              {badge?.industry && <div style={{ opacity: 0.85, fontSize: 12.5, marginTop: 4 }}>{badge.industry}</div>}
              {badge?.tripName && <div style={{ opacity: 0.8, fontSize: 12, marginTop: 14 }}>{badge.tripName}{badge.coach ? ` · ${badge.coach}` : ""}</div>}
            </div>
          </div>
        </div>
      </div>

      <button onClick={flip} style={{ marginTop: 20, background: "rgba(255,255,255,.16)", color: "#fff", border: "none", borderRadius: 999, padding: "9px 18px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, backdropFilter: "blur(6px)" }}>
        <RotateCw size={15} /> {flipped ? "Show QR" : "Show company badge"}
      </button>

      <style>{`
        .bdg-flip { perspective: 1400px; width: 300px; height: 448px; cursor: pointer; }
        .bdg-inner { position: relative; width: 100%; height: 100%; transition: transform .7s cubic-bezier(.2,.7,.2,1); transform-style: preserve-3d; }
        .bdg-inner.flipped { transform: rotateY(180deg); }
        .bdg-face { position: absolute; inset: 0; -webkit-backface-visibility: hidden; backface-visibility: hidden; border-radius: 22px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
        .bdg-back { transform: rotateY(180deg); }
      `}</style>
    </>
  );
}
