/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — User Guide's walkthrough-video upload card
 *
 *  Extracted from UserGuidePage.jsx.
 * ============================================================================= */
import { useState, useEffect } from "react";
import { PlayCircle, Upload, Trash2 } from "lucide-react";
import { apiGet, apiDelete, getPermissions, getToken } from "../../../lib/api.js";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

/** Getting Started's walkthrough video slot. Global, not per-account — GET
 *  /api/guide-video returns whatever an Admin last uploaded (null = "coming
 *  soon" placeholder). Only manageAccounts sees upload/replace/remove. */
export function GuideVideoCard({ t }) {
  const isAdmin = !!getPermissions().manageAccounts;
  const [video, setVideo] = useState(undefined); // undefined = loading, null = none set
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    apiGet("/guide-video").then((r) => setVideo(r.video || null)).catch(() => setVideo(null));
  }
  useEffect(load, []);

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("video", file);
      const res = await fetch(`${API_BASE}/guide-video`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() || ""}` },
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || t("Could not upload the video."));
      }
      load();
    } catch (e2) {
      setError(e2.message || t("Could not upload the video."));
    } finally {
      setUploading(false);
    }
  }

  async function onRemove() {
    if (!window.confirm(t("Remove the walkthrough video? The tab goes back to \"coming soon\" until another one is uploaded."))) return;
    try {
      await apiDelete("/guide-video");
      load();
    } catch {
      /* best-effort — the card just keeps showing the old video if this fails */
    }
  }

  return (
    <div className="card" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
      {video ? (
        <video
          key={video.url}
          src={video.url}
          controls
          style={{ width: "100%", aspectRatio: "16 / 9", display: "block", background: "#000" }}
        />
      ) : (
        <div
          style={{
            position: "relative", width: "100%", aspectRatio: "16 / 9",
            background: "linear-gradient(135deg, var(--surface-2), var(--surface))",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <span style={{
              display: "inline-flex", width: 64, height: 64, borderRadius: "50%",
              background: "var(--scc-red)", color: "#fff", alignItems: "center", justifyContent: "center",
              boxShadow: "var(--shadow-lg)",
            }}>
              <PlayCircle size={30} />
            </span>
            <p style={{ marginTop: 14, fontWeight: 600, fontSize: 15 }}>
              {t(video === undefined ? "Loading…" : "Walkthrough video — coming soon")}
            </p>
            {video === null && (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{t("A short video covering the basics will go here.")}</p>
            )}
          </div>
        </div>
      )}
      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          {video
            ? t("In the meantime, the guide below covers the one thing worth understanding before you start: how a delegate's status changes.")
            : t("In the meantime, the guide below covers the one thing worth understanding before you start: how a delegate's status changes.")}
        </p>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <label className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px", cursor: uploading ? "default" : "pointer" }}>
              <Upload size={14} /> {uploading ? t("Uploading…") : (video ? t("Replace video") : t("Upload video"))}
              <input type="file" accept="video/*" style={{ display: "none" }} disabled={uploading} onChange={onPick} />
            </label>
            {video && (
              <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px", color: "var(--st-missing)" }} onClick={onRemove}>
                <Trash2 size={14} /> {t("Remove")}
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="muted" style={{ padding: "0 18px 14px", color: "var(--st-missing)", fontSize: 12 }}>{error}</p>}
    </div>
  );
}

