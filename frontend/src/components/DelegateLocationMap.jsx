/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Delegate widgets
 * ============================================================================= */
import { useState } from "react";
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

/* AMap's uri.amap.com/search page is a full mobile micro-site (search bar,
 * category shortcuts, an app-download QR panel) — it's a cross-origin
 * iframe, so we can't reach into its DOM/CSS to hide those pieces directly.
 * This crops them out instead: the iframe is rendered TALLER than the
 * visible box and shifted up by AMAP_CHROME_CROP_PX, while the wrapping div
 * clips both the (now off-screen-above) top chrome and the (pushed-past-
 * bottom) QR panel via overflow:hidden. The crop amount is an ESTIMATE from
 * a screenshot, not measured live (no browser available while building
 * this) — nudge it up/down if the search bar/icons still peek through, or if
 * too much of the actual map gets cropped off the top.
 */
const AMAP_CHROME_CROP_PX = 140;

export default function DelegateLocationMap({ location, height = 200 }) {
  const { t } = useLang();
  const [tab, setTab] = useState("google");
  if (!location) return null;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const amapUrl = `https://uri.amap.com/search?keyword=${encodeURIComponent(location)}`;

  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        {TABS.map((tb) => (
          <button key={tb.key} type="button" onClick={() => setTab(tb.key)}
            style={{
              fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 999, cursor: "pointer",
              background: tab === tb.key ? "var(--scc-red-tint)" : "var(--surface-2)",
              color: tab === tb.key ? "var(--scc-red)" : "var(--ink-2)",
              border: `1px solid ${tab === tb.key ? "var(--scc-red)" : "var(--line)"}`,
            }}>
            {t(tb.label)}
          </button>
        ))}
      </div>

      {tab === "google" ? (
        apiKey ? (
          <div>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
              {t("Google Map works best for locations outside mainland China.")}
            </div>
            <iframe
              title={`map-${location}`}
              src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(location)}`}
              width="100%"
              height={height}
              style={{ border: 0, borderRadius: "var(--r-sm)" }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12, padding: "8px 0" }}>
            {t("Location:")} {location} — {t("set VITE_GOOGLE_MAPS_API_KEY in frontend/.env to show a map here.")}
          </div>
        )
      ) : (
        <div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
            {t("AMap works best for locations within mainland China.")}
          </div>
          <div style={{ height, overflow: "hidden", borderRadius: "var(--r-sm)", border: "1px solid var(--line)", position: "relative" }}>
            <iframe
              title={`amap-${location}`}
              src={amapUrl}
              width="100%"
              height={height + AMAP_CHROME_CROP_PX}
              style={{ border: 0, display: "block", marginTop: -AMAP_CHROME_CROP_PX }}
              loading="lazy"
            />
          </div>
          <a href={amapUrl} target="_blank" rel="noreferrer"
            className="muted" style={{ fontSize: 11.5, display: "block", marginTop: 6 }}>
            {t("If the map doesn't load, open in AMap")} ↗
          </a>
        </div>
      )}
    </div>
  );
}
