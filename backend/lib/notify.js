/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Emergency escalations
 *
 *  Outbound notification channels for escalations (routes/escalations.js).
 *  Three tiers, per the user's request:
 *   1. In-app banner (frontend, polls GET /api/escalations/open) — always on.
 *   2. Tab-flash/chime (frontend) — always on, no config needed.
 *   3. Real out-of-app channels, here:
 *      - Email: LIVE, via nodemailer + any SMTP provider (Gmail app password,
 *        SendGrid SMTP relay, AWS SES SMTP, etc. — all speak the same
 *        protocol, so no per-provider code needed). Configure SMTP_HOST/
 *        SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM in backend/.env.
 *      - SMS / WhatsApp: STUBBED, not wired to a real provider — these cost
 *        money per message (Twilio et al.), so nothing fires until you
 *        explicitly decide to pay for it and fill in the env vars below.
 *        The Twilio call is written and ready to uncomment; until then it
 *        only logs what WOULD have been sent, so you can see this working
 *        end-to-end (including in the escalation's own audit trail) with
 *        zero cost, and flip it on later by installing `twilio` and setting
 *        TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER (SMS) or
 *        TWILIO_WHATSAPP_FROM (WhatsApp, needs Twilio's WhatsApp sender
 *        approved first) + ESCALATION_SMS_TO / ESCALATION_WHATSAPP_TO
 *        (comma-separated phone numbers in E.164 format, e.g. +6591234567).
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

/** Builds the HTML body for an escalation email (2026-07-25) — richer than
 *  the plain-text version so office staff have full context WITHOUT opening
 *  the app: delegate phone as a tap-to-call link, last known location as a
 *  Google Maps link. Both are optional (a message-only escalation, or a
 *  delegate with no phone/location on file, just omits those lines). */
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

  // Uncomment once `npm install twilio` and the TWILIO_* env vars above are
  // set. Left commented (not deleted) so the exact shape is ready to go —
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

  // Same Twilio client as SMS above, just a `whatsapp:` prefixed from/to pair
  // — Twilio's WhatsApp sender needs to be approved/set up first, separate
  // from a plain SMS number. Uncomment once that's done:
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
