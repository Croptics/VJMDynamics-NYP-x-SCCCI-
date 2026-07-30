/* =============================================================================
 *  OWNED BY:  Vance — public flip-card badge page (Feature 4c). Opened from the
 *  emailed boarding pass ("View & flip your badge"): a delegate's interactive
 *  badge that flips between the company-branded FRONT (logo, name, role) and the
 *  BACK (their QR). No login — the code in the URL is the shared secret, like an
 *  e-ticket link. Standalone (no app shell), so it works from any email client.
 * ============================================================================= */
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import { ClipboardCheck, Star, RotateCw } from "lucide-react";

const BRAND_COLORS = ["#1f6feb", "#8250df", "#0f766e", "#b91c1c", "#b45309", "#0e7490", "#4d7c0f", "#9d174d", "#3f3f9e", "#7c3aed"];
const STOP = new Set(["pte", "ltd", "llp", "inc", "co", "corp", "the", "and", "services", "group", "holdings", "solutions", "consulting", "international"]);
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

export default function BadgePage() {
  const { code } = useParams();
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
    QRCode.toDataURL(code, { width: 340, margin: 1, color: { dark: "#111111", light: "#ffffff" } })
      .then((u) => { if (alive) setQr(u); }).catch(() => {});
    return () => { alive = false; };
  }, [code]);

  const wrap = (children) => (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#e1232a 0%,#1a1a22 100%)", padding: 20, fontFamily: "-apple-system,Segoe UI,Arial,sans-serif", color: "#fff", textAlign: "center" }}>{children}</div>
  );
  if (err) return wrap(<div><div style={{ fontSize: 40, marginBottom: 10 }}>🎫</div><div style={{ fontWeight: 700, fontSize: 18 }}>Badge not found</div><div style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>This pass link isn't recognised.</div></div>);
  if (!badge) return wrap(<div style={{ opacity: 0.85 }}>Loading your badge…</div>);

  const b = brandOf(badge.company);
  const domain = domainOf(badge.website);
  const logo = domain && logoOk ? `https://unavatar.io/${domain}` : null;

  return wrap(
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 800, letterSpacing: 0.3, marginBottom: 18, opacity: 0.95 }}>
        <ClipboardCheck size={20} /> MusterGo
      </div>

      <div className="bdg-flip" onClick={() => setFlipped((f) => !f)} role="button" aria-label="Flip badge">
        <div className={"bdg-inner" + (flipped ? " flipped" : "")}>
          {/* FRONT — company identity */}
          <div className="bdg-face" style={{ background: "#fff", color: "#1a1a1a" }}>
            <div style={{ height: 10, background: b.color }} />
            <div style={{ padding: "26px 22px", display: "flex", flexDirection: "column", alignItems: "center" }}>
              {logo
                ? <img src={logo} alt={badge.company || ""} width={92} height={92} onError={() => setLogoOk(false)} style={{ borderRadius: 22, objectFit: "contain", background: "#fff", border: "1px solid #eee", boxShadow: "0 6px 18px rgba(0,0,0,.12)" }} />
                : <div style={{ width: 92, height: 92, borderRadius: 22, background: b.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 800 }}>{b.initials}</div>}
              <div style={{ marginTop: 18, fontWeight: 800, fontSize: 22, display: "flex", alignItems: "center", gap: 7 }}>
                {badge.name}{badge.vip && <Star size={16} fill="#e0a800" color="#e0a800" />}
              </div>
              <div style={{ color: "#666", fontSize: 14, marginTop: 3 }}>{badge.role || "Delegate"}</div>
              <div style={{ fontWeight: 600, fontSize: 14.5, marginTop: 12, color: b.color }}>{badge.company || ""}</div>
              {badge.industry && <div style={{ color: "#999", fontSize: 12.5, marginTop: 3 }}>{badge.industry}</div>}
              {badge.tripName && <div style={{ marginTop: 16, fontSize: 12, color: "#aaa" }}>{badge.tripName}</div>}
            </div>
          </div>
          {/* BACK — QR to board */}
          <div className="bdg-face bdg-back" style={{ background: b.color, color: "#fff" }}>
            <div style={{ padding: "26px 22px", display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "center" }}>
              {qr ? <img src={qr} alt="QR" width={200} height={200} style={{ borderRadius: 14, background: "#fff", padding: 8 }} /> : <div style={{ width: 216, height: 216, borderRadius: 14, background: "rgba(255,255,255,.2)" }} />}
              <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, marginTop: 14 }}>{badge.code}</div>
              <div style={{ opacity: 0.9, fontSize: 12.5, marginTop: 6 }}>Show this to board{badge.coach ? ` · ${badge.coach}` : ""}</div>
            </div>
          </div>
        </div>
      </div>

      <button onClick={() => setFlipped((f) => !f)} style={{ marginTop: 22, background: "rgba(255,255,255,.16)", color: "#fff", border: "none", borderRadius: 999, padding: "9px 18px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, backdropFilter: "blur(6px)" }}>
        <RotateCw size={15} /> {flipped ? "Show badge" : "Show QR"}
      </button>

      <style>{`
        .bdg-flip { perspective: 1400px; width: 300px; height: 420px; cursor: pointer; }
        .bdg-inner { position: relative; width: 100%; height: 100%; transition: transform .7s cubic-bezier(.2,.7,.2,1); transform-style: preserve-3d; }
        .bdg-inner.flipped { transform: rotateY(180deg); }
        .bdg-face { position: absolute; inset: 0; -webkit-backface-visibility: hidden; backface-visibility: hidden; border-radius: 22px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
        .bdg-back { transform: rotateY(180deg); }
      `}</style>
    </>
  );
}
