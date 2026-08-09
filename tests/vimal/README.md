# Unit tests — Vimal (FaceCheck-Pro: face/voice check-in + enrolment)

Unit tests for my individual code contributions — the biometric matching
engine, the on-device face/voice capture helpers, and the delegate enrolment
invite email. They exercise the **pure, side-effect-free functions** directly,
so no database, no HTTP server, no camera, no microphone and no SMTP
connection is needed, and every run is deterministic.

## How to run

From the repository root:

```bash
node --test "tests/vimal/*.test.js"
```

Uses Node's **built-in test runner** (`node:test` + `node:assert`, Node 18+) —
no external test framework or extra dependencies. `tests/vimal/package.json`
sets `"type": "module"` so these files can import the ESM backend and frontend
modules.

## What's covered

| File | Module under test | What it verifies |
| --- | --- | --- |
| `biometric-match.test.js` | `backend/lib/biometricMatch.js` | `parseVectorToken` (v2 only, both modalities, rejects v1 / unknown modality / too-short descriptors / malformed input); `cosineSimilarity` (identical = 1, orthogonal = 0, scale-invariant, a blank frame can never score a perfect match); `normaliseVector` (mean-centred + unit length, a global brightness shift normalises away, a flat vector gives zeros not `NaN`); `identify` — the accept/reject decision: recognises a re-scan, returns `LOW_CONFIDENCE` for an un-enrolled face instead of picking someone, `AMBIGUOUS` when two templates fit equally well, `NO_CANDIDATES` on an empty roster, and honours a stricter threshold config. |
| `face-voice-token.test.js` | `frontend/src/lib/scanner/faceScan.js` | `faceCropBox` (identical square geometry in portrait and landscape); face-token build/parse round-trip incl. the legacy dot-separated v2 form and cross-modality rejection; `isValidBiometricToken` (rejects the `deadbeef` placeholder, junk, non-strings; version-agnostic); `averageFaceVectors` / `sampleConsistency` (multi-sample templating, and detecting a mid-capture person swap by the *worst* pair); `cosineSimilarity`; `vectorizeVoiceprint` (deterministic v1 passphrase fallback carrying no vector). |
| | `frontend/src/lib/scanner/humanFace.js` | `gate` — the quality/anti-spoof/liveness gate: refuses a distant or blurry face, a printed photo or phone screen, a non-live subject, and a detection with no embedding; `similarity` / `averageEmbeddings` / `sampleConsistency`; embedding-token round-trip and `isEmbeddingToken` telling a 1024-float deep embedding apart from a 40-value legacy descriptor (the backend picks its matcher and threshold by that length). |
| `enrol-invite-mail.test.js` | `backend/lib/mailer.js` | Fails **closed**: unconfigured or partially-configured SMTP means dry-run, and `MAIL_DRY_RUN=true` overrides a full config; `sendMail` previews without transmitting and resolves (never throws) on a missing recipient, so a bulk invite run can't abort halfway. `appBaseUrlWarning` catches invites whose link is dead on arrival — localhost, every RFC1918 range, link-local, a bare-IP https cert, and an unparseable URL. `enrolInviteEmail` — subject with and without a trip name, link present in both HTML and text parts, name fallback, stated expiry, the PDPA/zero-image promise, and HTML-escaping of the delegate and trip names (roster values are untrusted input). |

Total: **73 tests**, all passing.

## Note on the mailer tests

`mailer.js` reads its SMTP/URL configuration from `process.env` once, at module
load. To exercise several configurations in one file, each case sets the
environment and imports the module under a unique `?case=` query string, which
Node treats as a separate module instance — the environment is restored after
every load. Nothing is ever transmitted: every case is unconfigured or
explicitly dry-run.
