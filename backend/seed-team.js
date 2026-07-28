/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  Create one login account per team member, so nobody has to share
 *  "staff_194".
 *
 *  WHY THIS EXISTS: logins enforce a SINGLE ACTIVE SESSION per account (see
 *  auth.js — each login bumps token_version, invalidating older tokens). That
 *  is correct for one person, but the whole team shares ONE database, so when
 *  everyone logs in as the same `staff_194` account they constantly log each
 *  other out ("Your account is no longer valid. Please sign in again." every
 *  ~15s). Giving each person their OWN account fixes it: your session only
 *  ends when YOU log in somewhere else, not when a teammate does.
 *
 *  Run once (safe to re-run — it never overwrites an account that already
 *  exists, so nobody's password gets reset):
 *      cd backend && npm run seed:team
 *
 *  Everyone gets the "admin" role for development (full access, bypasses
 *  every permission check — see accountPermissions() in data.js). Change any
 *  account to "staff" afterwards in the Account control page if you want to
 *  demo the permission gates. Default password for every new account is
 *  "password123!".
 * ============================================================================= */

import "dotenv/config";
import pg from "pg";
import { initDb, hashPassword } from "./data.js";
import { PERM_KEYS } from "../permissions.js";

const { Pool } = pg;

// One account per team member (see HIGH_LEVEL_DESIGN.md). Add/adjust freely.
const TEAM = [
  { username: "jq",      name: "Jun Qi" },
  { username: "vance",   name: "Vance" },
  { username: "desmond", name: "Desmond" },
  { username: "jayden",  name: "Jayden" },
  { username: "vimal",   name: "Vimal" },
];

const PASSWORD = "password123!";
// Full access for every dev account so each person can test the whole app.
const ALL_PERMS = Object.fromEntries(PERM_KEYS.map((k) => [k, true]));

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
  const r = await pool.query(`SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 3) AS INTEGER)), 0) AS m FROM accounts`);
  return Number(r.rows[0].m) + 1;
}

async function main() {
  await initDb(); // ensure the accounts table exists
  const pool = new Pool(readConfig());
  const permsJson = JSON.stringify(ALL_PERMS);
  let created = 0, skipped = 0;
  let nextN = await nextAccountId(pool);

  for (const member of TEAM) {
    const existing = await pool.query("SELECT id FROM accounts WHERE username = $1", [member.username]);
    if (existing.rows.length) {
      console.log(`  · ${member.username} already exists — left as-is.`);
      skipped++;
      continue;
    }
    const id = `u-${nextN++}`;
    await pool.query(
      `INSERT INTO accounts (id, username, name, password, role, permissions, "createdAt")
       VALUES ($1,$2,$3,$4,'admin',$5,$6)`,
      [id, member.username, member.name, await hashPassword(PASSWORD), permsJson, new Date().toISOString()]
    );
    console.log(`  ✓ created ${member.username} / ${PASSWORD}`);
    created++;
  }

  await pool.end();
  console.log(`\n  Team accounts ready — ${created} created, ${skipped} already existed.`);
  console.log(`  Everyone: sign in with your own username and "${PASSWORD}" instead of staff_194.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("\n  seed:team failed:", e.message, "\n"); process.exit(1); });
