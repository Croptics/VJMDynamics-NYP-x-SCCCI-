/* =============================================================================
 *  Scope-test seed  —  Desmond (TransitFlow), 2026-07-24.  ADDITIVE + re-runnable.
 *
 *  Creates three STAFF captain logins so the per-coach scoped board can be
 *  tested end-to-end:
 *
 *      Staff_1 / Staff_2 / Staff_3      password:  password1
 *
 *  Each is role "staff" (NOT admin — admins bypass scoping and see every coach)
 *  with Manage-trips + Manage-delegates, so a captain can run their own coach
 *  and its people but nothing else.
 *
 *  It then makes each a coach CAPTAIN (coaches.account_id) on the trip that
 *  already has the most coaches with delegates assigned — so signing in as
 *  Staff_N shows ONLY that one coach and its delegates, nothing else.
 *
 *  Safe to re-run: existing accounts are re-used (kept as staff + given the
 *  manage perms), and the three captains' coach links are rebuilt cleanly each
 *  run so nobody ends up captaining two coaches.
 *
 *  Run once, after the backend has booted at least once (so the ops columns
 *  exist) — though this also creates the column defensively:
 *      cd backend && node scripts/seed-scope-test.js
 * ============================================================================= */
import "dotenv/config";
import pg from "pg";
import { initDb, hashPassword } from "../data.js";
import { DEFAULT_PERMISSIONS } from "../../frontend/src/lib/permissions.js";

const { Pool } = pg;

const STAFF = ["Staff_1", "Staff_2", "Staff_3"];
const PASSWORD = "password1";
// A staff captain: the normal staff defaults, plus the two capabilities they
// need to actually run their coach — edit the trip/coach (manageTrips) and
// move/edit their delegates (manageDelegates). Still NOT admin.
const PERMS = JSON.stringify({
  ...DEFAULT_PERMISSIONS,
  manageTrips: true,
  manageDelegates: true,
  viewTrips: true,
  viewMobileTrips: true,
});

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

async function nextAccountId(pool) {
  const r = await pool.query(`SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 3) AS INTEGER)), 0) AS m FROM accounts WHERE id ~ '^u-[0-9]+$'`);
  return Number(r.rows[0].m) + 1;
}

async function main() {
  await initDb(); // ensure the accounts table exists
  const pool = new Pool(readConfig());

  // The captain link normally comes from desmond.js's ensureOpsSchema at server
  // boot; add it here too so this script works even on a fresh DB.
  await pool.query(`ALTER TABLE coaches ADD COLUMN IF NOT EXISTS account_id VARCHAR(64)`);

  /* ---- 1. Create (or normalise) the three staff captain accounts ---------- */
  let nextN = await nextAccountId(pool);
  const accountIds = {};
  for (const username of STAFF) {
    const existing = await pool.query("SELECT id FROM accounts WHERE username = $1", [username]);
    if (existing.rows.length) {
      accountIds[username] = existing.rows[0].id;
      // Force it back to a staff captain in case a previous run/edit made it admin.
      await pool.query(`UPDATE accounts SET role = 'staff', permissions = $1 WHERE username = $2`, [PERMS, username]);
      console.log(`  · ${username} already existed — kept as staff + manage perms (password unchanged).`);
    } else {
      const id = `u-${nextN++}`;
      await pool.query(
        `INSERT INTO accounts (id, username, name, password, role, permissions, "createdAt")
         VALUES ($1,$2,$3,$4,'staff',$5,$6)`,
        [id, username, username, await hashPassword(PASSWORD), PERMS, new Date().toISOString()]
      );
      accountIds[username] = id;
      console.log(`  ✓ created ${username} / ${PASSWORD}   (role: staff)`);
    }
  }

  /* ---- 2. Pick the trip whose coaches already have delegates -------------- */
  const rows = await pool.query(`
    SELECT c.id, c.label, c.trip_id AS "tripId", COALESCE(c.sort_order, 0) AS "sortOrder",
           t.name AS "tripName", t.status,
           COUNT(d.id) AS "delegateCount"
      FROM coaches c
      JOIN trips t ON t.uuid_id = c.trip_id
      LEFT JOIN delegates d ON d."coachId" = c.id
     GROUP BY c.id, c.label, c.trip_id, c.sort_order, t.name, t.status
     ORDER BY c.trip_id, "sortOrder"
  `);

  if (!rows.rows.length) {
    console.log("\n  No coaches found in any trip — create some coaches (with delegates) first, then re-run.\n");
    await pool.end();
    return;
  }

  // Group by trip, rank each trip by how many of its coaches have >=1 delegate
  // (tie-break: an In-progress trip is the best demo), and choose the winner.
  const byTrip = new Map();
  for (const r of rows.rows) {
    if (!byTrip.has(r.tripId)) byTrip.set(r.tripId, { tripId: r.tripId, tripName: r.tripName, status: r.status, coaches: [] });
    byTrip.get(r.tripId).coaches.push({ id: r.id, label: r.label, sortOrder: r.sortOrder, delegateCount: Number(r.delegateCount) });
  }
  const ranked = [...byTrip.values()].sort((a, b) => {
    const aw = a.coaches.filter((c) => c.delegateCount > 0).length;
    const bw = b.coaches.filter((c) => c.delegateCount > 0).length;
    if (bw !== aw) return bw - aw;
    return (b.status === "In progress" ? 1 : 0) - (a.status === "In progress" ? 1 : 0);
  });
  const trip = ranked[0];

  // Prefer coaches that already have delegates; fall back to empty ones so all
  // three staff still get a coach to test with.
  const withDelegates = trip.coaches.filter((c) => c.delegateCount > 0).sort((a, b) => a.sortOrder - b.sortOrder);
  const withoutDelegates = trip.coaches.filter((c) => c.delegateCount === 0).sort((a, b) => a.sortOrder - b.sortOrder);
  const chosen = [...withDelegates, ...withoutDelegates].slice(0, STAFF.length);

  /* ---- 3. Wire each staff account to one coach --------------------------- */
  const staffIds = Object.values(accountIds);
  // Clear any previous captain link these three held, so a re-run is clean.
  await pool.query(`UPDATE coaches SET account_id = NULL WHERE account_id = ANY($1)`, [staffIds]);

  console.log(`\n  Assigning captains on trip "${trip.tripName}" (${trip.status}):`);
  for (let i = 0; i < chosen.length; i++) {
    const username = STAFF[i];
    const coach = chosen[i];
    await pool.query(`UPDATE coaches SET account_id = $1 WHERE id = $2`, [accountIds[username], coach.id]);
    const names = await pool.query(`SELECT name FROM delegates WHERE "coachId" = $1 ORDER BY name`, [coach.id]);
    const people = names.rows.map((r) => r.name);
    console.log(`  ✓ ${username}  →  ${coach.label}  (${people.length} delegate${people.length !== 1 ? "s" : ""}${people.length ? ": " + people.slice(0, 6).join(", ") + (people.length > 6 ? "…" : "") : ""})`);
  }
  if (chosen.length < STAFF.length) {
    console.log(`  ! Only ${chosen.length} coach(es) on this trip — ${STAFF.slice(chosen.length).join(", ")} were created but not assigned a coach.`);
  }

  await pool.end();
  console.log(`\n  Done. Sign in as Staff_1 / Staff_2 / Staff_3 (password "${PASSWORD}") and open the trip's board —`);
  console.log(`  each should see ONLY their own coach and its delegates. Sign in as any admin to see the full trip.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("\n  seed:scope-test failed:", e.message, "\n"); process.exit(1); });
