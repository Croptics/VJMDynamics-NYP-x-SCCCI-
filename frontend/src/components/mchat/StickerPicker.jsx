/* =============================================================================
 *  OWNED BY:  Vance — MusterChat sticker picker. A popover with an emoji sticker
 *  pack (sent as body) plus an "upload image sticker" option (sent as a data-URL
 *  in media). Shared by HumanThread and GroupThread. onPick receives one of
 *  { body } | { media } | { error }.
 * ============================================================================= */
import { useRef } from "react";
import { ImagePlus } from "lucide-react";

const STICKERS = ["😀", "😂", "🥰", "😎", "😭", "😱", "🤔", "😴", "👍", "👏", "🙏", "🎉", "🔥", "💯", "❤️", "💔", "✅", "❌", "⚠️", "🚌", "✈️", "📸", "🫡", "💪", "🙌", "👀", "🤝", "🌟", "☕", "🍜", "🧳", "📍"];
const MAX_STICKER_BYTES = 1024 * 1024; // ~1MB

export default function StickerPicker({ onPick }) {
  const fileRef = useRef(null);
  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_STICKER_BYTES) { onPick({ error: "Sticker image must be under ~1 MB." }); return; }
    try {
      const media = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      onPick({ media });
    } catch { onPick({ error: "Couldn't read that image." }); }
  }
  return (
    <div className="card" style={{ position: "absolute", bottom: 60, left: 10, padding: 10, zIndex: 6, width: 272, boxShadow: "0 12px 32px rgba(0,0,0,0.16)" }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="page-eyebrow" style={{ padding: 0 }}>Stickers</div>
        <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Upload</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 2, maxHeight: 184, overflowY: "auto" }}>
        {STICKERS.map((s) => (
          <button key={s} onClick={() => onPick({ body: s })} title="Send sticker" className="mc-sticker"
            style={{ fontSize: 26, lineHeight: 1, padding: 6, borderRadius: 10, border: "none", background: "transparent", cursor: "pointer" }}>
            {s}
          </button>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
      <style>{`.mc-sticker:hover{background:var(--surface-2)!important}`}</style>
    </div>
  );
}
