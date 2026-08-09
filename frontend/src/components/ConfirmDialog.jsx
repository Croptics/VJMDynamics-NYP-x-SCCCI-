/* =============================================================================
 *  PART OF:   MusterGo — shared confirmation prompt
 *
 *  Generic "are you sure?" dialog (2026-07-31 — "pls add warning to delete,
 *  resolve button"). Uses the same .exc-overlay/.exc-modal shell as
 *  LogExceptionModal/EscalateModal so it matches whichever page renders it
 *  without needing that page's own bespoke modal styles.
 * ============================================================================= */
import { useRef } from "react";
import { X } from "lucide-react";
import { useLang } from "../lib/i18n.jsx";

/**
 * @param {string}  title
 * @param {string}  message
 * @param {string} [confirmLabel]  defaults to "Confirm"
 * @param {"default"|"danger"} [tone]
 * @param {() => void} onCancel
 * @param {() => void} onConfirm
 */
export default function ConfirmDialog({ title, message, confirmLabel, tone = "default", onCancel, onConfirm }) {
  const { t } = useLang();
  const downOnBackdrop = useRef(false);
  return (
    <div className="exc-overlay"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onCancel(); }}
      role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="exc-modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="exc-modal__head">
          <h2>{title}</h2>
          <button className="exc-modal__x" onClick={onCancel} aria-label={t("Close")}><X size={20} /></button>
        </div>
        <div className="exc-modal__body">
          <p style={{ fontSize: 13.5, marginTop: 0 }}>{message}</p>
          <div className="row" style={{ gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onCancel}>{t("Cancel")}</button>
            <button
              className={"btn " + (tone === "danger" ? "btn-primary" : "btn-dark")}
              style={tone === "danger" ? { background: "var(--st-missing)", borderColor: "var(--st-missing)" } : undefined}
              onClick={onConfirm}
            >
              {confirmLabel || t("Confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
