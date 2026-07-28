import { useLang } from "../lib/i18n.jsx";

/**
 * Renders a pill in the MusterGo five-state status system.
 * Pass either a known `state` or use the confidence helper below.
 */
const STATE_MAP = {
  // PRESENT kept as a legacy alias — QR/face-scan/manual check-in routes
  // still write it directly (see normalize() in backend/data.js); not yet
  // migrated to ARRIVED (deferred to a later pass, see the 5-status plan).
  PRESENT: { cls: "badge-arrived", label: "Arrived" },
  ARRIVED: { cls: "badge-arrived", label: "Arrived" },
  ASSIGNED: { cls: "badge-assigned", label: "Assigned" },
  LATE: { cls: "badge-late", label: "Late" },
  MISSING: { cls: "badge-missing", label: "Missing" },
  UNASSIGNED: { cls: "badge-unassigned", label: "Unassigned" },
  REVIEW: { cls: "badge-review", label: "Review" },
  NORMAL: { cls: "badge-normal", label: "Normal" },
  CRITICAL: { cls: "badge-missing", label: "Critical" },
  LOW: { cls: "badge-neutral", label: "Low" },
  RESOLVED: { cls: "badge-present", label: "Resolved" },
  OPEN: { cls: "badge-missing", label: "Open" },
};

export default function StatusBadge({ state, children }) {
  const { t } = useLang();
  const def = STATE_MAP[state] || { cls: "badge-neutral", label: state };
  return <span className={"badge " + def.cls}>{children || t(def.label)}</span>;
}

/** Map a 0–1 confidence score to the review/present/missing palette. */
export function ConfidenceBadge({ value }) {
  const pct = Math.round(value * 100);
  let cls = "badge-present";
  if (value < 0.6) cls = "badge-missing";
  else if (value < 0.85) cls = "badge-review";
  return <span className={"badge " + cls + " mono"}>{pct}%</span>;
}
