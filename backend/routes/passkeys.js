/* =============================================================================
 * backend/routes/passkeys.js
 * OWNED BY: FaceCheck-Pro (Vimal)
 *
 * Passkey (WebAuthn / FIDO2) sign-in — "Sign in with Face ID / Touch ID /
 * fingerprint / Windows Hello" using the biometric the staff member ALREADY
 * has set up on their phone or laptop. No extra app, no new enrolment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THIS DIFFERS FROM FaceCheck (routes/facescan.js) — they are NOT the same
 * ─────────────────────────────────────────────────────────────────────────────
 * FaceCheck answers "WHICH delegate is this?" — a 1:N identification against
 * face templates we store, used to check people in.
 *
 * This answers "is this the device+person who owns this staff account?" — a 1:1
 * authentication. The face/fingerprint NEVER reaches this server, or even the
 * browser: iOS/Android/Windows verify it locally in secure hardware and only
 * release a signature from a private key that never leaves the device. We only
 * ever store a PUBLIC key. That is what makes this both stronger than a
 * password and cheaper, privacy-wise, than anything we could build ourselves.
 *
 * Flow:
 *   register (must already be signed in):  /register/options -> device prompts
 *     biometric -> /register/verify stores the public key against the account
 *   login:  /login/options -> device prompts biometric -> /login/verify checks
 *     the signature against the stored public key -> issues the SAME JWT the
 *     password route issues, so everything downstream is unchanged.
 * ========================================================================== */

import { Router } from "express";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { requireAuth, makeToken } from "../lib/auth.js";
import { all as dbAll, get as dbGet, run as dbRun } from "../db/connection.js";
import { getAccountByUsername, accountPermissions } from "../db/accounts.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, error, message) => res.status(status).json({ error, message });

/* ---- storage -------------------------------------------------------------
 * Own table, created on demand — this module never edits db/schema.js, the
 * same arrangement the other feature modules use. */
let ready = null;
async function ensureSchema() {
  if (ready) return ready;
  ready = (async () => {
    await dbRun(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id             TEXT PRIMARY KEY,
      account_id     TEXT NOT NULL,
      username       TEXT NOT NULL,
      public_key     TEXT NOT NULL,
      counter        BIGINT NOT NULL DEFAULT 0,
      transports     TEXT,
      device_label   TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at   TIMESTAMPTZ
    )`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_webauthn_username ON webauthn_credentials(username)`);
    console.log("  Passkeys ready -> webauthn_credentials");
  })();
  return ready;
}

/* Challenges are single-use and short-lived, so they live in memory rather than
 * a table. A restart simply invalidates any in-flight ceremony, which the UI
 * already handles by asking the user to tap the button again. */
const challenges = new Map(); // key -> { challenge, at }
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
function putChallenge(key, challenge) {
  challenges.set(key, { challenge, at: Date.now() });
}
function takeChallenge(key) {
  const hit = challenges.get(key);
  challenges.delete(key); // single use
  if (!hit || Date.now() - hit.at > CHALLENGE_TTL_MS) return null;
  return hit.challenge;
}

/* ---- relying party -------------------------------------------------------
 * The RP ID must be the site's DOMAIN. Derived per-request so the same code
 * works on localhost in dev and on a real hostname in production.
 *
 * NOTE: WebAuthn deliberately does NOT allow a bare IP address as an RP ID, so
 * passkeys cannot work when the app is reached as https://192.168.x.x — that's
 * a spec restriction, not a bug here. Use localhost or a real domain. */
function rp(req) {
  const origin = req.headers.origin || `https://${req.headers.host}`;
  let host;
  try { host = new URL(origin).hostname; } catch { host = "localhost"; }
  return { rpID: host, origin };
}
const isIpHost = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");

const b64 = (buf) => Buffer.from(buf).toString("base64url");

/* ============================ REGISTRATION ============================== */

/* POST /api/passkeys/register/options — must already be signed in (you prove
 * who you are with your password once, then bind this device's biometric). */
router.post("/api/passkeys/register/options", requireAuth(), wrap(async (req, res) => {
  await ensureSchema();
  const { rpID } = rp(req);
  if (isIpHost(rpID)) {
    return fail(res, 400, "RP_ID_UNSUPPORTED",
      "Passkeys need a hostname, not an IP address. Open the app on localhost or a real domain.");
  }
  const acc = req.account;
  const existing = await dbAll(`SELECT id, transports FROM webauthn_credentials WHERE username = $1`, [acc.username]);

  const options = await generateRegistrationOptions({
    rpName: "MusterGo",
    rpID,
    userName: acc.username,
    userDisplayName: acc.name || acc.username,
    attestationType: "none",
    // Don't offer to re-register a device that's already set up.
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    authenticatorSelection: {
      // platform = the biometric built into THIS device (Face ID / Touch ID /
      // Android fingerprint / Windows Hello) rather than a roaming USB key.
      authenticatorAttachment: "platform",
      residentKey: "preferred",   // enables username-less sign-in
      userVerification: "required", // force the biometric/PIN, not just presence
    },
  });

  putChallenge(`reg:${acc.username}`, options.challenge);
  res.json(options);
}));

/* POST /api/passkeys/register/verify — store the public key on success. */
router.post("/api/passkeys/register/verify", requireAuth(), wrap(async (req, res) => {
  await ensureSchema();
  const { rpID, origin } = rp(req);
  const acc = req.account;
  const expectedChallenge = takeChallenge(`reg:${acc.username}`);
  if (!expectedChallenge) return fail(res, 400, "CHALLENGE_EXPIRED", "That took too long — tap the button and try again.");

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return fail(res, 400, "VERIFICATION_FAILED", e.message || "Could not verify that device.");
  }
  if (!verification.verified || !verification.registrationInfo) {
    return fail(res, 400, "VERIFICATION_FAILED", "Could not verify that device.");
  }

  const { credential } = verification.registrationInfo;
  const label = (req.body && req.body.deviceLabel) || guessDevice(req.headers["user-agent"]);
  await dbRun(
    `INSERT INTO webauthn_credentials (id, account_id, username, public_key, counter, transports, device_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET public_key = EXCLUDED.public_key, counter = EXCLUDED.counter`,
    [
      credential.id, String(acc.id), acc.username, b64(credential.publicKey),
      Number(credential.counter) || 0,
      JSON.stringify(credential.transports || []), label,
    ]
  );
  res.json({ verified: true, deviceLabel: label });
}));

/* ============================ AUTHENTICATION ============================ */

/* POST /api/passkeys/login/options  { staffId? }
 * With no staffId this is a username-less sign-in: the device offers whichever
 * passkey it holds for this site, so staff just tap and look at their phone. */
router.post("/api/passkeys/login/options", wrap(async (req, res) => {
  await ensureSchema();
  const { rpID } = rp(req);
  if (isIpHost(rpID)) {
    return fail(res, 400, "RP_ID_UNSUPPORTED",
      "Passkeys need a hostname, not an IP address. Open the app on localhost or a real domain.");
  }
  const staffId = String((req.body && req.body.staffId) || "").trim();

  let allow;
  if (staffId) {
    const creds = await dbAll(`SELECT id, transports FROM webauthn_credentials WHERE username = $1`, [staffId]);
    if (creds.length === 0) return fail(res, 404, "NO_PASSKEY", "No passkey is set up for that Staff ID yet.");
    allow = creds.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined }));
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    ...(allow ? { allowCredentials: allow } : {}),
  });
  // Keyed by challenge itself so a username-less ceremony needs no session.
  putChallenge(`auth:${options.challenge}`, options.challenge);
  res.json(options);
}));

/* POST /api/passkeys/login/verify — verify the signature and issue the SAME
 * JWT the password route issues, so the rest of the app is unchanged. */
router.post("/api/passkeys/login/verify", wrap(async (req, res) => {
  await ensureSchema();
  const { rpID, origin } = rp(req);
  const body = req.body || {};
  const expectedChallenge = takeChallenge(`auth:${body.expectedChallenge || ""}`)
    || takeChallenge(`auth:${body.challenge || ""}`);
  if (!expectedChallenge) return fail(res, 400, "CHALLENGE_EXPIRED", "That took too long — tap the button and try again.");

  const row = await dbGet(`SELECT * FROM webauthn_credentials WHERE id = $1`, [body.id]);
  if (!row) return fail(res, 404, "UNKNOWN_CREDENTIAL", "That device isn't registered for sign-in.");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: row.id,
        publicKey: Buffer.from(row.public_key, "base64url"),
        counter: Number(row.counter) || 0,
        transports: row.transports ? JSON.parse(row.transports) : undefined,
      },
    });
  } catch (e) {
    return fail(res, 401, "VERIFICATION_FAILED", e.message || "Sign-in failed.");
  }
  if (!verification.verified) return fail(res, 401, "VERIFICATION_FAILED", "Sign-in failed.");

  // Signature counter guards against a cloned authenticator replaying.
  await dbRun(
    `UPDATE webauthn_credentials SET counter = $1, last_used_at = now() WHERE id = $2`,
    [Number(verification.authenticationInfo.newCounter) || 0, row.id]
  );

  const acc = await getAccountByUsername(row.username);
  if (!acc) return fail(res, 404, "NO_ACCOUNT", "That account no longer exists.");
  // Matches routes/auth.js's password-login check exactly (2026-07-29 JQ fix
  // — the original UPPERCASE comparison here could never match this table's
  // real values: `status` is lowercase and defaults to 'approved', so as
  // written this would have 403'd EVERY account, including normal approved
  // ones, the first time anyone tried passkey sign-in).
  if (acc.status === "pending") {
    return fail(res, 403, "ACCOUNT_PENDING", "Your account is awaiting admin approval.");
  }
  if (acc.status === "rejected") {
    return fail(res, 403, "ACCOUNT_REJECTED", "This account's registration was not approved.");
  }

  // permissions MUST go through accountPermissions() (2026-07-30 — "when i
  // try to login with the registered window hello, got issue: your account
  // access was updated, please sign in again"): this used to send the RAW
  // stored `acc.permissions` (an unparsed JSON string for staff, and — for
  // admin accounts — whatever happened to be stored rather than the real
  // all-true admin bypass). useSessionGuard's very first session check,
  // firing on mount right after this login completed, calls GET
  // /auth/session — which DOES go through accountPermissions() — compares
  // it against what passkey login had just stored, finds them different
  // (almost always, since raw vs. cleaned/defaulted are rarely byte-identical
  // JSON), and immediately force-logs-out the user it just signed in.
  // routes/auth.js's own login/session endpoints always used this helper;
  // passkeys.js simply predates it having one consistent source of truth.
  res.json({
    token: makeToken(acc.username, acc.token_version ?? 0),
    role: acc.role,
    readOnly: !!acc.readOnly,
    name: acc.name,
    username: acc.username,
    permissions: accountPermissions(acc),
  });
}));

/* ============================ MANAGEMENT ================================ */

/* GET /api/passkeys — the signed-in user's registered devices. */
router.get("/api/passkeys", requireAuth(), wrap(async (req, res) => {
  await ensureSchema();
  const rows = await dbAll(
    `SELECT id, device_label, created_at, last_used_at FROM webauthn_credentials
     WHERE username = $1 ORDER BY created_at DESC`,
    [req.account.username]
  );
  res.json({
    passkeys: rows.map((r) => ({
      id: r.id, deviceLabel: r.device_label, createdAt: r.created_at, lastUsedAt: r.last_used_at,
    })),
  });
}));

/* POST /api/passkeys/remove  { id } — you can only remove your own. */
router.post("/api/passkeys/remove", requireAuth(), wrap(async (req, res) => {
  await ensureSchema();
  const id = String((req.body && req.body.id) || "");
  const row = await dbGet(`SELECT id FROM webauthn_credentials WHERE id = $1 AND username = $2`, [id, req.account.username]);
  if (!row) return fail(res, 404, "NOT_FOUND", "That passkey isn't on your account.");
  await dbRun(`DELETE FROM webauthn_credentials WHERE id = $1`, [id]);
  res.json({ removed: true, id });
}));

/* GET /api/passkeys/available?staffId=… — does this Staff ID have a passkey?
 * Lets the login page show the biometric button only when it would work. */
router.get("/api/passkeys/available", wrap(async (req, res) => {
  await ensureSchema();
  const { rpID } = rp(req);
  const staffId = String((req.query && req.query.staffId) || "").trim();
  const total = await dbGet(`SELECT COUNT(*)::int AS n FROM webauthn_credentials`, []);
  const mine = staffId
    ? await dbGet(`SELECT COUNT(*)::int AS n FROM webauthn_credentials WHERE username = $1`, [staffId])
    : { n: 0 };
  res.json({
    supported: !isIpHost(rpID),
    anyRegistered: (total?.n || 0) > 0,
    registeredForStaffId: (mine?.n || 0) > 0,
  });
}));

/** Friendly device name from the UA, so the list reads "iPhone" not a blob. */
function guessDevice(ua = "") {
  const s = String(ua);
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Android/i.test(s)) return "Android device";
  if (/Macintosh/i.test(s)) return "Mac";
  if (/Windows/i.test(s)) return "Windows PC";
  return "This device";
}

export default router;
