/* =============================================================================
 *  OWNED BY:  Vance — MusterChat doc-share card. Renders a document shared into
 *  a chat: the delegates the parser extracted, with a one-tap "Add to trip"
 *  that writes them through the same onboarding confirm the Document reader
 *  uses. This is the "seamless with the document reader" bridge.
 * ============================================================================= */
import { FileText, UserPlus, Check, Loader2 } from "lucide-react";

export default function DocShareCard({ doc, onAddToTrip, adding, added, mine }) {
  const rows = Array.isArray(doc?.rows) ? doc.rows : [];
  const shown = rows.slice(0, 6);
  const more = rows.length - shown.length;

  return (
    <div style={{
      border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden",
      background: "var(--surface, #fff)", width: 260, maxWidth: "100%",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ display: "inline-flex", width: 30, height: 30, borderRadius: 8, background: "var(--scc-red-tint)", color: "var(--scc-red)", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <FileText size={16} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {doc?.filename || "Document"}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>{rows.length} delegate{rows.length === 1 ? "" : "s"} extracted</div>
        </div>
      </div>

      {shown.length > 0 && (
        <ul style={{ margin: 0, padding: "8px 12px", listStyle: "none", display: "grid", gap: 5 }}>
          {shown.map((r, i) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.3 }}>
              <strong style={{ fontWeight: 600 }}>{r.fullName || r.name}</strong>
              {(r.role || r.company) && (
                <span className="muted"> · {[r.role, r.company].filter(Boolean).join(" · ")}</span>
              )}
            </li>
          ))}
          {more > 0 && <li className="muted" style={{ fontSize: 12 }}>…and {more} more</li>}
        </ul>
      )}

      {onAddToTrip && (
        <div style={{ padding: "8px 12px 12px" }}>
          <button
            className="btn btn-primary btn-block"
            style={{ fontSize: 12.5, justifyContent: "center" }}
            disabled={adding || added || rows.length === 0}
            onClick={onAddToTrip}
          >
            {added ? <><Check size={14} /> Added to trip</>
              : adding ? <><Loader2 size={14} className="mc-spin" /> Adding…</>
              : <><UserPlus size={14} /> Add {rows.length} to trip</>}
          </button>
        </div>
      )}
      {/* Local copy of the spinner keyframes (integration patch 2026-07-27) —
          previously only defined inside MusterChatInbox's inline <style>, so
          the spinner silently froze if this card ever rendered outside it. */}
      <style>{`.mc-spin{animation:mc-spin 1s linear infinite}@keyframes mc-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
