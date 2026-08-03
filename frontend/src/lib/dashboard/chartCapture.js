/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/**
 * Turns the Analytics panel's live charts into PNGs so the Excel export can
 * embed them on their own sheet (2026-07-29 — "instead of standalone, can you
 * also make it display in image instead of number on new tab in csv").
 *
 * Replaces the old per-chart "CSV" buttons, which produced a file of raw
 * numbers — useless for the stated purpose (a report or a presentation deck),
 * since whoever received it had to rebuild the chart themselves.
 *
 * HOW: each chart card registers itself here while it's mounted, handing over
 * a getter for its DOM node plus its legend series. `captureChartPng()` then
 * composes a PNG on a canvas:
 *
 *      [ chart title      ]   <- drawn here, not scraped from the DOM
 *      [ the chart's <svg> ]   <- serialised and drawn as an image
 *      [ ■ series  ■ series ]  <- drawn here too
 *
 * WHY compose it rather than screenshot the card: recharts renders its Legend
 * as **HTML** in a sibling `<div>`, NOT inside the `<svg>` — so serialising
 * the SVG alone silently loses every legend, which on the donut charts is the
 * only thing naming the slices. Rebuilding title + legend on the canvas keeps
 * this dependency-free (no html2canvas) AND produces a cleaner, self-contained
 * image than a screenshot of the card chrome would.
 *
 * Everything is drawn on an opaque WHITE background regardless of the app's
 * theme: these end up in an Excel sheet and in slides, both of which assume a
 * light background. Recharts' default axis/tick colours are dark greys, so
 * they stay legible; the series colours come from COLORS in AnalyticsPanel and
 * are theme-independent already.
 */

// id -> { id, label, order, getEl, legend }
const registry = new Map();
const listeners = new Set();

// Cached so `listCharts()` returns a STABLE array reference between changes.
// Required by useSyncExternalStore in ExportModal: returning a fresh array on
// every call makes React think the store changed on every render and it throws
// "getSnapshot should be cached" / spins forever. Invalidated only in notify().
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
// 2x so the image still looks sharp when Excel/PowerPoint scales it up, and on
// a high-DPI screen when someone views the sheet.
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

  // Clone so nothing about the on-screen chart is mutated, and stamp explicit
  // width/height + the SVG namespace — a serialised SVG without both fails to
  // load as an <img> in every browser.
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

/** Capture several, skipping any that fail. Sequential on purpose — these are
 *  big canvases and firing six at once on a low-end laptop just thrashes. */
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
