/**
 * Unit tests — Passport-expiry validation (Vance, Screen 4/6).
 *
 * checkPassportExpiry flags passports that are expired or expiring within 6
 * months (the standard overseas-travel rule), and treats missing/unparseable
 * dates as "unknown" (never flagged). computeRisk then surfaces expired
 * passports as a critical concern and expiring ones as medium.
 *
 * A fixed "now" is passed so the tests are deterministic.
 *
 * Run from the repo root:  node --test "tests/vance/*.test.js"
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkPassportExpiry, computeRisk, answerLocally } from "../../backend/routes/vance.js";

const NOW = new Date("2026-07-20T00:00:00Z");

describe("checkPassportExpiry", () => {
  test("flags an already-expired passport", () => {
    const r = checkPassportExpiry("2025-01-01", NOW);
    assert.equal(r.status, "expired");
    assert.ok(r.daysLeft < 0);
  });

  test("flags a passport expiring within 6 months", () => {
    const r = checkPassportExpiry("2026-10-01", NOW); // ~2.5 months out
    assert.equal(r.status, "expiring");
    assert.ok(r.daysLeft > 0);
  });

  test("passes a passport valid well beyond 6 months", () => {
    const r = checkPassportExpiry("2029-08-01", NOW);
    assert.equal(r.status, "ok");
  });

  test("boundary: just under 6 months is 'expiring', well past is 'ok'", () => {
    assert.equal(checkPassportExpiry("2027-01-01", NOW).status, "expiring"); // ~5.4 months
    assert.equal(checkPassportExpiry("2027-02-01", NOW).status, "ok");       // ~6.4 months
  });

  test("missing or unparseable expiry is 'unknown' (never flagged)", () => {
    assert.equal(checkPassportExpiry(null, NOW).status, "unknown");
    assert.equal(checkPassportExpiry("", NOW).status, "unknown");
    assert.equal(checkPassportExpiry("not a date", NOW).status, "unknown");
  });
});

describe("computeRisk — passport issues in the priority list", () => {
  test("an expired passport ranks as a critical concern", () => {
    const risks = computeRisk({
      missing: [], exceptions: [], coaches: [],
      passportIssues: [{ name: "Alice Tan", status: "expired", expiry: "2025-01-01" }],
    });
    assert.equal(risks.length, 1);
    assert.equal(risks[0].level, "critical");
    assert.match(risks[0].text, /expired passport/i);
    assert.match(risks[0].text, /Alice Tan/);
  });

  test("expiring passports rank as medium, below a missing VIP", () => {
    const risks = computeRisk({
      missing: [{ name: "Bob Lim", vip: true }],
      exceptions: [], coaches: [],
      passportIssues: [{ name: "Cara Ng", status: "expiring", expiry: "2026-10-01" }],
    });
    assert.equal(risks[0].level, "critical");     // missing VIP first
    assert.equal(risks[risks.length - 1].level, "medium"); // expiring passport last
    assert.match(risks[risks.length - 1].text, /expiring within 6 months/);
  });
});

describe("answerLocally — passport intent", () => {
  const snap = {
    trip: { name: "Beijing study mission" },
    kpis: { total: 3, present: 1, missing: 1, unassigned: 1 },
    coaches: [], missing: [], roster: [], byCompany: [], byIndustry: [],
    vips: [], exceptions: [], itinerary: [],
    passportIssues: [
      { name: "Alice Tan", vip: true, status: "expired", expiry: "2025-01-01" },
      { name: "Cara Ng", vip: false, status: "expiring", expiry: "2026-10-01" },
    ],
  };

  test("lists delegates with passport issues", () => {
    const a = answerLocally("any passport issues?", snap);
    assert.match(a, /Alice Tan/);
    assert.match(a, /EXPIRED/);
    assert.match(a, /Cara Ng/);
  });

  test("reassures when there are none", () => {
    const a = answerLocally("passport expiry check", { ...snap, passportIssues: [] });
    assert.match(a, /No passport issues/);
  });
});
