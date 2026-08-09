/**
 * Unit tests — checked-in status (Jayden, frontend/src/lib/exception/exceptionsApi.js).
 *
 * WHY THIS MATTERS: isCheckedIn() is what decides whether the Exception Inbox
 * still offers the manual **Override** action on a ticket. Get it wrong in one
 * direction and staff are offered a pointless second override on someone who is
 * already boarded — which writes a duplicate row into check_in_logs. Get it
 * wrong in the other and a genuinely missing delegate can never be marked
 * present from the inbox at all.
 *
 * The subtlety it exists to absorb: the app carries TWO status vocabularies at
 * once. The five-status model is UNASSIGNED → ASSIGNED → ARRIVED / LATE /
 * MISSING, but the pre-migration value PRESENT is still written by parts of the
 * codebase and is treated as a legacy alias for ARRIVED. A bare
 * `status === "ARRIVED"` check silently mis-handles every PRESENT row.
 *
 * Run from the repo root:  node --test tests/jayden/*.test.js
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

/* exceptionsApi.js pulls in the shared api.js + offline outbox, which read
 * localStorage at call time. Stub the browser globals before importing so the
 * module graph loads under plain Node. */
class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new FakeStorage();
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const { isCheckedIn, CHECKED_IN_STATUSES } =
  await import("../../frontend/src/lib/exception/exceptionsApi.js");

describe("isCheckedIn — which statuses count as boarded", () => {
  test("ARRIVED is checked in (the five-status model's value)", () => {
    assert.equal(isCheckedIn("ARRIVED"), true);
  });

  test("PRESENT is checked in (legacy alias, still written by check-in routes)", () => {
    // The regression this guards: dropping PRESENT would make the inbox offer
    // Override on delegates who are already boarded.
    assert.equal(isCheckedIn("PRESENT"), true);
  });

  test("statuses that are NOT boarded stay false", () => {
    for (const s of ["MISSING", "LATE", "ASSIGNED", "UNASSIGNED"]) {
      assert.equal(isCheckedIn(s), false, `${s} must not count as checked in`);
    }
  });

  test("LATE is not checked in — a late delegate still has not boarded", () => {
    // Called out separately because it is the easiest one to get wrong: LATE
    // sits alongside ARRIVED in the enum but means the opposite for boarding.
    assert.equal(isCheckedIn("LATE"), false);
  });

  test("missing / malformed values are false, never throw", () => {
    for (const s of [null, undefined, "", "arrived", "Present", 0, 42, {}, []]) {
      assert.equal(isCheckedIn(s), false, `${JSON.stringify(s)} must be false`);
    }
  });

  test("comparison is case-sensitive — statuses are stored uppercase", () => {
    assert.equal(isCheckedIn("arrived"), false);
    assert.equal(isCheckedIn("ARRIVED"), true);
  });

  test("CHECKED_IN_STATUSES is exactly the two boarded values", () => {
    assert.deepEqual([...CHECKED_IN_STATUSES].sort(), ["ARRIVED", "PRESENT"]);
  });
});
