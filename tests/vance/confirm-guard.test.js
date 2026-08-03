/**
 * Unit tests — Confirm-time junk guard (Vance, Screen 4).
 *
 * isPlausibleDelegate() decides whether an extracted/edited row is a real person
 * before it's written to the shared delegates table. It must reject stray test
 * entries (e.g. "jq") without rejecting genuinely short names like "Wu" or "Ng",
 * and must treat a 2-character CJK name as a complete name.
 *
 * Run from the repo root:  node --test "tests/vance/*.test.js"
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isPlausibleDelegate } from "../../backend/routes/document.js";

describe("isPlausibleDelegate — rejects junk, keeps real delegates", () => {
  describe("rejects stray / junk rows", () => {
    const junk = [
      ["a 2-char lowercase token with no other data ('jq')", { fullName: "jq" }],
      ["a single letter", { fullName: "j" }],
      ["symbols only", { fullName: "--" }],
      ["an empty name", { fullName: "" }],
      ["digits only", { fullName: "123" }],
      ["a bare short Latin name with no supporting field ('Wu')", { fullName: "Wu" }],
    ];
    for (const [label, row] of junk) {
      test(`rejects ${label}`, () => {
        assert.equal(isPlausibleDelegate(row), false);
      });
    }
  });

  describe("keeps genuine delegates", () => {
    const real = [
      ["a short name backed by a company ('Wu' @ Mencast)", { fullName: "Wu", company: "Mencast" }],
      ["a short name backed by a role ('Ng', Director)", { fullName: "Ng", role: "Director" }],
      ["a normal multi-word name", { fullName: "Li Wei" }],
      ["a full romanised name", { fullName: "Chew Kam Swee", company: "K.S. Chew & Co" }],
      ["a 2-character CJK name (a complete name)", { fullName: "陈伟" }],
      ["a 3-character CJK name", { fullName: "王小明" }],
      ["an otherwise-thin name rescued by an email", { fullName: "jq", email: "jq@example.com" }],
    ];
    for (const [label, row] of real) {
      test(`keeps ${label}`, () => {
        assert.equal(isPlausibleDelegate(row), true);
      });
    }
  });

  test("treats a missing fullName as invalid", () => {
    assert.equal(isPlausibleDelegate({}), false);
  });
});
