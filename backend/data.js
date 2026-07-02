/**
 * In-memory + JSON-file store for the MusterGo dashboard.
 *
 * WHAT CHANGED (CRUD build):
 *   - No seeded delegates. The app starts EMPTY so you can create / read /
 *     update / delete your own records.
 *   - Delegates are persisted to `delegates.json` next to this file, so your
 *     data survives a server restart. Delete that file to reset to empty.
 *   - The live-activity feed is no longer hardcoded — it logs each CRUD action.
 *   - COACHES and TRIP stay as fixed structure (they're the containers the
 *     dashboard renders; coach management is Desmond's screen). Everything the
 *     dashboard shows (KPIs, coach bars, missing list) is computed from the
 *     delegates you create.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, "delegates.json");

/* ---- Fixed structure (not CRUD data) ------------------------------------ */
export const TRIP = {
  id: "t-1",
  name: "Beijing study mission",
  dateRange: "12–16 Aug 2026",
  dayOf: 3,
  totalDays: 5,
  lead: "Wei Ming Tan",
  status: "In progress",
  localTime: "14:26",
  departsIn: "04:53",
};

export const COACHES = [
  { id: "c1", label: "C1", name: "Coach 1", city: "Beijing",  capacity: 40 },
  { id: "c2", label: "C2", name: "Coach 2", city: "Shanghai", capacity: 40 },
  { id: "c3", label: "C3", name: "Coach 3", city: "Hangzhou", capacity: 40 },
  { id: "c4", label: "C4", name: "Coach 4", city: "Suzhou",   capacity: 40 },
];

/* ---- Persistence -------------------------------------------------------- */
function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return []; // no file yet → start empty
  }
}

function saveStore() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DELEGATES, null, 2));
  } catch (e) {
    console.error("Could not write delegates.json:", e.message);
  }
}

let DELEGATES = loadStore();
let ACTIVITY = []; // ephemeral log, rebuilt each server run
let seq = DELEGATES.reduce(
  (max, d) => Math.max(max, parseInt(String(d.id).replace(/\D/g, ""), 10) || 0),
  0
);

/* ---- Helpers ------------------------------------------------------------ */
function initialsOf(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function logActivity(text, kind) {
  ACTIVITY.unshift({
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    via: "you",
    kind, // checkin | reassign | exception
  });
  ACTIVITY = ACTIVITY.slice(0, 8); // keep it recent
}

function normalize(input, id) {
  const status = ["PRESENT", "MISSING", "UNASSIGNED"].includes(input.status)
    ? input.status
    : "UNASSIGNED";
  return {
    id,
    name: (input.name || "").trim() || "Unnamed delegate",
    initials: initialsOf(input.name),
    coachId: status === "UNASSIGNED" ? null : input.coachId || null,
    status,
    vip: !!input.vip,
    lastSeen: (input.lastSeen || "").trim() || null,
  };
}

/* ---- CRUD --------------------------------------------------------------- */
export function listDelegates() {
  return DELEGATES;
}

export function createDelegate(input) {
  const d = normalize(input, `d-${++seq}`);
  DELEGATES.push(d);
  logActivity(`${d.name} added`, d.status === "PRESENT" ? "checkin" : "reassign");
  saveStore();
  return d;
}

export function updateDelegate(id, patch) {
  const i = DELEGATES.findIndex((x) => x.id === id);
  if (i === -1) return null;
  const merged = normalize({ ...DELEGATES[i], ...patch }, id);
  DELEGATES[i] = merged;
  logActivity(`${merged.name} updated`, "reassign");
  saveStore();
  return merged;
}

export function deleteDelegate(id) {
  const i = DELEGATES.findIndex((x) => x.id === id);
  if (i === -1) return false;
  const [removed] = DELEGATES.splice(i, 1);
  logActivity(`${removed.name} removed`, "exception");
  saveStore();
  return true;
}

/* ---- Derived views for the dashboard ------------------------------------ */
export function getTrip() {
  return TRIP;
}

export function getActivity() {
  return ACTIVITY;
}

export function getDashboard() {
  const d = DELEGATES;
  const present = d.filter((x) => x.status === "PRESENT").length;
  const missing = d.filter((x) => x.status === "MISSING").length;
  const unassigned = d.filter((x) => x.status === "UNASSIGNED").length;

  const coaches = COACHES.map((c) => {
    const assigned = d.filter((x) => x.coachId === c.id);
    return {
      id: c.id,
      label: c.label,
      name: c.name,
      city: c.city,
      capacity: c.capacity,
      boarded: assigned.filter((x) => x.status === "PRESENT").length,
      missing: assigned.filter((x) => x.status === "MISSING").length,
      total: assigned.length,
    };
  });

  return {
    trip: TRIP,
    kpis: {
      total: d.length,
      present,
      missing,
      unassigned,
      openExceptions: 0,
      criticalExceptions: 0,
      normalExceptions: 0,
      presentDelta: ACTIVITY.filter((a) => a.kind === "checkin").length,
    },
    coaches,
    activity: ACTIVITY,
  };
}

export function getMissing() {
  return DELEGATES.filter((x) => x.status === "MISSING").map((x) => {
    const coach = COACHES.find((c) => c.id === x.coachId);
    return {
      id: x.id,
      name: x.name,
      initials: x.initials,
      coach: coach ? `${coach.name} · ${coach.city}` : "Unassigned",
      vip: x.vip,
      lastSeen: x.lastSeen,
    };
  });
}

export function getDelegates() {
  return DELEGATES;
}
