/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Image storage admin (Settings)
 * ============================================================================= */
import { useEffect, useState, useRef } from "react";
import { Image as ImageIcon, RefreshCw, Trash2, AlertTriangle, Loader2, CheckSquare, Square } from "lucide-react";
import { apiGet, apiPost } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

const CONFIRM_PHRASE = "DELETE ALL";

function fmtBytes(n) {
  if (!n) return "0 KB";
  const kb = n / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Image storage manager — Settings → "Image storage" card, manageAccounts-
 * gated. Lists every delegate-photo asset actually sitting in Cloudinary
 * (backend/routes/media.js), each tagged with which delegate it belongs to
 * (or "Unlinked" — left over from a photo that was since replaced/removed),
 * and lets an admin delete a chosen subset or purge the entire folder.
 *
 * Purge is the one truly destructive, no-undo action in this whole app, so
 * it's gated behind an explicit typed confirmation ("DELETE ALL") rather
 * than just a window.confirm() — the button itself stays disabled until the
 * phrase matches exactly.
 */
export default function MediaManager() {
  const { t } = useLang();
  const [data, setData] = useState(null); // { total, totalBytes, images }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeText, setPurgeText] = useState("");
  const [purgeBusy, setPurgeBusy] = useState(false);
  // Only dismiss if the WHOLE click gesture started on the backdrop, not
  // wherever the mouse was released after dragging to select text in the
  // confirmation-phrase input — extra important here since this is a
  // destructive, no-undo action guarded by that exact typed phrase.
  const downOnPurgeBackdrop = useRef(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet("/media/images");
      setData(res);
      setSelected((prev) => new Set([...prev].filter((id) => res.images.some((img) => img.publicId === id))));
    } catch (e) {
      setError(e.code === "NOT_CONFIGURED" ? t("Cloudinary isn't configured for this deployment.") : (e.message || t("Could not load images.")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (!data) return;
    setSelected((prev) => (prev.size === data.images.length ? new Set() : new Set(data.images.map((i) => i.publicId))));
  };

  async function deleteSelected() {
    if (selected.size === 0) return;
    const linkedCount = data.images.filter((i) => selected.has(i.publicId) && i.delegateName).length;
    const warn = linkedCount > 0
      ? `\n\n${linkedCount} ${t("of these are a delegate's active profile photo — deleting them will also clear that delegate's photo.")}`
      : "";
    if (!window.confirm(`${t("Delete")} ${selected.size} ${t("image(s)? This can't be undone.")}${warn}`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost("/media/images/delete", { publicIds: [...selected] });
      setToast(`${t("Deleted")} ${res.deletedCount}${res.unlinkedDelegates ? ` · ${res.unlinkedDelegates} ${t("delegate photo(s) cleared")}` : ""}`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e.message || t("Delete failed."));
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  async function purgeAll() {
    if (purgeText !== CONFIRM_PHRASE) return;
    setPurgeBusy(true);
    setError(null);
    try {
      const res = await apiPost("/media/images/purge", { confirm: CONFIRM_PHRASE });
      setToast(`${t("Purged")} ${res.deletedCount} ${t("image(s)")}${res.unlinkedDelegates ? ` · ${res.unlinkedDelegates} ${t("delegate photo(s) cleared")}` : ""}`);
      setPurgeOpen(false);
      setPurgeText("");
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e.message || t("Purge failed."));
    } finally {
      setPurgeBusy(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  const images = data?.images || [];

  return (
    <div className="card" style={{ marginTop: 16, padding: 22 }}>
      <div className="row between" style={{ marginBottom: 4, flexWrap: "wrap", gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <ImageIcon size={18} color="var(--ink-3)" />
          <h2 style={{ fontSize: 16 }}>{t("Image storage")}</h2>
        </div>
        <button className="btn btn-ghost" onClick={load} disabled={loading} style={{ padding: "6px 10px" }}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> {t("Refresh")}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 2, marginBottom: 14 }}>
        {t("Delegate profile photos stored in Cloudinary — delete individual images, or clear everything at once.")}
      </p>

      {error && (
        <div style={{ padding: "10px 12px", borderRadius: "var(--r-sm)", background: "var(--st-missing-bg)", color: "var(--st-missing)", fontSize: 13, marginBottom: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}

      {loading && !data && <div className="muted" style={{ fontSize: 13 }}>{t("Loading…")}</div>}

      {data && (
        <>
          <div className="row between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {data.total} {t("images")} · {fmtBytes(data.totalBytes)}
            </span>
            {images.length > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" onClick={toggleAll} style={{ padding: "6px 10px", fontSize: 12.5 }}>
                  {selected.size === images.length ? <CheckSquare size={14} /> : <Square size={14} />}
                  {selected.size === images.length ? t("Deselect all") : t("Select all")}
                </button>
                <button
                  className="btn btn-ghost" onClick={deleteSelected} disabled={selected.size === 0 || busy}
                  style={{ padding: "6px 10px", fontSize: 12.5, color: "var(--st-missing)", borderColor: "var(--scc-red-tint-2)" }}
                >
                  {busy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                  {t("Delete selected")} {selected.size > 0 ? `(${selected.size})` : ""}
                </button>
                <button
                  className="btn btn-dark" onClick={() => setPurgeOpen(true)} disabled={busy}
                  style={{ padding: "6px 10px", fontSize: 12.5, background: "var(--st-missing)" }}
                >
                  <Trash2 size={14} /> {t("Purge all")}
                </button>
              </div>
            )}
          </div>

          {images.length === 0 ? (
            <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: "24px 0" }}>
              {t("No images stored yet.")}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
              {images.map((img) => {
                const isSel = selected.has(img.publicId);
                return (
                  <button
                    key={img.publicId}
                    onClick={() => toggle(img.publicId)}
                    title={img.delegateName ? `${img.delegateName} · ${fmtBytes(img.bytes)}` : `${t("Unlinked")} · ${fmtBytes(img.bytes)}`}
                    style={{
                      position: "relative", padding: 0, border: `2px solid ${isSel ? "var(--scc-red)" : "var(--line)"}`,
                      borderRadius: "var(--r-sm)", overflow: "hidden", cursor: "pointer", background: "var(--surface-2)",
                      aspectRatio: "1 / 1",
                    }}
                  >
                    <img src={img.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} loading="lazy" />
                    <span style={{
                      position: "absolute", top: 4, left: 4, width: 18, height: 18, borderRadius: 4,
                      background: isSel ? "var(--scc-red)" : "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isSel && <CheckSquare size={12} color="#fff" />}
                    </span>
                    <span style={{
                      position: "absolute", bottom: 0, left: 0, right: 0, padding: "3px 5px", fontSize: 10,
                      background: "rgba(16,24,40,0.72)", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left",
                    }}>
                      {img.delegateName || t("Unlinked")}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {toast && (
        <div style={{ marginTop: 14, padding: "8px 12px", borderRadius: "var(--r-sm)", background: "var(--st-present-bg)", color: "var(--st-present)", fontSize: 12.5 }}>
          {toast}
        </div>
      )}

      {/* Purge-all confirmation — the destructive action requires typing the
          exact phrase, not just a click-through confirm(). */}
      {purgeOpen && (
        <div
          onMouseDown={(e) => { downOnPurgeBackdrop.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (downOnPurgeBackdrop.current && e.target === e.currentTarget) { setPurgeOpen(false); setPurgeText(""); } }}
          style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 20 }}
        >
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", padding: 22 }}>
            <div className="row" style={{ gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
              <AlertTriangle size={20} color="var(--st-missing)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <h2 style={{ fontSize: 16 }}>{t("Purge all images")}</h2>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  {t("This permanently deletes all")} {data?.total ?? 0} {t("images from Cloudinary and clears every delegate's profile photo. This cannot be undone.")}
                </p>
              </div>
            </div>
            <label className="field-label" style={{ marginTop: 6 }}>
              {t("Type")} <span className="mono" style={{ fontWeight: 700 }}>{CONFIRM_PHRASE}</span> {t("to confirm")}
            </label>
            <input
              className="input" autoFocus value={purgeText}
              onChange={(e) => setPurgeText(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              style={{ marginTop: 6 }}
            />
            <div className="row" style={{ gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setPurgeOpen(false); setPurgeText(""); }}>
                {t("Cancel")}
              </button>
              <button
                className="btn btn-primary" style={{ flex: 1, background: "var(--st-missing)" }}
                disabled={purgeText !== CONFIRM_PHRASE || purgeBusy}
                onClick={purgeAll}
              >
                {purgeBusy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} {t("Purge all")}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
