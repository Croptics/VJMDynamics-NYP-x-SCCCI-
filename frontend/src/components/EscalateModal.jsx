/* =============================================================================
 *  PART OF:   MusterGo — Emergency escalations
 *
 *  Shared "Escalate to office" modal, extracted from DashboardPage.jsx's
 *  inline version so the Exceptions inbox's Escalate button uses the same copy,
 *  recipient picker and request shape. Keep the two in sync.
 * ============================================================================= */
import { useEffect, useRef, useState } from "react";
import { Siren, X } from "lucide-react";
import { apiGet, apiPost } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * @param {string}   delegateId    who this escalation is about
 * @param {string}   delegateName  shown in the modal's intro line
 * @param {string}  [tripId]       scopes the recipient picker's "trip lead" float-to-top
 * @param {string}  [defaultMessage]
 * @param {() => void} onClose
 * @param {(result: {alreadyOpen: boolean}) => void} onEscalated
 */
export default function EscalateModal({ delegateId, delegateName, tripId, defaultMessage, onClose, onEscalated }) {
  const { t } = useLang();
  const [message, setMessage] = useState(defaultMessage || t("Not answering phone calls"));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const qs = tripId ? `?tripId=${encodeURIComponent(tripId)}` : "";
    apiGet(`/escalations/recipients${qs}`).then((r) => {
      const list = r.recipients || [];
      setRecipients(list);
      setSelected(new Set(list.map((p) => p.email)));
    }).catch(() => { setRecipients([]); setSelected(new Set()); });
  }, [tripId]);

  function toggleRecipient(email) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  }

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const r = await apiPost("/escalations", {
        tripId: tripId || null,
        delegateId,
        message: message.trim(),
        recipientEmails: [...selected],
      });
      if (r.alreadyOpen) {
        setErr(t("This delegate already has an open escalation — no new alert was sent."));
        setSaving(false);
        return;
      }
      onEscalated?.(r);
      onClose();
    } catch (e) {
      setErr(e.message || t("Couldn't send the escalation. Please try again."));
      setSaving(false);
    }
  }

  return (
    <div className="exc-overlay"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label={t("Escalate to office")}>
      <div className="exc-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="exc-modal__head">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--st-missing)" }}>
            <Siren size={18} /> {t("Escalate to office")}
          </h2>
          <button className="exc-modal__x" onClick={onClose} aria-label={t("Close")}><X size={20} /></button>
        </div>

        <div className="exc-modal__body">
          <p className="muted" style={{ fontSize: 13, marginTop: -6, marginBottom: 14 }}>
            {t("This alerts offsite admin/office staff right away — for when a Missing delegate isn't answering their phone.")} <strong>{delegateName}</strong>
          </p>

          <label className="field-label">{t("What's happening?")}</label>
          <textarea
            className="input"
            rows={3}
            autoFocus
            style={{ marginTop: 4, marginBottom: 14, resize: "vertical" }}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <label className="field-label">{t("Alert who?")}</label>
          {recipients.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              {t("No admin accounts have an email on file yet — add one in Account Control to alert someone by email.")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, maxHeight: 150, overflowY: "auto" }}>
              {recipients.map((p) => (
                <label key={p.email} className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(p.email)} onChange={() => toggleRecipient(p.email)} />
                  <span style={{ fontWeight: 600 }}>{p.name || p.username}</span>
                  <span className="muted">{p.email}</span>
                  {p.isTripLead && <span className="badge badge-review" style={{ padding: "1px 7px", fontSize: 10.5 }}>{t("Trip lead")}</span>}
                </label>
              ))}
            </div>
          )}

          <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            {t("Emails can sometimes land in the recipient's Spam folder — ask them to check there and mark it \"Not spam\" the first time.")}
          </p>

          {err && <p className="exc-error">{err}</p>}

          <div className="row" style={{ gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>{t("Cancel")}</button>
            <button
              className="btn btn-primary"
              style={{ background: "var(--st-missing)", borderColor: "var(--st-missing)" }}
              onClick={submit}
              disabled={saving}
            >
              <Siren size={15} /> {saving ? t("Sending…") : t("Escalate now")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
