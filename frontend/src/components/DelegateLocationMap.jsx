/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Delegate widgets
 * ============================================================================= */
import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { useLang } from "../lib/i18n.jsx";

/**
 * Renders a delegate's "Last known location" as a static embedded map (not
 * live tracking; see the "lastLocation" comment in backend/data.js) — with a
 * choice of provider, since Google Maps is unreliable/blocked for delegates
 * actually in China:
 *   - Google Map: Maps Embed API, needs VITE_GOOGLE_MAPS_API_KEY in
 *     frontend/.env (see .env_Future.example) — degrades to a plain message
 *     when it's missing instead of rendering a broken iframe.
 *   - AMap (Gaode): no API key configured yet, so this uses AMap's public
 *     `uri.amap.com/search` page (their share/preview link, not the full JS
 *     SDK) as the iframe source — searches by the SAME place-name text as
 *     the Google tab. Since we only ever store a place name (not lat/lng),
 *     AMap's own search index may occasionally resolve it to a different
 *     spot than Google's — worth eyeballing once real China-based locations
 *     start coming in. A visible "Open in AMap" link is always shown
 *     alongside it in case the iframe ever gets blocked from framing.
 */
const TABS = [
  { key: "google", label: "Google Map" },
  { key: "amap", label: "AMap" },
];

/* The AMap iframe used to be rendered taller than its box and shifted up by a
 * hardcoded 140px, to crop away AMap's own search bar / app-download panel.
 * That number was a guess from a screenshot, never measured in a real browser
 * (the original comment said as much) — and a wrong crop shows an EMPTY slice
 * of the page, which is exactly the "blank grey box" reported on 2026-07-28.
 * Cropping blind is worse than showing AMap's real chrome, so it's gone. */
const AMAP_CROP_PX = 0;

export default function DelegateLocationMap({ location, height = 200 }) {
  const { t } = useLang();
  const [tab, setTab] = useState("google");
  const apiKey = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;
  const amapKey = import.meta.env?.VITE_AMAP_KEY;
  const amapUrl = location ? `https://uri.amap.com/search?keyword=${encodeURIComponent(location)}` : "";

  /* Keyed AMap path (2026-07-28). With a Gaode web-service key the address is
   * geocoded to coordinates and drawn as a STATIC MAP IMAGE — no iframe, so
   * nothing can be blocked or mis-cropped, and it renders identically inside
   * mainland China where Google is unreachable. Fails soft: any error just
   * leaves `staticUrl` null and the keyless preview + "open in AMap" link
   * below take over. NOTE: written without a key to test against (a Gaode key
   * needs a mainland-China phone + real-name verification — see
   * README/THIRD_PARTY_SERVICES.md), so if the client supplies one, verify this
   * path once before relying on it. */
  const [staticUrl, setStaticUrl] = useState(null);
  useEffect(() => {
    if (!amapKey || !location) { setStaticUrl(null); return; }
    let alive = true;
    (async () => {
      try {
        const geo = await fetch(
          `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(location)}&key=${encodeURIComponent(amapKey)}`
        ).then((r) => r.json());
        const point = geo?.geocodes?.[0]?.location; // "lng,lat"
        if (!alive || !point) { setStaticUrl(null); return; }
        // Fixed generous size so the SAME image serves both the inline card and
        // the enlarged view (CSS scales it) — no refetch when the box resizes.
        setStaticUrl(
          `https://restapi.amap.com/v3/staticmap?location=${encodeURIComponent(point)}` +
          `&zoom=15&size=750*420&scale=2` +
          `&markers=mid,,A:${encodeURIComponent(point)}&key=${encodeURIComponent(amapKey)}`
        );
      } catch {
        if (alive) setStaticUrl(null); // offline / key rejected / referer blocked
      }
    })();
    return () => { alive = false; };
  }, [amapKey, location]);

  /* Enlarge (2026-07-28 — "for the amap, can you give me option to enlarge
   * it"). AMap's keyless preview is a MOBILE micro-site: at the card's ~200px
   * it's almost entirely search bar and app-download banner with barely any map
   * left, and its place-name search sometimes lands on the wrong POI (a real
   * example: "Emperor Qinshihuang's Mausoleum Site Museum" resolved to "Emperor
   * Coffee"), which you can only see and correct with room to work. Enlarging
   * gives it most of the viewport. Applies to the Google tab too — same value
   * for reading street detail. */
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (!location) return null;

  /* One renderer for both sizes, so the inline card and the enlarged overlay can
   * never drift apart. `h` is the map height in px. */
  function mapBody(h) {
    if (tab === "google") {
      return apiKey ? (
        <iframe
          title={`map-${location}`}
          src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(location)}`}
          width="100%"
          height={h}
          style={{ border: 0, display: "block" }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div className="muted" style={{ fontSize: 12, padding: "8px 0" }}>
          {t("Location:")} {location} — {t("set VITE_GOOGLE_MAPS_API_KEY in frontend/.env to show a map here.")}
        </div>
      );
    }
    if (staticUrl) {
      /* Keyed: a plain image, so nothing can block or crop it. */
      return (
        <img
          src={staticUrl}
          alt={`AMap ${location}`}
          // No border/radius of its own — the framed widget around it provides
          // both, and nesting them looked doubled up.
          style={{ width: "100%", height: h, objectFit: "cover", display: "block" }}
          onError={() => setStaticUrl(null)}
        />
      );
    }
    return (
      <div style={{ height: h, overflow: "hidden", position: "relative", background: "var(--surface-2)" }}>
        {/* Keyless preview of AMap's own public search page. It needs no API
            key, but it's a heavy JS site: outside mainland China it often has
            no data for the address and renders empty, and a cross-border load
            can simply be slow. So a readable fallback sits UNDERNEATH the
            iframe rather than leaving a blank grey box — if the map paints, it
            covers this; if it doesn't, the staff member still gets the address
            and a way out. */}
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, padding: 14, textAlign: "center" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{location}</div>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            {t("No AMap preview for this address — AMap has little data outside mainland China. Use the link below, or add an AMap key (see THIRD_PARTY_SERVICES.md).")}
          </div>
        </div>
        <iframe
          title={`amap-${location}`}
          src={amapUrl}
          width="100%"
          height={h + AMAP_CROP_PX}
          style={{ border: 0, display: "block", marginTop: -AMAP_CROP_PX, position: "relative" }}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div>
      {/* One framed widget instead of four stacked loose rows (2026-07-28 —
          "can you improve the uiux, it look abit messy"). Controls live in a
          header bar, the map sits inside, and the provider guidance moved to
          tooltips on the tabs so it isn't a standing paragraph above every map. */}
      <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", overflow: "hidden", background: "var(--surface-2)" }}>
        <div className="row between" style={{ padding: "6px 8px", gap: 8 }}>
          {/* Segmented provider switch — reads as one control, not two buttons. */}
          <div className="row" style={{ gap: 0, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 999, padding: 2 }}>
            {TABS.map((tb) => (
              <button key={tb.key} type="button" onClick={() => setTab(tb.key)}
                title={tb.key === "google"
                  ? t("Google Map works best for locations outside mainland China.")
                  : t("AMap works best for locations within mainland China — where Google Maps is blocked.")}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 999, cursor: "pointer", border: "none",
                  background: tab === tb.key ? "var(--scc-red-tint)" : "transparent",
                  color: tab === tb.key ? "var(--scc-red)" : "var(--ink-3)",
                }}>
                {t(tb.label)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setExpanded(true)} title={t("Enlarge map")} aria-label={t("Enlarge map")}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", flexShrink: 0,
              fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 999,
              background: "var(--surface)", color: "var(--ink-2)", border: "1px solid var(--line)",
            }}>
            <Maximize2 size={13} /> {t("Enlarge")}
          </button>
        </div>

        <div style={{ background: "var(--surface)", borderTop: "1px solid var(--line)" }}>
          {mapBody(height)}
        </div>

        {/* Footer only where it earns its space: AMap's link-out (which works
            with no account) matters, Google's doesn't need saying. */}
        {tab === "amap" && (
          <div className="row between" style={{ padding: "6px 10px", gap: 8, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 10.5 }}>
              {amapKey ? t("Using your AMap key.") : t("No account needed")}
            </span>
            <a href={amapUrl} target="_blank" rel="noreferrer"
              style={{ fontSize: 11.5, fontWeight: 600, color: "var(--scc-red)", flexShrink: 0 }}>
              {t("Open in AMap")} ↗
            </a>
          </div>
        )}
      </div>

      {/* ---- Enlarged overlay ------------------------------------------- */}
      {expanded && (
        <div
          // stopPropagation because this card is rendered INSIDE other modals
          // (the delegate profile / map / edit sheets) — without it the click
          // that closes this overlay could also close the modal underneath.
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div className="card" onClick={(e) => e.stopPropagation()}
            style={{ padding: 0, width: "min(1000px, 96vw)", maxHeight: "94vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div className="row between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{location}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{tab === "google" ? "Google Map" : "AMap"}</div>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                {/* Switch provider without leaving the enlarged view. */}
                {TABS.map((tb) => (
                  <button key={tb.key} type="button" onClick={() => setTab(tb.key)}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 999, cursor: "pointer",
                      background: tab === tb.key ? "var(--scc-red-tint)" : "var(--surface-2)",
                      color: tab === tb.key ? "var(--scc-red)" : "var(--ink-2)",
                      border: `1px solid ${tab === tb.key ? "var(--scc-red)" : "var(--line)"}`,
                    }}>
                    {t(tb.label)}
                  </button>
                ))}
                <button type="button" onClick={() => setExpanded(false)} aria-label={t("Close")}
                  style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4, cursor: "pointer" }}>
                  <X size={18} />
                </button>
              </div>
            </div>

            <div style={{ padding: 12, overflowY: "auto" }}>
              {/* Most of the viewport — enough for AMap's mobile layout to show
                  a usable map under its own chrome, and to search/correct a
                  wrong place-name match in place. */}
              {mapBody(Math.max(320, Math.round(window.innerHeight * 0.72)))}
            </div>

            {tab === "amap" && (
              <div className="row between" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)", gap: 10, flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {t("Searching by place name — if AMap lands on the wrong spot, search inside the map or open it in AMap.")}
                </span>
                <a href={amapUrl} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, fontWeight: 600, color: "var(--scc-red)", flexShrink: 0 }}>
                  {t("Open in AMap")} ↗
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
