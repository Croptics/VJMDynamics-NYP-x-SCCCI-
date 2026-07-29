/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Emergency escalations
 * ============================================================================= */
/**
 * "Mute alert sound" (2026-07-25) — a device-local preference (not synced to
 * the account, since a shared kiosk device and a personal phone might want
 * different settings) for the escalation chime played by EscalationBanner.jsx.
 * Only silences the Tier-1 audio chime — the banner itself, the tab-title
 * flash, and the email still all still fire regardless.
 */
const KEY = "mg_mute_alert_sound";

export function isAlertSoundMuted() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAlertSoundMuted(muted) {
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    // ignore — worst case the preference just doesn't persist
  }
}
