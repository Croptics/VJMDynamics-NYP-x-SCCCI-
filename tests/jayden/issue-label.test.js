/**
 * Unit tests — issue labelling and time display
 * (Jayden, frontend/src/lib/exception/exceptionsApi.js).
 *
 * WHY THIS MATTERS: every ticket in the inbox, the mobile inbox, the critical
 * banner and the CSV export is titled by issueLabel(). The awkward case is the
 * OTHER type: staff pick "Others" and type their own short label, which must be
 * shown instead of the useless generic word "Other" — but only when they
 * actually supplied one.
 *
 * fmtTime() is covered here too because it has to survive three different
 * shapes of input: an already-formatted "HH:MM" string from seed data, a real
 * ISO timestamp from Postgres, and junk.
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

const { issueLabel, fmtTime, ISSUE_LABEL, TYPE_OTHER_MAX } =
  await import("../../frontend/src/lib/exception/exceptionsApi.js");

describe("issueLabel — the title shown on every ticket", () => {
  test("maps each known enum value to its human label", () => {
    assert.equal(issueLabel({ type: "MISSING_PERSON" }), "Missing person");
    assert.equal(issueLabel({ type: "LOST_BADGE" }), "Lost badge");
    assert.equal(issueLabel({ type: "FACE_MATCH_FAILED" }), "Face match failed");
    assert.equal(issueLabel({ type: "DEAD_PHONE" }), "Dead phone");
    assert.equal(issueLabel({ type: "VIP_REQUEST" }), "VIP request");
  });

  test("OTHER shows the staff member's own label, not the word 'Other'", () => {
    assert.equal(
      issueLabel({ type: "OTHER", typeOther: "Lost luggage" }),
      "Lost luggage"
    );
  });

  test("OTHER with no label falls back to the generic word", () => {
    // The form blocks submitting an empty label, but tickets already in the
    // database predate that guard, so the fallback still has to hold.
    assert.equal(issueLabel({ type: "OTHER" }), "Other");
    assert.equal(issueLabel({ type: "OTHER", typeOther: "" }), "Other");
    assert.equal(issueLabel({ type: "OTHER", typeOther: null }), "Other");
  });

  test("typeOther is ignored for any type other than OTHER", () => {
    // A stray label on a MISSING_PERSON ticket must not hijack the title.
    assert.equal(
      issueLabel({ type: "MISSING_PERSON", typeOther: "ignore me" }),
      "Missing person"
    );
  });

  test("an unrecognised type degrades to the raw value rather than blank", () => {
    // Better to surface "SOMETHING_NEW" than an empty cell if the enum grows.
    assert.equal(issueLabel({ type: "SOMETHING_NEW" }), "SOMETHING_NEW");
  });

  test("a null/undefined ticket yields an empty string, never throws", () => {
    assert.equal(issueLabel(null), "");
    assert.equal(issueLabel(undefined), "");
  });

  test("every enum key in ISSUE_LABEL resolves to a non-empty label", () => {
    for (const key of Object.keys(ISSUE_LABEL)) {
      const label = issueLabel({ type: key });
      assert.ok(label && label.length > 0, `${key} must have a label`);
    }
  });

  test("the custom-label cap is the documented 20 characters", () => {
    // Mirrored in the DB column width and the backend validator; if this moves,
    // all three must move together.
    assert.equal(TYPE_OTHER_MAX, 20);
  });
});

describe("fmtTime — HH:MM display", () => {
  test("an already-formatted HH:MM string passes straight through", () => {
    assert.equal(fmtTime("14:08"), "14:08");
    assert.equal(fmtTime("09:00"), "09:00");
  });

  test("an ISO timestamp renders as 24-hour HH:MM", () => {
    const out = fmtTime("2026-07-30T10:35:00Z");
    assert.match(out, /^\d{2}:\d{2}$/, `expected HH:MM, got "${out}"`);
  });

  test("empty input renders as empty, not 'Invalid Date'", () => {
    assert.equal(fmtTime(null), "");
    assert.equal(fmtTime(undefined), "");
    assert.equal(fmtTime(""), "");
  });

  test("unparseable input is returned as-is rather than 'Invalid Date'", () => {
    assert.equal(fmtTime("sometime tuesday"), "sometime tuesday");
  });
});
