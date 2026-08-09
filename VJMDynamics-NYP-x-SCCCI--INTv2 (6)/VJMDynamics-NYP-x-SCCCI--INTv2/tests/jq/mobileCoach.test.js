/**
 * Unit tests — mobile coach scope (JQ, frontend/src/lib/mobileCoach.js).
 *
 * WHY: tapping a coach on mobile Home only affected the Attendance roster,
 * while the QR / Face / Manual scanners each auto-picked "first coach with
 * people" on their own — so Home → Coach 2 → QR scanned into Coach 1, a
 * wrong-coach check-in with nothing on screen to warn you (AI Log 259).
 * preferredCoachId() is now the single fallback chain all of them share, so
 * these tests pin it — especially the trip-switch case, where a remembered
 * coach belongs to a DIFFERENT trip and must be ignored rather than selected.
 *
 * Run from the repo root:  node --test tests/jq/*.test.js
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new FakeStorage();

const { getMobileCoachId, setMobileCoachId, preferredCoachId } =
  await import("../../frontend/src/lib/mobileCoach.js");

const coach = (id, total = 0) => ({ id, label: id.toUpperCase(), name: id, total });

describe("mobileCoach — which coach a scanner opens on", () => {
  beforeEach(() => { globalThis.localStorage.clear(); });

  test("remembered coach wins over the first-with-people default", () => {
    // The actual reported bug: c1 has people so the old logic always chose it,
    // even right after the user explicitly picked c2 on Home.
    setMobileCoachId("c2");
    assert.equal(preferredCoachId([coach("c1", 6), coach("c2", 2)]), "c2");
  });

  test("with nothing remembered, falls back to the first coach WITH people", () => {
    assert.equal(preferredCoachId([coach("c1", 0), coach("c2", 4)]), "c2");
  });

  test("with nothing remembered and nobody assigned, falls back to the first coach", () => {
    assert.equal(preferredCoachId([coach("c1", 0), coach("c2", 0)]), "c1");
  });

  test("a remembered coach from ANOTHER trip is ignored, not selected", () => {
    // The trip-switch case: the id is still in localStorage but isn't in this
    // trip's list. Selecting it would scan into a coach on a different trip.
    setMobileCoachId("beijing-c4");
    assert.equal(preferredCoachId([coach("bkk-c1", 0), coach("bkk-c2", 3)]), "bkk-c2");
  });

  test("empty / missing coach list returns null rather than throwing", () => {
    assert.equal(preferredCoachId([]), null);
    assert.equal(preferredCoachId(null), null);
    assert.equal(preferredCoachId(undefined), null);
  });

  test("set/get round-trips, and a falsy id clears the preference", () => {
    setMobileCoachId("c9");
    assert.equal(getMobileCoachId(), "c9");
    setMobileCoachId(null);
    assert.equal(getMobileCoachId(), null);
  });

  test("survives localStorage throwing (private mode / quota)", () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    };
    try {
      assert.doesNotThrow(() => setMobileCoachId("c1"));
      assert.equal(getMobileCoachId(), null);
      // Still resolves a sensible coach with no storage available at all.
      assert.equal(preferredCoachId([coach("c1", 0), coach("c2", 5)]), "c2");
    } finally {
      globalThis.localStorage = real;
    }
  });
});
