/* =============================================================================
 *  OWNED BY:  Vance — DocuSync AI (Document Parsing)
 * ============================================================================= */
/**
 * Document-parsing bridge for the Onboarding page (Use Case 1).
 *
 * The PDF/image is uploaded to OUR backend, which calls the Anthropic Claude
 * API **server-side** — the API key never touches the browser. Claude reads the
 * document and returns structured delegate rows, each with a confidence score.
 * Rows below the review threshold are flagged so the admin can fix them (the
 * "blurry document" alternative flow).
 *
 * DEMO SWITCH
 * -----------
 * Set USE_SIMULATION = true to run the page with built-in dummy rows and no
 * backend/API key (handy for UI work or a no-network demo). Set it to false —
 * the default now — to hit the real backend.
 */

import { apiPost, apiGet, getToken } from "../api.js";

const USE_SIMULATION = false; // real backend by default; flip to true for offline UI demo

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

/* ---- Demo data (only used when USE_SIMULATION = true) -------------------- */
const SIMULATED_ROWS = [
  { fullName: "Lim Wei Jie",   passportNumber: "S1234567A", nationality: "Singapore", passportExpiry: "2029-08-12", confidence: 0.99 },
  { fullName: "Chen Hao Ming", passportNumber: "E2233445C", nationality: "China",     passportExpiry: null,         confidence: 0.62 },
  { fullName: "Tan Siew Ling", passportNumber: "S9876543B", nationality: "Singapore", passportExpiry: "2031-03-04", confidence: 0.92 },
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Parse ONE uploaded file into delegate rows.
 * @param {File} file
 * @returns {Promise<{rows: Array, totalCount: number}>}
 */
export async function parseDocument(file) {
  if (USE_SIMULATION) {
    await wait(1200 + Math.random() * 900);
    const rows = SIMULATED_ROWS.map((r, i) => ({ id: `${file?.name || "file"}-${i}`, needsReview: r.confidence < 0.85, ...r }));
    return { rows, totalCount: rows.length };
  }

  // Send the raw file bytes. We can't use apiPost() here because it JSON- or
  // FormData-encodes the body; the parse route reads the raw buffer instead.
  const type = file.type || "application/pdf";
  const token = getToken();
  const res = await fetch(
    `${BASE_URL}/documents/parse?name=${encodeURIComponent(file.name || "file")}&type=${encodeURIComponent(type)}`,
    {
      method: "POST",
      headers: { "Content-Type": type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: file,
    }
  );

  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return { rows: data.rows, totalCount: data.totalCount ?? data.rows.length };
}

/**
 * Commit reviewed rows into the SHARED delegate list (writes through the
 * backend, which uses JQ's createDelegate() so the rows match the whole app).
 * @param {string} tripId
 * @param {Array} rows
 * @returns {Promise<{added:number}>}
 */
export async function confirmDelegates(tripId, rows) {
  const clean = rows.map((r) => ({
    fullName: r.fullName,
    role: r.role || null,
    company: r.company || null,
    industry: r.industry || null,
    email: r.email || null,
    phone: r.phone || null,
    website: r.website || null,
    passportNumber: r.passportNumber || null,
    nationality: r.nationality || null,
    passportExpiry: r.passportExpiry || null,
    vip: !!r.vip,
    coachId: r.coachId || null,
  }));
  return apiPost(`/trips/${tripId}/onboarding/confirm`, { rows: clean });
}

/* ---- Async parsing (background job) -------------------------------------- *
 * Starts a server-side parse job and returns its id. The document is read
 * page-by-page in the background, so the page can be left and re-attached.
 */
export async function startParseJob(file) {
  const type = file.type || "application/pdf";
  const token = getToken();
  const res = await fetch(
    `${BASE_URL}/documents/parse-async?name=${encodeURIComponent(file.name || "file")}&type=${encodeURIComponent(type)}`,
    {
      method: "POST",
      headers: { "Content-Type": type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: file,
    }
  );
  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json(); // { jobId }
}

export function getParseJob(jobId) {
  return apiGet(`/documents/parse-async/${jobId}`); // { status, done, total, method, rows, error }
}

export function getOnboardingContext(tripId) {
  const qs = tripId ? `?tripId=${encodeURIComponent(tripId)}` : "";
  return apiGet(`/onboarding/context${qs}`); // { existingNames, coaches }
}

/* Live "trip pulse" for the page headers — trip context, attendance KPIs, and
 * the top ranked risks. Cheap (reuses the assistant's cached snapshot).
 * tripId (2026-07-31, multi-trip support) scopes it to the assistant's
 * currently-selected trip instead of always Beijing. */
export function getTripPulse(tripId) {
  const qs = tripId ? `?tripId=${encodeURIComponent(tripId)}` : "";
  return apiGet(`/assistant/pulse${qs}`); // { trip, kpis, risk, asOf }
}

/* Real trips for the onboarding "Assign to trip" picker. Reads the shared
 * all-trips list so the option values are the ACTUAL trip ids in the database.
 * The old hardcoded t-1/t-2/t-3 list only matched the seed trip — the other two
 * matched no row and silently orphaned every delegate onboarded to them. */
// Restricted to "In progress" trips (2026-07-24) — a Planning/Completed trip
// has no live delegates to onboard/print passes for. Same restriction
// MobileHomePage.jsx already applies to its own trip picker. Both callers
// (OnboardingPage.jsx, BoardingPassesView.jsx) already reset their selection
// if the previously-picked trip id no longer appears in this list, so a trip
// that finishes mid-session falls back cleanly instead of staying selected
// with no rows to show.
export async function getTrips() {
  const data = await apiGet("/all-trips"); // { trips: [{ id, name, dateRange, status, ... }] }
  const trips = Array.isArray(data?.trips) ? data.trips : [];
  return trips.filter((t) => t.status === "In progress");
}

/* ---- Boarding passes (QR) + check-in ------------------------------------ *
 * qrCheckin() is the badge contract consumed by the on-site scanner
 * (Jayden's QRScannerPanel, mounted in the shared QR check-in screen) — it
 * resolves a scanned `qr_code` and boards the delegate. Do not remove.
 */
export function getBadges(tripId) {
  return apiGet(`/onboarding/badges?tripId=${encodeURIComponent(tripId || "")}`); // { delegates, coaches, total, present }
}

export function qrCheckin({ code, tripId, coachId }) {
  return apiPost("/onboarding/checkin", { code, tripId, coachId }); // { ok, alreadyBoarded, delegate, total, present }
}

/* Link (or clear) a delegate's EXTERNAL physical pass code (Feature 4b). Pass an
 * empty string to unlink. Check-in then resolves EITHER this or our qr_code. */
export function linkPhysicalBadge(delegateId, code) {
  return apiPost(`/onboarding/delegates/${delegateId}/badge`, { code }); // { ok, id, external_badge_code }
}

/* Email a delegate their branded boarding pass. `qrDataUrl` is the client-rendered
 * QR-with-logo PNG (embedded inline in the email). Returns { ok, to }. */
export function emailPass(delegateId, qrDataUrl) {
  return apiPost(`/onboarding/delegates/${delegateId}/email-pass`, { qrDataUrl });
}

/* ---- CSV export (opens in Excel) ---------------------------------------- */
const CSV_COLUMNS = [
  ["fullName", "Name"], ["role", "Role"], ["company", "Company"], ["industry", "Industry"],
  ["email", "Email"], ["phone", "Phone"], ["website", "Website"],
  ["passportNumber", "Passport"], ["nationality", "Nationality"], ["passportExpiry", "Expiry"],
  ["confidence", "Confidence"],
];

export function exportRowsCsv(rows, filename = "delegates.csv") {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = CSV_COLUMNS.map(([, label]) => label).join(",");
  const lines = rows.map((r) => CSV_COLUMNS.map(([key]) => esc(r[key])).join(","));
  const csv = [header, ...lines].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }); // BOM so Excel reads UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
