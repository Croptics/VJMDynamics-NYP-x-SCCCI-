/**
 * Unit tests — on-device face/voice capture helpers (Vimal, FaceCheck-Pro).
 *
 * Covers the pure, browser-free functions in the client biometric engine:
 *   frontend/src/lib/scanner/faceScan.js   (framing, token build/parse,
 *                                           multi-sample averaging, voiceprint)
 *   frontend/src/lib/scanner/humanFace.js  (deep-embedding quality gate,
 *                                           similarity, token round-trip)
 *
 * Nothing here touches a camera, a microphone or the DOM — the capture
 * functions that do are deliberately left out, so every run is deterministic
 * and needs no browser.
 *
 * Run from the repo root:  node --test "tests/vimal/*.test.js"
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FACE_CROP,
  faceCropBox,
  averageFaceVectors,
  sampleConsistency,
  buildFaceToken,
  parseFaceVector,
  parseVoiceVector,
  vectorizeVoiceprint,
  cosineSimilarity,
  isValidBiometricToken,
} from "../../frontend/src/lib/scanner/faceScan.js";
import {
  MIN_FACE_SCORE,
  MIN_LIVE,
  MIN_REAL,
  gate,
  similarity,
  averageEmbeddings,
  sampleConsistency as embeddingConsistency,
  buildEmbeddingToken,
  parseEmbeddingToken,
  isEmbeddingToken,
} from "../../frontend/src/lib/scanner/humanFace.js";

const ramp = (n, from = 0) => Array.from({ length: n }, (_, i) => from + i);
/** A believable deep-embedding detection that should pass every gate. */
const goodDetection = (over = {}) => ({
  ok: true,
  faceScore: 0.95,
  live: 0.9,
  real: 0.9,
  embedding: ramp(128, 1),
  ...over,
});

describe("faceCropBox — framing is square and centred on any camera", () => {
  test("takes a centred square of the short edge on a landscape frame", () => {
    const box = faceCropBox(640, 480);
    assert.equal(box.side, Math.floor(480 * FACE_CROP));
    assert.equal(box.x0, Math.floor((640 - box.side) / 2));
    assert.equal(box.y0, Math.floor((480 - box.side) / 2));
  });

  test("a portrait frame is cropped off the width instead, still square", () => {
    const box = faceCropBox(480, 640);
    assert.equal(box.side, Math.floor(480 * FACE_CROP));
    // Same side length as the landscape case above: identical geometry
    // regardless of how the phone is held, which is what makes an enrolment
    // on one device comparable with a scan on another.
    assert.equal(box.side, faceCropBox(640, 480).side);
  });
});

describe("face token build/parse round-trip", () => {
  test("a built token parses back to the same vector", () => {
    const vector = ramp(40, 1);
    const token = buildFaceToken(vector);
    assert.match(token, /^face:v3:[0-9a-f]+:/);
    assert.deepEqual(parseFaceVector(token), vector);
  });

  test("the same vector always produces the same token (integrity hash is stable)", () => {
    const vector = ramp(40, 1);
    assert.equal(buildFaceToken(vector), buildFaceToken(vector));
  });

  test("a different vector produces a different token", () => {
    assert.notEqual(buildFaceToken(ramp(40, 1)), buildFaceToken(ramp(40, 2)));
  });

  test("an empty capture yields no token rather than an empty one", () => {
    assert.equal(buildFaceToken([]), null);
    assert.equal(buildFaceToken(null), null);
  });

  test("the older dot-separated v2 form still parses (back-compat)", () => {
    assert.deepEqual(parseFaceVector("face:v2:ab12:10.20.30.40.50.60.70.80"),
      [10, 20, 30, 40, 50, 60, 70, 80]);
  });

  test("a voice token is not accepted as a face vector, or vice versa", () => {
    const voice = "voice:v2:ab12:1,2,3,4,5,6,7,8";
    assert.equal(parseFaceVector(voice), null);
    assert.ok(parseVoiceVector(voice));
    assert.equal(parseVoiceVector(buildFaceToken(ramp(40, 1))), null);
  });
});

describe("isValidBiometricToken — the guard before anything is stored", () => {
  test("accepts a real face and a real voice token", () => {
    assert.equal(isValidBiometricToken(buildFaceToken(ramp(40, 1))), true);
    assert.equal(isValidBiometricToken("voice:v2:ab12:1,2,3,4,5,6,7,8,9,10"), true);
  });

  test("rejects the deadbeef placeholder", () => {
    // A hardcoded stub must never be storable as somebody's identity.
    assert.equal(isValidBiometricToken("face:v3:deadbeef:1,2,3,4,5,6,7,8,9"), false);
  });

  test("rejects junk, empty and non-string input", () => {
    assert.equal(isValidBiometricToken("face:v3:ab12:1,2"), false, "too short to be a descriptor");
    assert.equal(isValidBiometricToken("face:v3:zzzz:1,2,3,4,5,6,7,8,9,10"), false, "hash is not hex");
    assert.equal(isValidBiometricToken("hello world"), false);
    assert.equal(isValidBiometricToken(""), false);
    assert.equal(isValidBiometricToken(null), false);
    assert.equal(isValidBiometricToken({ token: "face:v3:ab:1,2,3" }), false);
  });

  test("is version-agnostic — a future v4 token is not rejected on its version", () => {
    // Hardcoding "v1" here once silently rejected every real scan; the regex
    // matches any v<n> on purpose.
    assert.equal(isValidBiometricToken("face:v4:ab12:1,2,3,4,5,6,7,8,9,10"), true);
  });
});

describe("multi-sample capture — averaging and consistency", () => {
  test("averageFaceVectors returns the element-wise mean", () => {
    assert.deepEqual(averageFaceVectors([[0, 2, 4, 6], [2, 4, 6, 8]]), [1, 3, 5, 7]);
  });

  test("averaging ignores empty samples and returns null when none are usable", () => {
    assert.deepEqual(averageFaceVectors([[1, 3], [], null]), [1, 3]);
    assert.equal(averageFaceVectors([]), null);
    assert.equal(averageFaceVectors(null), null);
  });

  test("a single sample is trivially consistent", () => {
    assert.equal(sampleConsistency([ramp(40, 1)]), 1);
  });

  test("near-identical samples score high; a mid-capture swap scores low", () => {
    const a = ramp(40, 1);
    const jittered = a.map((x, i) => x + (i % 2 ? 0.3 : -0.3));
    assert.ok(sampleConsistency([a, jittered]) > 0.95, "same face across frames");

    // Someone else stepped in half-way through the capture: the caller must be
    // able to see the samples disagree and discard the whole attempt rather
    // than enrol a smeared average of two people.
    const other = [...a].reverse();
    assert.ok(sampleConsistency([a, jittered, other]) < 0.5, "two different faces");
  });

  test("consistency reports the WORST pair, not the average", () => {
    const a = ramp(40, 1);
    const other = [...a].reverse();
    const worst = sampleConsistency([a, a, other]);
    assert.ok(worst < 0, "one bad pair must drag the score down on its own");
  });
});

describe("cosineSimilarity (client copy — mirrors the server)", () => {
  test("the same descriptor scores 1", () => {
    const v = ramp(40, 1);
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
  });

  test("a descriptor too short to be meaningful is rejected with -1", () => {
    assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), -1);
  });

  test("non-array input is rejected rather than throwing", () => {
    assert.equal(cosineSimilarity(null, ramp(40)), -1);
    assert.equal(cosineSimilarity("face", ramp(40)), -1);
  });
});

describe("vectorizeVoiceprint — the no-microphone passphrase fallback", () => {
  test("emits a v1 token and is deterministic", () => {
    const token = vectorizeVoiceprint("muster go singapore");
    assert.match(token, /^voice:v1:[0-9a-f]+:\d+$/);
    assert.equal(token, vectorizeVoiceprint("muster go singapore"));
  });

  test("a different passphrase gives a different token", () => {
    assert.notEqual(vectorizeVoiceprint("muster go singapore"), vectorizeVoiceprint("muster go singapor"));
  });

  test("carries no vector, so the server falls back to exact-hash matching", () => {
    assert.equal(parseVoiceVector(vectorizeVoiceprint("muster go singapore")), null);
  });
});

describe("humanFace.gate — liveness and anti-spoof", () => {
  test("a clear, live face is ready to capture", () => {
    const g = gate(goodDetection());
    assert.equal(g.ready, true);
  });

  test("no face detected is not ready", () => {
    assert.equal(gate(null).ready, false);
    assert.equal(gate({ ok: false, hint: "No face detected." }).ready, false);
  });

  test("a face too far away / too blurry is refused", () => {
    const g = gate(goodDetection({ faceScore: MIN_FACE_SCORE - 0.01 }));
    assert.equal(g.ready, false);
    assert.match(g.hint, /clearer|closer/i);
  });

  test("a printed photo or a phone screen is refused (anti-spoof)", () => {
    // The attack this exists to stop: holding up a picture of a delegate.
    const g = gate(goodDetection({ real: MIN_REAL - 0.01 }));
    assert.equal(g.ready, false);
    assert.match(g.hint, /live face|photo|screen/i);
  });

  test("a still, non-live subject is refused (liveness)", () => {
    const g = gate(goodDetection({ live: MIN_LIVE - 0.01 }));
    assert.equal(g.ready, false);
    assert.match(g.hint, /blink|camera/i);
  });

  test("a detection with no embedding is refused — there is nothing to store", () => {
    assert.equal(gate(goodDetection({ embedding: null })).ready, false);
  });
});

describe("humanFace embeddings", () => {
  test("similarity of identical embeddings is 1, and mismatched lengths score 0", () => {
    const e = ramp(128, 1);
    assert.ok(Math.abs(similarity(e, e) - 1) < 1e-9);
    assert.equal(similarity(e, ramp(64, 1)), 0);
    assert.equal(similarity(null, e), 0);
  });

  test("averageEmbeddings builds one template from several samples", () => {
    assert.deepEqual(averageEmbeddings([[0, 2, 4], [2, 4, 6]]), [1, 3, 5]);
    assert.equal(averageEmbeddings([]), null);
  });

  test("embeddingConsistency is the MEAN pairwise similarity", () => {
    const e = ramp(128, 1);
    assert.ok(Math.abs(embeddingConsistency([e, e]) - 1) < 1e-9);
    assert.equal(embeddingConsistency([e]), 1, "a single sample is consistent by definition");
  });

  test("embedding token round-trips and is recognised as a DEEP embedding", () => {
    const e = ramp(1024, 1);
    const token = buildEmbeddingToken(e);
    assert.match(token, /^face:v3:[0-9a-f]+:/);
    assert.equal(parseEmbeddingToken(token).length, 1024);
    assert.equal(isEmbeddingToken(token), true);
  });

  test("a short legacy descriptor is NOT mistaken for a deep embedding", () => {
    // The backend picks its matcher and threshold purely by vector length, so
    // a 40-value hand-crafted descriptor must not claim to be a 1024-float one.
    const legacy = buildEmbeddingToken(ramp(40, 1));
    assert.equal(isEmbeddingToken(legacy), false);
  });

  test("a non-v3 or empty token yields nothing", () => {
    assert.equal(parseEmbeddingToken("face:v2:ab:1.2.3.4.5.6.7.8"), null);
    assert.equal(parseEmbeddingToken(null), null);
    assert.equal(buildEmbeddingToken([]), null);
  });
});
