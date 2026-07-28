/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging & QR Fallback
 * ============================================================================= */
import { useEffect, useState } from "react";
import {
  X, UserX, BadgeX, BatteryLow, Accessibility, ScanLine, MoreHorizontal,
} from "lucide-react";
import {
  getDelegates, createException, BASE_PRIORITIES, TYPE_OTHER_MAX,
} from "../lib/exceptionsApi.js";
import { useLang } from "../lib/i18n.jsx";

const ISSUE_TYPES = [
  { value: "MISSING_PERSON",    label: "Missing person",    Icon: UserX },
  { value: "LOST_BADGE",        label: "Lost badge",        Icon: BadgeX },
  { value: "FACE_MATCH_FAILED", label: "Face match failed", Icon: ScanLine },
  { value: "DEAD_PHONE",        label: "Dead phone",        Icon: BatteryLow },
  { value: "VIP_REQUEST",       label: "VIP request",       Icon: Accessibility },
  { value: "OTHER",             label: "Others",            Icon: MoreHorizontal },
];

/**
 * "Log exception" — the Create half of the ticket CRUD (admin / Screen 5).
 *
 * Priority model (shared with the mobile Issues panel):
 *   - "Mark as critical" is the escalation switch. On => CRITICAL, and the
 *     server pushes the ticket to every connected staff device over SSE.
 *   - With it off, the ticket is either NORMAL or LOW, chosen on the two
 *     colour-coded buttons underneath.
 *
 * Issue types include "Others", which reveals a short free-text label
 * (max TYPE_OTHER_MAX chars) so staff can be specific without a new enum
 * value for every one-off.
 */
export default function LogExceptionModal({ onClose, onCreated }) {
  const { t } = useLang();
  const [delegates, setDelegates] = useState([]);
  const [type, setType] = useState("MISSING_PERSON");
  const [typeOther, setTypeOther] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [note, setNote] = useState("");
  const [critical, setCritical] = useState(false);
  const [priority, setPriority] = useState("NORMAL");   // used when not critical
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDelegates().then(setDelegates).catch(() => setDelegates([]));
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isOther = type === "OTHER";
  const otherLabel = typeOther.trim();
  const effectivePriority = critical ? "CRITICAL" : priority;
  // "Others" is only meaningful with a label, so block submit until it has one.
  const blocked = saving || (isOther && !otherLabel);

  async function submit() {
    if (isOther && !otherLabel) {
      setError(t("Describe the issue type."));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await createException({
        type,
        typeOther: isOther ? otherLabel : null,
        delegateId,
        note,
        priority: effectivePriority,
      });
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

          {/* Free-text label — only for "Others". */}
          {isOther && (
            <div className="exc-other-wrap">
              <label className="field-label" htmlFor="exc-type-other">{t("Describe the issue type")}</label>
              <div className="exc-other-row">
                <input
                  id="exc-type-other"
                  className="input"
                  autoFocus
                  maxLength={TYPE_OTHER_MAX}
                  placeholder={t("e.g. Lost luggage")}
                  value={typeOther}
                  onChange={(e) => setTypeOther(e.target.value)}
                />
                <span className={"exc-other-count" + (typeOther.length >= TYPE_OTHER_MAX ? " at-limit" : "")}>
                  {typeOther.length}/{TYPE_OTHER_MAX}
                </span>
              </div>
            </div>
          )}

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
                {d.name}{d.vip ? ` · ${t("VIP")}` : ""}
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

          {/* Normal / Low — superseded while Critical is on. */}
          <div style={{ marginBottom: 16 }}>
            <span className="exc-prio-label">
              {critical ? t("Priority · set to Critical by the switch above") : t("Priority")}
            </span>
            <div className={"exc-prio-row" + (critical ? " superseded" : "")}>
              {BASE_PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  data-p={p.value}
                  className={"exc-prio-btn" + (!critical && priority === p.value ? " selected" : "")}
                  onClick={() => setPriority(p.value)}
                  disabled={critical}
                  aria-pressed={!critical && priority === p.value}
                >
                  <span className="dot" style={{ background: p.colour }} />
                  {t(p.label)}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="exc-error">{error}</p>}

          <button
            className={"btn btn-block " + (critical ? "btn-primary" : "btn-dark")}
            onClick={submit}
            disabled={blocked}
          >
            {saving ? t("Submitting…") : critical ? t("Submit & alert team") : t("Submit ticket")}
          </button>
        </div>
      </div>
    </div>
  );
}
