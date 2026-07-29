// frontend/src/components/PasskeySignIn.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
//
// "Sign in with Face ID / Touch ID / fingerprint / Windows Hello" — a passkey
// (WebAuthn) sign-in button for the login page.
//
// Everything lives in this ONE component on purpose: LoginPage.jsx belongs to
// JQ and asks teammates not to edit it, so it only needs a single <PasskeySignIn/>
// line rather than a chunk of biometric logic.
//
// The biometric itself never reaches this app. iOS/Android/Windows verify the
// face or finger in secure hardware and release only a signature from a private
// key that never leaves the device — we just hand the signature to the server,
// which checks it against a stored PUBLIC key. That's why this needs no camera
// permission, no enrolment, and stores nothing sensitive.
//
// It renders nothing at all when passkeys can't work (no platform biometric,
// nothing registered yet, or the app opened over a bare IP — see rp() in
// backend/routes/passkeys.js), so the login page is never cluttered with a
// button that would only fail.

import { useEffect, useState } from "react";
import { Fingerprint, ScanFace, Loader2 } from "lucide-react";
import { startAuthentication, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";
import { apiGet, apiPost, setToken, setUser } from "../lib/api.js";

/** Name the gesture the way the user's own OS does, so it reads as familiar. */
function biometricLabel() {
  const ua = navigator.userAgent || "";
  const apple = /iPhone|iPad|iPod|Macintosh/i.test(ua);
  if (/iPhone|iPad|iPod/i.test(ua)) return { text: "Sign in with Face ID / Touch ID", Icon: ScanFace };
  if (apple) return { text: "Sign in with Touch ID", Icon: Fingerprint };
  if (/Android/i.test(ua)) return { text: "Sign in with fingerprint", Icon: Fingerprint };
  if (/Windows/i.test(ua)) return { text: "Sign in with Windows Hello", Icon: ScanFace };
  return { text: "Sign in with biometrics", Icon: Fingerprint };
}

export default function PasskeySignIn({ staffId = "", onSignedIn, keep = true, t = (s) => s }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { text, Icon } = biometricLabel();

  // Only offer this when the device has a built-in biometric AND the server
  // says at least one passkey exists on a reachable (non-IP) hostname.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const hasPlatform = await platformAuthenticatorIsAvailable();
        if (!hasPlatform) return;
        const info = await apiGet("/passkeys/available");
        if (alive && info.supported && info.anyRegistered) setShow(true);
      } catch { /* endpoint unavailable — just stay hidden */ }
    })();
    return () => { alive = false; };
  }, []);

  async function signIn() {
    setBusy(true); setError("");
    try {
      // 1) Server issues a one-time challenge. Passing a Staff ID narrows it to
      // that account's devices; leaving it blank lets the device offer whatever
      // passkey it holds (username-less sign-in).
      const options = await apiPost("/passkeys/login/options", staffId ? { staffId: staffId.trim() } : {});

      // 2) The OS prompts for Face ID / fingerprint and signs the challenge.
      const assertion = await startAuthentication({ optionsJSON: options });

      // 3) Server verifies the signature and returns the normal session token.
      const res = await apiPost("/passkeys/login/verify", {
        ...assertion,
        expectedChallenge: options.challenge,
      });
      if (!res.token) throw new Error("Sign-in failed.");
      setToken(res.token, keep);
      setUser(
        { staffId: res.username, username: res.username, name: res.name, role: res.role, permissions: res.permissions },
        keep
      );
      onSignedIn?.();
    } catch (e) {
      // A user cancelling the OS prompt is not an error worth shouting about.
      const name = e?.name || "";
      if (name === "NotAllowedError" || name === "AbortError") setError("");
      else if (e?.code === "NO_PASSKEY") setError(t("No passkey set up for that Staff ID yet."));
      else setError(e?.message || t("Biometric sign-in failed. Use your password instead."));
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 10px" }}>
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
          {t("or")}
        </span>
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
      </div>

      <button type="button" className="btn btn-ghost btn-block" onClick={signIn} disabled={busy}>
        {busy ? <Loader2 size={18} className="pk-spin" /> : <Icon size={18} />}
        {busy ? t("Waiting for your device…") : t(text)}
      </button>

      {error && (
        <p style={{ color: "var(--st-missing)", fontSize: 12.5, textAlign: "center", marginTop: 8 }}>{error}</p>
      )}

      <style>{`.pk-spin{animation:pk-spin .9s linear infinite}@keyframes pk-spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}
