import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAssignmentList } from "../../backend/routes/dashboard/roomAssign.js";

const roster = [
  { id: "d1", name: "Chen Hao Ming" },
  { id: "d2", name: "Goh Mei Ling" },
  { id: "d3", name: "Lim Hua" },
  { id: "d4", name: "Tan Wei" },
];

test("roommate group — bare names then one shared room", () => {
  const r = parseAssignmentList("Chen Hao Ming, Goh Mei Ling, Lim Hua - 599", roster);
  assert.ok(r, "should parse, not fall through to the model");
  assert.equal(r.items.length, 3);
  for (const item of r.items) {
    assert.equal(item.roomNumber, "599");
    assert.equal(item.hotelName, undefined);
  }
  const names = r.items.map((i) => i.delegate.name).sort();
  assert.deepEqual(names, ["Chen Hao Ming", "Goh Mei Ling", "Lim Hua"]);
});

test("roommate group — shared hotel only", () => {
  const r = parseAssignmentList("Chen Hao Ming, Goh Mei Ling - Grand Hyatt", roster);
  assert.ok(r);
  assert.equal(r.items.length, 2);
  for (const item of r.items) {
    assert.equal(item.hotelName, "Grand Hyatt");
    assert.equal(item.roomNumber, undefined);
  }
});

test("two independent people on one comma-separated line still parse separately", () => {
  const r = parseAssignmentList("Chen Hao Ming - room 201, Goh Mei Ling - room 202", roster);
  assert.ok(r);
  assert.equal(r.items.length, 2);
  const byName = Object.fromEntries(r.items.map((i) => [i.delegate.name, i.roomNumber]));
  assert.equal(byName["Chen Hao Ming"], "201");
  assert.equal(byName["Goh Mei Ling"], "202");
});

test("multi-line list (original 2026-07-28 case) still works", () => {
  const r = parseAssignmentList(
    "Chen Hao Ming - room 201\nGoh Mei Ling - room 202\nLim Hua - room 200",
    roster
  );
  assert.ok(r);
  assert.equal(r.items.length, 3);
});

test("bare-number form doesn't leak into the hotel field (2026-07-28 regression)", () => {
  const r = parseAssignmentList("Chen Hao Ming: 305", roster);
  assert.ok(r);
  assert.equal(r.items[0].roomNumber, "305");
  assert.equal(r.items[0].hotelName, undefined);
});

test("a group where one name isn't on the roster falls through to the model", () => {
  const r = parseAssignmentList("Chen Hao Ming, Someone Else, Lim Hua - 599", roster);
  assert.equal(r, null);
});

test("plain fuzzy phrasing still falls through to the model", () => {
  const r = parseAssignmentList("put all VIPs in Hilton 12th floor", roster);
  assert.equal(r, null);
});
