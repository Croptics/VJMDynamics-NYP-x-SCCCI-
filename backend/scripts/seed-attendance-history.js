/* =============================================================================
 *  Attendance-history seed  —  Desmond (TransitFlow), 2026-07-24.  Re-runnable.
 *
 *  Populates per-event attendance + a realistic before/after change trail for
 *  the Beijing trip's COMPLETED days (Day 1 & Day 2), so the board's
 *  "Attendance & history" view has data to show for each event, per coach.
 *
 *  For every delegate on a coach, at each Day-1/Day-2 stop, it records a small
 *  history (e.g. Not recorded -> Missing -> Present) and leaves a final status,
 *  written to BOTH JQ's checkpoint_checkins (the live per-stop status the
 *  Dashboard/Timeline read) and this feature's attendance_log (the change log).
 *  Actor is the coach's captain login when set (e.g. Staff_1), else "Staff".
 *
 *  Idempotent: clears prior rows for those stops first. Run:
 *      cd backend && node scripts/seed-attendance-history.js
 * ============================================================================= */
import "dotenv/config";
import pg from "pg";
import { initDb } from "../data.js";

const { Pool } = pg;
const TRIP_NAME = "Beijing study mission";
const DAYS = [1, 2];

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

// Deterministic 0..1 from a string, so a re-run produces the same pattern.
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

async function main() {
  await initDb();
  const pool = new Pool(readConfig());

  await pool.query(`CREATE TABLE IF NOT EXISTS attendance_log (
    id VARCHAR(64) PRIMARY KEY, trip_id UUID, itinerary_item_id UUID, delegate_id VARCHAR(64),
    coach_id VARCHAR(64), actor TEXT, from_status TEXT, to_status TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now())`);

  const trip = (await pool.query(`SELECT uuid_id FROM trips WHERE name = $1`, [TRIP_NAME])).rows[0];
  if (!trip) { console.log(`\n  Trip "${TRIP_NAME}" not found.\n`); await pool.end(); return; }
  const tripId = trip.uuid_id;

  const items = (await pool.query(
    `SELECT id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title
       FROM itinerary_items WHERE trip_id = $1 AND day_number = ANY($2) ORDER BY day_number, sort_order`,
    [tripId, DAYS]
  )).rows;
  if (!items.length) { console.log(`\n  No Day ${DAYS.join("/")} itinerary — run seed-beijing-itinerary.js first.\n`); await pool.end(); return; }

  // Delegates on a coach, with their coach's captain login name (the actor).
  const delegates = (await pool.query(
    `SELECT d.id, d.name, d."coachId", c.label AS "coachLabel", COALESCE(a.name, a.username) AS "captain"
       FROM delegates d JOIN coaches c ON c.id = d."coachId"
       LEFT JOIN accounts a ON a.id = c.account_id
      WHERE d.trip_id = $1 AND d."coachId" IS NOT NULL`,
    [tripId]
  )).rows;

  const itemIds = items.map((i) => i.id);
  // Clean prior rows for these stops so re-runs rebuild cleanly.
  await pool.query(`DELETE FROM attendance_log WHERE itinerary_item_id = ANY($1)`, [itemIds]);
  await pool.query(`DELETE FROM checkpoint_checkins WHERE itinerary_item_id = ANY($1)`, [itemIds]);

  const now = Date.now();
  let checkins = 0, logs = 0;
  for (const item of items) {
    // Backdate this event relative to NOW (not the trip's fictional Aug dates):
    // Day 1 ≈ 2 days ago, Day 2 ≈ 1 day ago, offset by the stop's time-of-day.
    // This keeps all seeded history in the past, so a live edit (now) correctly
    // shows as the NEWEST entry rather than being buried under future-dated rows.
    const [h, m] = item.startTime.split(":").map(Number);
    const daysAgo = Math.max(0, 3 - item.dayNumber);
    const eventBase = now - daysAgo * 86400000 - (24 * 60 - (h * 60 + m)) * 60000;
    for (const d of delegates) {
      const r = hash01(d.id + item.id);
      const actor = d.captain || "Staff";
      // Build a small before/after chain, ending in a final status.
      // ~78% present (Missing->Present), ~10% late (Missing->Late->Present),
      // ~12% never turned up (Missing).
      let chain;
      if (r < 0.12) chain = ["MISSING"];
      else if (r < 0.22) chain = ["MISSING", "LATE", "ARRIVED"];
      else chain = ["MISSING", "ARRIVED"];

      let prev = null;
      let step = 0;
      for (const to of chain) {
        const at = new Date(eventBase + step * 7 * 60000); // staggered by 7 min per step, in the past
        await pool.query(
          `INSERT INTO attendance_log (id, trip_id, itinerary_item_id, delegate_id, coach_id, actor, from_status, to_status, at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [`att-seed-${item.id.slice(0, 8)}-${d.id}-${step}`, tripId, item.id, d.id, d.coachId, actor, prev, to, at]
        );
        logs++; prev = to; step++;
      }
      const finalStatus = chain[chain.length - 1];
      await pool.query(
        `INSERT INTO checkpoint_checkins (itinerary_item_id, delegate_id, status, method, scanned_by, updated_at)
         VALUES ($1,$2,$3,NULL,$4,now())
         ON CONFLICT (itinerary_item_id, delegate_id) DO UPDATE SET status=$3, scanned_by=$4, updated_at=now()`,
        [item.id, d.id, finalStatus, d.captain || "Staff"]
      );
      checkins++;
    }
  }

  await pool.end();
  console.log(`\n  Seeded attendance for ${items.length} stops × ${delegates.length} delegates:`);
  console.log(`  ${checkins} final check-ins + ${logs} before/after history entries (Days ${DAYS.join(", ")}).`);
  console.log(`  Open the board → a Day 1/2 stop → "Attendance & history" to see it (scoped per coach).\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("\n  seed:attendance-history failed:", e.message, "\n"); process.exit(1); });
