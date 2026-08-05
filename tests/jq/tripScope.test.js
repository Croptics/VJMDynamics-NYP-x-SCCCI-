/**
 * Unit tests — shared account→trip scoping (JQ, frontend/src/lib/tripScope.js).
 *
 * WHY THIS FILE EXISTS (2026-08-04, AI Log 247-250): the mobile shell and the
 * desktop Dashboard each carried their OWN duplicated copy of this filter and
 * tie-break. The mobile copy silently threw `ReferenceError: setMobileTripId is
 * not defined` from inside a swallowing try/catch, so for hours the app looked
 * completely healthy while every trip-scope correction quietly did nothing —
 * desktop showed the right trip, mobile showed a stale one, and neither
 * `npx vite build` nor the (then) 149-test suite could see it: Rollup treats an
 * unknown identifier as a runtime global, and nothing mounted the component.
 *
 * The decision is now ONE pure function, and these tests pin its behaviour so
 * a future drift or missing wire-up fails here instead of in someone's hand.
 *
 * Run from the repo root:  node --test tests/jq/*.test.js
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scopedTripIds, pickScopedTripId } from "../../frontend/src/lib/tripScope.js";

const coach = (tripId, tripStatus, coachId = "c1") => ({
  coachId, coachLabel: "Coach 1", tripId, tripName: `Trip ${tripId}`, tripStatus,
});

describe("tripScope — which trip an account is scoped to", () => {
  test("a single in-progress captaincy is the scope (the everyday case)", () => {
    const coaches = [coach("manila", "In progress")];
    assert.deepEqual(scopedTripIds(coaches), ["manila"]);
    assert.equal(pickScopedTripId(coaches), "manila");
  });

  test("an IN-PROGRESS trip outranks a stale Planning leftover", () => {
    // The exact shape that broke real testing: an account reassigned to a new
    // trip while an older Planning-trip captaincy was never cleaned up. Before
    // this rule, two candidates read as "ambiguous" and the app gave up,
    // silently leaving the user on whatever was cached (usually Beijing/t-1).
    const coaches = [coach("old-planning", "Planning", "c1"), coach("manila", "In progress", "c2")];
    assert.deepEqual(scopedTripIds(coaches), ["manila"]);
    assert.equal(pickScopedTripId(coaches), "manila");
  });

  test("COMPLETED trips are dropped entirely", () => {
    const coaches = [coach("beijing", "Completed", "c1"), coach("manila", "In progress", "c2")];
    assert.deepEqual(scopedTripIds(coaches), ["manila"]);
    assert.equal(pickScopedTripId(coaches), "manila");
  });

  test("a lone Planning captaincy still scopes (nothing in progress yet)", () => {
    const coaches = [coach("bangkok", "Planning")];
    assert.equal(pickScopedTripId(coaches), "bangkok");
  });

  test("several coaches on the SAME trip is still one unambiguous scope", () => {
    const coaches = [coach("manila", "In progress", "c1"), coach("manila", "In progress", "c2")];
    assert.deepEqual(scopedTripIds(coaches), ["manila"]);
    assert.equal(pickScopedTripId(coaches), "manila");
  });

  test("no captaincies at all → null (never guess; leave the cache alone)", () => {
    assert.equal(pickScopedTripId([]), null);
    assert.equal(pickScopedTripId(null), null);
    assert.equal(pickScopedTripId(undefined), null);
  });

  test("every captaincy Completed → null, not an empty-array crash", () => {
    assert.deepEqual(scopedTripIds([coach("beijing", "Completed")]), []);
    assert.equal(pickScopedTripId([coach("beijing", "Completed")]), null);
  });

  test("genuinely ambiguous (two Planning trips) → null rather than a coin flip", () => {
    const coaches = [coach("a", "Planning", "c1"), coach("b", "Planning", "c2")];
    assert.equal(scopedTripIds(coaches).length, 2);
    assert.equal(pickScopedTripId(coaches), null);
  });

  test("rows with a null/missing tripId are ignored, not counted as candidates", () => {
    // A null tripId used to survive into the candidate set and make a
    // single-trip account look ambiguous, silently disabling the correction.
    const coaches = [{ coachId: "c0", tripId: null, tripStatus: "In progress" }, coach("manila", "In progress", "c1")];
    assert.deepEqual(scopedTripIds(coaches), ["manila"]);
    assert.equal(pickScopedTripId(coaches), "manila");
  });

  test("tolerates a payload with no tripStatus at all (older backend)", () => {
    // If the backend hasn't been restarted with the tripStatus column, every
    // status is undefined — the fallback must still scope a single-trip
    // account rather than bailing out.
    const coaches = [{ coachId: "c1", tripId: "manila" }];
    assert.equal(pickScopedTripId(coaches), "manila");
  });
});
