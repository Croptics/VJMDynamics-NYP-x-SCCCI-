/**
 * MusterGo backend — Express API for the SCCCI admin dashboard.
 *
 * Run:
 *   npm install
 *   npm run dev        # http://localhost:4000
 *
 * The Vite dev server proxies /api -> here (see Frontend/vite.config.js), so the
 * React app just calls fetch("/api/...") with no CORS or origin config needed.
 */

import express from "express";
import cors from "cors";
import ExcelJS from "exceljs";
import {
  getTrip,
  getDashboard,
  getMissing,
  getDelegates,
  listDelegates,
  createDelegate,
  updateDelegate,
  deleteDelegate,
  deleteAllDelegates,
  getAccountByUsername,
  accountPermissions,
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from "./data.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${req.url}`);
  next();
});

/* ---- Health ------------------------------------------------------------- */
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "mustergo-backend" }));

/* ---- Auth --------------------------------------------------------------- *
 * Login validates against the `accounts` table (see data.js). Accounts are
 * managed by "main" users on the Account control page. The seeded first login
 * is staff_194 / password123! (role: main).
 *
 * NOTE (production, not this demo): passwords are stored in plaintext and the
 * token is a simple base64 of the username. A real app would hash passwords
 * (bcrypt) and issue a signed JWT.
 * ------------------------------------------------------------------------- */
function makeToken(username) {
  return `demo.${Buffer.from(String(username)).toString("base64")}.token`;
}

/** Resolve the calling account from the Authorization: Bearer token. */
function accountFromReq(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length < 2) return null;
  let username;
  try {
    username = Buffer.from(parts[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  return getAccountByUsername(username) || null;
}

/** Gate a route on a specific permission. */
function requirePermission(perm) {
  return (req, res, next) => {
    const acc = accountFromReq(req);
    if (!acc) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Please sign in again." });
    if (!accountPermissions(acc)[perm]) {
      return res.status(403).json({ error: "FORBIDDEN", message: "You don't have permission for that action." });
    }
    req.account = acc;
    next();
  };
}

app.post("/api/auth/login", (req, res) => {
  const { staffId, password } = req.body || {};

  if (!staffId || !password) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "Staff ID and password are required." });
  }

  const acc = getAccountByUsername(staffId);
  if (!acc || acc.password !== password) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Incorrect Staff ID or password." });
  }

  res.json({
    token: makeToken(acc.username),
    role: acc.role,
    name: acc.name,
    username: acc.username,
    permissions: accountPermissions(acc),
  });
});

/* ---- Accounts (requires manageAccounts) --------------------------------- */
app.get("/api/accounts", requirePermission("manageAccounts"), (_req, res) => res.json({ accounts: listAccounts() }));

app.post("/api/accounts", requirePermission("manageAccounts"), (req, res) => {
  const result = createAccount(req.body || {});
  if (result.error) return res.status(accountErrStatus(result.error)).json(result);
  res.status(201).json(result.account);
});

app.patch("/api/accounts/:id", requirePermission("manageAccounts"), (req, res) => {
  const result = updateAccount(req.params.id, req.body || {});
  if (result.error) return res.status(accountErrStatus(result.error)).json(result);
  // If you edited your OWN account, hand back a fresh token for the (possibly
  // new) username so the client can keep working without re-logging in.
  const isSelf = req.account && req.account.id === req.params.id;
  res.json({
    account: result.account,
    self: !!isSelf,
    token: isSelf ? makeToken(result.account.username) : undefined,
  });
});

app.delete("/api/accounts/:id", requirePermission("manageAccounts"), (req, res) => {
  const result = deleteAccount(req.params.id);
  if (result.error) return res.status(accountErrStatus(result.error)).json(result);
  res.json(result);
});

function accountErrStatus(code) {
  if (code === "NOT_FOUND") return 404;
  if (code === "USERNAME_TAKEN") return 409;
  if (code === "LAST_MAIN") return 409;
  return 400; // USERNAME_REQUIRED / PASSWORD_REQUIRED
}

/* ---- Trips -------------------------------------------------------------- */
app.get("/api/trips", (_req, res) => res.json([getTrip()]));
app.get("/api/trips/:id", (_req, res) => res.json(getTrip()));

/* ---- Dashboard read views ----------------------------------------------- */
app.get("/api/trips/:id/dashboard", (_req, res) => res.json(getDashboard()));
app.get("/api/trips/:id/missing", (_req, res) => res.json({ missing: getMissing() }));

/* ---- Delegate CRUD ------------------------------------------------------ */
app.get("/api/trips/:id/delegates", (_req, res) => res.json({ delegates: listDelegates() }));

// DELETE all delegates (dashboard "Delete all" button)
app.delete("/api/trips/:id/delegates", requirePermission("manageDelegates"), (_req, res) => {
  const deleted = deleteAllDelegates();
  res.json({ deleted });
});

app.post("/api/trips/:id/delegates", requirePermission("manageDelegates"), (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.name.trim()) {
    return res.status(400).json({ error: "NAME_REQUIRED", message: "A name is required." });
  }
  const delegate = createDelegate(body);
  res.status(201).json(delegate);
});

app.patch("/api/delegates/:id", requirePermission("manageDelegates"), (req, res) => {
  const updated = updateDelegate(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(updated);
});

app.delete("/api/delegates/:id", requirePermission("manageDelegates"), (req, res) => {
  const ok = deleteDelegate(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ deleted: true });
});

/* ---- Excel export ------------------------------------------------------- */
app.get("/api/trips/:id/export", async (_req, res) => {
  const trip = getTrip();
  const delegates = getDelegates();

  const wb = new ExcelJS.Workbook();
  wb.creator = "MusterGo";
  wb.created = new Date();

  const ws = wb.addWorksheet("Attendance");
  ws.mergeCells("A1:E1");
  ws.getCell("A1").value = `${trip.name} — Attendance Report`;
  ws.getCell("A1").font = { size: 14, bold: true };
  ws.mergeCells("A2:E2");
  ws.getCell("A2").value = `${trip.dateRange} · Day ${trip.dayOf} of ${trip.totalDays} · Lead: ${trip.lead}`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } };

  ws.addRow([]);
  ws.addRow(["#", "Name", "Coach", "Status", "Last seen"]);
  const head = ws.getRow(4);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE1232A" } };
    cell.alignment = { vertical: "middle" };
  });

  const coachName = (id) => {
    const map = { c1: "Coach 1 · Beijing", c2: "Coach 2 · Shanghai", c3: "Coach 3 · Hangzhou", c4: "Coach 4 · Suzhou" };
    return map[id] || "Unassigned";
  };

  delegates.forEach((d, i) => {
    ws.addRow([i + 1, d.name, coachName(d.coachId), d.status, d.lastSeen || "—"]);
  });

  ws.columns = [{ width: 5 }, { width: 22 }, { width: 20 }, { width: 14 }, { width: 24 }];

  const fileName = `attendance_${trip.name.replace(/\s+/g, "_").toLowerCase()}_day${trip.dayOf}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  await wb.xlsx.write(res);
  res.end();
});

/* =============================================================================
 *  TEAMMATE ZONE — add your OWN routes below this line.
 *
 *  Everything ABOVE is JQ's base (auth, dashboard, delegates, accounts). Please
 *  don't edit it. To add your feature's endpoints:
 *    1. Create  backend/routes/<yourname>.js  exporting an Express router, e.g.
 *         import { Router } from "express";
 *         const router = Router();
 *         router.get("/api/trips", (req, res) => res.json({ trips: [] }));
 *         export default router;
 *    2. Import and mount it here (one line each), e.g.
 *         import tripsRouter from "./routes/trips.js";
 *         app.use(tripsRouter);
 *  Keep all your changes between this banner and the Fallback below.
 * ============================================================================= */

// import tripsRouter from "./routes/trips.js";
// app.use(tripsRouter);

/* ---- Fallback ----------------------------------------------------------- */
app.use((req, res) => res.status(404).json({ error: "NOT_FOUND", path: req.originalUrl }));

app.listen(PORT, () => {
  console.log(`\n  MusterGo backend running -> http://localhost:${PORT}`);
  console.log(`  Login: staff_194 / password123!\n`);
});
