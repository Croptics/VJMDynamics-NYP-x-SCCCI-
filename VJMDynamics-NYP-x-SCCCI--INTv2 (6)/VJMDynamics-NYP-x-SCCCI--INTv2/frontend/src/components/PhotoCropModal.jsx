/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/**
 * Shared circular photo-crop-before-upload modal. Extracted from
 * DashboardPage.jsx (2026-07-24) so SettingsPage.jsx's self-service profile
 * photo could reuse the exact same crop/zoom/drag flow instead of duplicating
 * it — the underlying picker just decides what to do with the resulting blob
 * (delegate photo upload vs. account photo upload).
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const CROP_VIEWPORT = 280; // on-screen circular preview size (px)
const CROP_OUTPUT = 480;   // exported square image size (px)

const S = {
  overlay: { position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 60 },
  modal: { width: "min(380px, 100%)", maxHeight: "calc(100vh - 48px)", overflowY: "auto", padding: 24, background: "var(--surface)", textAlign: "center" },
  iconBtn: { background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4, borderRadius: 6 },
};

export default function PhotoCropModal({ file, onCancel, onSave, t }) {
  const [src, setSrc] = useState(null);
  const [naturalSize, setNaturalSize] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const imgElRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = naturalSize ? Math.max(CROP_VIEWPORT / naturalSize.w, CROP_VIEWPORT / naturalSize.h) : 1;
  const scale = baseScale * zoom;

  function clampOffset(off, s) {
    if (!naturalSize) return off;
    const dispW = naturalSize.w * s, dispH = naturalSize.h * s;
    const maxX = Math.max(0, (dispW - CROP_VIEWPORT) / 2);
    const maxY = Math.max(0, (dispH - CROP_VIEWPORT) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, off.x)), y: Math.min(maxY, Math.max(-maxY, off.y)) };
  }

  useEffect(() => { setOffset((o) => clampOffset(o, scale)); }, [zoom, naturalSize]); // eslint-disable-line react-hooks/exhaustive-deps

  function onImgLoad(e) {
    setNaturalSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
    setOffset({ x: 0, y: 0 });
  }

  function onPointerDown(e) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampOffset({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy }, scale));
  }
  function onPointerUp() { dragRef.current = null; }

  async function handleSave() {
    if (!naturalSize) return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = CROP_OUTPUT;
      canvas.height = CROP_OUTPUT;
      const ctx = canvas.getContext("2d");
      const outScale = CROP_OUTPUT / CROP_VIEWPORT;
      const dispW = naturalSize.w * scale * outScale;
      const dispH = naturalSize.h * scale * outScale;
      const cx = CROP_OUTPUT / 2 + offset.x * outScale;
      const cy = CROP_OUTPUT / 2 + offset.y * outScale;
      ctx.drawImage(imgElRef.current, cx - dispW / 2, cy - dispH / 2, dispW, dispH);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      onSave(blob);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={S.overlay}>
      <div className="card" style={S.modal}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 16 }}>{t("Adjust photo")}</h2>
          <button onClick={onCancel} style={S.iconBtn} aria-label={t("Close")}><X size={18} /></button>
        </div>

        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{
            width: CROP_VIEWPORT, height: CROP_VIEWPORT, margin: "0 auto", borderRadius: "50%",
            overflow: "hidden", position: "relative", background: "#000", cursor: dragRef.current ? "grabbing" : "grab",
            touchAction: "none", boxShadow: "0 0 0 2px var(--line)",
          }}
        >
          {src && (
            <img
              ref={imgElRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={onImgLoad}
              style={{
                position: "absolute", left: "50%", top: "50%",
                width: naturalSize ? naturalSize.w * scale : "auto",
                height: naturalSize ? naturalSize.h * scale : "auto",
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                userSelect: "none", pointerEvents: "none",
              }}
            />
          )}
        </div>

        <div className="row" style={{ gap: 10, marginTop: 16, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }}>{t("Zoom")}</span>
          <input
            type="range" min={1} max={3} step={0.01} value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t("Drag to reposition, then Save.")}</p>

        <div className="row" style={{ gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>{t("Cancel")}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !naturalSize}>
            {saving ? t("Saving…") : t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
