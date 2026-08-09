/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Emergency escalations
 *
 *  Out-of-app notification channels for escalations, used by
 *  routes/dashboard/escalations.js. (The in-app banner and tab-flash/chime are
 *  frontend-side and always on.)
 *   - Email: LIVE, via nodemailer + any SMTP provider (Gmail app password,
 *     SendGrid, AWS SES — all speak SMTP, so no per-provider code). Set
 *     SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM in backend/.env.
 *   - SMS / WhatsApp: STUBBED because Twilio charges per message. The calls are
 *     written and ready to uncomment; until then they only log what WOULD have
 *     been sent, so the flow is testable end-to-end at zero cost. To enable:
 *     `npm install twilio` and set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN plus
 *     TWILIO_FROM_NUMBER (SMS) or TWILIO_WHATSAPP_FROM (needs Twilio's WhatsApp
 *     sender approved first), and ESCALATION_SMS_TO / ESCALATION_WHATSAPP_TO
 *     (comma-separated E.164 numbers, e.g. +6591234567).
 * ============================================================================= */
import nodemailer from "nodemailer";

/* ---- Email (live) --------------------------------------------------------- */
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

export function emailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** HTML body for an escalation email — richer than the plain-text version so
 *  office staff have full context WITHOUT opening the app: phone as tap-to-call,
 *  last known location as a Google Maps link. Both optional (a message-only
 *  escalation, or no phone/location on file, just omits those lines). */
export function buildEscalationHtml({ actor, message, delegateName, phone, lastLocation, tripName }) {
  const rows = [];
  if (delegateName) rows.push(`<p style="margin:0 0 8px"><strong>Delegate:</strong> ${escapeHtml(delegateName)}</p>`);
  if (tripName) rows.push(`<p style="margin:0 0 8px"><strong>Trip:</strong> ${escapeHtml(tripName)}</p>`);
  if (message) rows.push(`<p style="margin:0 0 8px"><strong>Details:</strong> ${escapeHtml(message)}</p>`);
  if (phone) rows.push(`<p style="margin:0 0 8px"><strong>Phone:</strong> <a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></p>`);
  if (lastLocation) {
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lastLocation)}`;
    rows.push(`<p style="margin:0 0 8px"><strong>Last known location:</strong> ${escapeHtml(lastLocation)} — <a href="${mapUrl}">view on map</a></p>`);
  }
  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;max-width:480px">
      <div style="background:#e1232a;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;font-weight:bold;font-size:15px">
        MusterGo — ${escapeHtml(actor || "A staff member")} needs assistance
      </div>
      <div style="border:1px solid #e5e5e5;border-top:none;border-radius:0 0 8px 8px;padding:16px">
        ${rows.join("")}
        <p style="margin:16px 0 0;color:#666;font-size:12.5px">Open the Dashboard to see full context and acknowledge this alert.</p>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Sends one email per recipient (not one email with everyone in `to`, so a
 *  reply doesn't broadcast to the whole office). Best-effort per recipient —
 *  one failed address never blocks the others. Returns how many sent. */
export async function sendEscalationEmails(recipients, { subject, text, html }) {
  const t = getTransporter();
  if (!t || recipients.length === 0) return 0;
  let sent = 0;
  for (const to of recipients) {
    try {
      await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
      sent++;
    } catch (err) {
      console.error(`  Escalation email to ${to} failed:`, err.message || err);
    }
  }
  return sent;
}

/* ---- SMS (stubbed — no paid provider wired in yet) ------------------------ */
export function smsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

/** Recipients come from ESCALATION_SMS_TO (comma-separated E.164 numbers) —
 *  there's no per-account phone number field in this app yet, so this is
 *  intentionally a flat config list rather than a per-admin lookup. */
export async function sendEscalationSms(body) {
  const to = (process.env.ESCALATION_SMS_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (to.length === 0) return { sent: 0, configured: smsConfigured() };

  if (!smsConfigured()) {
    console.log(`  [SMS not configured — would send to ${to.join(", ")}]: ${body}`);
    return { sent: 0, configured: false };
  }

  // Uncomment once `npm install twilio` and the TWILIO_* env vars are set —
  // this is the ENTIRE integration, nothing else needs to change.
  //
  // const twilio = (await import("twilio")).default;
  // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // let sent = 0;
  // for (const num of to) {
  //   try {
  //     await client.messages.create({ from: process.env.TWILIO_FROM_NUMBER, to: num, body });
  //     sent++;
  //   } catch (err) {
  //     console.error(`  Escalation SMS to ${num} failed:`, err.message || err);
  //   }
  // }
  // return { sent, configured: true };

  return { sent: 0, configured: true };
}

/* ---- WhatsApp (stubbed — no paid provider wired in yet) ------------------- */
export function whatsAppConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
}

export async function sendEscalationWhatsApp(body) {
  const to = (process.env.ESCALATION_WHATSAPP_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (to.length === 0) return { sent: 0, configured: whatsAppConfigured() };

  if (!whatsAppConfigured()) {
    console.log(`  [WhatsApp not configured — would send to ${to.join(", ")}]: ${body}`);
    return { sent: 0, configured: false };
  }

  // Same Twilio client as SMS above, just `whatsapp:`-prefixed from/to. Needs
  // Twilio's WhatsApp sender approved first, separate from a plain SMS number.
  //
  // const twilio = (await import("twilio")).default;
  // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // let sent = 0;
  // for (const num of to) {
  //   try {
  //     await client.messages.create({
  //       from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
  //       to: `whatsapp:${num}`,
  //       body,
  //     });
  //     sent++;
  //   } catch (err) {
  //     console.error(`  Escalation WhatsApp to ${num} failed:`, err.message || err);
  //   }
  // }
  // return { sent, configured: true };

  return { sent: 0, configured: true };
}
