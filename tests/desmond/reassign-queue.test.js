/**
 * Unit tests — offline reassignment queue
 * (Desmond, frontend/src/lib/reassignQueue.js).
 *
 * The Trips board's reassign must survive a dead signal: queued when offline,
 * still visible after a reload, resolved so the optimistic UI stands, replayed
 * in order on reconnect, and NOT lost — while a genuine server refusal
 * (capacity/conflict/permission) still surfaces instead of being swallowed.
 * Pinned here against a fake localStorage and a controllable "network".
 *
 * Run from the repo root:  node --test "tests/desmond/*.test.js"
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ---- fakes the frontend modules read off the global scope ----------------- */
class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new FakeStorage();
// sessionStorage too (2026-08-02, integration): api.js's getToken() reads
// `localStorage.getItem(...) || sessionStorage.getItem(...)` — "remember me"
// picks which one holds the token. With only localStorage stubbed, the
// fallback threw a ReferenceError, and because that error carries no
// `.status` it looked exactly like an offline failure to isOfflineError() —
// so the two "online" tests below saw their request queued instead of sent.
globalThis.sessionStorage = new FakeStorage();
globalThis.crypto ??= (await import("node:crypto")).webcrypto;

/* A controllable fetch so we drive api.js's request layer directly — "offline"
 * (a rejection with no .status) vs a real HTTP response. */
let fetchImpl;
globalThis.fetch = (...args) => fetchImpl(...args);
function offline() { fetchImpl = async () => { throw new TypeError("Failed to fetch"); }; }
function respond(status, body) {
  fetchImpl = async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Import AFTER the globals exist (outbox reads localStorage; the module
// registers its outbox sender on import).
const outbox = await import("../../frontend/src/lib/outbox.js");
const rq = await import("../../frontend/src/lib/reassignQueue.js");

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  outbox.clearFailed();
  respond(200, { ok: true }); // default: online + succeeds
});

describe("applyQueuedReassigns — an offline move survives a reload", () => {
  test("overlays the queued target coach onto the server's stale roster + flags pendingSync", () => {
    outbox.enqueue({ kind: rq.REASSIGN_KIND, payload: { tripId: "t-1", delegateId: "d-4", toCoachId: "c3" }, meta: { delegateId: "d-4" } });
    // What the server returns after an offline reload: still the OLD coach.
    const fromServer = [
      { id: "d-4", name: "Chen Hao Ming", coachId: "c1", status: "ARRIVED" },
      { id: "d-5", name: "Yeo Pei Lin", coachId: null, status: "UNASSIGNED" },
    ];
    const merged = rq.applyQueuedReassigns(fromServer);
    assert.equal(merged[0].coachId, "c3", "the staff member's own move is shown, not the stale c1");
    assert.equal(merged[0].pendingSync, true, "flagged so the card can show it unsynced");
    assert.deepEqual(merged[1], fromServer[1], "untouched delegates pass through unchanged");
  });

  test("a queued unassign (toCoachId null) overlays as null", () => {
    outbox.enqueue({ kind: rq.REASSIGN_KIND, payload: { tripId: "t-1", delegateId: "d-4", toCoachId: null } });
    const merged = rq.applyQueuedReassigns([{ id: "d-4", coachId: "c1", status: "ARRIVED" }]);
    assert.equal(merged[0].coachId, null);
    assert.equal(merged[0].pendingSync, true);
  });

  test("the newest queued move wins when a delegate was moved twice offline", () => {
    outbox.enqueue({ kind: rq.REASSIGN_KIND, payload: { tripId: "t-1", delegateId: "d-4", toCoachId: "c2" } });
    outbox.enqueue({ kind: rq.REASSIGN_KIND, payload: { tripId: "t-1", delegateId: "d-4", toCoachId: "c3" } });
    const merged = rq.applyQueuedReassigns([{ id: "d-4", coachId: "c1" }]);
    assert.equal(merged[0].coachId, "c3");
  });

  test("returns the list untouched (same reference) when nothing is queued", () => {
    const list = [{ id: "d-1", coachId: "c1" }];
    assert.equal(rq.applyQueuedReassigns(list), list);
  });

  test("ignores other outbox kinds (e.g. attendance patches)", () => {
    outbox.enqueue({ kind: "delegates/patch", payload: { delegateId: "d-4", patch: { status: "MISSING" } } });
    const list = [{ id: "d-4", coachId: "c1" }];
    assert.equal(rq.applyQueuedReassigns(list), list, "not a reassign — left alone");
  });
});

describe("reassignRequest — online", () => {
  test("returns the server's updated delegate and queues nothing", async () => {
    respond(200, { id: "d-4", coachId: "c2", status: "ASSIGNED" });
    const res = await rq.reassignRequest("t-1", { delegateId: "d-4", toCoachId: "c2", expectedCoachId: "c1" });
    assert.equal(res.coachId, "c2");
    assert.equal(res.queued, undefined);
    assert.equal(outbox.pendingCount(), 0);
  });

  test("a real refusal (409 CAPACITY_FULL) THROWS — it is NOT queued", async () => {
    respond(409, { error: "CAPACITY_FULL", message: "Coach 2 is full (40/40 seats)." });
    await assert.rejects(
      () => rq.reassignRequest("t-1", { delegateId: "d-4", toCoachId: "c2", expectedCoachId: "c1" }),
      (err) => { assert.equal(err.status, 409); assert.equal(err.code, "CAPACITY_FULL"); return true; },
    );
    assert.equal(outbox.pendingCount(), 0, "a genuine rejection must not linger in the queue");
  });
});

describe("reassignRequest — offline", () => {
  test("queues the move and resolves { queued:true } so the optimistic UI stands", async () => {
    offline();
    const res = await rq.reassignRequest("t-1", { delegateId: "d-4", toCoachId: "c3", expectedCoachId: "c1" }, { label: "Chen Hao Ming" });
    assert.equal(res.queued, true);
    assert.equal(res.coachId, "c3");
    assert.equal(outbox.pendingCount(), 1);
    assert.equal(outbox.pending()[0].meta.label, "Chen Hao Ming");
  });

  test("the queued payload DROPS expectedCoachId (a deferred move applies last-write-wins)", async () => {
    offline();
    await rq.reassignRequest("t-1", { delegateId: "d-4", toCoachId: "c3", expectedCoachId: "c1" });
    const payload = outbox.pending()[0].payload;
    assert.equal("expectedCoachId" in payload, false, "no stale lock carried into the replay");
    assert.equal(payload.toCoachId, "c3");
    assert.ok(payload.clientEventId, "carries an idempotency key for safe replay");
  });
});

describe("replay — the queued move reaches the endpoint on reconnect", () => {
  test("flush sends each queued reassign, in the order it was made", async () => {
    offline();
    await rq.reassignRequest("t-1", { delegateId: "d-4", toCoachId: "c2" });
    await rq.reassignRequest("t-1", { delegateId: "d-5", toCoachId: "c3" });
    assert.equal(outbox.pendingCount(), 2);

    // "Reconnect": swap the sender for one that records what it would POST.
    const sent = [];
    outbox.registerSender(rq.REASSIGN_KIND, async (p) => { sent.push([p.delegateId, p.toCoachId]); return { ok: true }; });
    const r = await outbox.flush();

    assert.equal(r.sent, 2);
    assert.deepEqual(sent, [["d-4", "c2"], ["d-5", "c3"]], "FIFO order preserved");
    assert.equal(outbox.pendingCount(), 0);
  });
});
