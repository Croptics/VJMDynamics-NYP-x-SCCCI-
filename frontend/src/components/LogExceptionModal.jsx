/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging & QR Fallback
 * ============================================================================= */
import { useEffect, useState } from "react";
import { X, UserX, BadgeX, BatteryLow, Accessibility, ScanLine } from "lucide-react";
import { getDelegates, createException } from "../lib/exceptionsApi.js";
import { useLang } from "../lib/i18n.jsx";

const ISSUE_TYPES = [
  { value: "MISSING_PERSON",    label: "Missing person",    Icon: UserX },
  { value: "LOST_BADGE",        label: "Lost badge",        Icon: BadgeX },
  { value: "FACE_MATCH_FAILED", label: "Face match failed", Icon: ScanLine },
  { value: "DEAD_PHONE",        label: "Dead phone",        Icon: BatteryLow },
  { value: "VIP_REQUEST",       label: "VIP request",       Icon: Accessibility },
];

/**
 * "Log exception" — the Create half of the ticket CRUD.
 * Turning on "Mark as critical" raises priority to CRITICAL, which the server
 * pushes over SSE to every connected staff device.
 */
export default function LogExceptionModal({ onClose, onCreated }) {
  const { t } = useLang();
  const [delegates, setDelegates] = useState([]);
  const [type, setType] = useState("MISSING_PERSON");
  const [delegateId, setDelegateId] = useState("");
  const [note, setNote] = useState("");
  const [critical, setCritical] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDelegates().then(setDelegates).catch(() => setDelegates([]));
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const created = await createException({ type, delegateId, note, markCritical: critical });
      onCreated(created, critical);
    } catch (e) {
      setError(e.message || t("Could not log the exception. Please try again."));
      setSaving(false);
    }
  }

  return (
    <div className="exc-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("Log exception")}>
      <div className="exc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="exc-modal__head">
          <h2>{t("Log exception")}</h2>
          <button className="exc-modal__x" onClick={onClose} aria-label={t("Close")}><X size={20} /></button>
        </div>

        <div className="exc-modal__body">
          <label className="field-label">{t("Issue type")}</label>
          <div className="exc-issue-grid">
            {ISSUE_TYPES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                className={"exc-issue-opt" + (type === value ? " selected" : "")}
                onClick={() => setType(value)}
                aria-pressed={type === value}
              >
                <Icon size={20} strokeWidth={2} />
                {t(label)}
              </button>
            ))}
          </div>

          <label className="field-label" htmlFor="exc-delegate">{t("Delegate")}</label>
          <select
            id="exc-delegate"
            className="select"
            value={delegateId}
            onChange={(e) => setDelegateId(e.target.value)}
            style={{ marginBottom: 16 }}
          >
            <option value="">{t("Unidentified / not listed")}</option>
            {delegates.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}{d.vip ? " · VIP" : ""}
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor="exc-note">{t("Quick note")}</label>
          <textarea
            id="exc-note"
            className="input exc-textarea"
            placeholder={t("e.g. Phone unreachable. Last seen near gift shop at 14:08.")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div
            className="exc-critical"
            role="switch"
            aria-checked={critical}
            tabIndex={0}
            onClick={() => setCritical((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") { e.preventDefault(); setCritical((v) => !v); }
            }}
          >
            <span className={"exc-switch" + (critical ? " on" : "")}><span className="knob" /></span>
            <div>
              <div className="exc-critical__title">{t("Mark as critical")}</div>
              <div className="exc-critical__sub">{t("Alerts all staff devices instantly")}</div>
            </div>
          </div>

          {error && <p className="exc-error">{error}</p>}

          <button
            className={"btn btn-block " + (critical ? "btn-primary" : "btn-dark")}
            onClick={submit}
            disabled={saving}
          >
            {saving ? t("Submitting…") : critical ? t("Submit & alert team") : t("Submit ticket")}
          </button>
        </div>
      </div>
    </div>
  );
}
