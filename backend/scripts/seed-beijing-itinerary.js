/* =============================================================================
 *  Beijing itinerary seed  —  Desmond (TransitFlow), 2026-07-24.  Re-runnable.
 *
 *  The "Beijing study mission" trip only had a Day-3 itinerary. This fills in
 *  Days 1, 2, 4 and 5 with realistic stops. Days 1 and 2 are marked FULLY
 *  COMPLETED (every stop ticked done / crossed out), since by the trip's Day 3
 *  they're in the past. Day 3 is left untouched (it already has demo data).
 *
 *  Idempotent: it deletes any existing items for the days it seeds (1,2,4,5)
 *  first, then re-inserts — so a re-run rebuilds cleanly and never duplicates,
 *  and never touches Day 3.
 *
 *  Run:  cd backend && node scripts/seed-beijing-itinerary.js
 * ============================================================================= */
import "dotenv/config";
import pg from "pg";
import { initDb } from "../data.js";

const { Pool } = pg;
const TRIP_NAME = "Beijing study mission";
const SEED_DAYS = [1, 2, 4, 5];

// day, time, title, location, category. Days 1 & 2 get completed=true below.
const ITINERARY = [
  // ---- Day 1 (completed) — arrival ----
  { day: 1, time: "09:00", title: "Airport arrival & transfer", location: "Beijing Capital Intl Airport", category: "airport" },
  { day: 1, time: "12:00", title: "Hotel check-in",            location: "Novotel Beijing Xinqiao",       category: "hotel" },
  { day: 1, time: "13:00", title: "Welcome lunch",             location: "Hotel banquet hall",             category: "meal" },
  { day: 1, time: "15:00", title: "City orientation walk",     location: "Wangfujing Street",              category: "attraction" },
  { day: 1, time: "19:00", title: "Welcome dinner",            location: "Quanjude Roast Duck",            category: "meal" },
  // ---- Day 2 (completed) — Great Wall ----
  { day: 2, time: "07:30", title: "Hotel breakfast",           location: "Hotel restaurant",               category: "meal" },
  { day: 2, time: "09:00", title: "Great Wall visit",          location: "Badaling Great Wall",            category: "attraction" },
  { day: 2, time: "12:30", title: "Lunch stop",                location: "Badaling town",                  category: "meal" },
  { day: 2, time: "14:30", title: "Ming Tombs tour",           location: "Changling, Ming Tombs",          category: "attraction" },
  { day: 2, time: "18:30", title: "Group dinner",              location: "Hotpot house, Dongcheng",        category: "meal" },
  // ---- Day 4 (upcoming) ----
  { day: 4, time: "08:00", title: "Hotel breakfast",           location: "Hotel restaurant",               category: "meal" },
  { day: 4, time: "09:30", title: "Summer Palace",             location: "Summer Palace, Haidian",         category: "attraction" },
  { day: 4, time: "12:30", title: "Lunch",                     location: "Haidian district",               category: "meal" },
  { day: 4, time: "14:30", title: "Temple of Heaven",          location: "Temple of Heaven Park",          category: "attraction" },
  { day: 4, time: "19:00", title: "Cultural show & dinner",    location: "Chaoyang Theatre",               category: "attraction" },
  // ---- Day 5 (upcoming) — departure ----
  { day: 5, time: "08:00", title: "Hotel breakfast",           location: "Hotel restaurant",               category: "meal" },
  { day: 5, time: "10:00", title: "Olympic Park visit",        location: "Bird's Nest & Water Cube",       category: "attraction" },
  { day: 5, time: "12:30", title: "Farewell lunch",            location: "Olympic Green",                  category: "meal" },
  { day: 5, time: "15:00", title: "Airport departure transfer", location: "Beijing Capital Intl Airport",  category: "airport" },
];

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

async function main() {
  await initDb();
  const pool = new Pool(readConfig());

  // Ops columns (normally added by desmond.js at boot) — defensive.
  await pool.query(`ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled'`);
  await pool.query(`ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS delay_minutes INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT false`);

  const trip = (await pool.query(`SELECT uuid_id FROM trips WHERE name = $1`, [TRIP_NAME])).rows[0];
  if (!trip) { console.log(`\n  Trip "${TRIP_NAME}" not found.\n`); await pool.end(); return; }
  const tripId = trip.uuid_id;

  // Clean the days we own so a re-run rebuilds them (Day 3 is never touched).
  await pool.query(
    `DELETE FROM itinerary_items WHERE trip_id = $1 AND day_number = ANY($2)`,
    [tripId, SEED_DAYS]
  );

  let inserted = 0;
  // sort_order per day, in listed (chronological) order.
  const perDayIndex = {};
  for (const it of ITINERARY) {
    const completed = it.day === 1 || it.day === 2; // Days 1 & 2 are fully done.
    const sortOrder = (perDayIndex[it.day] = (perDayIndex[it.day] ?? -1) + 1);
    await pool.query(
      `INSERT INTO itinerary_items (trip_id, day_number, start_time, title, location, sort_order, category, status, delay_minutes, completed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',0,$8)`,
      [tripId, it.day, it.time, it.title, it.location, sortOrder, it.category, completed]
    );
    inserted++;
  }

  await pool.end();
  console.log(`\n  Seeded ${inserted} itinerary items on "${TRIP_NAME}" for Days ${SEED_DAYS.join(", ")}.`);
  console.log(`  Days 1 & 2 are marked completed (crossed out); Days 4 & 5 are upcoming. Day 3 untouched.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("\n  seed:beijing-itinerary failed:", e.message, "\n"); process.exit(1); });
