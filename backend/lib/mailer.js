/* =============================================================================
 * backend/lib/mailer.js
 * OWNED BY: FaceCheck-Pro (Vimal)
 *
 * Outbound email for FaceCheck enrolment invites. Kept framework-free and out
 * of the router so the transport + templating can be reasoned about (and
 * dry-run tested) in isolation.
 *
 * SAFETY: sending mail is an outward-facing side effect, so this module fails
 * CLOSED. If SMTP isn't fully configured, or MAIL_DRY_RUN is set, nothing is
 * transmitted — the message is logged and reported back as { dryRun: true }.
 * That means a misconfigured dev box can never accidentally mail real
 * delegates; you have to deliberately configure SMTP to send for real.
 *
 * Config (backend/.env):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   MAIL_DRY_RUN=true        force preview mode even when SMTP is configured
 *   PUBLIC_APP_URL=https://…  base URL used to build the enrolment link
 * ========================================================================== */

import nodemailer from "nodemailer";

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
  MAIL_DRY_RUN, PUBLIC_APP_URL,
} = process.env;

/** True only when every piece needed to actually send is present. */
export function mailConfigured() {
  return !!(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

/** Dry-run whenever mail isn't fully configured, or it's explicitly forced. */
export function isDryRun() {
  return !mailConfigured() || String(MAIL_DRY_RUN || "").toLowerCase() === "true";
}

let _tx = null;
function transport() {
  if (_tx) return _tx;
  _tx = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465, // 465 = implicit TLS; 587 upgrades via STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return _tx;
}

/** Base URL for links inside emails. */
export function appBaseUrl() {
  return (PUBLIC_APP_URL || "http://localhost:5173").replace(/\/+$/, "");
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The enrolment invite. Explains what to do, why it's safe (PDPA / Zero-Image),
 * and links straight into the delegate's own enrolment via a signed token.
 * Table-based + inline styles: that's what survives Gmail/Outlook rendering.
 */
export function enrolInviteEmail({ name, tripName, link, expiresInDays }) {
  const subject = tripName
    ? `Set up face check-in for ${tripName}`
    : "Set up your face check-in before the trip";

  const text = [
    `Hi ${name || "there"},`,
    "",
    tripName
      ? `You're travelling with us on ${tripName}. Please set up face check-in before you go.`
      : "Please set up face check-in before your trip.",
    "",
    "It takes about a minute on your phone:",
    "  1. Open the link below",
    "  2. Confirm your name and give consent",
    "  3. Scan your face (and optionally record a voice backup)",
    "",
    link,
    "",
    `This link is personal to you and expires in ${expiresInDays} days.`,
    "",
    "Your privacy: no photo or audio is ever stored. Only an anonymous",
    "mathematical signature is saved, it cannot be turned back into your",
    "face or voice, and you can erase it yourself at any time (PDPA).",
    "",
    "— MusterGo",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e8eb;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;">
    <tr><td style="background:#e1232a;background-image:linear-gradient(135deg,#e1232a,#a3171d);padding:24px;">
      <div style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.85;">Before your trip</div>
      <div style="color:#ffffff;font-size:24px;font-weight:700;margin-top:6px;">Set up face check-in</div>
      ${tripName ? `<div style="color:#ffffff;font-size:14px;opacity:.92;margin-top:6px;">${esc(tripName)}</div>` : ""}
    </td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 14px;font-size:15px;color:#1a1d21;">Hi ${esc(name || "there")},</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#4a5158;">
        Enrol once now and staff can check you in with a quick face scan at the coach — no queue, no paperwork.
        It takes about a minute on your phone.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
        <tr><td style="padding:6px 0;font-size:14px;color:#4a5158;"><b style="color:#e1232a;">1.</b>&nbsp; Tap the button below</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#4a5158;"><b style="color:#e1232a;">2.</b>&nbsp; Confirm your name and give consent</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#4a5158;"><b style="color:#e1232a;">3.</b>&nbsp; Scan your face &mdash; and optionally record a voice backup for dark venues</td></tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:4px 0 18px;">
        <a href="${esc(link)}" style="display:inline-block;background:#e1232a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;">Start enrolment</a>
      </td></tr></table>
      <p style="margin:0 0 18px;font-size:12px;color:#6b7280;text-align:center;">
        This link is personal to you and expires in ${expiresInDays} days.<br>
        If the button doesn't work, paste this into your browser:<br>
        <span style="color:#4a5158;word-break:break-all;">${esc(link)}</span>
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7f6ec;border-radius:12px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:13px;font-weight:700;color:#16a34a;margin-bottom:6px;">&#128274; Your privacy is protected</div>
          <div style="font-size:12.5px;line-height:1.6;color:#4a5158;">
            No photo or audio is ever stored or uploaded. Only an anonymous mathematical signature is saved &mdash;
            it cannot be turned back into your face or voice &mdash; and you can erase it yourself at any time (PDPA).
          </div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 24px;border-top:1px solid #e6e8eb;font-size:11.5px;color:#6b7280;">
      Sent by MusterGo &middot; SCCCI delegation attendance. If you weren't expecting this, you can ignore it.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}

/**
 * Send (or preview) one message.
 * Returns { sent, dryRun, to, subject, messageId?, error? } and never throws —
 * a bulk invite run shouldn't abort halfway because one address bounced.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!to) return { sent: false, dryRun: isDryRun(), to, subject, error: "NO_RECIPIENT" };
  if (isDryRun()) {
    console.log(`  [mail:dry-run] would send "${subject}" -> ${to}`);
    return { sent: false, dryRun: true, to, subject };
  }
  try {
    const info = await transport().sendMail({ from: SMTP_FROM, to, subject, text, html });
    return { sent: true, dryRun: false, to, subject, messageId: info.messageId };
  } catch (e) {
    console.error(`  [mail] failed -> ${to}: ${e.message}`);
    return { sent: false, dryRun: false, to, subject, error: e.message };
  }
}
