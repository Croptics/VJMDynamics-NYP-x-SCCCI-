/**
 * Unit tests — Document Parsing helpers (Vance, Screen 4).
 *
 * Covers the pure functions that turn a messy LLM reply into clean, structured
 * delegate rows: JSON extraction, bilingual name tidying, de-duplication, the
 * romanised-over-CJK preference, the full finalize pipeline, and row shaping.
 *
 * Run from the repo root:  node --test "tests/vance/*.test.js"
 * (Node's built-in test runner — no external test framework required.)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractRecords,
  cleanName,
  dedupeByName,
  preferRomanised,
  finalizeRecords,
  toRow,
} from "../../backend/routes/vance.js";

describe("extractRecords — robustly pulls a records array out of an LLM reply", () => {
  test("parses a bare JSON array", () => {
    const out = extractRecords('[{"fullName":"Amy Tan"}]');
    assert.deepEqual(out, [{ fullName: "Amy Tan" }]);
  });

  test("strips a ```json code fence before parsing", () => {
    const out = extractRecords('```json\n[{"fullName":"Amy Tan"}]\n```');
    assert.equal(out.length, 1);
    assert.equal(out[0].fullName, "Amy Tan");
  });

  test("unwraps an object that holds the array under a common key", () => {
    const out = extractRecords('{"records":[{"fullName":"Bob Lim"},{"fullName":"Cara Ng"}]}');
    assert.equal(out.length, 2);
    assert.equal(out[1].fullName, "Cara Ng");
  });

  test("recovers the array even when the model adds prose around it", () => {
    const out = extractRecords('Sure! Here are the delegates:\n[{"fullName":"Dan Ong"}]\nLet me know if you need more.');
    assert.deepEqual(out, [{ fullName: "Dan Ong" }]);
  });

  test("falls back to the object form when a stray bracket breaks the array slice", () => {
    // The "[note]" string makes the first-[ to last-] slice invalid JSON, so the
    // parser must fall through to reading obj.records.
    const out = extractRecords('{"note":"see [note]","records":[{"fullName":"Eve Goh"}]}');
    assert.equal(out.length, 1);
    assert.equal(out[0].fullName, "Eve Goh");
  });

  test("returns null for unparseable text", () => {
    assert.equal(extractRecords("the model refused to answer"), null);
  });

  test("returns null for empty or missing input", () => {
    assert.equal(extractRecords(""), null);
    assert.equal(extractRecords(null), null);
    assert.equal(extractRecords(undefined), null);
  });
});

describe("cleanName — tidies a model-produced name", () => {
  test("keeps only the romanised half of a bilingual 'CJK / Latin' name", () => {
    assert.equal(cleanName("邓邵徽 / Reyes Tin"), "Reyes Tin");
  });

  test("leaves a purely romanised name untouched", () => {
    assert.equal(cleanName("John Tan"), "John Tan");
  });

  test("keeps a wholly-CJK name as-is (no romanised part to prefer)", () => {
    assert.equal(cleanName("陈伟"), "陈伟");
  });

  test("rejects placeholder values the model sometimes emits", () => {
    assert.equal(cleanName("N/A"), "");
    assert.equal(cleanName("Not specified"), "");
    assert.equal(cleanName("unknown"), "");
  });

  test("trims surrounding whitespace", () => {
    assert.equal(cleanName("  Amy Lee  "), "Amy Lee");
  });

  test("returns an empty string for empty/nullish input", () => {
    assert.equal(cleanName(""), "");
    assert.equal(cleanName(null), "");
  });
});

describe("dedupeByName — collapses the same person, keeping the richer record", () => {
  test("keeps the record with more populated fields when names match (case-insensitively)", () => {
    const out = dedupeByName([
      { fullName: "Li Wei", company: "Acme" },
      { fullName: "li wei", company: "Acme", role: "Director", email: "lw@acme.com" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].role, "Director"); // the richer of the two won
  });

  test("keeps genuinely different people", () => {
    const out = dedupeByName([{ fullName: "Ann" }, { fullName: "Ben" }]);
    assert.equal(out.length, 2);
  });

  test("drops records with no usable name", () => {
    const out = dedupeByName([{ fullName: "" }, { fullName: "  " }, { fullName: "Cat" }]);
    assert.deepEqual(out.map((r) => r.fullName), ["Cat"]);
  });
});

describe("preferRomanised — drops stray pure-CJK duplicate rows", () => {
  test("removes CJK-only rows when any romanised name is present", () => {
    const out = preferRomanised([{ fullName: "Reyes Tin" }, { fullName: "陈伟" }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].fullName, "Reyes Tin");
  });

  test("keeps everything for a wholly-CJK batch (nothing romanised to prefer)", () => {
    const out = preferRomanised([{ fullName: "陈伟" }, { fullName: "王明" }]);
    assert.equal(out.length, 2);
  });
});

describe("finalizeRecords — the full clean → dedupe → prefer pipeline", () => {
  test("turns a bilingual batch with a stray CJK duplicate and a placeholder into one clean row", () => {
    const out = finalizeRecords([
      { fullName: "邓邵徽 / Reyes Tin", company: "Acme" },
      { fullName: "邓邵徽" },      // stray Chinese-only half of the same person
      { fullName: "N/A" },          // placeholder junk
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].fullName, "Reyes Tin");
    assert.equal(out[0].company, "Acme");
  });
});

describe("toRow — normalises a record into a delegate row", () => {
  test("clamps an over-1 confidence to 1 and does not flag a good row for review", () => {
    const row = toRow({ fullName: "Amy", confidence: 1.5 }, 0, "doc");
    assert.equal(row.confidence, 1);
    assert.equal(row.needsReview, false);
    assert.equal(row.id, "doc-0");
  });

  test("clamps a negative confidence to 0 and flags a low-confidence row for review", () => {
    const row = toRow({ fullName: "Bob", confidence: -1 }, 1, "doc");
    assert.equal(row.confidence, 0);
    assert.equal(row.needsReview, true);
    assert.equal(row.id, "doc-1");
  });

  test("defaults a missing confidence to 0.6 (which needs review)", () => {
    const row = toRow({ fullName: "Cid" }, 0, "doc");
    assert.equal(row.confidence, 0.6);
    assert.equal(row.needsReview, true);
  });

  test("flags a nameless row for review and uses the default 'file' prefix", () => {
    const row = toRow({ fullName: "", confidence: 0.99 }, 2);
    assert.equal(row.needsReview, true);
    assert.equal(row.id, "file-2");
  });

  test("coerces empty optional fields to null", () => {
    const row = toRow({ fullName: "Dee", company: "", role: "Manager", confidence: 0.9 }, 0, "d");
    assert.equal(row.company, null);
    assert.equal(row.role, "Manager");
    assert.equal(row.needsReview, false);
  });
});
