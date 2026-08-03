/**
 * Unit tests — Trip Assistant fast-path (Vance, Screen 6).
 *
 * answerLocally() returns an instant, deterministic answer to common factual
 * questions straight from the live snapshot (no LLM call), or null to let the
 * model handle anything open-ended. These tests pin the routing: the right
 * questions get answered from data, and open-ended / unknown ones return null.
 *
 * Run from the repo root:  node --test "tests/vance/*.test.js"
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { answerLocally } from "../../backend/routes/document.js";

/** A representative snapshot in the exact shape buildSnapshot() produces. */
function makeSnapshot() {
  return {
    trip: { name: "Beijing study mission" },
    kpis: { total: 33, present: 8, missing: 20, unassigned: 5 },
    coaches: [
      { id: "c1", label: "C1", name: "Coach 1", city: "Beijing", boarded: 6, missing: 4, total: 10, capacity: 40 },
      { id: "c2", label: "C2", name: "Coach 2", city: "Shanghai", boarded: 2, missing: 12, total: 14, capacity: 40 },
    ],
    missing: [
      { name: "Alice Tan", vip: true, coach: "Coach 2 · Shanghai", lastSeen: "unknown" },
      { name: "Bob Lim", vip: false, coach: "Coach 1 · Beijing" },
    ],
    roster: [
      { name: "Alice Tan", company: "Acme Corp", industry: "Finance", role: "Director", status: "MISSING", vip: true, coach_id: "c2" },
      { name: "Dane Soh", company: "SJ Digital Media", industry: "Media", role: "Producer", status: "PRESENT", vip: false, coach_id: "c1" },
      { name: "Cara Ng", company: "Acme Corp", industry: "Finance", role: "Analyst", status: "UNASSIGNED", vip: false, coach_id: null },
    ],
    byCompany: [["Acme Corp", 5], ["SJ Digital Media", 3]],
    byIndustry: [["Finance", 6], ["Media", 2]],
    vips: [{ name: "Alice Tan", company: "Acme Corp", status: "MISSING", vip: true }],
    exceptions: [{ type: "Passport expiring", priority: "CRITICAL", delegate: "Alice Tan" }],
    itinerary: [{ start_time: "09:00", title: "Opening ceremony", location: "Great Hall" }],
  };
}

describe("answerLocally — deterministic snapshot answers", () => {
  const snap = makeSnapshot();

  test("greets and offers capabilities", () => {
    const a = answerLocally("hi", snap);
    assert.match(a, /Beijing study mission/);
  });

  test("attendance summary returns the exact KPI sentence", () => {
    const a = answerLocally("give me an attendance summary", snap);
    assert.equal(a, "33 delegates total — 8 present, 20 missing, 5 unassigned (not yet on a coach).");
  });

  test("present count cites present and total", () => {
    const a = answerLocally("how many are checked in?", snap);
    assert.match(a, /\b8\b/);
    assert.match(a, /\b33\b/);
  });

  test("does NOT mis-fire on 'presentation'", () => {
    // 'present' as a substring of another word must not trigger the present intent.
    const a = answerLocally("when is the presentation", snap);
    assert.equal(a, null);
  });

  test("missing count when asked 'how many'", () => {
    const a = answerLocally("how many delegates are missing?", snap);
    assert.match(a, /\b20\b/);
  });

  test("missing list when asked 'who', VIP first", () => {
    const a = answerLocally("who is missing?", snap);
    assert.match(a, /Alice Tan/);
    assert.match(a, /\(VIP\)/);
    assert.ok(a.indexOf("Alice Tan") < a.indexOf("Bob Lim"), "VIP should be listed first");
  });

  test("coach with the most missing", () => {
    const a = answerLocally("which coach has the most missing?", snap);
    assert.match(a, /Coach 2/);
    assert.match(a, /\b12\b/);
  });

  test("coach with the fewest missing", () => {
    const a = answerLocally("which coach has the fewest missing?", snap);
    assert.match(a, /Coach 1/);
    assert.match(a, /\b4\b/);
  });

  test("company breakdown lists top companies", () => {
    const a = answerLocally("break down delegates by company", snap);
    assert.match(a, /Acme Corp/);
    assert.match(a, /SJ Digital Media/);
  });

  test("industry breakdown lists top industries", () => {
    const a = answerLocally("which industries are represented?", snap);
    assert.match(a, /Finance/);
  });

  test("VIP query flags the missing VIP", () => {
    const a = answerLocally("show me the VIPs", snap);
    assert.match(a, /Alice Tan/);
    assert.match(a, /missing/);
  });

  test("open exceptions are listed", () => {
    const a = answerLocally("any open exceptions?", snap);
    assert.match(a, /Passport expiring/);
    assert.match(a, /CRITICAL/);
  });

  test("today's itinerary is returned", () => {
    const a = answerLocally("what's on today's itinerary?", snap);
    assert.match(a, /Opening ceremony/);
    assert.match(a, /09:00/);
  });

  test("risk question surfaces the missing VIP and critical exception", () => {
    const a = answerLocally("who should I worry about right now?", snap);
    assert.match(a, /Alice Tan/);
    assert.match(a, /critical/i);
  });

  describe("person look-up by name", () => {
    test("'what company is X from' returns that delegate's company + status", () => {
      const a = answerLocally("what company is Dane Soh from?", snap);
      assert.match(a, /SJ Digital Media/);
      assert.match(a, /checked in/);
    });

    test("'is X here' returns that delegate's status, not an aggregate", () => {
      const a = answerLocally("is Alice Tan here?", snap);
      assert.match(a, /Alice Tan/);
      assert.match(a, /missing/);
      assert.doesNotMatch(a, /33 delegates total/); // must not be the attendance summary
    });
  });

  describe("falls through to the model (returns null)", () => {
    test("out-of-scope question", () => {
      assert.equal(answerLocally("what's the weather in Beijing?", snap), null);
    });

    test("open-ended advice question", () => {
      assert.equal(answerLocally("draft an email to the missing delegates", snap), null);
    });

    test("empty input", () => {
      assert.equal(answerLocally("", snap), null);
      assert.equal(answerLocally(null, snap), null);
    });
  });
});
