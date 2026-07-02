/**
 * SQLite data layer for the MusterGo dashboard (via sql.js).
 *
 * WHY sql.js: it's a pure-WASM build of SQLite, so `npm install` needs no
 * native compilation or build tools — it works the same on Windows, macOS, and
 * Linux. The data lives in a real SQLite database file, `database.db`, next to
 * this module. Delete that file to reset to an empty database.
 *
 * Schema:
 *   trips     (one row — the active trip)
 *   coaches   (the four coaches — fixed structure)
 *   delegates (the CRUD data you create from the dashboard)
 *
 * The exported functions are identical to the old JSON version, so server.js
 * and the whole frontend are unchanged. The live-activity feed stays in memory
 * (it's a transient log, rebuilt each server run).
 *
 * Note: top-level `await` initialises the WASM engine before the module
 * finishes loading, so every function below is plain synchronous after import.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { PERM_KEYS, cleanPermissions } from "../permissions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB_PATH = path.join(__dirname, "database.db");
const LEGACY_DB = path.join(__dirname, "mustergo.db");     // old name — migrated once
const LEGACY_JSON = path.join(__dirname, "delegates.json"); // migrated once, if present

/* ---- Fixed structure used to seed the database -------------------------- */
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

/* ---- Engine + connection ------------------------------------------------ */
const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
const db = fs.existsSync(DB_PATH)
  ? new SQL.Database(fs.readFileSync(DB_PATH))
  : fs.existsSync(LEGACY_DB)
  ? new SQL.Database(fs.readFileSync(LEGACY_DB)) // one-time migration from mustergo.db
  : new SQL.Database();

function persist() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

/* ---- Small query helpers ------------------------------------------------ */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

/* ---- Schema + seed ------------------------------------------------------ */
db.run(`
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY, name TEXT, dateRange TEXT, dayOf INTEGER,
    totalDays INTEGER, lead TEXT, status TEXT, localTime TEXT, departsIn TEXT
  );
  CREATE TABLE IF NOT EXISTS coaches (
    id TEXT PRIMARY KEY, label TEXT, name TEXT, city TEXT, capacity INTEGER
  );
  CREATE TABLE IF NOT EXISTS delegates (
    id TEXT PRIMARY KEY, name TEXT, initials TEXT, coachId TEXT,
    status TEXT, vip INTEGER, lastSeen TEXT
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT,
    password TEXT, role TEXT, permissions TEXT, createdAt TEXT
  );
`);

// Migrate older account tables that predate the `permissions` column.
{
  const cols = all("PRAGMA table_info(accounts)").map((c) => c.name);
  if (!cols.includes("permissions")) {
    db.run("ALTER TABLE accounts ADD COLUMN permissions TEXT");
  }
  for (const a of all("SELECT id, role FROM accounts WHERE permissions IS NULL OR permissions = ''")) {
    db.run("UPDATE accounts SET permissions = ? WHERE id = ?", [
      JSON.stringify(defaultPermsForRole(a.role)),
      a.id,
    ]);
  }
}

// Seed the first "main" account (once) so there's always a way in.
if (!get("SELECT id FROM accounts LIMIT 1")) {
  const perms = defaultPermsForRole("main");
  db.run("INSERT INTO accounts VALUES (?,?,?,?,?,?,?)", [
    "u-1", "staff_194", "Staff 194", "password123!", "main", JSON.stringify(perms), new Date().toISOString(),
  ]);
}

// Seed the trip (once).
if (!get("SELECT id FROM trips LIMIT 1")) {
  db.run(
    "INSERT INTO trips VALUES (?,?,?,?,?,?,?,?,?)",
    [TRIP.id, TRIP.name, TRIP.dateRange, TRIP.dayOf, TRIP.totalDays, TRIP.lead, TRIP.status, TRIP.localTime, TRIP.departsIn]
  );
}

// Seed the coaches (once).
if (!get("SELECT id FROM coaches LIMIT 1")) {
  for (const c of COACHES) {
    db.run("INSERT INTO coaches VALUES (?,?,?,?,?)", [c.id, c.label, c.name, c.city, c.capacity]);
  }
}

// One-time migration: if the delegates table is empty but the old JSON file is
// still around, import those rows so you keep the records you already created.
if (!get("SELECT id FROM delegates LIMIT 1") && fs.existsSync(LEGACY_JSON)) {
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_JSON, "utf8"));
    for (const d of legacy) {
      db.run("INSERT INTO delegates VALUES (?,?,?,?,?,?,?)", [
        d.id, d.name, d.initials || initialsOf(d.name), d.coachId ?? null,
        d.status, d.vip ? 1 : 0, d.lastSeen ?? null,
      ]);
    }
  } catch { /* ignore a malformed legacy file */ }
}

persist();

/* ---- In-memory activity log --------------------------------------------- */
let ACTIVITY = [];

function logActivity(text, kind) {
  ACTIVITY.unshift({
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    via: "you",
    kind,
  });
  ACTIVITY = ACTIVITY.slice(0, 8);
}

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

function rowToDelegate(row) {
  return { ...row, vip: !!row.vip };
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

function nextId() {
  const row = get("SELECT COALESCE(MAX(CAST(SUBSTR(id, 3) AS INTEGER)), 0) AS m FROM delegates");
  return `d-${(row?.m || 0) + 1}`;
}

/* ---- CRUD --------------------------------------------------------------- */
export function listDelegates() {
  return all("SELECT * FROM delegates ORDER BY id").map(rowToDelegate);
}

export function createDelegate(input) {
  const d = normalize(input, nextId());
  db.run("INSERT INTO delegates VALUES (?,?,?,?,?,?,?)", [
    d.id, d.name, d.initials, d.coachId, d.status, d.vip ? 1 : 0, d.lastSeen,
  ]);
  logActivity(`${d.name} added`, d.status === "PRESENT" ? "checkin" : "reassign");
  persist();
  return d;
}

export function updateDelegate(id, patch) {
  const existing = get("SELECT * FROM delegates WHERE id = ?", [id]);
  if (!existing) return null;
  const merged = normalize({ ...rowToDelegate(existing), ...patch }, id);
  db.run(
    "UPDATE delegates SET name=?, initials=?, coachId=?, status=?, vip=?, lastSeen=? WHERE id=?",
    [merged.name, merged.initials, merged.coachId, merged.status, merged.vip ? 1 : 0, merged.lastSeen, id]
  );
  logActivity(`${merged.name} updated`, "reassign");
  persist();
  return merged;
}

export function deleteDelegate(id) {
  const existing = get("SELECT * FROM delegates WHERE id = ?", [id]);
  if (!existing) return false;
  db.run("DELETE FROM delegates WHERE id = ?", [id]);
  logActivity(`${existing.name} removed`, "exception");
  persist();
  return true;
}

/* ---- Derived views ------------------------------------------------------ */
export function getTrip() {
  return get("SELECT * FROM trips LIMIT 1") || TRIP;
}

export function getActivity() {
  return ACTIVITY;
}

export function getDashboard() {
  const d = listDelegates();
  const present = d.filter((x) => x.status === "PRESENT").length;
  const missing = d.filter((x) => x.status === "MISSING").length;
  const unassigned = d.filter((x) => x.status === "UNASSIGNED").length;

  const coaches = all("SELECT * FROM coaches ORDER BY id").map((c) => {
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
    trip: getTrip(),
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
  const coaches = all("SELECT * FROM coaches");
  return listDelegates()
    .filter((x) => x.status === "MISSING")
    .map((x) => {
      const coach = coaches.find((c) => c.id === x.coachId);
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
  return listDelegates();
}

/* ---- Bulk delete (for the dashboard "Delete all" button) ---------------- */
export function deleteAllDelegates() {
  const count = get("SELECT COUNT(*) AS c FROM delegates")?.c || 0;
  db.run("DELETE FROM delegates");
  if (count > 0) logActivity(`All delegates removed (${count})`, "exception");
  persist();
  return count;
}

/* ---- Accounts + permissions -------------------------------------------- *
 * Instead of a single vague role, each account carries a set of permissions
 * (tickboxes on the Account control page):
 *   - manageDelegates : add / edit / delete delegates (incl. delete all)
 *   - exportData      : download the attendance Excel report
 *   - manageAccounts  : access Account control (create/edit/delete accounts)
 * A short "role" label (main/admin/staff) is derived from the permissions just
 * for display (the sidebar account block). Passwords are plaintext for this
 * school demo; production would hash them (bcrypt).
 * ------------------------------------------------------------------------- */
function defaultPermsForRole(role) {
  if (role === "main") return { manageDelegates: true, exportData: true, manageAccounts: true };
  if (role === "admin") return { manageDelegates: true, exportData: true, manageAccounts: false };
  return { manageDelegates: true, exportData: false, manageAccounts: false }; // staff
}

function cleanPerms(input) {
  return cleanPermissions(input);
}

function roleFromPerms(p) {
  if (p.manageAccounts) return "main";
  if (p.manageDelegates || p.exportData) return "admin";
  return "staff";
}

/** Parsed permissions for an account row (falls back to role defaults). */
export function accountPermissions(row) {
  if (!row) return cleanPerms({});
  try {
    if (row.permissions) return cleanPerms(JSON.parse(row.permissions));
  } catch { /* fall through */ }
  return defaultPermsForRole(row.role);
}

export function accountCan(row, perm) {
  return !!accountPermissions(row)[perm];
}

function countManagers() {
  return all("SELECT * FROM accounts").filter((a) => accountPermissions(a).manageAccounts).length;
}

function accountPublic(row) {
  if (!row) return null;
  const { password, permissions, ...rest } = row; // never expose the password / raw JSON
  return { ...rest, permissions: accountPermissions(row) };
}

function nextAccountId() {
  const row = get("SELECT COALESCE(MAX(CAST(SUBSTR(id, 3) AS INTEGER)), 0) AS m FROM accounts");
  return `u-${(row?.m || 0) + 1}`;
}

/** Full row incl. password — used only for login / auth checks. */
export function getAccountByUsername(username) {
  return get("SELECT * FROM accounts WHERE username = ?", [String(username || "").trim()]);
}

export function listAccounts() {
  return all("SELECT * FROM accounts ORDER BY id").map(accountPublic);
}

export function createAccount(input) {
  const username = String(input.username || "").trim();
  const password = String(input.password || "");
  const name = String(input.name || "").trim() || username;
  const perms = cleanPerms(input.permissions);
  const role = roleFromPerms(perms);

  if (!username) return { error: "USERNAME_REQUIRED" };
  if (!password) return { error: "PASSWORD_REQUIRED" };
  if (getAccountByUsername(username)) return { error: "USERNAME_TAKEN" };

  const id = nextAccountId();
  db.run("INSERT INTO accounts VALUES (?,?,?,?,?,?,?)", [
    id, username, name, password, role, JSON.stringify(perms), new Date().toISOString(),
  ]);
  persist();
  return { account: accountPublic(get("SELECT * FROM accounts WHERE id = ?", [id])) };
}

export function updateAccount(id, patch) {
  const existing = get("SELECT * FROM accounts WHERE id = ?", [id]);
  if (!existing) return { error: "NOT_FOUND" };

  const username = patch.username !== undefined ? String(patch.username).trim() : existing.username;
  const name = patch.name !== undefined ? String(patch.name).trim() || username : existing.name;
  const password = patch.password ? String(patch.password) : existing.password;
  const perms = patch.permissions ? cleanPerms(patch.permissions) : accountPermissions(existing);
  const role = roleFromPerms(perms);

  if (!username) return { error: "USERNAME_REQUIRED" };
  const clash = getAccountByUsername(username);
  if (clash && clash.id !== id) return { error: "USERNAME_TAKEN" };

  // Don't let the last account that can manage accounts lose that permission.
  if (accountPermissions(existing).manageAccounts && !perms.manageAccounts && countManagers() <= 1) {
    return { error: "LAST_MAIN" };
  }

  db.run("UPDATE accounts SET username=?, name=?, password=?, role=?, permissions=? WHERE id=?", [
    username, name, password, role, JSON.stringify(perms), id,
  ]);
  persist();
  return { account: accountPublic(get("SELECT * FROM accounts WHERE id = ?", [id])) };
}

export function deleteAccount(id) {
  const existing = get("SELECT * FROM accounts WHERE id = ?", [id]);
  if (!existing) return { error: "NOT_FOUND" };

  if (accountPermissions(existing).manageAccounts && countManagers() <= 1) {
    return { error: "LAST_MAIN" };
  }

  db.run("DELETE FROM accounts WHERE id = ?", [id]);
  persist();
  return { deleted: true };
}
