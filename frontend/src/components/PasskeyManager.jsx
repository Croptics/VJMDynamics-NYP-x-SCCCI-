// frontend/src/components/PasskeyManager.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
//
// "Set up Face ID / fingerprint" — registers THIS device's built-in biometric
// as a passkey for the signed-in account, and lists/removes the devices already
// set up. Pairs with components/PasskeySignIn.jsx on the login page.
//
// You must already be signed in to register: the password proves who you are
// once, and this then binds that identity to the device's secure hardware. From
// then on the password is only a fallback.

import { useEffect, useState, useCallback } from "react";
import { Fingerprint, ScanFace, Loader2, Trash2, ShieldCheck, Check } from "lucide-react";
import { startRegistration, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";
import { apiGet, apiPost } from "../lib/api.js";

function biometricLabel() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return { text: "Face ID / Touch ID", Icon: ScanFace };
  if (/Macintosh/i.test(ua)) return { text: "Touch ID", Icon: Fingerprint };
  if (/Android/i.test(ua)) return { text: "fingerprint", Icon: Fingerprint };
  if (/Windows/i.test(ua)) return { text: "Windows Hello", Icon: ScanFace };
  return { text: "biometrics", Icon: Fingerprint };
}

const fmt = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return ""; } };

export default function PasskeyManager({ t = (s) => s }) {
  const [supported, setSupported] = useState(false);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { tone, text }
  const { text, Icon } = biometricLabel();

  const load = useCallback(async () => {
    try { setList((await apiGet("/passkeys")).passkeys || []); } catch { /* not critical */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [hasPlatform, info] = await Promise.all([
          platformAuthenticatorIsAvailable(),
          apiGet("/passkeys/available").catch(() => ({ supported: false })),
        ]);
        setSupported(hasPlatform && info.supported);
      } catch { setSupported(false); }
      load();
    })();
  }, [load]);

  async function register() {
    setBusy(true); setMsg(null);
    try {
      const options = await apiPost("/passkeys/register/options", {});
      const attestation = await startRegistration({ optionsJSON: options });
      const res = await apiPost("/passkeys/register/verify", attestation);
      setMsg({ tone: "present", text: `${t("Set up on")} ${res.deviceLabel || t("this device")}` });
      load();
    } catch (e) {
      const name = e?.name || "";
      if (name === "NotAllowedError" || name === "AbortError") setMsg(null); // user cancelled
      else if (e?.name === "InvalidStateError") setMsg({ tone: "review", text: t("This device is already set up.") });
      else setMsg({ tone: "missing", text: e?.message || t("Could not set up biometric sign-in.") });
    } finally { setBusy(false); }
  }

  async function remove(id) {
    setBusy(true); setMsg(null);
    try { await apiPost("/passkeys/remove", { id }); load(); }
    catch (e) { setMsg({ tone: "missing", text: e?.message || t("Could not remove that device.") }); }
    finally { setBusy(false); }
  }

  if (!supported && list.length === 0) return null;

  return (
    <div className="mobile-card">
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <ShieldCheck size={16} color="var(--ink-3)" />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t("Biometric sign-in")}</span>
      </div>

      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "0 0 12px" }}>
        {t("Use your device's")} {t(text)} {t("to sign in instead of typing your password. Your face or fingerprint never leaves this device — it stays in secure hardware.")}
      </p>

      {list.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {list.map((p) => (
            <div key={p.id} className="m-row">
              <span className="avatar" style={{ background: "var(--st-present-bg)", color: "var(--st-present)" }}>
                <Check size={14} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{p.deviceLabel || t("Device")}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>
                  {t("Added")} {fmt(p.createdAt)}{p.lastUsedAt ? ` · ${t("last used")} ${fmt(p.lastUsedAt)}` : ""}
                </span>
              </span>
              <button
                onClick={() => remove(p.id)} disabled={busy}
                aria-label={`${t("Remove")} ${p.deviceLabel || t("device")}`}
                style={{ background: "none", border: "none", padding: 5, display: "flex", color: "var(--scc-red)", flexShrink: 0 }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {supported && (
        <button className="btn btn-ghost btn-block" onClick={register} disabled={busy}>
          {busy ? <Loader2 size={16} className="pk-spin" /> : <Icon size={16} />}
          {busy ? t("Waiting for your device…") : list.length ? `${t("Add another device")}` : `${t("Set up")} ${t(text)}`}
        </button>
      )}

      {msg && (
        <p style={{ fontSize: 12.5, fontWeight: 600, textAlign: "center", marginTop: 8, color: `var(--st-${msg.tone})` }}>
          {msg.text}
        </p>
      )}

      <style>{`.pk-spin{animation:pk-spin .9s linear infinite}@keyframes pk-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
