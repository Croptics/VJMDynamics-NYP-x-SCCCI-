/**
 * Unit tests — offline write queue (JQ, frontend/src/lib/outbox.js).
 *
 * The whole offline attendance feature rests on one property: a queued write is
 * applied EXACTLY ONCE, no matter how many times it's replayed. These tests
 * exercise that directly against a fake localStorage and a fake sender, with no
 * browser and no backend.
 *
 * Run from the repo root:  node --test tests/jq/*.test.js
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ---- minimal localStorage stand-in (outbox.js reads the global) ---------- */
class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new FakeStorage();

// Import AFTER localStorage exists, since the module reads it lazily but the
// first call happens during these tests.
const outbox = await import("../../frontend/src/lib/outbox.js");

/** An HTTP-style failure, the shape lib/api.js throws (has .status). */
function httpError(status, message = "boom") {
  const e = new Error(message);
  e.status = status;
  return e;
}
/** A network failure, the shape fetch() rejection produces (NO .status). */
function networkError() {
  return new TypeError("Failed to fetch");
}

const PAYLOAD = (id) => ({
  tripId: "t-1",
  delegateId: "d-7",
  clientEventId: id,
  clientTs: "2026-07-28T09:05:00.000Z",
  isOfflineOrigin: true,
});

beforeEach(() => {
  globalThis.localStorage.clear();
  outbox.clearFailed();
});

describe("isOfflineError — only queue when the server was never reached", () => {
  test("a fetch rejection counts as offline", () => {
    assert.equal(outbox.isOfflineError(networkError()), true);
  });
  test("an HTTP error does NOT count as offline", () => {
    for (const s of [400, 401, 403, 404, 409, 500]) {
      assert.equal(outbox.isOfflineError(httpError(s)), false, `status ${s}`);
    }
  });
});

describe("enqueue — durable, ordered, idempotency key preserved", () => {
  test("queues and reports a pending count", () => {
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("evt-1"), meta: { delegateId: "d-7" } });
    assert.equal(outbox.pendingCount(), 1);
  });

  test("uses the payload's clientEventId as the entry id (so replay reuses it)", () => {
    const e = outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("evt-abc") });
    assert.equal(e.id, "evt-abc");
    assert.equal(outbox.pending()[0].payload.clientEventId, "evt-abc");
  });

  test("preserves the original clientTs, not the sync time", () => {
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("evt-2") });
    assert.equal(outbox.pending()[0].payload.clientTs, "2026-07-28T09:05:00.000Z");
  });

  test("survives a 'reload' — state lives in storage, not memory", async () => {
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("evt-3") });
    const fresh = await import("../../frontend/src/lib/outbox.js?reload=1");
    assert.equal(fresh.pendingCount(), 1);
  });
});

describe("flush — the exactly-once guarantee", () => {
  test("sends each queued write once and drains the queue", async () => {
    const sent = [];
    outbox.registerSender("checkins/manual", async (p) => { sent.push(p.clientEventId); return { ok: true }; });
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("a") });
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("b") });

    const r = await outbox.flush();
    assert.equal(r.sent, 2);
    assert.deepEqual(sent, ["a", "b"], "FIFO order");
    assert.equal(outbox.pendingCount(), 0);
  });

  test("flushing twice does NOT re-send anything", async () => {
    const sent = [];
    outbox.registerSender("checkins/manual", async (p) => { sent.push(p.clientEventId); return { ok: true }; });
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("once") });

    await outbox.flush();
    await outbox.flush();
    await outbox.flush();
    assert.deepEqual(sent, ["once"], "sent exactly once across three flushes");
  });

  test("a duplicate response still drains the entry (server already had it)", async () => {
    outbox.registerSender("checkins/manual", async () => ({ duplicate: true }));
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("dup") });
    await outbox.flush();
    assert.equal(outbox.pendingCount(), 0);
  });

  test("the SAME clientEventId is used on every retry", async () => {
    const seen = [];
    let failTimes = 2;
    outbox.registerSender("checkins/manual", async (p) => {
      seen.push(p.clientEventId);
      if (failTimes-- > 0) throw networkError();
      return { ok: true };
    });
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("stable-id") });

    await outbox.flush(); // offline
    await outbox.flush(); // still offline
    await outbox.flush(); // back online
    assert.deepEqual(seen, ["stable-id", "stable-id", "stable-id"]);
    assert.equal(outbox.pendingCount(), 0);
  });
});

describe("flush — failure handling", () => {
  test("still offline: keeps the queue intact and stops early (order preserved)", async () => {
    const sent = [];
    outbox.registerSender("checkins/manual", async (p) => { sent.push(p.clientEventId); throw networkError(); });
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("x") });
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("y") });

    const r = await outbox.flush();
    assert.equal(r.sent, 0);
    assert.equal(r.stopped, true);
    assert.equal(outbox.pendingCount(), 2, "nothing dropped");
    assert.deepEqual(sent, ["x"], "stopped at the first failure instead of hammering");
  });

  test("a real refusal (403) is moved to failed, not retried forever", async () => {
    outbox.registerSender("checkins/manual", async () => { throw httpError(403, "no permission"); });
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("nope"), meta: { label: "Lim Wei Jie" } });

    await outbox.flush();
    assert.equal(outbox.pendingCount(), 0, "removed from the retry queue");
    assert.equal(outbox.failed().length, 1);
    assert.equal(outbox.failed()[0].meta.label, "Lim Wei Jie");
    assert.match(outbox.failed()[0].lastError, /no permission/);
  });

  test("an expired session (401) is KEPT for after re-login, not discarded", async () => {
    outbox.registerSender("checkins/manual", async () => { throw httpError(401, "expired"); });
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("keepme") });

    await outbox.flush();
    assert.equal(outbox.pendingCount(), 1, "a real attendance action must not be lost to a token refresh");
    assert.equal(outbox.failed().length, 0);
  });

  test("a 500 is kept and retried later (server fault, not our data)", async () => {
    outbox.registerSender("checkins/manual", async () => { throw httpError(500); });
    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("srv") });
    await outbox.flush();
    assert.equal(outbox.pendingCount(), 1);
  });

  test("no registered sender: keeps the entry rather than dropping it", async () => {
    outbox.enqueue({ kind: "unknown/kind", payload: { clientEventId: "u1" } });
    const r = await outbox.flush();
    assert.equal(r.sent, 0);
    assert.equal(outbox.pendingCount(), 1);
  });
});

describe("subscribe — drives the sync pill", () => {
  test("fires on enqueue and on drain, with the current counts", async () => {
    const seen = [];
    const unsub = outbox.subscribe((s) => seen.push(s.pending));
    outbox.registerSender("checkins/manual", async () => ({ ok: true }));

    outbox.enqueue({ kind: "checkins/manual", payload: PAYLOAD("s1") });
    await outbox.flush();
    unsub();

    assert.ok(seen.includes(1), "saw the queued state");
    assert.equal(seen[seen.length - 1], 0, "ended drained");
  });
});
