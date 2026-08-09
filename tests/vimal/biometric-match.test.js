/**
 * Unit tests — biometric matching engine (Vimal, FaceCheck-Pro).
 *
 * Covers the pure 1:N identification maths in `backend/lib/biometricMatch.js`:
 * token parsing, cosine similarity, the illumination-invariance normalisation,
 * and the accept / reject / ambiguous decision logic that decides whether a
 * scan at the coach door is allowed to check somebody in.
 *
 * These are the tests that matter most for this feature: a false ACCEPT boards
 * the wrong person, a false REJECT strands a real delegate. Both paths are
 * asserted explicitly rather than only the happy one.
 *
 * Run from the repo root:  node --test "tests/vimal/*.test.js"
 * (Node's built-in test runner — no external test framework required.)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MATCH_CONFIG,
  parseVectorToken,
  cosineSimilarity,
  normaliseVector,
  identify,
} from "../../backend/lib/biometricMatch.js";

/* A 40-long ramp stands in for an enrolled face descriptor. Ramps are handy
 * here because a *reversed* ramp is almost perfectly negatively correlated
 * once mean-centred, which gives a realistic "different person" impostor. */
const ramp = (n = 40, from = 0) => Array.from({ length: n }, (_, i) => from + i);
/** Same face, re-scanned: same descriptor plus small deterministic sensor noise. */
const withNoise = (v, amp = 0.4) => v.map((x, i) => x + (i % 3 === 0 ? amp : -amp));

describe("parseVectorToken — only v2 tokens carry a real vector", () => {
  test("parses a well-formed v2 face token", () => {
    const parsed = parseVectorToken("face:v2:9ab3:10.20.30.40.50.60.70.80");
    assert.deepEqual(parsed, {
      type: "face",
      version: "v2",
      vector: [10, 20, 30, 40, 50, 60, 70, 80],
    });
  });

  test("parses a voice token the same way", () => {
    const parsed = parseVectorToken("voice:v2:ff:1.2.3.4.5.6.7.8");
    assert.equal(parsed.type, "voice");
    assert.equal(parsed.vector.length, 8);
  });

  test("rejects a legacy v1 token — it holds a hash, not a vector", () => {
    assert.equal(parseVectorToken("face:v1:9ab3:42"), null);
  });

  test("rejects an unknown modality", () => {
    assert.equal(parseVectorToken("iris:v2:9ab3:10.20.30.40.50.60.70.80"), null);
  });

  test("rejects a descriptor too short to identify anyone", () => {
    // 7 values — one below the 8-value floor, so it can never be matched.
    assert.equal(parseVectorToken("face:v2:9ab3:1.2.3.4.5.6.7"), null);
  });

  test("rejects malformed and non-string input", () => {
    assert.equal(parseVectorToken("face:v2"), null);
    assert.equal(parseVectorToken(""), null);
    assert.equal(parseVectorToken(null), null);
    assert.equal(parseVectorToken(undefined), null);
    assert.equal(parseVectorToken(12345), null);
  });
});

describe("cosineSimilarity", () => {
  test("identical vectors score 1", () => {
    const v = ramp();
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
  });

  test("orthogonal vectors score 0", () => {
    assert.equal(cosineSimilarity([1, 0, 0, 0], [0, 1, 0, 0]), 0);
  });

  test("a blank/zero-magnitude frame can never score as a perfect match", () => {
    // Guards the worst failure mode: a camera that returned nothing must not
    // read as "matches everyone".
    assert.equal(cosineSimilarity([0, 0, 0, 0], [1, 2, 3, 4]), 0);
    assert.equal(cosineSimilarity([], [1, 2, 3]), 0);
  });

  test("scale does not change the score — only direction does", () => {
    const v = ramp(16, 1);
    const doubled = v.map((x) => x * 2);
    assert.ok(Math.abs(cosineSimilarity(v, doubled) - 1) < 1e-9);
  });
});

describe("normaliseVector — the illumination-invariance step", () => {
  test("output is mean-centred and unit length", () => {
    const out = normaliseVector(ramp(20, 5));
    const mean = out.reduce((s, v) => s + v, 0) / out.length;
    const mag = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
    assert.ok(Math.abs(mean) < 1e-9, "mean should be ~0");
    assert.ok(Math.abs(mag - 1) < 1e-9, "magnitude should be ~1");
  });

  test("a global brightness shift is normalised away", () => {
    // The same face under brighter light: every cell +50.
    const dim = ramp(20);
    const bright = dim.map((x) => x + 50);
    assert.deepEqual(
      normaliseVector(dim).map((x) => +x.toFixed(9)),
      normaliseVector(bright).map((x) => +x.toFixed(9)),
    );
  });

  test("a flat (featureless) vector normalises to zeros, not NaN", () => {
    assert.deepEqual(normaliseVector([7, 7, 7, 7]), [0, 0, 0, 0]);
    assert.deepEqual(normaliseVector([]), []);
  });
});

describe("identify — the accept / reject decision", () => {
  const enrolled = ramp();
  const impostor = ramp().reverse();

  test("recognises the same person re-scanned, and reports the score", () => {
    const res = identify(withNoise(enrolled), [
      { id: "d-1", vector: enrolled },
      { id: "d-2", vector: impostor },
    ]);
    assert.equal(res.matched, true);
    assert.equal(res.id, "d-1");
    assert.ok(res.similarity >= MATCH_CONFIG.ACCEPT_THRESHOLD);
    assert.ok(res.similarity > res.runnerUp);
  });

  test("rejects a face nobody enrolled instead of picking someone", () => {
    // The regression this feature was built to fix: an unknown face used to be
    // assigned to a random missing delegate.
    const res = identify(impostor, [{ id: "d-1", vector: enrolled }]);
    assert.equal(res.matched, false);
    assert.equal(res.reason, "LOW_CONFIDENCE");
    assert.ok(res.bestSimilarity < MATCH_CONFIG.ACCEPT_THRESHOLD);
  });

  test("refuses an ambiguous match between two near-identical templates", () => {
    // Two enrolled templates the probe fits equally well: boarding either one
    // is a coin flip, so the matcher must decline and let staff resolve it.
    const res = identify(withNoise(enrolled), [
      { id: "d-1", vector: enrolled },
      { id: "d-2", vector: enrolled },
    ]);
    assert.equal(res.matched, false);
    assert.equal(res.reason, "AMBIGUOUS");
    assert.ok(res.bestSimilarity - res.runnerUp < MATCH_CONFIG.MARGIN);
  });

  test("an empty enrolment list is a clean rejection, not a crash", () => {
    assert.deepEqual(identify(enrolled, []), { matched: false, reason: "NO_CANDIDATES" });
    assert.deepEqual(identify(enrolled, null), { matched: false, reason: "NO_CANDIDATES" });
  });

  test("thresholds are configurable — a stricter config rejects a borderline match", () => {
    const candidates = [{ id: "d-1", vector: enrolled }, { id: "d-2", vector: impostor }];
    const loose = identify(withNoise(enrolled), candidates);
    assert.equal(loose.matched, true);

    const strict = identify(withNoise(enrolled), candidates, {
      ...MATCH_CONFIG,
      ACCEPT_THRESHOLD: 0.999999,
    });
    assert.equal(strict.matched, false);
    assert.equal(strict.reason, "LOW_CONFIDENCE");
  });
});
