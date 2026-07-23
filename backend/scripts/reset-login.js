/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  Reset (or create) the primary login account to a known good state.
 *
 *  WHY THIS EXISTS: the team shares ONE Neon database, and `git clone` only
 *  resets code — never the database. The seeded `staff_194 / password123!`
 *  login in data.js only runs on a FIRST boot against an empty DB (it's
 *  guarded by "if no accounts exist"). So once the shared DB is populated,
 *  that seed never re-applies. If the stored password later drifts from
 *  password123! — someone changed it in Account Control, or a teammate on an
 *  older pre-bcrypt branch wrote to the accounts table — a fresh clone can no
 *  longer log in with the documented credentials.
 *
 *  This script fixes that in one command instead of editing Neon by hand:
 *      cd backend && npm run reset:login
 *
 *  It force-sets staff_194 back to password123! (bcrypt-hashed) with full
 *  "admin" permissions — creating the row if it's missing. Safe to re-run.
 *
 *  Override the target with env vars if you ever need a different account:
 *      RESET_USER=someone RESET_PASS=NewPass123 npm run reset:login
 * ============================================================================= */

import "dotenv/config";
import pg from "pg";
import { initDb, hashPassword } from "../data.js";
import { DEFAULT_PERMISSIONS } from "../../permissions.js";

const { Pool } = pg;

const USERNAME = process.env.RESET_USER || "staff_194";
const PASSWORD = process.env.RESET_PASS || "password123!";
const NAME = process.env.RESET_NAME || "Staff 194";

// The "admin" role — every permission on, so this account can reach the
// whole app (dashboard, trips, exceptions, export, account control).
const ADMIN_PERMS = Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map((k) => [k, true]));

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
  await initDb(); // make sure the accounts table (+ token_version column) exists
  const pool = new Pool(readConfig());
  const hash = await hashPassword(PASSWORD);
  const permsJson = JSON.stringify(ADMIN_PERMS);

  const existing = await pool.query("SELECT id FROM accounts WHERE username = $1", [USERNAME]);
  if (existing.rows.length) {
    // Also reset token_version to 0 so any lingering "single active session"
    // token elsewhere is invalidated — a clean slate.
    await pool.query(
      `UPDATE accounts SET password = $1, role = 'admin', permissions = $2, token_version = 0 WHERE username = $3`,
      [hash, permsJson, USERNAME]
    );
    console.log(`\n  Reset existing account "${USERNAME}" -> password "${PASSWORD}" (full admin access).`);
  } else {
    const idRow = await pool.query(`SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 3) AS INTEGER)), 0) AS m FROM accounts`);
    const id = `u-${Number(idRow.rows[0].m) + 1}`;
    await pool.query(
      `INSERT INTO accounts (id, username, name, password, role, permissions, "createdAt")
       VALUES ($1,$2,$3,$4,'admin',$5,$6)`,
      [id, USERNAME, NAME, hash, permsJson, new Date().toISOString()]
    );
    console.log(`\n  Created account "${USERNAME}" -> password "${PASSWORD}" (full admin access).`);
  }

  await pool.end();
}

main()
  .then(() => { console.log("  Login reset complete.\n"); process.exit(0); })
  .catch((e) => { console.error("\n  Reset failed:", e.message, "\n"); process.exit(1); });
