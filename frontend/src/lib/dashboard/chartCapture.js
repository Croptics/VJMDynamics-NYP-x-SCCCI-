/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/**
 * Turns the Analytics panel's live charts into PNGs for the Excel export's
 * chart sheet (replacing per-chart CSVs of raw numbers, which the recipient had
 * to rebuild by hand).
 *
 * Each chart card registers itself while mounted, handing over a getter for its
 * DOM node plus its legend series. captureChartPng() then composes on a canvas:
 *
 *      [ chart title       ]   <- drawn here, not scraped from the DOM
 *      [ the chart's <svg>  ]   <- serialised and drawn as an image
 *      [ ■ series  ■ series ]  <- drawn here too
 *
 * WHY composed rather than a card screenshot: recharts renders its Legend as
 * HTML in a sibling <div>, NOT inside the <svg>, so serialising the SVG alone
 * silently loses every legend — the only thing naming donut slices. Redrawing
 * title + legend keeps this dependency-free (no html2canvas).
 *
 * Background is always opaque WHITE regardless of theme — these land in Excel
 * and slides, which assume light. Recharts' axis/tick greys stay legible and
 * AnalyticsPanel's COLORS are already theme-independent.
 */

// id -> { id, label, order, getEl, legend }
const registry = new Map();
const listeners = new Set();

// listCharts() MUST return a stable array reference between changes:
// ExportModal's useSyncExternalStore throws "getSnapshot should be cached" /
// spins forever on a fresh array per call. Invalidated only in notify().
let snapshot = [];

function rebuildSnapshot() {
  snapshot = [...registry.values()]
    .filter((c) => !c.empty)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(({ id, label }) => ({ id, label }));
}

function notify() {
  rebuildSnapshot();
  for (const fn of listeners) {
    try { fn(); } catch { /* a broken subscriber must not break the others */ }
  }
}

/**
 * Called by a chart card on mount (and whenever its legend changes).
 * @param {object}   entry
 * @param {string}   entry.id     stable key, also the worksheet image order key
 * @param {string}   entry.label  human title, drawn onto the image
 * @param {number}   entry.order  sort order in the export picker
 * @param {Function} entry.getEl  () => the element CONTAINING the chart's <svg>
 * @param {Array}    entry.legend [{ label, color }] — drawn under the chart
 * @param {boolean}  entry.empty  true when the chart has no data to show
 */
export function registerChart(entry) {
  registry.set(entry.id, entry);
  notify();
}

export function unregisterChart(id) {
  if (registry.delete(id)) notify();
}

/** Charts currently on screen and capturable, in display order. Stable
 *  reference between changes — see `snapshot` above. */
export function listCharts() {
  return snapshot;
}

export function subscribeCharts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const FONT_STACK = '600 15px "Segoe UI", system-ui, -apple-system, sans-serif';
const LEGEND_FONT = '13px "Segoe UI", system-ui, -apple-system, sans-serif';
const PAD = 16;
const TITLE_H = 30;
const LEGEND_H = 26;
// 2x so it stays sharp when Excel/PowerPoint scales it up, and on high-DPI.
const SCALE = 2;

/**
 * @returns {Promise<{id, label, dataUrl, width, height} | null>}
 *          null when the chart isn't on screen or its SVG can't be read —
 *          callers skip it rather than embedding a blank image.
 */
export async function captureChartPng(id) {
  const entry = registry.get(id);
  const host = entry?.getEl?.();
  const svg = host?.querySelector?.("svg");
  if (!svg) return null;

  const box = svg.getBoundingClientRect();
  const chartW = Math.max(1, Math.round(box.width));
  const chartH = Math.max(1, Math.round(box.height));
  const legend = Array.isArray(entry.legend) ? entry.legend.filter((l) => l && l.label) : [];

  // Clone so the on-screen chart isn't mutated. Explicit width/height AND the
  // namespace are both required or the serialised SVG won't load as an <img>.
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(chartW));
  clone.setAttribute("height", String(chartH));

  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    new XMLSerializer().serializeToString(clone)
  )}`;

  let img;
  try {
    img = await loadImage(svgUrl);
  } catch {
    return null; // unserialisable SVG — skip this chart, don't fail the export
  }

  const totalW = chartW + PAD * 2;
  const totalH = TITLE_H + chartH + (legend.length ? LEGEND_H : 0) + PAD * 2;

  const canvas = document.createElement("canvas");
  canvas.width = totalW * SCALE;
  canvas.height = totalH * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, totalH);

  ctx.fillStyle = "#111827";
  ctx.font = FONT_STACK;
  ctx.textBaseline = "middle";
  ctx.fillText(entry.label || "", PAD, PAD + TITLE_H / 2 - 4);

  ctx.drawImage(img, PAD, PAD + TITLE_H, chartW, chartH);

  if (legend.length) {
    let x = PAD;
    const y = PAD + TITLE_H + chartH + LEGEND_H / 2;
    ctx.font = LEGEND_FONT;
    for (const item of legend) {
      ctx.fillStyle = item.color || "#9ca3af";
      ctx.fillRect(x, y - 5, 10, 10);
      x += 15;
      ctx.fillStyle = "#374151";
      ctx.fillText(item.label, x, y);
      x += ctx.measureText(item.label).width + 18;
    }
  }

  return {
    id,
    label: entry.label || id,
    dataUrl: canvas.toDataURL("image/png"),
    width: totalW,
    height: totalH,
  };
}

/** Skips any that fail. Sequential on purpose — these are big canvases and
 *  firing six at once on a low-end laptop thrashes. */
export async function captureCharts(ids) {
  const out = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const shot = await captureChartPng(id);
    if (shot) out.push(shot);
  }
  return out;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
