/**
 * MusterGo backend — Express API for the SCCCI admin dashboard.
 *
 * Run:
 *   npm install
 *   npm run dev        # http://localhost:4000
 *
 * The Vite dev server proxies /api → here (see Frontend/vite.config.js), so the
 * React app just calls fetch("/api/...") with no CORS or origin config needed.
 *
 * CRUD build: delegates start empty and are managed through the routes below.
 * The dashboard / missing / export views are all computed from whatever
 * delegates currently exist.
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

/* ---- Auth (demo) -------------------------------------------------------- */
app.post("/api/auth/login", (req, res) => {
  const { staffId } = req.body || {};
  if (!staffId) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Staff ID is required." });
  }
  res.json({
    token: `demo.${Buffer.from(staffId).toString("base64")}.token`,
    role: "admin",
    name: staffId,
  });
});

/* ---- Trips -------------------------------------------------------------- */
app.get("/api/trips", (_req, res) => res.json([getTrip()]));
app.get("/api/trips/:id", (_req, res) => res.json(getTrip()));

/* ---- Dashboard read views ----------------------------------------------- */
app.get("/api/trips/:id/dashboard", (_req, res) => res.json(getDashboard()));
app.get("/api/trips/:id/missing", (_req, res) => res.json({ missing: getMissing() }));

/* ---- Delegate CRUD ------------------------------------------------------ */
// READ all
app.get("/api/trips/:id/delegates", (_req, res) => res.json({ delegates: listDelegates() }));

// CREATE
app.post("/api/trips/:id/delegates", (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.name.trim()) {
    return res.status(400).json({ error: "NAME_REQUIRED", message: "A name is required." });
  }
  const delegate = createDelegate(body);
  res.status(201).json(delegate);
});

// UPDATE
app.patch("/api/delegates/:id", (req, res) => {
  const updated = updateDelegate(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(updated);
});

// DELETE
app.delete("/api/delegates/:id", (req, res) => {
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

/* ---- Fallback ----------------------------------------------------------- */
app.use((req, res) => res.status(404).json({ error: "NOT_FOUND", path: req.originalUrl }));

app.listen(PORT, () => {
  console.log(`\n  MusterGo backend running → http://localhost:${PORT}`);
  console.log(`  Delegates start empty — create them from the dashboard.\n`);
});
