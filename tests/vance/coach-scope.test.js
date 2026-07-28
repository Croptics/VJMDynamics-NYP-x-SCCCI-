/**
 * Unit tests — coach-scoped assistant look-ups (Vance, Screen 6).
 *
 * "Who is missing from Coach 2?" (the app's very first suggested prompt) must
 * answer about Coach 2 specifically, not the whole trip. These pin that the
 * missing/present intents honour a named coach, and that an unscoped question
 * still returns the trip-wide answer.
 *
 * Run from the repo root:  node --test "tests/vance/*.test.js"
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { answerLocally } from "../../backend/routes/vance.js";

/** A small, internally-consistent snapshot: 3 missing across 2 coaches. */
function snap() {
  return {
    trip: { name: "Beijing study mission" },
    kpis: { total: 6, present: 2, missing: 3, unassigned: 1 },
    coaches: [
      { id: "c1", label: "Coach 1", name: "Coach 1", boarded: 1, missing: 1 },
      { id: "c2", label: "Coach 2", name: "Coach 2", boarded: 1, missing: 2 },
    ],
    missing: [
      { name: "Alice Tan", vip: true, coach_id: "c2", coach: "Coach 2" },
      { name: "Bob Lim", vip: false, coach_id: "c2", coach: "Coach 2" },
      { name: "Cara Ng", vip: false, coach_id: "c1", coach: "Coach 1" },
    ],
    roster: [
      { name: "Alice Tan", status: "MISSING", coach_id: "c2", vip: true },
      { name: "Bob Lim", status: "ASSIGNED", coach_id: "c2", vip: false },
      { name: "Dan Ong", status: "PRESENT", coach_id: "c2", vip: false },
      { name: "Cara Ng", status: "MISSING", coach_id: "c1", vip: false },
    ],
  };
}

describe("coach-scoped missing look-ups", () => {
  const s = snap();

  test("'who is missing from Coach 2?' lists ONLY Coach 2's missing", () => {
    const a = answerLocally("who is missing from Coach 2?", s);
    assert.match(a, /Alice Tan/);
    assert.match(a, /Bob Lim/);
    assert.doesNotMatch(a, /Cara Ng/); // Cara is on Coach 1 — must be excluded
    assert.match(a, /Coach 2/);
  });

  test("'how many are missing on Coach 1?' counts just that coach", () => {
    const a = answerLocally("how many are missing on Coach 1?", s);
    assert.match(a, /\b1\b/);
    assert.match(a, /Coach 1/);
  });

  test("unscoped 'who is missing?' still lists everyone", () => {
    const a = answerLocally("who is missing?", s);
    assert.match(a, /Alice Tan/);
    assert.match(a, /Cara Ng/);
  });

  test("coach-scoped present count", () => {
    const a = answerLocally("how many are checked in on Coach 2?", s);
    // Coach 2 has 3 delegates (Alice, Bob, Dan); 1 boarded (Dan = PRESENT).
    assert.match(a, /\b1\b/);
    assert.match(a, /\b3\b/);
    assert.match(a, /Coach 2/);
  });
});
