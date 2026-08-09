/**
 * Unit tests — Trip Assistant risk scoring (Vance, Screen 6).
 *
 * computeRisk(snapshot) ranks what an organiser should worry about, most-urgent
 * first: missing VIPs and CRITICAL exceptions outrank an operational gap (the
 * coach furthest from boarded), which outranks ordinary open tickets. Both the
 * fast-path "who should I worry about" answer and the model prompt use it.
 *
 * Run from the repo root:  node --test "tests/vance/*.test.js"
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeRisk } from "../../backend/routes/document.js";

describe("computeRisk — ranks concerns most-urgent first", () => {
  test("returns nothing when there is nothing to worry about", () => {
    const risks = computeRisk({ missing: [], exceptions: [], coaches: [] });
    assert.equal(risks.length, 0);
  });

  test("a missing VIP outranks a critical exception, which outranks a coach gap", () => {
    const risks = computeRisk({
      missing: [{ name: "Alice Tan", vip: true }, { name: "Bob Lim", vip: false }],
      exceptions: [{ type: "Passport issue", priority: "CRITICAL", delegate: "Cara Ng" }],
      coaches: [
        { name: "Coach 1", city: "Beijing", missing: 2 },
        { name: "Coach 2", city: "Shanghai", missing: 9 },
      ],
    });
    const levels = risks.map((r) => r.level);
    // VIP (critical) and exception (critical) come before the coach gap (high).
    assert.equal(risks[0].level, "critical");
    assert.match(risks[0].text, /VIP/);
    assert.match(risks[1].text, /Passport issue/);
    assert.equal(risks[risks.length - 1].level, "high");
    assert.match(risks[risks.length - 1].text, /Coach 2/); // the coach with the most missing
    assert.ok(levels.indexOf("critical") < levels.indexOf("high"));
  });

  test("names the coach furthest from boarded", () => {
    const risks = computeRisk({
      missing: [], exceptions: [],
      coaches: [
        { name: "Coach 1", missing: 3 },
        { name: "Coach 2", missing: 7 },
        { name: "Coach 3", missing: 0 },
      ],
    });
    assert.equal(risks.length, 1);
    assert.match(risks[0].text, /Coach 2/);
    assert.match(risks[0].text, /7 missing/);
  });

  test("a coach with nobody missing is not flagged", () => {
    const risks = computeRisk({ missing: [], exceptions: [], coaches: [{ name: "Coach 1", missing: 0 }] });
    assert.equal(risks.length, 0);
  });

  test("ordinary (non-critical) exceptions rank below everything else", () => {
    const risks = computeRisk({
      missing: [{ name: "Alice Tan", vip: true }],
      exceptions: [{ type: "Dietary note", priority: "NORMAL" }],
      coaches: [],
    });
    assert.equal(risks[0].level, "critical");
    assert.equal(risks[risks.length - 1].level, "medium");
    assert.match(risks[risks.length - 1].text, /other open exception/);
  });

  test("handles a missing/partial snapshot without throwing", () => {
    assert.deepEqual(computeRisk(undefined), []);
    assert.deepEqual(computeRisk({}), []);
  });
});
