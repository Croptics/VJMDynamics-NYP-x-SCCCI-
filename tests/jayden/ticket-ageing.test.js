/**
 * Unit tests — ticket ageing (Jayden, frontend/src/lib/exception/exceptionsApi.js).
 *
 * WHY THIS MATTERS: on a live trip the difference between a ticket raised two
 * minutes ago and one raised forty minutes ago is the entire point of the
 * Exception Inbox, but both render as an identical HH:MM stamp. The ageing
 * helpers turn "when" into "how long", and tint the row once it crosses the
 * escalation thresholds (amber at 15 minutes, red at 30).
 *
 * Time is injected via the `now` parameter rather than mocked globally, so
 * every case below is deterministic and none of them depend on the clock.
 *
 * Run from the repo root:  node --test tests/jayden/*.test.js
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new FakeStorage();
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const { ageMinutes, fmtAge, ageLevel, resolveMinutes, AGE_WARN_MINS, AGE_LATE_MINS } =
  await import("../../frontend/src/lib/exception/exceptionsApi.js");

/** Fixed reference instant, so nothing here depends on the real clock. */
const NOW = Date.parse("2026-07-30T12:00:00Z");
/** ISO timestamp for `mins` minutes before NOW. */
const minsAgo = (mins) => new Date(NOW - mins * 60000).toISOString();

describe("ageMinutes — whole minutes since a ticket was raised", () => {
  test("counts elapsed minutes, flooring partial minutes", () => {
    assert.equal(ageMinutes(minsAgo(0), NOW), 0);
    assert.equal(ageMinutes(minsAgo(8), NOW), 8);
    assert.equal(ageMinutes(minsAgo(90), NOW), 90);
    // 59 seconds has not yet become a full minute.
    assert.equal(ageMinutes(new Date(NOW - 59000).toISOString(), NOW), 0);
  });

  test("never returns a negative age for a future timestamp", () => {
    // Clock skew between a staff device and the server must not render "-3m".
    assert.equal(ageMinutes(new Date(NOW + 5 * 60000).toISOString(), NOW), 0);
  });

  test("returns null for missing or unparseable input", () => {
    for (const v of [null, undefined, "", "not-a-date"]) {
      assert.equal(ageMinutes(v, NOW), null, `${JSON.stringify(v)} must be null`);
    }
  });
});

describe("fmtAge — compact human age", () => {
  test("under a minute reads 'just now'", () => {
    assert.equal(fmtAge(0), "just now");
  });

  test("under an hour is plain minutes", () => {
    assert.equal(fmtAge(1), "1m");
    assert.equal(fmtAge(59), "59m");
  });

  test("an hour or more is h + zero-padded minutes", () => {
    assert.equal(fmtAge(60), "1h 00m");
    assert.equal(fmtAge(95), "1h 35m");
    assert.equal(fmtAge(605), "10h 05m"); // padding is what keeps the column aligned
  });

  test("a day or more collapses to whole days", () => {
    assert.equal(fmtAge(1440), "1d");
    assert.equal(fmtAge(4321), "3d");
  });

  test("null/undefined render as empty, not 'NaN'", () => {
    assert.equal(fmtAge(null), "");
    assert.equal(fmtAge(undefined), "");
  });
});

describe("ageLevel — the escalation tint", () => {
  const openAt = (mins) => ({ status: "OPEN", createdAt: minsAgo(mins) });

  test("fresh tickets carry no tint", () => {
    assert.equal(ageLevel(openAt(0), NOW), "");
    assert.equal(ageLevel(openAt(14), NOW), "");
  });

  test("amber from the warn threshold, red from the late threshold", () => {
    assert.equal(ageLevel(openAt(AGE_WARN_MINS), NOW), "warn");   // boundary is inclusive
    assert.equal(ageLevel(openAt(29), NOW), "warn");
    assert.equal(ageLevel(openAt(AGE_LATE_MINS), NOW), "late");   // boundary is inclusive
    assert.equal(ageLevel(openAt(240), NOW), "late");
  });

  test("thresholds are the documented 15 / 30 minutes", () => {
    assert.equal(AGE_WARN_MINS, 15);
    assert.equal(AGE_LATE_MINS, 30);
  });

  test("only OPEN tickets age — a resolved ticket is never tinted", () => {
    // A ticket closed an hour ago is done; colouring it red would be noise.
    assert.equal(ageLevel({ status: "RESOLVED", createdAt: minsAgo(600) }, NOW), "");
  });

  test("missing ticket or unparseable date yields no tint rather than throwing", () => {
    assert.equal(ageLevel(null, NOW), "");
    assert.equal(ageLevel({ status: "OPEN", createdAt: "rubbish" }, NOW), "");
    assert.equal(ageLevel({ status: "OPEN" }, NOW), "");
  });
});

describe("resolveMinutes — how long a ticket took to close", () => {
  test("returns the elapsed minutes between raised and resolved", () => {
    assert.equal(resolveMinutes({
      status: "RESOLVED",
      createdAt: "2026-07-30T10:00:00Z",
      resolvedAt: "2026-07-30T10:35:00Z",
    }), 35);
  });

  test("rounds to the nearest minute", () => {
    assert.equal(resolveMinutes({
      status: "RESOLVED",
      createdAt: "2026-07-30T10:00:00Z",
      resolvedAt: "2026-07-30T10:02:40Z", // 2m40s → 3
    }), 3);
  });

  test("an OPEN ticket has no resolve time", () => {
    assert.equal(resolveMinutes({ status: "OPEN", createdAt: minsAgo(10) }), null);
  });

  test("RESOLVED without a resolvedAt stamp is null, not NaN", () => {
    assert.equal(resolveMinutes({ status: "RESOLVED", createdAt: minsAgo(10) }), null);
  });

  test("a resolvedAt earlier than createdAt is rejected", () => {
    // Guards against clock skew producing a negative "took -4m" in the UI.
    assert.equal(resolveMinutes({
      status: "RESOLVED",
      createdAt: "2026-07-30T10:00:00Z",
      resolvedAt: "2026-07-30T09:56:00Z",
    }), null);
  });

  test("null ticket is handled", () => {
    assert.equal(resolveMinutes(null), null);
  });
});
