// frontend/src/components/PasskeySignIn.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
//
// Biometric ("Face ID / Touch ID / fingerprint / Windows Hello") sign-in for
// the login page.
//
// 2026-07-30 ("can you merge these 2 buttons together — try biometric first,
// if it didn't happen just follow the normal login"): this used to render
// its OWN separate "Sign in with Windows Hello" button + "or" divider below
// the password Sign in button. Now there's a single Sign in button (in
// LoginPage.jsx, JQ's file) — usePasskeySignIn() below exposes attempt(),
// which LoginPage calls FIRST on submit whenever a passkey is set up on this
// device; if attempt() resolves false (unsupported device, nothing
// registered yet, the OS prompt is cancelled, or it just fails) LoginPage
// silently falls through to the normal Staff ID + password flow with
// whatever's currently typed — no separate biometric error is shown for
// that fallback path, since failing over is the expected, quiet case now,
// not a real error.
//
// The biometric itself still never reaches this app: iOS/Android/Windows
// verify the face or finger in secure hardware and release only a signature
// from a private key that never leaves the device — we just hand that
// signature to the server, which checks it against a stored PUBLIC key.
// That's why this needs no camera permission, no enrolment, and stores
// nothing sensitive.
//
// 2026-07-30 ("set the login by face to be one time until i exit the page or
// the local storage/web browser forget, then re-scan to login — like real
// application logic"): LoginPage.jsx now also calls attempt() ONCE
// automatically on page load (guarded by a ref there, not here) whenever
// `available && registered` — this hook itself has no memory of "already
// tried this page load"; that's deliberately the caller's job, since a fresh
// mount (a real page reload, or navigating back to /login after signing
// out) is exactly what should make it eligible to auto-fire again.

import { useEffect, useState, useCallback } from "react";
import { startAuthentication, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";
import { apiGet, apiPost, setToken, setUser } from "../lib/api.js";

/** Name the gesture the way the user's own OS does, so it reads as familiar
 *  wherever a caller wants to mention it (e.g. a small hint under the button). */
export function biometricLabel() {
  const ua = navigator.userAgent || "";
  const apple = /iPhone|iPad|iPod|Macintosh/i.test(ua);
  if (/iPhone|iPad|iPod/i.test(ua)) return "Face ID / Touch ID";
  if (apple) return "Touch ID";
  if (/Android/i.test(ua)) return "fingerprint";
  if (/Windows/i.test(ua)) return "Windows Hello";
  return "biometrics";
}

/**
 * available: this device + origin could do passkey sign-in at all (platform
 * authenticator present, and the WebAuthn relying-party origin check on the
 * backend allows it — see rp() in backend/routes/passkeys.js).
 * registered: whether it's actually worth prompting for THIS typed Staff ID
 * — scoped to `registeredForStaffId` (a specific account) once something's
 * typed, falling back to `anyRegistered` (discoverable/usernameless credential
 * — some account, any account, has one, and the device is asked to offer
 * whatever it's holding) only while the field is still blank. Both `available`
 * and `registered` must be true for attempt() to be worth calling.
 *
 * 2026-07-30 bug fix — this used to check `anyRegistered` unconditionally,
 * even with a Staff ID already typed. Combined with LoginPage's auto-fire-on-
 * mount, that meant ANY staff member's login page would auto-trigger an OS
 * biometric prompt the instant SOME OTHER account anywhere on the server had
 * ever registered a passkey — nothing to do with whether THIS account, or
 * this device, actually had one. Scoping to the typed Staff ID once one
 * exists is what `registeredForStaffId` (backend/routes/passkeys.js) is
 * actually for.
 */
export function usePasskeySignIn({ staffId = "", keep = true, onSignedIn } = {}) {
  const [available, setAvailable] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const hasPlatform = await platformAuthenticatorIsAvailable();
        const id = staffId.trim();
        const info = await apiGet(`/passkeys/available${id ? `?staffId=${encodeURIComponent(id)}` : ""}`).catch(() => ({ supported: false }));
        if (!alive) return;
        setAvailable(hasPlatform && info.supported);
        setRegistered(!!(id ? info.registeredForStaffId : info.anyRegistered));
      } catch { /* endpoint unavailable — stay unavailable */ }
    })();
    return () => { alive = false; };
  }, [staffId]);

  const attempt = useCallback(async () => {
    if (!available || !registered) return false;
    setBusy(true);
    try {
      // 1) Server issues a one-time challenge. Passing a Staff ID narrows it to
      // that account's devices; leaving it blank lets the device offer whatever
      // passkey it holds (username-less sign-in — see the "no credential at
      // all" advisory note above the exports: this already works today,
      // nothing else to build for it).
      const options = await apiPost("/passkeys/login/options", staffId.trim() ? { staffId: staffId.trim() } : {});
      // 2) The OS prompts for Face ID / fingerprint and signs the challenge.
      const assertion = await startAuthentication({ optionsJSON: options });
      // 3) Server verifies the signature and returns the normal session token.
      const res = await apiPost("/passkeys/login/verify", { ...assertion, expectedChallenge: options.challenge });
      if (!res.token) return false;
      setToken(res.token, keep);
      setUser(
        { staffId: res.username, username: res.username, name: res.name, role: res.role, readOnly: res.readOnly, permissions: res.permissions },
        keep
      );
      onSignedIn?.();
      return true;
    } catch {
      // Cancelled OS prompt, no matching passkey for this Staff ID, network
      // hiccup, revoked credential, etc. — all fall back to password silently.
      return false;
    } finally {
      setBusy(false);
    }
  }, [available, registered, staffId, keep, onSignedIn]);

  return { available, registered, busy, attempt };
}
