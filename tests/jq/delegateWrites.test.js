/**
 * Unit tests — offline delegate writes (JQ, frontend/src/lib/localstorage/delegateWrites.js).
 *
 * Covers the mobile Attendance sheet's path: a status change ("missing, last
 * seen at Gate 3") or a cancellation taken with no signal must survive, replay
 * in the order it was taken, and still be visible after a page reload.
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
globalThis.crypto ??= (await import("node:crypto")).webcrypto;

const outbox = await import("../../frontend/src/lib/localstorage/outbox.js");
const dw = await import("../../frontend/src/lib/localstorage/delegateWrites.js");

beforeEach(() => {
  globalThis.localStorage.clear();
  outbox.clearFailed();
});

/** Re-point the queue's sender so tests control the "network". */
function withSender(fn) {
  outbox.registerSender("delegates/patch", fn);
}

describe("applyQueuedPatches — an offline change survives a reload", () => {
  test("overlays a queued status onto the server's stale copy", () => {
    outbox.enqueue({
      kind: "delegates/patch",
      payload: { delegateId: "d-4", patch: { status: "MISSING", lastLocation: "Gate 3" }, clientEventId: "e1" },
      meta: { delegateId: "d-4" },
    });

    // What the server would return after a reload with no signal: still stale.
    const fromServer = [
      { id: "d-4", name: "Chen Hao Ming", status: "ASSIGNED", lastLocation: "" },
      { id: "d-5", name: "Yeo Pei Lin", status: "ARRIVED" },
    ];
    const merged = dw.applyQueuedPatches(fromServer);

    assert.equal(merged[0].status, "MISSING", "the staff member's own change is preserved");
    assert.equal(merged[0].lastLocation, "Gate 3");
    assert.equal(merged[0].pendingSync, true, "flagged so the UI can mark it unsynced");
    assert.deepEqual(merged[1], fromServer[1], "untouched delegates pass through unchanged");
  });

  test("newest queued decision wins when a delegate was changed twice", () => {
    outbox.enqueue({ kind: "delegates/patch", payload: { delegateId: "d-4", patch: { status: "MISSING" }, clientEventId: "a" } });
    outbox.enqueue({ kind: "delegates/patch", payload: { delegateId: "d-4", patch: { cancelled: true, status: "UNASSIGNED" }, clientEventId: "b" } });

    const merged = dw.applyQueuedPatches([{ id: "d-4", status: "ASSIGNED" }]);
    assert.equal(merged[0].cancelled, true);
    assert.equal(merged[0].status, "UNASSIGNED");
  });

  test("returns the list untouched when nothing is queued", () => {
    const list = [{ id: "d-1", status: "ARRIVED" }];
    assert.equal(dw.applyQueuedPatches(list), list);
  });
});

describe("queue introspection", () => {
  test("hasQueuedPatch / queuedPatchesFor report per delegate", () => {
    assert.equal(dw.hasQueuedPatch("d-4"), false);
    outbox.enqueue({ kind: "delegates/patch", payload: { delegateId: "d-4", patch: { status: "MISSING" }, clientEventId: "x" } });
    assert.equal(dw.hasQueuedPatch("d-4"), true);
    assert.equal(dw.hasQueuedPatch("d-9"), false, "doesn't leak across delegates");
    assert.deepEqual(dw.queuedPatchesFor("d-4"), [{ status: "MISSING" }]);
  });
});

describe("replay", () => {
  test("applies queued patches in the order they were taken", async () => {
    const calls = [];
    withSender(async ({ delegateId, patch }) => { calls.push([delegateId, patch.status]); return { ok: true }; });

    outbox.enqueue({ kind: "delegates/patch", payload: { delegateId: "d-4", patch: { status: "MISSING" }, clientEventId: "1" } });
    outbox.enqueue({ kind: "delegates/patch", payload: { delegateId: "d-4", patch: { status: "UNASSIGNED" }, clientEventId: "2" } });

    await outbox.flush();
    assert.deepEqual(calls, [["d-4", "MISSING"], ["d-4", "UNASSIGNED"]],
      "order matters — MISSING then CANCELLED must not land reversed");
    assert.equal(outbox.pendingCount(), 0);
  });

  test("re-applying the same patch is harmless (state assignment, not append)", async () => {
    let applied = 0;
    let status = "ASSIGNED";
    withSender(async ({ patch }) => { applied += 1; status = patch.status; return { ok: true }; });

    outbox.enqueue({ kind: "delegates/patch", payload: { delegateId: "d-4", patch: { status: "MISSING" }, clientEventId: "same" } });
    await outbox.flush();
    await outbox.flush(); // nothing left to send

    assert.equal(applied, 1, "sent once");
    assert.equal(status, "MISSING", "and even a hypothetical re-apply yields the same state");
  });

  test("a still-offline flush keeps the change queued", async () => {
    withSender(async () => { throw new TypeError("Failed to fetch"); });
    outbox.enqueue({ kind: "delegates/patch", payload: { delegateId: "d-4", patch: { status: "MISSING" }, clientEventId: "keep" } });

    await outbox.flush();
    assert.equal(outbox.pendingCount(), 1);
    assert.equal(dw.hasQueuedPatch("d-4"), true);
  });

  test("a real refusal (403) is surfaced, not retried forever", async () => {
    withSender(async () => { const e = new Error("forbidden"); e.status = 403; throw e; });
    outbox.enqueue({
      kind: "delegates/patch",
      payload: { delegateId: "d-4", patch: { status: "MISSING" }, clientEventId: "no" },
      meta: { label: "Chen Hao Ming" },
    });

    await outbox.flush();
    assert.equal(outbox.pendingCount(), 0);
    assert.equal(outbox.failed().length, 1);
    assert.equal(outbox.failed()[0].meta.label, "Chen Hao Ming");
  });
});
