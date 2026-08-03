/**
 * Unit tests — reassignment decision core
 * (Desmond, backend/routes/reassign-core.js — the pure heart of
 *  PATCH /api/trips/:tripId/reassign in trip.js).
 *
 * The Trips board's reassign is the one write that MUST be defended server-side:
 * it can overfill a coach, cross trips, or be raced by a second coordinator.
 * Those rules were pulled out of the route into one pure function so they can be
 * pinned here directly — no DB, no server, no browser.
 *
 * Run from the repo root:  node --test "tests/desmond/*.test.js"
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateReassign } from "../../backend/routes/reassign-core.js";

const TRIP = "trip-beijing";

/** A valid delegate on this trip (ARRIVED on Coach 1 by default). */
function delegate(over = {}) { return { tripId: TRIP, coachId: "c1", status: "ARRIVED", ...over }; }
/** A valid target coach on this trip (40 seats by default). */
function coach(over = {}) { return { tripId: TRIP, capacity: 40, label: "Coach 2", ...over }; }
/** Evaluate a move on this trip, filling in the trip id. */
function move(args) { return evaluateReassign({ tripUuid: TRIP, ...args }); }

describe("guards — the delegate and coach must be real and on THIS trip", () => {
  test("a missing delegate is 404 NOT_FOUND", () => {
    const r = move({ delegate: null, toCoachId: "c2", coach: coach() });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
    assert.equal(r.code, "NOT_FOUND");
  });

  test("a delegate belonging to another trip is 400 WRONG_TRIP", () => {
    const r = move({ delegate: delegate({ tripId: "trip-manila" }), toCoachId: "c2", coach: coach() });
    assert.equal(r.status, 400);
    assert.equal(r.code, "WRONG_TRIP");
  });

  test("a target coach that doesn't exist is 404 COACH_NOT_FOUND", () => {
    const r = move({ delegate: delegate(), toCoachId: "c99", coach: null });
    assert.equal(r.status, 404);
    assert.equal(r.code, "COACH_NOT_FOUND");
  });

  test("a target coach from ANOTHER trip is 400 COACH_WRONG_TRIP — the 'wrong coach' fix", () => {
    // This is the root-cause guard: a delegate must never end up pointing at a
    // coach that isn't on their trip.
    const r = move({ delegate: delegate(), toCoachId: "c2", coach: coach({ tripId: "trip-manila" }) });
    assert.equal(r.status, 400);
    assert.equal(r.code, "COACH_WRONG_TRIP");
  });
});

describe("no-op — moving somewhere they already are does nothing", () => {
  test("dropping onto the coach they're already on is a no-op (no history, no capacity check)", () => {
    const r = move({ delegate: delegate({ coachId: "c1" }), toCoachId: "c1", coach: coach() });
    assert.equal(r.ok, true);
    assert.equal(r.noop, true);
  });

  test("unassigning an already-unassigned delegate is a no-op", () => {
    const r = move({ delegate: delegate({ coachId: null, status: "UNASSIGNED" }), toCoachId: null });
    assert.equal(r.ok, true);
    assert.equal(r.noop, true);
  });
});

describe("capacity — real server-side seat enforcement", () => {
  const unassigned = () => delegate({ coachId: null, status: "UNASSIGNED" });

  test("a full coach is rejected 409 CAPACITY_FULL, carrying used/capacity for the UI", () => {
    const r = move({ delegate: unassigned(), toCoachId: "c2", coach: coach({ capacity: 40 }), occupied: 40 });
    assert.equal(r.status, 409);
    assert.equal(r.code, "CAPACITY_FULL");
    assert.equal(r.used, 40);
    assert.equal(r.capacity, 40);
    assert.match(r.message, /full/i);
  });

  test("override:true pushes the move through anyway (the confirm-override path)", () => {
    const r = move({ delegate: unassigned(), toCoachId: "c2", coach: coach({ capacity: 40 }), occupied: 40, override: true });
    assert.equal(r.ok, true);
    assert.equal(r.coachId, "c2");
  });

  test("capacity 0 means 'unmetered' — never full, however many are aboard", () => {
    const r = move({ delegate: unassigned(), toCoachId: "c2", coach: coach({ capacity: 0 }), occupied: 999 });
    assert.equal(r.ok, true);
  });

  test("one free seat is fine", () => {
    const r = move({ delegate: unassigned(), toCoachId: "c2", coach: coach({ capacity: 40 }), occupied: 39 });
    assert.equal(r.ok, true);
  });

  test("exactly at capacity counts as full (>=, not >)", () => {
    const r = move({ delegate: unassigned(), toCoachId: "c2", coach: coach({ capacity: 1 }), occupied: 1 });
    assert.equal(r.code, "CAPACITY_FULL");
  });
});

describe("optimistic locking — two coordinators can't silently clobber each other", () => {
  test("a stale expectedCoachId is 409 CONFLICT and reports where the delegate REALLY is", () => {
    // The client thinks they're still on c3; the server row says c1.
    const r = move({ delegate: delegate({ coachId: "c1" }), toCoachId: "c2", coach: coach(), hasExpected: true, expectedCoachId: "c3" });
    assert.equal(r.status, 409);
    assert.equal(r.code, "CONFLICT");
    assert.equal(r.currentCoachId, "c1");
  });

  test("a matching expectedCoachId proceeds", () => {
    const r = move({ delegate: delegate({ coachId: "c1" }), toCoachId: "c2", coach: coach(), hasExpected: true, expectedCoachId: "c1" });
    assert.equal(r.ok, true);
  });

  test("null expected matches an Unassigned delegate (IS NOT DISTINCT FROM semantics)", () => {
    const r = move({ delegate: delegate({ coachId: null, status: "UNASSIGNED" }), toCoachId: "c2", coach: coach(), hasExpected: true, expectedCoachId: null });
    assert.equal(r.ok, true);
  });

  test("an offline replay (no expectedCoachId sent) skips the lock — last-write-wins", () => {
    // hasExpected:false is exactly how a queued offline move replays on reconnect;
    // it must apply even though the world moved on, not 409.
    const r = move({ delegate: delegate({ coachId: "c1" }), toCoachId: "c2", coach: coach(), hasExpected: false, expectedCoachId: "c3" });
    assert.equal(r.ok, true);
  });
});

describe("captain scoping — a coach captain only moves their own coach's people", () => {
  const mine = new Set(["c1"]);

  test("cannot move a delegate OFF a coach they can't see", () => {
    const r = move({ delegate: delegate({ coachId: "c2" }), toCoachId: "c1", coach: coach(), visibleCoachIds: mine });
    assert.equal(r.status, 403);
    assert.equal(r.code, "FORBIDDEN");
  });

  test("cannot move a delegate ONTO a coach they can't see", () => {
    const r = move({ delegate: delegate({ coachId: "c1" }), toCoachId: "c2", coach: coach(), visibleCoachIds: mine });
    assert.equal(r.code, "FORBIDDEN");
  });

  test("CAN release their own delegate to Unassigned", () => {
    const r = move({ delegate: delegate({ coachId: "c1", status: "ARRIVED" }), toCoachId: null, visibleCoachIds: mine });
    assert.equal(r.ok, true);
    assert.equal(r.status, "UNASSIGNED");
  });

  test("an admin (visibleCoachIds = null) is unrestricted", () => {
    const r = move({ delegate: delegate({ coachId: "c2" }), toCoachId: "c3", coach: coach(), visibleCoachIds: null });
    assert.equal(r.ok, true);
  });
});

describe("status follows the coach", () => {
  test("Unassigned → Assigned when placed on a coach (expected, not yet checked in)", () => {
    const r = move({ delegate: delegate({ coachId: null, status: "UNASSIGNED" }), toCoachId: "c2", coach: coach() });
    assert.equal(r.status, "ASSIGNED");
    assert.equal(r.coachId, "c2");
  });

  for (const s of ["ARRIVED", "LATE", "MISSING"]) {
    test(`a real attendance status (${s}) is preserved across a coach change`, () => {
      const r = move({ delegate: delegate({ coachId: "c1", status: s }), toCoachId: "c2", coach: coach() });
      assert.equal(r.status, s);
    });
  }

  test("releasing to no coach sets status UNASSIGNED and clears the coach", () => {
    const r = move({ delegate: delegate({ coachId: "c1", status: "ARRIVED" }), toCoachId: null });
    assert.equal(r.status, "UNASSIGNED");
    assert.equal(r.coachId, null);
  });
});

describe("precedence — the more actionable guard wins", () => {
  test("a wrong-trip coach is caught before capacity is ever considered", () => {
    const r = move({ delegate: delegate({ coachId: null, status: "UNASSIGNED" }), toCoachId: "c2", coach: coach({ tripId: "trip-manila", capacity: 1 }), occupied: 99 });
    assert.equal(r.code, "COACH_WRONG_TRIP");
  });

  test("a genuinely full coach surfaces CAPACITY_FULL even if the client is also stale", () => {
    // Capacity is checked before the lock, so the operator sees the real blocker
    // (the coach is full) rather than a confusing 'someone else moved it'.
    const r = move({ delegate: delegate({ coachId: "c1" }), toCoachId: "c2", coach: coach({ capacity: 1 }), occupied: 1, hasExpected: true, expectedCoachId: "c-stale" });
    assert.equal(r.code, "CAPACITY_FULL");
  });
});
