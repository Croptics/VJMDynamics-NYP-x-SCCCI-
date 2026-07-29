/* =============================================================================
 *  OWNED BY:  Jayden
 *  Demo seed for the Exception feature.
 *
 *  The base backend seeds a trip, 4 coaches and the first login — but no
 *  delegates, so the delegate picker and the inbox start empty. This script
 *  adds a realistic delegate roster (via JQ's exported createDelegate, so the
 *  rows are shaped exactly as her code expects) plus the sample tickets from
 *  the Screen 5 design.
 *
 *  Run once, after the server has booted at least once:
 *      cd backend && npm run seed:demo
 *  Safe to re-run: it skips seeding if tickets already exist.
 * ============================================================================= */

import "dotenv/config";
import { randomUUID } from "crypto";
import pg from "pg";
import { initDb, listDelegates, createDelegate } from "../data.js";

const { Pool } = pg;

function readConfig() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const forceSsl = process.env.PGSSL;
  const sslFor = (isLocal) =>
    forceSsl === "true" ? { rejectUnauthorized: false }
    : forceSsl === "false" ? false
    : isLocal ? false
    : { rejectUnauthorized: false };
  if (url) return { connectionString: url, ssl: sslFor(/localhost|127\.0\.0\.1/.test(url)) };
  const host = process.env.DB_HOST || "localhost";
  return {
    host, port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "mustergo",
    ssl: sslFor(/localhost|127\.0\.0\.1/.test(host)),
  };
}

const TRIP_ID = "t-1";

const ROSTER = [
  { name: "Lim Wei Jie",   coachId: "c2", status: "MISSING",    vip: true,  lastSeen: "Gift shop · 14:08" },
  { name: "Tan Boon Keng", coachId: "c1", status: "MISSING",    vip: false, lastSeen: "Lobby · 14:02" },
  { name: "Goh Mei Ling",  coachId: "c2", status: "MISSING",    vip: false, lastSeen: "Hotel · 13:55" },
  { name: "Chen Hao Ming", coachId: "c2", status: "PRESENT",    vip: false, lastSeen: "Coach 2 · 13:45" },
  { name: "Yeo Pei Lin",   coachId: "c3", status: "PRESENT",    vip: false, lastSeen: "Coach 3 · 09:20" },
  { name: "Ng Soo Peng",   coachId: "c1", status: "PRESENT",    vip: false, lastSeen: "Coach 1 · 09:05" },
  { name: "Wong Pei Shan", coachId: "c2", status: "PRESENT",    vip: false, lastSeen: "Coach 2 · 08:40" },
  { name: "Sim Tian Kee",  coachId: "c3", status: "PRESENT",    vip: false, lastSeen: "Coach 3 · 08:22" },
  { name: "Phua Yong Min", coachId: null, status: "UNASSIGNED", vip: false, lastSeen: null },
];

// [type, priority, status, note, delegateName]
const TICKETS = [
  ["MISSING_PERSON",    "CRITICAL", "OPEN",     "Not boarded · departure imminent. Last seen near gift shop 14:08.", "Lim Wei Jie"],
  ["LOST_BADGE",        "NORMAL",   "OPEN",     "Delegate cannot scan QR.",                "Tan Boon Keng"],
  ["FACE_MATCH_FAILED", "NORMAL",   "OPEN",     "Photo outdated · used QR instead.",       "Goh Mei Ling"],
  ["DEAD_PHONE",        "LOW",      "RESOLVED", "Manually counted.",                       "Chen Hao Ming"],
  ["VIP_REQUEST",       "LOW",      "RESOLVED", "Needs accessible seating.",               "Yeo Pei Lin"],
  ["LOST_BADGE",        "NORMAL",   "RESOLVED", "Reissued at hotel desk.",                 "Ng Soo Peng"],
  ["DEAD_PHONE",        "LOW",      "RESOLVED", "Charged on coach.",                       "Wong Pei Shan"],
];

async function main() {
  await initDb(); // ensures base tables + trip/coaches/account exist
  const pool = new Pool(readConfig());
  const q = (t, p) => pool.query(t, p);

  // 1. Delegates (only if the roster is empty)
  let delegates = await listDelegates();
  if (delegates.length === 0) {
    for (const d of ROSTER) await createDelegate(d);
    delegates = await listDelegates();
    console.log(`  Seeded ${delegates.length} delegates.`);
  } else {
    console.log(`  ${delegates.length} delegates already present — skipping roster.`);
  }

  // 2. Tickets (only if none exist)
  const { rows: existing } = await q("SELECT id FROM exception_tickets LIMIT 1");
  if (existing.length) {
    console.log("  Exception tickets already present — nothing to do.");
    await pool.end();
    return;
  }

  const { rows: accs } = await q("SELECT id FROM accounts ORDER BY id LIMIT 1");
  if (!accs.length) throw new Error("No account found — start the server once so it seeds staff_194.");
  const raiser = accs[0].id;

  const byName = Object.fromEntries(delegates.map((d) => [d.name, d]));
  let n = 0;
  for (const [type, priority, status, note, delegateName] of TICKETS) {
    const d = byName[delegateName];
    const resolved = status === "RESOLVED";
    await q(
      `INSERT INTO exception_tickets
         (id, trip_id, delegate_id, coach_id, type, priority, status, note,
          raised_by, resolved_by, client_event_id, created_at, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() - ($12 || ' minutes')::interval, $13)`,
      [randomUUID(), TRIP_ID, d?.id || null, d?.coachId || null, type, priority, status, note,
       raiser, resolved ? raiser : null, randomUUID(), String(n * 7), resolved ? new Date() : null]
    );
    n++;
  }
  console.log(`  Seeded ${n} exception tickets.`);
  await pool.end();
}

main()
  .then(() => { console.log("\n  Demo seed complete.\n"); process.exit(0); })
  .catch((e) => { console.error("\n  Seed failed:", e.message, "\n"); process.exit(1); });
