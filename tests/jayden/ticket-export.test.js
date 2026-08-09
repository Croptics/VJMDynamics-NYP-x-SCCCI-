/**
 * Unit tests — CSV export (Jayden, frontend/src/lib/exception/exceptionsApi.js).
 *
 * WHY THIS MATTERS: the Export button hands a secretariat organiser a file they
 * open straight in Excel, so two things have to be exactly right or the sheet
 * is silently wrong rather than visibly broken:
 *
 *   1. ESCAPING — exception notes are free text and routinely contain commas
 *      ("Not boarded, departure imminent") and quotes. Unescaped, a single
 *      comma shifts every later column of that row into the wrong header.
 *   2. THE UTF-8 BOM — without the leading EF BB BF bytes Excel decodes the
 *      file as the local ANSI codepage and mangles every Chinese delegate name.
 *
 * exportTicketsCsv() is a browser download helper, so the four browser APIs it
 * touches (Blob, URL, document, the anchor click) are stubbed here and the
 * captured payload is asserted on. No jsdom, no browser.
 *
 * Run from the repo root:  node --test tests/jayden/*.test.js
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
globalThis.window = { addEventListener() {}, removeEventListener() {} };

/* ---- capture the "download" instead of performing one -------------------- */
let captured = null; // { parts, type, filename, revoked }

class FakeBlob {
  constructor(parts, opts) { this.parts = parts; this.type = opts?.type; }
}
globalThis.Blob = FakeBlob;
globalThis.URL = {
  createObjectURL(blob) { captured = { blob, revoked: false }; return "blob:stub"; },
  revokeObjectURL() { if (captured) captured.revoked = true; },
};
globalThis.document = {
  createElement() {
    return {
      set href(v) { this._href = v; },
      set download(v) { if (captured) captured.filename = v; },
      click() { if (captured) captured.clicked = true; },
    };
  },
};

const { exportTicketsCsv } =
  await import("../../frontend/src/lib/exception/exceptionsApi.js");

/** Run the export and return the decoded CSV text plus metadata. */
function exportAndRead(tickets, filename) {
  captured = null;
  const count = filename === undefined
    ? exportTicketsCsv(tickets)
    : exportTicketsCsv(tickets, filename);
  const raw = captured.blob.parts.join("");
  return {
    count,
    raw,
    text: raw.replace(/^﻿/, ""),
    hasBom: raw.charCodeAt(0) === 0xFEFF,
    mime: captured.blob.type,
    filename: captured.filename,
    clicked: captured.clicked,
    revoked: captured.revoked,
  };
}

const openTicket = {
  priority: "CRITICAL", type: "MISSING_PERSON", status: "OPEN",
  delegateName: "Lim Wei Jie", coach: "Coach 2",
  note: "Not boarded, departure imminent", // NOTE: contains a comma on purpose
  createdAt: "2026-07-30T10:00:00Z", raisedBy: "Staff 194",
  resolvedAt: null, resolvedBy: null,
};

const resolvedTicket = {
  priority: "NORMAL", type: "OTHER", typeOther: "Lost luggage", status: "RESOLVED",
  delegateName: "Goh Mei Ling", coach: "Coach 1", note: "Found at carousel",
  createdAt: "2026-07-30T09:00:00Z", raisedBy: "Staff 194",
  resolvedAt: "2026-07-30T09:25:00Z", resolvedBy: "Staff 12",
};

describe("exportTicketsCsv — file shape", () => {
  test("writes the documented header row", () => {
    const { text } = exportAndRead([openTicket]);
    assert.equal(
      text.split("\r\n")[0],
      "Priority,Issue,Delegate,Coach,Note,Status,Raised at,Raised by,Resolved at,Resolved by,Age (mins)"
    );
  });

  test("writes one row per ticket and returns that count", () => {
    const { text, count } = exportAndRead([openTicket, resolvedTicket]);
    assert.equal(count, 2);
    assert.equal(text.split("\r\n").length, 3); // header + 2
  });

  test("an empty list still produces a header-only file", () => {
    const { text, count } = exportAndRead([]);
    assert.equal(count, 0);
    assert.equal(text.split("\r\n").length, 1);
  });

  test("rows are CRLF-separated, which is what Excel expects", () => {
    const { text } = exportAndRead([openTicket]);
    assert.ok(text.includes("\r\n"));
  });

  test("carries the UTF-8 BOM so Excel does not mangle CJK names", () => {
    const { hasBom, mime } = exportAndRead([openTicket]);
    assert.equal(hasBom, true, "missing BOM — Excel would read this as ANSI");
    assert.equal(mime, "text/csv;charset=utf-8;");
  });

  test("uses the supplied filename, and a sensible default without one", () => {
    assert.equal(exportAndRead([openTicket], "exceptions-open-2026-07-30.csv").filename,
      "exceptions-open-2026-07-30.csv");
    assert.equal(exportAndRead([openTicket]).filename, "exceptions.csv");
  });

  test("triggers the download and releases the object URL", () => {
    // Not releasing it leaks the blob for the lifetime of the tab.
    const { clicked, revoked } = exportAndRead([openTicket]);
    assert.equal(clicked, true);
    assert.equal(revoked, true);
  });
});

describe("exportTicketsCsv — escaping", () => {
  test("a note containing a comma is quoted, keeping columns aligned", () => {
    const { text } = exportAndRead([openTicket]);
    assert.ok(
      text.includes('"Not boarded, departure imminent"'),
      "comma-bearing note must be wrapped in quotes"
    );
  });

  test("embedded double quotes are doubled per RFC 4180", () => {
    const { text } = exportAndRead([{ ...openTicket, note: 'said "on the bus"' }]);
    assert.ok(text.includes('"said ""on the bus"""'), `got: ${text.split("\r\n")[1]}`);
  });

  test("a newline inside a note is quoted rather than splitting the row", () => {
    const { text } = exportAndRead([{ ...openTicket, note: "line one\nline two" }]);
    assert.equal(text.split("\r\n").length, 2, "newline must not create a new CSV row");
    assert.ok(text.includes('"line one\nline two"'));
  });

  test("plain values are left unquoted", () => {
    const { text } = exportAndRead([{ ...openTicket, note: "simple note" }]);
    assert.ok(text.includes("simple note"));
    assert.ok(!text.includes('"simple note"'));
  });
});

describe("exportTicketsCsv — field mapping", () => {
  test("uses the same issue label as the on-screen ticket, including OTHER", () => {
    const { text } = exportAndRead([resolvedTicket]);
    assert.ok(text.includes("Lost luggage"), "OTHER must export its custom label");
  });

  test("a ticket with no delegate exports as 'Unidentified', not blank", () => {
    const { text } = exportAndRead([{ ...openTicket, delegateName: null }]);
    assert.ok(text.includes("Unidentified"));
  });

  test("null coach / resolvedBy become empty cells rather than the text 'null'", () => {
    const { text } = exportAndRead([{ ...openTicket, coach: null }]);
    assert.ok(!text.includes("null"), `"null" leaked into the sheet: ${text}`);
  });

  test("a RESOLVED ticket reports how long it took, not its current age", () => {
    // 09:00 → 09:25 is 25 minutes, regardless of when the export runs.
    const row = exportAndRead([resolvedTicket]).text.split("\r\n")[1];
    assert.ok(row.endsWith(",25"), `expected trailing age of 25, got: ${row}`);
  });

  test("an OPEN ticket reports its live age", () => {
    const row = exportAndRead([{ ...openTicket, createdAt: new Date(Date.now() - 12 * 60000).toISOString() }])
      .text.split("\r\n")[1];
    assert.ok(row.endsWith(",12"), `expected trailing age of 12, got: ${row}`);
  });
});
