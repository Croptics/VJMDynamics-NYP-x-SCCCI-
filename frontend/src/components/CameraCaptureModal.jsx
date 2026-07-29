/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { useEffect, useRef, useState } from "react";
import { Camera, X, RefreshCw, Check } from "lucide-react";

/**
 * Take a profile photo with the webcam (2026-07-29 — "allow me to take image
 * using camera also"). The Settings avatar could only ever be a file upload,
 * which is a poor fit for the actual situation: staff are AT the event, on a
 * laptop with a camera, and don't have a headshot saved anywhere.
 *
 * Deliberately hands back a plain `File`, so it drops into the EXISTING photo
 * pipeline untouched — SettingsPage feeds it to the same `PhotoCropModal` a
 * file upload goes through, and the crop result posts to the same endpoint.
 * Nothing about upload, cropping or storage needed to change.
 *
 * Two-step (preview → review) rather than capture-and-commit: a webcam frame is
 * easy to get wrong (mid-blink, bad framing), and re-taking has to be cheaper
 * than uploading a replacement afterwards.
 *
 * NOT reusing lib/faceScan.js's captureFrame(): that's built for biometrics —
 * it centres on a face-crop box and downscales to 180px for vectorising. A
 * profile photo wants the full frame at full resolution and no face detection,
 * since a delegate's avatar is a picture, not a template to match against.
 */
export default function CameraCaptureModal({ onCapture, onCancel, t }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  // Data URL of a taken-but-not-yet-accepted shot; null while previewing live.
  const [shot, setShot] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        // `user` = the front/self-facing camera, which is what you want for a
        // photo OF the person at the keyboard (the scanner pages ask for
        // `environment` instead, since they're pointed AT a delegate).
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => { /* autoplay policy — the poster still shows */ });
        }
        setReady(true);
      } catch (e) {
        // Name the actual cause: "denied" and "no camera attached" need
        // completely different responses from the user, and a generic
        // "camera error" leaves them guessing which one they're facing.
        const name = e?.name || "";
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? t("Camera access was blocked. Allow camera permission for this site, then try again.")
            : name === "NotFoundError" || name === "DevicesNotFoundError"
              ? t("No camera was found on this device.")
              : name === "NotReadableError"
                ? t("The camera is in use by another app. Close it and try again.")
                : (e?.message || t("Could not start the camera."))
        );
      }
    }
    start();
    // Releasing the stream on unmount is not optional — a live MediaStream that
    // outlives this modal leaves the camera light on, which reads as the app
    // spying on you.
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function take() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    // Square, centre-cropped to the short edge — the avatar renders in a
    // circle everywhere, so cropping here means the preview you approve is
    // the shape you actually get.
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    // Un-mirror before drawing. The live preview is mirrored (below) because an
    // un-mirrored self-view feels wrong to look at, but saving it mirrored would
    // flip any text on a lanyard or badge in the shot.
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      video,
      (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size,
      0, 0, size, size
    );
    setShot(canvas.toDataURL("image/jpeg", 0.92));
  }

  async function accept() {
    if (!shot) return;
    setSaving(true);
    try {
      const blob = await (await fetch(shot)).blob();
      // A File (not a bare Blob) so it behaves identically to a picked file
      // downstream — PhotoCropModal and the upload both read `.name`/`.type`.
      onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
    } catch {
      setError(t("Could not save that photo. Please try again."));
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.55)", display: "grid", placeItems: "center", padding: 20, zIndex: 80 }}
      onClick={onCancel}
    >
      <div className="card" style={{ width: "min(460px, 100%)", padding: 0, background: "var(--surface)", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <div className="row" style={{ gap: 8 }}>
            <Camera size={16} color="var(--scc-red)" />
            <strong style={{ fontSize: 15 }}>{t("Take a photo")}</strong>
          </div>
          <button onClick={onCancel} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          {error ? (
            <div style={{ fontSize: 13, color: "var(--st-missing)", lineHeight: 1.55 }}>{error}</div>
          ) : (
            <>
              <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: "var(--r-md)", overflow: "hidden", background: "#000" }}>
                {shot ? (
                  <img src={shot} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    // `scaleX(-1)` — mirrored preview only; see take() for why
                    // the saved frame is flipped back.
                    style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
                  />
                )}
                {!ready && !shot && (
                  <div className="muted" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13 }}>
                    {t("Starting camera…")}
                  </div>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {shot ? t("Happy with it? Save, or retake.") : t("Centre yourself in the frame, then take the photo.")}
              </div>
            </>
          )}
        </div>

        <div className="row between" style={{ padding: "12px 18px", borderTop: "1px solid var(--line)", gap: 10 }}>
          <button className="btn btn-ghost" onClick={onCancel}>{t("Cancel")}</button>
          {!error && (shot ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShot(null)} disabled={saving}>
                <RefreshCw size={15} /> {t("Retake")}
              </button>
              <button className="btn btn-primary" onClick={accept} disabled={saving}>
                <Check size={15} /> {saving ? t("Saving…") : t("Use photo")}
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={take} disabled={!ready}>
              <Camera size={15} /> {t("Take photo")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
