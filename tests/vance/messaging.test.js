/**
 * Unit tests — MusterChat conversation keying (Vance, Screen 6).
 *
 * convoKey() must be order-independent for two staff accounts, so a message
 * from A→B and B→A resolve to the SAME thread; and account↔delegate threads are
 * per-staffer, so two different staff members talking to the same delegate keep
 * separate threads. This is the invariant the whole inbox relies on.
 *
 * Run from the repo root:  node --test "tests/vance/*.test.js"
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { convoKey } from "../../backend/routes/document.js";

describe("convoKey — staff ↔ staff", () => {
  test("is order-independent (A→B and B→A share one thread)", () => {
    assert.equal(convoKey("u-1", "account", "u-2"), convoKey("u-2", "account", "u-1"));
  });

  test("distinct pairs get distinct keys", () => {
    assert.notEqual(convoKey("u-1", "account", "u-2"), convoKey("u-1", "account", "u-3"));
  });

  test("uses the sorted 'a:<lo>|a:<hi>' shape", () => {
    assert.equal(convoKey("u-2", "account", "u-10"), "a:u-10|a:u-2"); // string sort, not numeric
    assert.equal(convoKey("u-10", "account", "u-2"), "a:u-10|a:u-2");
  });
});

describe("convoKey — staff → delegate", () => {
  test("is per-staffer (same delegate, different staff → different threads)", () => {
    assert.notEqual(convoKey("u-1", "delegate", "d-9"), convoKey("u-2", "delegate", "d-9"));
  });

  test("uses the 'a:<acct>|d:<delegate>' shape", () => {
    assert.equal(convoKey("u-1", "delegate", "d-9"), "a:u-1|d:d-9");
  });

  test("a delegate id never collides with an account id of the same value", () => {
    assert.notEqual(convoKey("u-1", "delegate", "u-2"), convoKey("u-1", "account", "u-2"));
  });
});
