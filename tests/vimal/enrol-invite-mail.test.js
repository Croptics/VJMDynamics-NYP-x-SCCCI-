/**
 * Unit tests — delegate enrolment-invite email (Vimal, FaceCheck-Pro).
 *
 * Covers `backend/lib/mailer.js`: the dry-run safety interlock, the
 * PUBLIC_APP_URL sanity check, and the invite template itself.
 *
 * WHY THE ODD IMPORTS: mailer.js reads its SMTP/URL configuration from
 * process.env once, at module load. To exercise several different
 * configurations in one file, each case sets the environment and then imports
 * the module under a unique `?case=` query string, which Node treats as a
 * separate module instance. Nothing is ever transmitted — every case here is
 * unconfigured or explicitly dry-run.
 *
 * Run from the repo root:  node --test "tests/vimal/*.test.js"
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const SMTP_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "MAIL_DRY_RUN", "PUBLIC_APP_URL"];

/** Load a fresh copy of mailer.js under the given environment. */
let caseId = 0;
async function loadMailer(env = {}) {
  const saved = {};
  for (const k of SMTP_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env);
  try {
    caseId += 1;
    return await import(`../../backend/lib/mailer.js?case=${caseId}`);
  } finally {
    for (const k of SMTP_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const FULL_SMTP = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_USER: "apikey",
  SMTP_PASS: "not-a-real-secret",
  SMTP_FROM: "MusterGo <no-reply@example.test>",
};

describe("mail configuration fails CLOSED", () => {
  test("unconfigured SMTP means dry-run — a dev box can never mail real delegates", async () => {
    const m = await loadMailer({ PUBLIC_APP_URL: "https://mustergo.example.org" });
    assert.equal(m.mailConfigured(), false);
    assert.equal(m.isDryRun(), true);
  });

  test("a partial SMTP config still counts as unconfigured", async () => {
    const { SMTP_FROM, ...partial } = FULL_SMTP;
    const m = await loadMailer(partial);
    assert.equal(m.mailConfigured(), false, "missing SMTP_FROM must not arm sending");
    assert.equal(m.isDryRun(), true);
  });

  test("MAIL_DRY_RUN=true forces preview mode even with full SMTP", async () => {
    const m = await loadMailer({ ...FULL_SMTP, MAIL_DRY_RUN: "true" });
    assert.equal(m.mailConfigured(), true);
    assert.equal(m.isDryRun(), true, "the explicit kill switch must win");
  });

  test("sendMail in dry-run reports a preview and transmits nothing", async () => {
    const m = await loadMailer({ ...FULL_SMTP, MAIL_DRY_RUN: "true" });
    const res = await m.sendMail({ to: "delegate@example.test", subject: "Hi", text: "x", html: "<p>x</p>" });
    assert.equal(res.sent, false);
    assert.equal(res.dryRun, true);
    assert.equal(res.to, "delegate@example.test");
    assert.equal(res.messageId, undefined);
  });

  test("sendMail with no recipient resolves to an error instead of throwing", async () => {
    // A bulk invite run must not abort halfway because one row had no address.
    const m = await loadMailer({});
    const res = await m.sendMail({ to: "", subject: "Hi", text: "x" });
    assert.equal(res.sent, false);
    assert.equal(res.error, "NO_RECIPIENT");
  });
});

describe("appBaseUrlWarning — catches invites whose link is dead on arrival", () => {
  test("a real public https URL is fine", async () => {
    const m = await loadMailer({ PUBLIC_APP_URL: "https://mustergo.duckdns.org" });
    assert.equal(m.appBaseUrlWarning(), null);
  });

  test("a trailing slash is trimmed from the base URL", async () => {
    const m = await loadMailer({ PUBLIC_APP_URL: "https://mustergo.duckdns.org///" });
    assert.equal(m.appBaseUrl(), "https://mustergo.duckdns.org");
  });

  test("localhost is flagged — the link only resolves on the dev machine", async () => {
    const m = await loadMailer({ PUBLIC_APP_URL: "http://localhost:5173" });
    const w = m.appBaseUrlWarning();
    assert.ok(w, "should warn");
    assert.match(w, /only resolves on this machine|dead/i);
  });

  test("a private LAN address is flagged, and the https cert problem is called out", async () => {
    const lan = await loadMailer({ PUBLIC_APP_URL: "https://192.168.1.42:5173" });
    const w = lan.appBaseUrlWarning();
    assert.match(w, /private LAN/i);
    assert.match(w, /certificate/i);
  });

  test("every RFC1918 range is covered, not just 192.168", async () => {
    for (const host of ["10.0.0.5", "172.16.4.9", "169.254.1.1"]) {
      const m = await loadMailer({ PUBLIC_APP_URL: `http://${host}:5173` });
      assert.ok(m.appBaseUrlWarning(), `${host} should warn`);
    }
  });

  test("a garbage URL is reported rather than silently used", async () => {
    const m = await loadMailer({ PUBLIC_APP_URL: "not a url" });
    assert.match(m.appBaseUrlWarning(), /not a valid URL/i);
  });

  test("defaults to localhost when PUBLIC_APP_URL is unset (and warns about it)", async () => {
    const m = await loadMailer({});
    assert.equal(m.appBaseUrl(), "http://localhost:5173");
    assert.ok(m.appBaseUrlWarning());
  });
});

describe("enrolInviteEmail — the message a delegate actually receives", () => {
  const build = async (over = {}) => {
    const m = await loadMailer({ PUBLIC_APP_URL: "https://mustergo.duckdns.org" });
    return m.enrolInviteEmail({
      name: "Wesley Wong",
      tripName: "SCCCI Delegation to Chengdu",
      link: "https://mustergo.duckdns.org/enroll?t=abc.def.ghi",
      expiresInDays: 14,
      ...over,
    });
  };

  test("the subject names the trip when there is one", async () => {
    const mail = await build();
    assert.equal(mail.subject, "Set up face check-in for SCCCI Delegation to Chengdu");
  });

  test("falls back to a generic subject with no trip name", async () => {
    const mail = await build({ tripName: null });
    assert.equal(mail.subject, "Set up your face check-in before the trip");
    assert.ok(!mail.html.includes("null"), "a missing trip must not render as 'null'");
  });

  test("both the HTML and plain-text parts carry the enrolment link", async () => {
    const mail = await build();
    assert.ok(mail.html.includes("https://mustergo.duckdns.org/enroll?t=abc.def.ghi"));
    assert.ok(mail.text.includes("https://mustergo.duckdns.org/enroll?t=abc.def.ghi"));
  });

  test("greets the delegate by name, and 'there' when the name is missing", async () => {
    assert.ok((await build()).text.startsWith("Hi Wesley Wong,"));
    assert.ok((await build({ name: null })).text.startsWith("Hi there,"));
  });

  test("states the expiry so the delegate knows the link is time-limited", async () => {
    const mail = await build({ expiresInDays: 7 });
    assert.ok(mail.text.includes("expires in 7 days"));
    assert.ok(mail.html.includes("expires in 7 days"));
  });

  test("carries the PDPA / zero-image privacy promise", async () => {
    const mail = await build();
    assert.match(mail.text, /no photo or audio is ever stored/i);
    assert.match(mail.html, /PDPA/);
  });

  test("HTML-escapes the delegate's name — a roster value can't inject markup", async () => {
    // Names come from an uploaded delegate list, so they are untrusted input.
    const mail = await build({ name: '<script>alert("x")</script>' });
    assert.ok(!mail.html.includes("<script>"), "raw script tag must not survive");
    assert.ok(mail.html.includes("&lt;script&gt;"));
  });

  test("HTML-escapes the trip name too", async () => {
    const mail = await build({ tripName: "Chengdu <b>2026</b>" });
    assert.ok(mail.html.includes("Chengdu &lt;b&gt;2026&lt;/b&gt;"));
  });
});
