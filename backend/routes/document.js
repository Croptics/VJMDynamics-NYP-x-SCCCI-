/* =============================================================================
 *  OWNED BY:  Vance — DocuSync AI (Document Parsing) + Trip Assistant (Chatbot)
 *  PART OF:   MusterGo — Screen 4 (Document Parsing) + Screen 6 (Trip Assistant)
 *
 *  This is a self-contained feature module (same pattern as Jayden's
 *  exceptions.js and Desmond's trip.js). It does NOT edit any of JQ's base
 *  files (server.js / data.js / permissions.js) beyond the two mount lines in
 *  server.js's TEAMMATE ZONE.
 *
 *  DOCUMENT PARSING — hybrid, versatile pipeline
 *  ---------------------------------------------
 *    1. PDFs are FIRST read as text server-side (unpdf). If the file has real,
 *       selectable text (a delegate directory, an attendee spreadsheet export,
 *       a typed list…), that text is structured by an LLM — cheap, fast, works
 *       across many pages, and even runs on a free local Ollama.
 *    2. If a PDF has little/no extractable text (a SCANNED passport, a photo),
 *       or the upload is an image, it falls back to VISION. Claude vision is used
 *       when a key is set; otherwise images are read by LOCAL OCR (Tesseract), so
 *       scanned attendee lists and passport/ID photos still work fully offline —
 *       the OCR text then flows through the same LLM structuring step.
 *    This is why one uploader handles directories, spreadsheets AND passport
 *    scans — the strongest talking point for the Section C AI reflection.
 *
 *  Provider split:
 *    - Parsing prefers Claude when a key is set (best extraction accuracy),
 *      and falls back to local Ollama for text-based docs when it isn't.
 *      Vision uses Claude when available, else local Tesseract OCR for images.
 *    - The chatbot is Ollama-first, Claude-fallback (mirrors JQ's insights.js),
 *      because it is high-volume and text-only.
 * ============================================================================= */

import { Router } from "express";
import express from "express";
import { randomUUID } from "crypto";
import pg from "pg";
import {
  createDelegate,
  getTrip,
  getDashboard,
  COACHES,
  accountPermissions,
  getVisibleCoachIds,
} from "../data.js";
// Audit trail (2026-07-30 — "the history log didn't track the qr, face
// scanner and manual update right?" — confirmed: it didn't). Same helper
// trip.js's own edits already use; exported from there rather than
// duplicated here.
import { recordEvent } from "./trip.js";
// The REAL Delegate history log (activity_log, db/history.js — a SEPARATE
// system from recordEvent's trip_event_log above) — this route also updates
// `delegates` with raw SQL, bypassing updateDelegate() (db/delegates.js),
// which is the only place logActivity() otherwise gets called from (2026-07-30
// — "the qr code scanner didn't log in the history log, pls check").
import { logActivity } from "../db/history.js";
import { actorOf } from "../lib/actor.js";
import { requireAuth, requirePermission, requireKioskOrPermission } from "../lib/auth.js";
// Boarding-pass email (Feature 4c, merged from Vance's post-v2 branch,
// 2026-07-31) — already a project dependency (JQ's lib/notify.js uses the
// same SMTP_HOST/SMTP_USER/SMTP_PASS pattern for escalation emails); kept as
// its own transporter here rather than importing notify.js's, matching this
// module's existing self-contained-feature convention.
import nodemailer from "nodemailer";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---- DB connection (same env vars as data.js / exceptions.js) ----------- */
const { Pool } = pg;
let pool;

function readConfig() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const forceSsl = process.env.PGSSL;
  const sslFor = (isLocal) =>
    forceSsl === "true" ? { rejectUnauthorized: false }
    : forceSsl === "false" ? false
    : isLocal ? false
    : { rejectUnauthorized: false };

  if (url) return { connectionString: url, ssl: sslFor(/localhost|127\.0\.0\.1/.test(url)) };
  const host = process.env.DB_HOST || "localhost";
  return {
    host,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "mustergo",
    ssl: sslFor(/localhost|127\.0\.0\.1/.test(host)),
  };
}

const q = (text, params) => pool.query(text, params);

/* Resolve a client-supplied trip identifier to its uuid_id. Accepts EITHER the
 * trips.id string (e.g. "t-1", the seed trip) OR the uuid_id itself (what
 * /api/all-trips returns as `id`, which is what the onboarding trip picker now
 * sends). Returns null when nothing matches. Matching only the string id used
 * to silently orphan delegates onboarded to any non-seed trip. Call after
 * ensureReady() so the pool exists. */
async function resolveTripUuid(tripId) {
  if (!tripId) return null;
  const r = await q(
    `SELECT uuid_id FROM trips WHERE id = $1 OR uuid_id::text = $1 LIMIT 1`,
    [String(tripId)]
  );
  return r.rows[0]?.uuid_id || null;
}

/* ---- Lazy schema init (additive only — never drops base tables) ---------- */
let readyPromise = null;
function ensureReady() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  pool = new Pool(readConfig());
  // Rich delegate fields captured by the document parser. `company` already
  // exists (added by Desmond) — reuse it. Everything here is additive.
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS passport_no     VARCHAR(64)`);
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS nationality     VARCHAR(128)`);
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS passport_expiry VARCHAR(32)`);
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS role            VARCHAR(191)`);
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS industry        VARCHAR(191)`);
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS email           VARCHAR(191)`);
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS phone           VARCHAR(64)`);
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS website         VARCHAR(255)`);
  // Unique boarding-pass token per delegate → encoded in their QR badge and
  // resolved by the on-site scanner to check them in.
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS qr_code         VARCHAR(64)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_delegates_qr ON delegates(qr_code) WHERE qr_code IS NOT NULL`);
  // Optional EXTERNAL badge (Feature 4b): a code from SCCCI's own physical pass,
  // linked at the boarding-pass desk. Check-in resolves EITHER this or qr_code,
  // so a delegate can be scanned in with their existing pass instead of ours.
  await q(`ALTER TABLE delegates ADD COLUMN IF NOT EXISTS external_badge_code VARCHAR(128)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_delegates_extbadge ON delegates(external_badge_code) WHERE external_badge_code IS NOT NULL`);

  // Saved assistant chats for the desktop sidebar.
  await q(`CREATE TABLE IF NOT EXISTS chat_sessions (
    id          VARCHAR(64) PRIMARY KEY,
    account_id  VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title       VARCHAR(255) NOT NULL DEFAULT 'New chat',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS chat_messages (
    id          VARCHAR(64) PRIMARY KEY,
    session_id  VARCHAR(64) NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        VARCHAR(16) NOT NULL,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await q(`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false`);
  // Multi-trip assistant support (2026-07-31 — "we have different trips and the
  // chatbot is only for beijing"): each chat is now scoped to the trip it was
  // started for, so continuing an existing chat always answers about the SAME
  // trip it began with, regardless of which trip is currently selected in the
  // switcher. Existing rows predate trips entirely — backfill them to Beijing
  // (t-1), matching this codebase's established backfill convention (see
  // coaches/delegates trip_id backfill in db/schema.js).
  await q(`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES trips(uuid_id)`);
  await q(`UPDATE chat_sessions SET trip_id = (SELECT uuid_id FROM trips WHERE id = 't-1')
           WHERE trip_id IS NULL AND EXISTS (SELECT 1 FROM trips WHERE id = 't-1')`);
  await q(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_acct ON chat_sessions(account_id, updated_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_chat_messages_sess ON chat_messages(session_id, created_at)`);

  // MusterChat: direct human↔human messages (staff↔staff two-way, staff→delegate
  // log), plus video-call entries and shared-document cards. The AI assistant
  // keeps its own chat_sessions tables above; this is the person-to-person layer
  // that sits beside it in the same inbox. `convo_key` is an order-independent
  // key for the pair so A→B and B→A share one thread. `media` holds a data URL
  // for a video clip, or JSON for a doc-share / call summary.
  // (Integrated from Vance's v2 branch 2026-07-27 — tables are all-additive,
  // CREATE/ALTER IF NOT EXISTS only, no existing table is touched.)
  await q(`CREATE TABLE IF NOT EXISTS dm_messages (
    id             VARCHAR(64) PRIMARY KEY,
    convo_key      VARCHAR(200) NOT NULL,
    sender_id      VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    recipient_kind VARCHAR(16) NOT NULL,
    recipient_id   VARCHAR(64) NOT NULL,
    kind           VARCHAR(16) NOT NULL DEFAULT 'text',
    body           TEXT,
    media          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at        TIMESTAMPTZ
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_dm_convo ON dm_messages(convo_key, created_at)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_dm_inbox ON dm_messages(recipient_kind, recipient_id, read_at)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_dm_sender ON dm_messages(sender_id, created_at)`);
  // WhatsApp-style edit / delete (additive). `edited_at` stamps an edited text;
  // `deleted_at` soft-deletes (the row stays for ordering, but body/media are
  // blanked on read so the content is gone — "This message was deleted").
  await q(`ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ`);
  await q(`ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

  // MusterChat calling: WebRTC signaling relay. Two staff exchange offer/answer/
  // ICE via these rows (polled), so a real peer-to-peer audio/video call
  // connects without any dedicated signaling server. Rows are short-lived.
  await q(`CREATE TABLE IF NOT EXISTS call_signals (
    id          VARCHAR(64) PRIMARY KEY,
    call_id     VARCHAR(64) NOT NULL,
    from_id     VARCHAR(64) NOT NULL,
    from_name   VARCHAR(255),
    to_id       VARCHAR(64) NOT NULL,
    kind        VARCHAR(16) NOT NULL,
    payload     TEXT,
    mode        VARCHAR(8),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_call_signals_to ON call_signals(to_id, created_at)`);

  // MusterChat group chats. A group's messages reuse dm_messages with convo_key
  // = 'g:<groupId>' (recipient_kind 'group'), so no message-schema change — just
  // the group + membership tables here.
  await q(`CREATE TABLE IF NOT EXISTS chat_groups (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    created_by  VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS chat_group_members (
    group_id    VARCHAR(64) NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    account_id  VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, account_id)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_group_members_acct ON chat_group_members(account_id)`);
  // Per-member last-read for group chats (1:1 uses dm_messages.read_at; groups
  // need their own since one message has many recipients). Powers the unread
  // count that lights up the chat-bubble badge on group activity.
  await q(`CREATE TABLE IF NOT EXISTS chat_group_reads (
    group_id     VARCHAR(64) NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    account_id   VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, account_id)
  )`);

  console.log("  DocuSync/Assistant module ready -> delegate doc fields, chat_sessions, chat_messages, dm_messages, call_signals, chat_groups");
  warmUpModel(); // preload the chat model so the first question isn't a cold start
}

/* =============================================================================
 *  SHARED AI HELPERS
 * ========================================================================== */
const ANTHROPIC_MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

async function anthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({ apiKey });
}

function textOf(response) {
  return (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function anthropicChat(messages, system, maxTokens = 700) {
  const client = await anthropicClient();
  if (!client) return null;
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL(),
    max_tokens: maxTokens,
    system,
    messages,
  });
  return textOf(response);
}

// Model split: the chatbot uses the fast model (OLLAMA_MODEL), document parsing
// uses a higher-quality one (OLLAMA_PARSE_MODEL) since extraction accuracy matters.
const CHAT_MODEL = () => process.env.OLLAMA_MODEL || "llama3.2";
const PARSE_MODEL = () => process.env.OLLAMA_PARSE_MODEL || "llama3.2";

async function ollamaChat(messages, system, opts = {}) {
  const { timeoutMs = 45000, format, keepAlive = "30m", model } = opts;
  const base = process.env.OLLAMA_HOST || "http://localhost:11434";
  const useModel = model || CHAT_MODEL();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: useModel,
        messages: [{ role: "system", content: system }, ...messages],
        stream: false,
        keep_alive: keepAlive,       // keep the model resident so we don't pay the ~27s reload each call
        ...(format ? { format } : {}), // "json" forces valid JSON out (far more reliable to parse)
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Streaming chat: calls onToken(text) for each chunk as the model generates.
 * Returns the full text, or null if Ollama couldn't stream (caller falls back).
 * num_predict caps the answer length so replies stay fast on CPU. */
async function ollamaStream(messages, system, onToken, { numPredict = 400 } = {}) {
  const base = process.env.OLLAMA_HOST || "http://localhost:11434";
  const model = CHAT_MODEL();
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
        keep_alive: "30m",
        options: { num_predict: numPredict },
      }),
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "", got = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          const tok = j.message?.content || "";
          if (tok) { got = true; full += tok; onToken(tok); }
        } catch { /* partial JSON line — wait for more */ }
      }
    }
    return got ? full : null;
  } catch {
    return null;
  }
}

/* =============================================================================
 *  FEATURE 1 — DOCUMENT PARSING  (Use Case 1)
 * ========================================================================== */

/* One shared field contract so the text path and the vision path return the
 * exact same shape, whatever the document is. */
const SCHEMA_FIELDS = `{
  "fullName":       string,          // the person's name in Latin letters (prefer the English/romanised name)
  "role":           string | null,   // job title / designation (e.g. "Director", "Project Manager")
  "company":        string | null,   // organisation / company name
  "industry":       string | null,   // industry or sector, if stated
  "email":          string | null,
  "phone":          string | null,   // phone / mobile / Tel
  "website":        string | null,
  "nationality":    string | null,   // for passports / ID docs
  "passportNumber": string | null,   // for passports / ID docs
  "passportExpiry": string | null,   // ISO date if legible, else null
  "confidence":     number           // 0..1, see rules
}`;

const CONFIDENCE_RULES = `Confidence rules:
- 0.9+ when the person's name and their key details are clearly legible.
- 0.6-0.85 when some fields are missing, partly illegible, or inferred.
- below 0.6 when the text is too ambiguous/blurry to trust.
Never invent a value you cannot actually read — use null. Only extract INDIVIDUAL PEOPLE
(delegates / attendees / participants), never organisations, sponsors or venues as if they
were a person.`;

const BILINGUAL_RULE = `IMPORTANT — bilingual entries: each person is often listed with BOTH a Chinese name and an
English/romanised name (e.g. "邓邵徽 / Reyes Tin"). These are the SAME person — output ONE record
per person, and put the romanised (Latin-letter) name in "fullName". Never emit a separate record
whose name is only Chinese characters when a romanised name exists for that person. Likewise merge
the Chinese and English title/company/industry into one record (prefer the English value).`;

const TEXT_STRUCTURE_SYSTEM = `You are a delegate/attendee data-extraction engine for an event onboarding system.
You are given the raw text of a document — usually a delegation directory, an attendee list, or a
spreadsheet export. Extract EVERY distinct person.

${BILINGUAL_RULE}

Return ONLY a JSON array (no prose, no markdown, no code fences). Each element is exactly:
${SCHEMA_FIELDS}

${CONFIDENCE_RULES}`;

const VISION_INSTRUCTION = `You are a passport/travel-document and directory data-extraction engine for an event
onboarding system. The attached file contains one or more people's identity or profile details
(a passport, a batch of passports, a scanned attendee list, or an ID card). Extract EVERY distinct person.

Return ONLY a JSON array (no prose, no markdown, no code fences). Each element is exactly:
${SCHEMA_FIELDS}

${CONFIDENCE_RULES}`;

/* Robustly pull a records array out of an LLM reply, whether it returned a bare
 * array or wrapped it in an object like {records:[...]} / {delegates:[...]}. */
function extractRecords(text) {
  if (!text) return null;
  let s = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  // Prefer the first top-level array.
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const arr = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(arr)) return arr;
    } catch { /* fall through to object form */ }
  }
  // Otherwise try an object that contains an array under a common key.
  try {
    const obj = JSON.parse(s);
    for (const k of ["records", "delegates", "people", "rows", "attendees", "data"]) {
      if (Array.isArray(obj?.[k])) return obj[k];
    }
  } catch { /* nothing usable */ }
  return null;
}

/* ---- PDF text extraction (server-side, no external service) ------------- */
async function extractPdfPages(buf) {
  try {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    return Array.isArray(text) ? text : [String(text || "")];
  } catch (err) {
    console.warn("  PDF text extraction unavailable:", err.message || err);
    return null;
  }
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/* Local OCR fallback (no cloud). When an uploaded IMAGE has no text layer and no
 * Claude vision key is set, read it with Tesseract so scanned attendee lists and
 * passport/ID photos still work fully offline. The recognised text then flows
 * through the same text-structuring pipeline. Returns "" on failure. (A scanned,
 * image-only PDF would need rasterising to images first — not handled here; users
 * can upload it as an image.) */
async function ocrImage(buf) {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const { data: { text } } = await worker.recognize(buf);
    await worker.terminate();
    return (text || "").trim();
  } catch (err) {
    console.warn("  OCR (tesseract) unavailable:", err.message || err);
    return "";
  }
}

function dedupeByName(records) {
  const seen = new Map();
  for (const r of records) {
    const key = (r.fullName || "").toString().trim().toLowerCase();
    if (!key) continue;
    // Keep the richer record if the same person appears twice.
    const score = (o) => Object.values(o).filter((v) => v != null && v !== "").length;
    if (!seen.has(key) || score(r) > score(seen.get(key))) seen.set(key, r);
  }
  return [...seen.values()];
}

// In a bilingual directory each person has a romanised name AND a Chinese one;
// the model sometimes emits the Chinese half as its own row. If the batch has
// any romanised names at all, drop the pure-Chinese (no Latin letters) rows as
// duplicates. A wholly-CJK document (no romanised names anywhere) is left as-is.
function preferRomanised(records) {
  const hasLatin = (r) => /[A-Za-z]/.test((r.fullName || "").toString());
  return records.some(hasLatin) ? records.filter(hasLatin) : records;
}

// Tidy a name the model produced: drop non-name placeholders, and for a mixed
// "邓邵徽 / Reyes Tin" style value keep just the romanised part. Returns "" for
// anything that isn't a usable name (so it gets filtered out).
function cleanName(raw) {
  let s = (raw || "").toString().trim();
  if (!s) return "";
  if (/^(none|not|n\/?a|unknown|unspecified|not\s+specified|none\s+specified)/i.test(s) || /\bspecified\b/i.test(s)) return "";
  const hasCJK = /[㐀-鿿]/.test(s);
  const hasLatin = /[A-Za-z]/.test(s);
  if (hasCJK && hasLatin) {
    // Keep the romanised portion; strip CJK runs and tidy leftover separators.
    s = s.replace(/[㐀-鿿]+/g, " ").replace(/[/｜|·・、，,]+/g, " ").replace(/\s{2,}/g, " ").trim();
    s = s.replace(/^[\s/·・-]+|[\s/·・-]+$/g, "").trim();
  }
  return s;
}

function finalizeRecords(records) {
  const cleaned = records
    .map((r) => ({ ...r, fullName: cleanName(r.fullName) }))
    .filter((r) => r.fullName);
  return preferRomanised(dedupeByName(cleaned));
}

/* Structure text into records. Claude first (accuracy), Ollama fallback (free,
 * page-batched to fit a small local context window). Returns {records, engine}
 * or {records:null, engine:null} when no text engine is available. */
async function structureFromText(pages) {
  const client = await anthropicClient();
  if (client) {
    try {
      const response = await client.messages.create({
        model: ANTHROPIC_MODEL(),
        max_tokens: 8000,
        system: TEXT_STRUCTURE_SYSTEM,
        messages: [{ role: "user", content: `Extract every distinct person from this document text as a JSON array.\n\n=== DOCUMENT TEXT ===\n${pages.join("\n\n----- page break -----\n\n")}` }],
      });
      const recs = extractRecords(textOf(response));
      if (recs) return { records: finalizeRecords(recs), engine: "anthropic" };
    } catch (err) {
      console.error("  Text structuring (Anthropic) failed:", err.message || err);
    }
  }

  // Ollama fallback: batch a few pages per call so it fits the local model.
  const base = process.env.OLLAMA_HOST || "http://localhost:11434";
  let ollamaUp = false;
  try {
    const ping = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    ollamaUp = ping.ok;
  } catch { ollamaUp = false; }

  if (ollamaUp) {
    // Local CPU inference is slow, so only feed pages that plausibly contain a
    // person (an email, a phone, or a "Delegate/团员" marker). This skips cover,
    // intro and index pages — often half the document — for a big speed win.
    const looksLikePerson = (s) => /@|Delegate|Attendee|Participant|团员|E-?mail|Tel[:\s]/i.test(s || "");
    const candidatePages = pages.filter((p) => p && p.replace(/\s/g, "").length >= 40 && looksLikePerson(p));
    const targets = candidatePages.length ? candidatePages : pages.filter((p) => p && p.replace(/\s/g, "").length >= 40);

    const out = [];
    // One page per call keeps each request small enough to finish reliably.
    for (const page of targets) {
      const raw = await ollamaChat(
        [{ role: "user", content: `Extract every distinct person from this text. Reply as JSON: {"records":[ ... ]}.\n\n${page}` }],
        TEXT_STRUCTURE_SYSTEM,
        { timeoutMs: 240000, format: "json", keepAlive: "30m", model: PARSE_MODEL() }
      );
      const recs = extractRecords(raw);
      if (recs) out.push(...recs);
    }
    if (out.length) return { records: finalizeRecords(out), engine: "ollama" };
  }

  return { records: null, engine: null };
}

/* Vision path for scanned PDFs / images. Claude only (Ollama can't see). */
async function structureFromVision(client, buf, mediaType, isPdf) {
  const fileBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } };
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL(),
    max_tokens: 8000,
    messages: [{ role: "user", content: [fileBlock, { type: "text", text: VISION_INSTRUCTION }] }],
  });
  return extractRecords(textOf(response));
}

function toRow(r, i, namePrefix) {
  const confidence = typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.6;
  const fullName = (r.fullName || "").toString().trim();
  const clean = (v) => (v == null || v === "" ? null : String(v).trim());
  return {
    id: `${namePrefix || "file"}-${i}`,
    fullName,
    role: clean(r.role),
    company: clean(r.company),
    industry: clean(r.industry),
    email: clean(r.email),
    phone: clean(r.phone),
    website: clean(r.website),
    nationality: clean(r.nationality),
    passportNumber: clean(r.passportNumber),
    passportExpiry: clean(r.passportExpiry),
    confidence,
    needsReview: confidence < 0.85 || !fullName,
  };
}

/* ---- Async parse jobs ---------------------------------------------------- *
 * A big directory takes minutes on local Ollama. Instead of one blocking
 * request, the upload starts a JOB that reads the document page-by-page in the
 * background; the client polls for progress and rows stream in. Because the
 * work lives server-side, the admin can leave the Onboarding page (or even
 * reload) and reattach to the same job by its id.
 * ------------------------------------------------------------------------- */
const parseJobs = new Map(); // jobId -> { id, accountId, name, status, done, total, method, rows, error, createdAt }

function sweepJobs() {
  const cutoff = Date.now() - 60 * 60 * 1000; // keep jobs for 1 hour
  for (const [id, j] of parseJobs) if (j.createdAt < cutoff) parseJobs.delete(id);
}

/* Structure ONE page of text into records (Claude first, else Ollama). */
async function structurePage(text) {
  const client = await anthropicClient();
  if (client) {
    try {
      const response = await client.messages.create({
        model: ANTHROPIC_MODEL(),
        max_tokens: 4000,
        system: TEXT_STRUCTURE_SYSTEM,
        messages: [{ role: "user", content: `Extract every distinct person from this text as a JSON array.\n\n${text}` }],
      });
      const recs = extractRecords(textOf(response));
      if (recs) return recs;
    } catch (err) {
      console.error("  structurePage (Anthropic) failed:", err.message || err);
    }
  }
  if (await ollamaUp()) {
    const raw = await ollamaChat(
      [{ role: "user", content: `Extract every distinct person from this text. Reply as JSON: {"records":[ ... ]}.\n\n${text}` }],
      TEXT_STRUCTURE_SYSTEM,
      { timeoutMs: 240000, format: "json", keepAlive: "30m", model: PARSE_MODEL() }
    );
    const recs = extractRecords(raw);
    if (recs) return recs;
  }
  return [];
}

async function runParseJob(job, buf, mediaType, isPdf) {
  try {
    const hasClaude = !!process.env.ANTHROPIC_API_KEY;
    const hasOllama = await ollamaUp();
    const all = [];

    if (isPdf) {
      const pages = await extractPdfPages(buf);
      const textChars = pages ? pages.join("").replace(/\s/g, "").length : 0;
      if (pages && textChars > 200) {
        if (!hasClaude && !hasOllama) {
          job.status = "error";
          job.error = "Document reading needs an AI engine. Start Ollama (ollama pull llama3.2), or set ANTHROPIC_API_KEY in backend/.env.";
          return;
        }
        const looksLikePerson = (s) => /@|Delegate|Attendee|Participant|团员|E-?mail|Tel[:\s]/i.test(s || "");
        const candidates = pages.filter((p) => p && p.replace(/\s/g, "").length >= 40 && looksLikePerson(p));
        const targets = candidates.length ? candidates : pages.filter((p) => p && p.replace(/\s/g, "").length >= 40);
        job.total = targets.length || 1;
        job.method = hasClaude ? "text/anthropic" : "text/ollama";
        for (const page of targets) {
          const recs = await structurePage(page);
          all.push(...recs);
          job.done++;
          job.rows = finalizeRecords(all).map((r, i) => toRow(r, i, job.name));
        }
        job.status = "done";
        return;
      }
    }

    // Vision path (scanned PDF / image). Prefer Claude vision when a key is set;
    // otherwise fall back to LOCAL OCR (Tesseract) for images so scans work
    // offline. OCR still needs a text engine (Ollama) to structure the result.
    const isImage = mediaType.startsWith("image/");
    if (!hasClaude) {
      if (isImage && hasOllama) {
        job.total = 1;
        job.method = "ocr/tesseract";
        const text = await ocrImage(buf);
        if (text.replace(/\s/g, "").length >= 20) {
          const recs = await structurePage(text);
          all.push(...(recs || []));
          job.done = 1;
          job.rows = finalizeRecords(all).map((r, i) => toRow(r, i, job.name));
          job.status = "done";
          return;
        }
        job.status = "error";
        job.error = "Couldn't read any text from that image. Try a sharper photo, or a text-based PDF.";
        return;
      }
      job.status = "error";
      job.error = isImage
        ? "Reading this image needs the local AI engine for OCR. Start Ollama, or set ANTHROPIC_API_KEY in backend/.env."
        : "This looks like a scanned PDF. Local OCR currently supports images — upload it as a photo/screenshot, set a Claude key, or use a text-based PDF.";
      return;
    }
    job.total = 1;
    job.method = "vision/anthropic";
    const client = await anthropicClient();
    const recs = await structureFromVision(client, buf, mediaType, isPdf);
    all.push(...(recs || []));
    job.done = 1;
    job.rows = finalizeRecords(all).map((r, i) => toRow(r, i, job.name));
    job.status = "done";
  } catch (err) {
    console.error("  Parse job failed:", err.message || err);
    job.status = "error";
    job.error = "Couldn't read the document. Please try again or add delegates manually.";
  }
}

router.post(
  "/api/documents/parse-async",
  requirePermission("manageDocuments"), // carved out of manageDelegates 2026-07-21 — see permissions.js
  express.raw({ type: () => true, limit: "25mb" }),
  wrap(async (req, res) => {
    await ensureReady();
    sweepJobs();
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ error: "NO_FILE", message: "No file received. Please choose a PDF or image." });
    }
    const mediaType = (req.query.type || req.headers["content-type"] || "application/pdf").toString().split(";")[0].trim();
    const isPdf = mediaType === "application/pdf";
    const isImage = mediaType.startsWith("image/");
    if (!isPdf && !isImage) {
      return res.status(415).json({ error: "UNSUPPORTED_TYPE", message: `Unsupported file type "${mediaType}". Upload a PDF or an image.` });
    }
    const job = {
      id: randomUUID(),
      accountId: req.account.id,
      name: (req.query.name || "file").toString(),
      status: "running",
      done: 0,
      total: 0,
      method: null,
      rows: [],
      error: null,
      createdAt: Date.now(),
    };
    parseJobs.set(job.id, job);
    runParseJob(job, buf, mediaType, isPdf); // fire-and-forget; client polls below
    res.status(202).json({ jobId: job.id });
  })
);

router.get("/api/documents/parse-async/:id", requireAuth(), wrap(async (req, res) => {
  const job = parseJobs.get(req.params.id);
  if (!job || job.accountId !== req.account.id) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ status: job.status, done: job.done, total: job.total, method: job.method, rows: job.rows, error: job.error });
}));

/* Context for the onboarding screen: existing delegate names (for duplicate
 * detection) + the trip's coaches (for per-row assignment). */
router.get("/api/onboarding/context", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const tripId = req.query.tripId;
  const tripUuid = await resolveTripUuid(tripId);
  const dq = tripUuid
    ? await q(`SELECT name FROM delegates WHERE trip_id = $1`, [tripUuid])
    : await q(`SELECT name FROM delegates`);
  const cq = await q(`SELECT id, label, name, city FROM coaches ORDER BY sort_order NULLS LAST, id`);
  res.json({ existingNames: dq.rows.map((x) => x.name), coaches: cq.rows });
}));

router.post(
  "/api/documents/parse",
  requirePermission("manageDocuments"), // carved out of manageDelegates 2026-07-21 — see permissions.js
  express.raw({ type: () => true, limit: "25mb" }),
  wrap(async (req, res) => {
    await ensureReady();
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ error: "NO_FILE", message: "No file received. Please choose a PDF or image." });
    }
    const mediaType = (req.query.type || req.headers["content-type"] || "application/pdf").toString().split(";")[0].trim();
    const isPdf = mediaType === "application/pdf";
    const isImage = mediaType.startsWith("image/");
    if (!isPdf && !isImage) {
      return res.status(415).json({ error: "UNSUPPORTED_TYPE", message: `Unsupported file type "${mediaType}". Upload a PDF or an image.` });
    }
    const namePrefix = (req.query.name || "file").toString();

    let records = null;
    let method = null;

    /* 1. Text-first for PDFs that actually contain selectable text. */
    if (isPdf) {
      const pages = await extractPdfPages(buf);
      const textChars = pages ? pages.join("").replace(/\s/g, "").length : 0;
      if (pages && textChars > 200) {
        const result = await structureFromText(pages);
        if (result.records) {
          records = result.records;
          method = `text/${result.engine}`;
        } else if (result.engine === null && !process.env.ANTHROPIC_API_KEY) {
          // Text doc, but no engine at all is configured.
          return res.status(503).json({
            error: "AI_NOT_CONFIGURED",
            message: "Document reading needs an AI engine. Start Ollama locally (ollama pull llama3.2), or set ANTHROPIC_API_KEY in backend/.env.",
          });
        }
      }
    }

    /* 2. Vision fallback for scanned PDFs / images (Claude only). */
    if (!records) {
      const client = await anthropicClient();
      if (!client) {
        return res.status(503).json({
          error: "AI_NOT_CONFIGURED",
          message: isImage
            ? "Reading images/scans needs Claude vision. Ask an admin to set ANTHROPIC_API_KEY in backend/.env."
            : "This looks like a scanned document, which needs Claude vision. Set ANTHROPIC_API_KEY in backend/.env, or upload a text-based PDF.",
        });
      }
      try {
        records = await structureFromVision(client, buf, mediaType, isPdf);
        method = "vision/anthropic";
      } catch (err) {
        console.error("  Document parse (vision) failed:", err.message || err);
        return res.status(502).json({ error: "AI_SERVICE_ERROR", message: "Couldn't read the document just now. Please try again." });
      }
    }

    if (!records) {
      return res.status(422).json({
        error: "PARSE_FAILED",
        message: "The document couldn't be read into a delegate list. Try a clearer scan, or add the delegates manually.",
      });
    }

    const rows = records.map((r, i) => toRow(r, i, namePrefix)).filter((r) => r.fullName);
    res.json({ rows, totalCount: rows.length, method });
  })
);

/* Guard against stray/junk rows at confirm time. A real delegate needs a name
 * with at least two letters; a very short single-token name (<=2 chars, e.g.
 * "jq") that carries NO company/role/email/phone/passport is treated as a test
 * entry, not a person. Deliberately conservative — genuine short names like
 * "Wu" or "Ng" still pass as long as the row has any supporting detail, which a
 * directory row almost always does. */
function isPlausibleDelegate(r) {
  const name = (r.fullName || "").toString().trim();
  const letters = (name.match(/\p{L}/gu) || []).length;
  if (letters < 2) return false;
  const hasSupport = !!(r.company || r.role || r.email || r.phone || r.passportNumber || r.nationality);
  const compact = name.replace(/\s+/g, "");
  // A 2-char CJK name (e.g. 陈伟) is a complete name, so the "too short" check
  // only applies to Latin-script tokens like "jq".
  const hasCJK = /\p{Script=Han}/u.test(name);
  if (!hasCJK && compact.length <= 2 && !name.includes(" ") && !hasSupport) return false;
  return true;
}

router.post(
  "/api/trips/:id/onboarding/confirm",
  requirePermission("manageDocuments"), // carved out of manageDelegates 2026-07-21 — see permissions.js
  express.json(),
  wrap(async (req, res) => {
    await ensureReady();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      return res.status(400).json({ error: "NO_ROWS", message: "There are no delegates to add." });
    }
    const tripUuid = await resolveTripUuid(req.params.id);
    if (!tripUuid) {
      // Fail loudly rather than create delegates with a null trip_id (orphaned
      // to the base pool) — the old behaviour when a non-seed trip id was sent.
      return res.status(404).json({ error: "UNKNOWN_TRIP", message: "That trip no longer exists. Pick a trip from the list and try again." });
    }

    const added = [];
    let skippedInvalid = 0;
    for (const r of rows) {
      if (!isPlausibleDelegate(r)) { skippedInvalid++; continue; }
      const name = (r.fullName || "").toString().trim();
      // A coach assignment means the delegate is expected on that coach but not
      // yet checked in → MISSING (so they show on the coach board); otherwise
      // UNASSIGNED. VIP flag carries through.
      const coachId = r.coachId || null;
      // tripUuid passed directly now (2026-07-24) — this used to call
      // createDelegate() with none, then patch trip_id on with a separate
      // UPDATE below, which meant logActivity() (fired inside createDelegate)
      // always recorded trip_id NULL for every onboarded delegate, so the
      // Dashboard's per-trip History tracker never showed onboarding activity
      // at all. The UPDATE below still runs but is now a harmless no-op on
      // trip_id (COALESCE keeps whatever's already there).
      const delegate = await createDelegate({
        name,
        status: coachId ? "MISSING" : "UNASSIGNED",
        vip: !!r.vip,
        coachId,
      }, tripUuid);
      await q(
        `UPDATE delegates
           SET passport_no = $1, nationality = $2, passport_expiry = $3,
               company = COALESCE($4, company), role = $5, industry = $6,
               email = $7, phone = $8, website = $9, qr_code = $10,
               trip_id = COALESCE($11, trip_id)
         WHERE id = $12`,
        [
          r.passportNumber || null, r.nationality || null, r.passportExpiry || null,
          r.company || null, r.role || null, r.industry || null,
          r.email || null, r.phone || null, r.website || null, newQrCode(),
          tripUuid, delegate.id,
        ]
      );
      added.push({ ...delegate, company: r.company || null, role: r.role || null });
    }
    if (added.length) invalidateSnapshot(); // the assistant's cached view is now stale
    res.status(201).json({ added: added.length, skippedInvalid, delegates: added });
  })
);

/* =============================================================================
 *  BOARDING PASSES  (output of the document reader)
 *  Each onboarded delegate gets a unique qr_code, rendered as a printable QR
 *  boarding pass. Reading/scanning those codes to check delegates in on-site is
 *  Vimal's feature (POST /api/checkins) — deliberately NOT owned here.
 * ========================================================================== */
function newQrCode() {
  return "MG-" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

async function backfillQrCodes(tripUuid) {
  const rows = tripUuid
    ? (await q(`SELECT id FROM delegates WHERE qr_code IS NULL AND trip_id = $1`, [tripUuid])).rows
    : (await q(`SELECT id FROM delegates WHERE qr_code IS NULL`)).rows;
  for (const row of rows) await q(`UPDATE delegates SET qr_code = $1 WHERE id = $2`, [newQrCode(), row.id]);
}

// Delegates (with QR tokens) for a trip — powers the printable boarding passes.
router.get("/api/onboarding/badges", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const tripId = req.query.tripId;
  const tripUuid = await resolveTripUuid(tripId);
  await backfillQrCodes(tripUuid);
  // email/website/external_badge_code added 2026-07-31 (merged from Vance's
  // post-v2 branch) — power the "Email pass" button and the physical-pass
  // linking UI on BoardingPassesView.jsx.
  const cols = `id, name, email, company, role, industry, website, "coachId" AS coach_id, status, vip, qr_code, external_badge_code`;
  const r = tripUuid
    ? await q(`SELECT ${cols} FROM delegates WHERE trip_id = $1 ORDER BY name`, [tripUuid])
    : await q(`SELECT ${cols} FROM delegates ORDER BY name`);
  const coaches = (await q(`SELECT id, label, name, city FROM coaches ORDER BY sort_order NULLS LAST, id`)).rows;
  // PRESENT (legacy) and ARRIVED (the team's 5-status value) both mean "boarded".
  const present = r.rows.filter((d) => d.status === "PRESENT" || d.status === "ARRIVED").length;
  res.json({ delegates: r.rows, coaches, total: r.rows.length, present });
}));

// POST /api/onboarding/delegates/:id/badge — link (or clear) a delegate's
// EXTERNAL physical pass code (Feature 4b). An empty code unlinks. Enforces the
// same uniqueness the scanner relies on: the code can't collide with another
// delegate's qr_code or external_badge_code.
router.post("/api/onboarding/delegates/:id/badge", requirePermission("manageDocuments"), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const id = req.params.id;
  const code = (req.body?.code || "").toString().trim();
  const del = (await q(`SELECT id FROM delegates WHERE id = $1`, [id])).rows[0];
  if (!del) return res.status(404).json({ error: "NO_DELEGATE", message: "That delegate isn't found." });
  if (!code) {
    await q(`UPDATE delegates SET external_badge_code = NULL WHERE id = $1`, [id]);
    return res.json({ ok: true, id, external_badge_code: null });
  }
  const clash = (await q(
    `SELECT id FROM delegates WHERE id <> $1 AND (qr_code = $2 OR external_badge_code = $2) LIMIT 1`,
    [id, code]
  )).rows[0];
  if (clash) return res.status(409).json({ error: "CODE_TAKEN", message: "That pass code is already linked to another delegate." });
  await q(`UPDATE delegates SET external_badge_code = $1 WHERE id = $2`, [code, id]);
  res.json({ ok: true, id, external_badge_code: code });
}));

/* ---- Boarding-pass email (Feature 4c) ------------------------------------ *
 * Emails a delegate their branded QR boarding pass — a website-styled message
 * with a flip-card badge (front = QR + name, back = company logo/identity). The
 * QR (with the company logo in its centre) is rendered client-side and posted
 * here, then embedded as an inline CID image so it renders even in Gmail. Uses
 * the same SMTP_* config as JQ's escalation mailer (lib/notify.js), but its own
 * transporter instance — this module stays self-contained (matches every other
 * teammate module's own-pg-pool convention). */
let _passMailer = null;
function passMailer() {
  if (_passMailer) return _passMailer;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  _passMailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _passMailer;
}
const PASS_BRAND_COLORS = ["#1f6feb", "#8250df", "#0f766e", "#b91c1c", "#b45309", "#0e7490", "#4d7c0f", "#9d174d", "#3f3f9e", "#7c3aed"];
function passBrandColor(name) {
  const s = (name || "").trim(); if (!s) return "#64748b";
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PASS_BRAND_COLORS[h % PASS_BRAND_COLORS.length];
}
function passDomain(website) {
  if (!website) return null;
  const w = String(website).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(w) ? w : null;
}
function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function passEmailHtml({ name, role, company, industry, code, coachLabel, logoUrl, badgeUrl }) {
  const brand = passBrandColor(company);
  return `
  <div style="margin:0;background:#f4f4f6;font-family:-apple-system,Segoe UI,Arial,sans-serif;padding:24px 12px">
    <div style="max-width:480px;margin:0 auto">
      <div style="background:#e1232a;color:#fff;padding:16px 20px;border-radius:14px 14px 0 0;font-weight:800;font-size:17px;letter-spacing:.3px">MusterGo · Boarding Pass</div>
      <div style="background:#fff;border:1px solid #e6e6ea;border-top:none;border-radius:0 0 14px 14px;padding:22px 20px;text-align:center">
        <p style="margin:0 0 16px;color:#555;font-size:13.5px">Hi ${escHtml(name)}, here's your QR boarding pass for the SCCCI study mission. <span style="color:#999">(Hover the badge to flip it.)</span></p>
        <style>
          .mgflip{perspective:1100px;width:250px;margin:0 auto}
          .mgflip-in{position:relative;width:250px;height:314px;transition:transform .7s;transform-style:preserve-3d}
          .mgflip:hover .mgflip-in{transform:rotateY(180deg)}
          .mgface{position:absolute;top:0;left:0;width:250px;height:314px;-webkit-backface-visibility:hidden;backface-visibility:hidden;border-radius:16px;border:1px solid #e6e6ea;overflow:hidden;background:#fff}
          .mgback{transform:rotateY(180deg)}
        </style>
        <div class="mgflip"><div class="mgflip-in">
          <div class="mgface">
            <div style="background:${brand};height:8px;width:100%"></div>
            <img src="cid:passqr" width="188" height="188" alt="QR" style="display:block;margin:14px auto 6px;border-radius:10px"/>
            <div style="font-weight:800;font-size:16px;color:#1a1a1a">${escHtml(name)}</div>
            <div style="color:#666;font-size:12px;margin-top:2px">${escHtml(role || "Delegate")}</div>
            <div style="font-family:monospace;font-size:12px;color:#aaa;margin-top:8px">${escHtml(code || "")}</div>
          </div>
          <div class="mgface mgback" style="background:${brand};color:#fff">
            <table width="100%" height="100%"><tr><td align="center" valign="middle" style="padding:20px">
              ${logoUrl ? `<img src="${escHtml(logoUrl)}" width="76" height="76" alt="" style="border-radius:16px;background:#fff;padding:6px;margin-bottom:12px"/>` : ""}
              <div style="font-weight:800;font-size:19px">${escHtml(name)}</div>
              <div style="opacity:.92;font-size:13px;margin-top:4px">${escHtml(company || "")}</div>
              ${industry ? `<div style="opacity:.8;font-size:12px;margin-top:8px">${escHtml(industry)}</div>` : ""}
              <div style="opacity:.8;font-size:12px;margin-top:2px">${escHtml(coachLabel || "")}</div>
            </td></tr></table>
          </div>
        </div></div>
        ${badgeUrl ? `<div style="margin-top:18px"><a href="${escHtml(badgeUrl)}" style="display:inline-block;background:#e1232a;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px">View &amp; flip your badge →</a></div>` : ""}
        <p style="margin:18px 0 0;color:#aaa;font-size:11px">Show this QR at muster to board. A Singapore Chinese Chamber of Commerce &amp; Industry initiative.</p>
      </div>
    </div>
  </div>`;
}

router.post("/api/onboarding/delegates/:id/email-pass", requirePermission("manageDocuments"), express.json({ limit: "8mb" }), wrap(async (req, res) => {
  await ensureReady();
  const id = req.params.id;
  const qrDataUrl = (req.body?.qrDataUrl || "").toString();
  const del = (await q(
    `SELECT dg.id, dg.name, dg.email, dg.company, dg.role, dg.industry, dg.website, dg.qr_code,
            c.name AS coach_name, c.city AS coach_city
       FROM delegates dg LEFT JOIN coaches c ON c.id = dg."coachId"
      WHERE dg.id = $1`, [id]
  )).rows[0];
  if (!del) return res.status(404).json({ error: "NO_DELEGATE", message: "That delegate isn't found." });
  if (!del.email) return res.status(400).json({ error: "NO_EMAIL", message: `${del.name} has no email on file.` });
  const t = passMailer();
  if (!t) return res.status(503).json({ error: "EMAIL_NOT_CONFIGURED", message: "Email (SMTP) isn't configured on the server." });

  const attachments = [];
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(qrDataUrl);
  if (m) attachments.push({ filename: "boarding-pass.png", content: Buffer.from(m[2], "base64"), cid: "passqr" });

  const domain = passDomain(del.website);
  const coachLabel = del.coach_name ? `${del.coach_name}${del.coach_city ? ` · ${del.coach_city}` : ""}` : "No coach assigned";
  const base = (process.env.FRONTEND_URL || "https://localhost:5173").replace(/\/+$/, "");
  const html = passEmailHtml({
    name: del.name, role: del.role, company: del.company, industry: del.industry,
    code: del.qr_code, coachLabel, logoUrl: domain ? `https://unavatar.io/${domain}` : null,
    badgeUrl: `${base}/badge/${encodeURIComponent(del.qr_code)}`,
  });
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: del.email,
      subject: `Your MusterGo boarding pass — ${del.name}`,
      text: `Hi ${del.name}, your QR boarding pass code is ${del.qr_code}. Show it at muster to board.`,
      html, attachments,
    });
    res.json({ ok: true, to: del.email });
  } catch (err) {
    console.error("  email-pass failed:", err.message || err);
    res.status(502).json({ error: "SEND_FAILED", message: "Couldn't send the email — check the SMTP settings." });
  }
}));

// GET /api/badge/:code — PUBLIC pass lookup for the emailed flip-card page
// (/badge/:code). The code (our MG-xxxx or a linked physical code) is the
// shared secret, like an e-ticket link; returns only badge display fields.
router.get("/api/badge/:code", wrap(async (req, res) => {
  await ensureReady();
  const code = (req.params.code || "").toString().trim();
  if (!code) return res.status(400).json({ error: "NO_CODE" });
  const d = (await q(
    `SELECT dg.name, dg.role, dg.company, dg.industry, dg.website, dg.qr_code, dg.vip,
            c.name AS coach_name, c.city AS coach_city, t.name AS trip_name
       FROM delegates dg
       LEFT JOIN coaches c ON c.id = dg."coachId"
       LEFT JOIN trips t ON t.uuid_id = dg.trip_id
      WHERE dg.qr_code = $1 OR dg.external_badge_code = $1`, [code]
  )).rows[0];
  if (!d) return res.status(404).json({ error: "UNKNOWN_CODE", message: "Badge not found." });
  res.json({
    name: d.name, role: d.role, company: d.company, industry: d.industry, website: d.website,
    code: d.qr_code, vip: d.vip, tripName: d.trip_name || null,
    coach: d.coach_name ? `${d.coach_name}${d.coach_city ? ` · ${d.coach_city}` : ""}` : null,
  });
}));

// Scan → board. Resolve a QR token, mark the delegate PRESENT (+ coach), and log
// the scan. This is what the on-site scanner calls.
// requireKioskOrPermission("manageScanner"): a signed-in user with the
// "Manage scanner" permission, OR the passwordless kiosk token (the
// /kiosk-scan entrance scanner's QR mode — unaffected by the permission,
// by design). See auth.js.
router.post("/api/onboarding/checkin", requireKioskOrPermission("manageScanner"), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const code = (req.body?.code || "").toString().trim();
  const requestedTripId = (req.body?.tripId || "t-1").toString();
  const coachOverride = req.body?.coachId || null;
  if (!code) return res.status(400).json({ error: "NO_CODE", message: "No badge code provided." });

  // Resolve the delegate by their OWN unique qr_code, and join through to their
  // real trip (trips.id string, via the delegate's trip_id uuid). We log the
  // check-in against THAT trip rather than the client-supplied tripId, so a
  // mistyped/mismatched tripId in the request body can't file a check-in
  // against the wrong trip. Base-pool delegates (trip_id NULL) have no resolved
  // trip, so they fall back to the requested tripId (defaulting "t-1").
  // Also matches external_badge_code (2026-07-31, Feature 4b, merged from
  // Vance's post-v2 branch) — a delegate linked to SCCCI's own physical pass
  // can be scanned in with that code instead of our printed qr_code.
  const d = await q(
    `SELECT dg.id, dg.name, dg."coachId" AS coach_id, dg.status, t.id AS trip_str
       FROM delegates dg
       LEFT JOIN trips t ON t.uuid_id = dg.trip_id
      WHERE dg.qr_code = $1 OR dg.external_badge_code = $1`,
    [code]
  );
  if (!d.rows.length) return res.status(404).json({ error: "UNKNOWN_CODE", message: "That badge isn't recognised." });
  const del = d.rows[0];
  const tripId = del.trip_str || requestedTripId;

  // Cross-coach guard: a scanner scoped to one coach (coachOverride, from the
  // scan panel's own coach picker) must NOT be able to silently reassign a
  // delegate who is already assigned to a DIFFERENT coach — that used to
  // happen here (coachOverride unconditionally won in the COALESCE below),
  // so scanning a Coach 5 delegate on a Coach 1 scanner quietly moved them
  // onto Coach 1 and checked them in there. An UNASSIGNED delegate (no
  // coach_id yet) is still fine to assign on first scan — that's the
  // legitimate "muster onto whichever coach is scanning" case.
  if (coachOverride && del.coach_id && del.coach_id !== coachOverride) {
    const dash = await getDashboard();
    const assignedCoach = (dash.coaches || []).find((c) => c.id === del.coach_id);
    const scannerCoach = (dash.coaches || []).find((c) => c.id === coachOverride);
    const assignedLabel = assignedCoach?.label || assignedCoach?.name || del.coach_id;
    const scannerLabel = scannerCoach?.label || scannerCoach?.name || coachOverride;
    return res.status(409).json({
      error: "COACH_MISMATCH",
      message: `${del.name} is assigned to ${assignedLabel}, not ${scannerLabel}.`,
      delegateId: del.id,
      delegateName: del.name,
      assignedCoachId: del.coach_id,
      assignedCoachLabel: assignedLabel,
      scannerCoachId: coachOverride,
    });
  }

  // ARRIVED is the current 5-status value; PRESENT is the legacy alias this
  // endpoint itself still writes below. Checking only PRESENT here missed a
  // delegate who'd already boarded via face scan or manual override (both
  // write ARRIVED), so a re-scan of their QR code would report
  // alreadyBoarded:false instead of the correct duplicate-check-in notice.
  const alreadyBoarded = del.status === "PRESENT" || del.status === "ARRIVED";
  const coachId = coachOverride || del.coach_id || null;
  const nowStr = new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });

  try {
    await q(
      `INSERT INTO check_in_logs (id, delegate_id, trip_id, coach_id, method, checked_in_by, client_event_id, is_offline_origin, client_ts)
       VALUES ($1,$2,$3,$4,'QR',$5,$6,false,$7)`,
      [randomUUID(), del.id, tripId, coachId, req.account.id, randomUUID(), new Date().toISOString()]
    );
  } catch (err) {
    console.error("  QR check-in log failed (continuing to update delegate):", err.message || err);
  }
  await q(`UPDATE delegates SET status='PRESENT', "coachId" = COALESCE($1, "coachId"), "lastSeen" = $2 WHERE id = $3`,
    [coachOverride, `QR check-in · ${nowStr}`, del.id]);
  invalidateSnapshot(); // a delegate just boarded — refresh the assistant's view
  // Persisted audit row (2026-07-30 — QR check-ins never showed up on the
  // History log at all before this). Best-effort by design — a logging
  // failure must never undo or block a check-in that already succeeded.
  const onboardTripUuid = await resolveTripUuid(tripId);
  if (onboardTripUuid) {
    await recordEvent(onboardTripUuid, req, {
      action: "checkin.qr", entity: "delegate", entityId: del.id, kind: "checkin",
      summary: `${del.name} checked in via QR scan.`,
      before: { status: del.status }, after: { status: "PRESENT" },
    });
  }
  await logActivity(`${del.name} checked in (QR)`, "checkin", actorOf(req), { delegateId: del.id, tripUuid: onboardTripUuid });

  const counts = await q(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('PRESENT','ARRIVED'))::int AS present
       FROM delegates WHERE trip_id = (SELECT uuid_id FROM trips WHERE id = $1)`, [tripId]);
  res.json({
    ok: true,
    alreadyBoarded,
    delegate: { id: del.id, name: del.name, coachId },
    total: counts.rows[0]?.total ?? null,
    present: counts.rows[0]?.present ?? null,
  });
}));

/* =============================================================================
 *  FEATURE 2 — TRIP ASSISTANT  (Use Case 2)
 * ========================================================================== */
/* Passport validity for overseas travel: "expired", or "expiring" within 6
 * months (the common 6-month passport-validity rule), else "ok". A missing or
 * unparseable expiry is "unknown" (never flagged). Pure + exported for tests. */
function checkPassportExpiry(expiry, now = new Date()) {
  if (!expiry) return { status: "unknown", daysLeft: null };
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) return { status: "unknown", daysLeft: null };
  const daysLeft = Math.round((d.getTime() - now.getTime()) / 86400000);
  const sixMonths = new Date(now.getTime());
  sixMonths.setMonth(sixMonths.getMonth() + 6);
  if (d.getTime() < now.getTime()) return { status: "expired", daysLeft };
  if (d.getTime() < sixMonths.getTime()) return { status: "expiring", daysLeft };
  return { status: "ok", daysLeft };
}

async function buildSnapshot(tripUuid) {
  // The assistant used to be hardcoded to the Beijing study mission (t-1) —
  // resolving its uuid once and scoping every read to it, so the snapshot never
  // mixed trips (JQ's getTrip/getDashboard/getMissing otherwise default to an
  // arbitrary "LIMIT 1" (no ORDER BY) trip). Multi-trip support (2026-07-31,
  // "let me ask about other trips") makes that trip a caller-supplied param
  // instead, defaulting to t-1 so every pre-existing call site (which never
  // passed one) keeps behaving exactly as before. (Vance's original fix,
  // integrated 2026-07-27.)
  if (!tripUuid) tripUuid = await resolveTripUuid("t-1");
  const [trip, dashboard] = await Promise.all([
    getTrip(tripUuid), getDashboard(tripUuid),
  ]);

  /* Rich delegate roster (scoped to the same trip; drives company/industry/VIP
   * analytics + look-ups). */
  let roster = [];
  try {
    const cols = `name, company, industry, role, status, vip, "coachId" AS coach_id, email, passport_expiry`;
    const r = tripUuid
      ? await q(`SELECT ${cols} FROM delegates WHERE trip_id = $1 ORDER BY name`, [tripUuid])
      : await q(`SELECT ${cols} FROM delegates ORDER BY name`);
    roster = r.rows;
  } catch { /* delegate doc columns not present yet */ }

  const tally = (rows, key) => {
    const m = {};
    for (const x of rows) {
      const v = (x[key] || "").toString().trim();
      if (v) m[v] = (m[v] || 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const byIndustry = tally(roster, "industry");
  const byCompany = tally(roster, "company");
  const vips = roster.filter((x) => x.vip);

  /* 5-status-aware, SINGLE-SOURCE KPIs + lists (Vance's fix, integrated
   * 2026-07-27). Every delegate is exactly one of:
   *   boarded    = PRESENT / ARRIVED
   *   missing    = on a coach, not boarded
   *   unassigned = no coach, not boarded
   * Deriving the missing LIST and the missing COUNT from this one partition keeps
   * the assistant, Trip Pulse and boarding passes perfectly consistent. Before,
   * the count was roster-derived while the list came from JQ's getMissing(), so
   * "how many are missing?" and "who's missing?" gave different numbers. */
  const isBoarded = (d) => d.status === "PRESENT" || d.status === "ARRIVED";
  const coachLabelById = new Map((dashboard.coaches || []).map((c) => [c.id, c.label || c.name || c.id]));
  const boardedRoster = roster.filter(isBoarded);
  const missingRoster = roster.filter((d) => !isBoarded(d) && d.coach_id);
  const unassignedRoster = roster.filter((d) => !isBoarded(d) && !d.coach_id);
  const missingList = missingRoster.map((d) => ({
    name: d.name, vip: !!d.vip, status: d.status, company: d.company,
    coach_id: d.coach_id, coach: coachLabelById.get(d.coach_id) || null,
  }));
  const kpis = {
    total: roster.length,
    present: boardedRoster.length,
    unassigned: unassignedRoster.length,
    missing: missingList.length,
  };
  // Per-coach counts recomputed from the SAME partition, so "which coach has the
  // most missing" and a coach-scoped "who's missing on Coach 2" always agree.
  const coaches = (dashboard.coaches?.length ? dashboard.coaches : COACHES).map((c) => ({
    ...c,
    boarded: boardedRoster.filter((d) => d.coach_id === c.id).length,
    missing: missingRoster.filter((d) => d.coach_id === c.id).length,
  }));

  /* Passport validity — delegates whose passport is expired or expires within
   * 6 months. Soonest-to-expire / most-overdue first. */
  const passportIssues = roster
    .map((d) => ({ name: d.name, vip: !!d.vip, expiry: d.passport_expiry, ...checkPassportExpiry(d.passport_expiry) }))
    .filter((x) => x.status === "expired" || x.status === "expiring")
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  let exceptions = [];
  try {
    const r = await q(`
      SELECT e.type, e.priority, e.note, d.name AS delegate, e.coach_id
        FROM exception_tickets e
        LEFT JOIN delegates d ON d.id = e.delegate_id
       WHERE e.status = 'OPEN'
       ORDER BY CASE e.priority WHEN 'CRITICAL' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END, e.created_at DESC
       LIMIT 25`);
    exceptions = r.rows;
  } catch { /* exceptions module not initialised yet */ }

  let checkins = { total: 0, byMethod: {}, recent: [] };
  try {
    const totals = await q(`SELECT method, COUNT(*)::int AS n FROM check_in_logs GROUP BY method`);
    checkins.byMethod = Object.fromEntries(totals.rows.map((x) => [x.method, x.n]));
    checkins.total = totals.rows.reduce((s, x) => s + x.n, 0);
    const recent = await q(`
      SELECT d.name AS delegate, l.method, l.coach_id, l.client_ts
        FROM check_in_logs l LEFT JOIN delegates d ON d.id = l.delegate_id
       ORDER BY l.client_ts DESC LIMIT 8`);
    checkins.recent = recent.rows;
  } catch { /* check_in_logs not present yet */ }

  let itinerary = [];
  try {
    // BUG FIX (2026-07-31): this compared against the trip's legacy short id
    // ('t-1') instead of the resolved tripUuid actually used everywhere else in
    // this function — so itinerary data never resolved for any non-Beijing
    // trip, and coincidentally "worked" for Beijing only because it IS t-1.
    const r = await q(`
      SELECT i.day_number, to_char(i.start_time,'HH24:MI') AS start_time, i.title, i.location, i.category
        FROM itinerary_items i
       WHERE i.trip_id = $1 AND i.day_number = $2
       ORDER BY i.sort_order, i.start_time`, [tripUuid, trip?.dayOf || 1]);
    itinerary = r.rows;
  } catch { /* itinerary not present yet */ }

  return {
    asOf: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    trip, kpis, coaches,
    missing: missingList, exceptions, checkins, itinerary,
    roster, byIndustry, byCompany, vips, passportIssues,
  };
}

/* Short-TTL cache over buildSnapshot(). Every chat turn rebuilds the snapshot
 * from ~6 DB queries; within a few seconds the data barely changes, so caching
 * it makes rapid follow-up questions (and the fast-path below) much cheaper.
 * Writes that change the picture (confirm, check-in) call invalidateSnapshot().
 * Keyed per trip (2026-07-31, multi-trip support) — a single global entry used
 * to mean switching trips could still serve another trip's cached snapshot for
 * up to 5s. */
let _snapshotCache = new Map(); // tripUuid ("" for the null/default case) -> { at, data }
const SNAPSHOT_TTL_MS = 5000;
async function getSnapshot(tripUuid) {
  const key = tripUuid || "";
  const now = Date.now();
  const entry = _snapshotCache.get(key);
  if (entry && now - entry.at < SNAPSHOT_TTL_MS) return entry.data;
  const data = await buildSnapshot(tripUuid);
  _snapshotCache.set(key, { at: now, data });
  return data;
}
function invalidateSnapshot() { _snapshotCache.clear(); }

function buildSystemPrompt(snapshot, lang) {
  const languageLine = lang === "zh"
    ? "Reply in Simplified Chinese (简体中文), regardless of the language of the question."
    : "Reply in English.";

  const coachLines = snapshot.coaches
    .map((c) => `- ${c.name}${c.city ? ` (${c.city})` : ""} [${c.label || c.id}]: ${c.boarded ?? 0}/${c.capacity ?? "?"} boarded, ${c.missing ?? 0} missing, ${c.total ?? 0} assigned`)
    .join("\n");

  const missingLines = snapshot.missing.length
    ? snapshot.missing.map((m) => `- ${m.name}${m.vip ? " (VIP)" : ""} · ${m.coach} · last seen ${m.lastSeen || "unknown"}`).join("\n")
    : "(nobody currently marked missing)";

  const exceptionLines = snapshot.exceptions.length
    ? snapshot.exceptions.map((e) => `- [${e.priority}] ${e.type}${e.delegate ? ` · ${e.delegate}` : ""}${e.note ? ` — ${e.note}` : ""}`).join("\n")
    : "(no open exception tickets)";

  const passportLines = snapshot.passportIssues?.length
    ? snapshot.passportIssues.map((p) => `- ${p.name}${p.vip ? " (VIP)" : ""}: passport ${p.status === "expired" ? "EXPIRED" : "expiring"} (${p.expiry})`).join("\n")
    : "(no passport issues — all captured expiries valid 6+ months)";

  const methodLine = Object.keys(snapshot.checkins.byMethod).length
    ? Object.entries(snapshot.checkins.byMethod).map(([m, n]) => `${m}: ${n}`).join(", ")
    : "no check-ins logged yet";

  const itineraryLines = snapshot.itinerary.length
    ? snapshot.itinerary.map((i) => `- ${i.start_time} ${i.title}${i.location ? ` @ ${i.location}` : ""}`).join("\n")
    : "(no itinerary items for today)";

  const risks = computeRisk(snapshot);
  const prioritiesBlock = risks.length
    ? risks.map((r) => `- [${r.level}] ${r.text}`).join("\n")
    : "(nothing urgent — no missing VIPs or critical exceptions)";

  const industryLines = snapshot.byIndustry.length
    ? snapshot.byIndustry.map(([name, n]) => `- ${name}: ${n}`).join("\n")
    : "(no industry data captured)";

  const companyLines = snapshot.byCompany.length
    ? snapshot.byCompany.slice(0, 12).map(([name, n]) => `- ${name}: ${n}`).join("\n")
    : "(no company data captured)";

  const vipLines = snapshot.vips.length
    ? snapshot.vips.map((v) => `- ${v.name}${v.company ? ` · ${v.company}` : ""} [${v.status}]`).join("\n")
    : "(no VIPs flagged)";

  // Compact roster for direct look-ups ("what company is X from?"). Bounded so
  // the prompt stays small even on big delegations.
  const rosterLines = snapshot.roster.length
    ? snapshot.roster.slice(0, 150).map((d) =>
        `- ${d.name}${d.role ? `, ${d.role}` : ""}${d.company ? ` @ ${d.company}` : ""}${d.industry ? ` (${d.industry})` : ""} — ${d.status}`
      ).join("\n")
    : "(no delegates in the system yet)";

  return `You are the "Trip Assistant" for MusterGo, an attendance system used by SCCCI staff running an overseas delegation (the Beijing study mission). You help busy staff — often on their phones — understand the CURRENT state of the trip using ONLY the live snapshot below (taken at ${snapshot.asOf}).

CORE RULES
- Ground every answer in the snapshot. Read the EXACT numbers and real names from it; never guess, round, or invent delegates, companies, coaches or figures.
- Attendance has THREE separate states — never mix them up or swap their counts:
    • present  = checked in / accounted for.
    • missing  = expected but NOT checked in.
    • unassigned = not yet placed on any coach (this is NOT the same as present).
  Only describe a delegate or count as present/missing/unassigned if the "Attendance right now" numbers below say so. If present = 0, do not say anyone is present.
- If the snapshot doesn't contain the answer, say so plainly and offer what you CAN help with.
- Be concise and operational: short sentences and simple "- " bullets. You may bold a key number with **like this**. No markdown headers.
- Answer ONLY what was asked. Do NOT volunteer extra lists or details the user didn't request — e.g. if asked for an attendance summary, give the one summary line and STOP; do NOT list individual delegates unless the user explicitly asks WHO they are.
- STOP as soon as the question is answered. Do NOT add trailing commentary, restatements, or "this means…" explanations after the answer.
- ${languageLine}

HANDLING DIFFERENT QUESTIONS
- Greetings / thanks ("hi", "thanks"): reply warmly in one line and offer what you can do (attendance, missing delegates, coaches, exceptions, itinerary, delegate/company look-ups).
- Counts & breakdowns ("how many from finance?", "which companies?"): read the tallies and give the number plus the names/items.
- Person or company look-up ("what company is X from?", "who's from Mencast?"): use the roster.
- Comparisons ("which coach has the most missing?"): compute from the coach list.
- Risk / "who should I worry about?": prioritise missing VIPs and CRITICAL exceptions.
- Operational advice ("what should I do?"): base suggestions strictly on what the snapshot shows (e.g. who to chase).
- Out of scope (weather, unrelated topics): politely say it's outside the trip data you track, then redirect.
- Ambiguous: ask ONE short clarifying question instead of guessing.

EXAMPLES (these show TONE and FORMAT only — the letters/placeholders are NOT real data; always substitute the actual numbers and names from the snapshot)
Q: hi
A: Hi! I can help with the Beijing study mission — attendance, who's missing, coach status, open exceptions, the itinerary, or delegate look-ups. What would you like?

Q: which companies are biggest?
A: Biggest companies by headcount:
- (company name) — (count)
- (company name) — (count)

Q: what's the weather in Beijing?
A: I only track the trip's attendance and logistics, not the weather. I can tell you who's missing, coach status, or today's itinerary though — want any of those?

=== LIVE SNAPSHOT ===
Trip: ${snapshot.trip.name} (${snapshot.trip.dateRange}). Day ${snapshot.trip.dayOf} of ${snapshot.trip.totalDays}. Local time ${snapshot.trip.localTime}. Departs in ${snapshot.trip.departsIn}.

Attendance right now (these are distinct counts that add up to the total — use them exactly):
- Total delegates: ${snapshot.kpis.total}
- Present (checked in): ${snapshot.kpis.present}
- Missing (expected, not checked in): ${snapshot.kpis.missing}
- Unassigned (not on any coach yet): ${snapshot.kpis.unassigned}
Ready-made attendance summary — if asked to summarise attendance, reply with ONLY this exact sentence and NOTHING after it (no extra explanation, no "this means…"): "${snapshot.kpis.total} delegates total — ${snapshot.kpis.present} present, ${snapshot.kpis.missing} missing, ${snapshot.kpis.unassigned} unassigned (not yet on a coach)."

Top priorities right now (already ranked most-urgent first — use this for "who should I worry about / what should I focus on" questions):
${prioritiesBlock}

Coaches:
${coachLines}

Missing delegates:
${missingLines}

Open exception tickets:
${exceptionLines}

Passport issues (expired, or expiring within 6 months of today):
${passportLines}

Check-ins so far: ${snapshot.checkins.total} total (${methodLine}).

Today's itinerary (day ${snapshot.trip.dayOf}):
${itineraryLines}

Delegates by industry:
${industryLines}

Delegates by company (top 12):
${companyLines}

VIP delegates:
${vipLines}

Full delegate roster (name, role, company, industry — status):
${rosterLines}
=== END SNAPSHOT ===`;
}

function normaliseHistory(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((m) => {
      const role = String(m.role || "").toLowerCase() === "assistant" ? "assistant" : "user";
      const content = typeof m.content === "string" ? m.content : String(m.content ?? "");
      return { role, content };
    })
    .filter((m) => m.content.trim())
    .slice(-12);
}

async function ollamaUp() {
  const base = process.env.OLLAMA_HOST || "http://localhost:11434";
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

/* Load the chat model into memory ahead of the first real question. Ollama only
 * loads a model on first use (a ~20-30s cold start on CPU); firing one tiny
 * request at startup means the first user isn't the one who pays it. Runs once,
 * fire-and-forget, and fully guarded — if Ollama isn't up it just no-ops. */
let _warmedUp = false;
function warmUpModel() {
  if (_warmedUp) return;
  _warmedUp = true;
  const base = process.env.OLLAMA_HOST || "http://localhost:11434";
  fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL(), prompt: "ok", stream: false, keep_alive: "30m", options: { num_predict: 1 } }),
    signal: AbortSignal.timeout(90000),
  })
    .then(() => console.log(`  Assistant model warmed up (${CHAT_MODEL()})`))
    .catch(() => { /* Ollama not running or slow — the first real question will load it */ });
}

/* =============================================================================
 *  ASSISTANT FAST-PATH — deterministic answers straight from the snapshot.
 *
 *  The chat model runs on CPU (tens of seconds per reply), so the biggest speed
 *  win is to NOT call it for the common, factual questions we can answer exactly
 *  from live data. answerLocally() returns a formatted reply for those — instant
 *  and never hallucinated — or null to let the LLM handle anything open-ended.
 *  English only for now; Chinese questions fall through to the model.
 * ========================================================================== */
const bold = (n) => `**${n}**`;

/* Only match a delegate name distinctive enough to avoid false positives:
 * multi-word, or a single token of 5+ letters. Returns the longest match. */
function findDelegateInText(q, roster) {
  let best = null;
  for (const d of roster) {
    const name = (d.name || "").toLowerCase();
    if (!name) continue;
    const distinctive = name.includes(" ") || name.replace(/[^a-z]/g, "").length >= 5;
    if (distinctive && q.includes(name) && (!best || name.length > best.name.length)) best = d;
  }
  return best;
}

function coachNameById(id, coaches) {
  const c = coaches.find((x) => x.id === id || x.label === id);
  return c ? `${c.name}${c.city ? ` (${c.city})` : ""}` : null;
}

/* Rank what an organiser should worry about right now, from the live snapshot.
 * Returns concerns sorted most-urgent first: missing VIPs and CRITICAL
 * exceptions outrank operational gaps (a coach far from full) which outrank
 * ordinary open tickets. Shared by the fast-path "who should I worry about"
 * answer and the model prompt's PRIORITIES block, so both lead with the same
 * computed judgement. Plain text (no markdown) so it reads cleanly in either. */
function computeRisk(snapshot) {
  const { missing = [], exceptions = [], coaches = [], passportIssues = [] } = snapshot || {};
  const items = [];

  const missingVips = missing.filter((m) => m.vip);
  if (missingVips.length) {
    items.push({ score: 1000 + missingVips.length, level: "critical",
      text: `${missingVips.length} VIP${missingVips.length > 1 ? "s" : ""} still missing: ${missingVips.map((m) => m.name).join(", ")}` });
  }

  const critical = exceptions.filter((e) => (e.priority || "").toUpperCase() === "CRITICAL");
  if (critical.length) {
    items.push({ score: 900 + critical.length, level: "critical",
      text: `${critical.length} critical exception${critical.length > 1 ? "s" : ""}: ${critical.map((e) => e.type + (e.delegate ? ` (${e.delegate})` : "")).join("; ")}` });
  }

  const expiredPp = passportIssues.filter((p) => p.status === "expired");
  if (expiredPp.length) {
    items.push({ score: 850 + expiredPp.length, level: "critical",
      text: `${expiredPp.length} expired passport${expiredPp.length > 1 ? "s" : ""}: ${expiredPp.map((p) => p.name).join(", ")}` });
  }
  const expiringPp = passportIssues.filter((p) => p.status === "expiring");
  if (expiringPp.length) {
    items.push({ score: 300 + expiringPp.length, level: "medium",
      text: `${expiringPp.length} passport${expiringPp.length > 1 ? "s" : ""} expiring within 6 months` });
  }

  // Operational gap: the coach furthest from boarded (most still missing).
  const worstCoach = [...coaches]
    .map((c) => ({ label: `${c.name}${c.city ? ` (${c.city})` : ""}`, v: Number(c.missing ?? 0) }))
    .filter((c) => c.v > 0)
    .sort((a, b) => b.v - a.v)[0];
  if (worstCoach) {
    items.push({ score: 500 + worstCoach.v, level: "high",
      text: `${worstCoach.label} has the most still to board (${worstCoach.v} missing)` });
  }

  const normal = exceptions.filter((e) => (e.priority || "").toUpperCase() !== "CRITICAL");
  if (normal.length) {
    items.push({ score: 100, level: "medium",
      text: `${normal.length} other open exception${normal.length > 1 ? "s" : ""} to review` });
  }

  return items.sort((a, b) => b.score - a.score);
}

/* Detect a coach referenced in a question — "coach 2", or a coach's label /
 * name / city — so a missing/present look-up can be scoped to it. Returns the
 * coach object, or null when the question isn't about a specific coach. */
function findCoachInText(q, coaches = []) {
  for (const c of coaches) {
    for (const cand of [c.label, c.name, c.city].filter(Boolean)) {
      const s = String(cand).toLowerCase();
      if (s.length >= 2 && q.includes(s)) return c;
    }
    const num = String(c.label ?? c.name ?? "").match(/\d+/)?.[0];
    if (num && new RegExp(`\\bcoach\\s*0*${num}\\b`).test(q)) return c;
  }
  return null;
}

function answerLocally(question, snapshot) {
  if (!snapshot) return null;
  const q = (question || "").toLowerCase().trim();
  if (!q || q.length > 200) return null; // very long → probably freeform; let the model handle it
  const {
    kpis = {}, coaches = [], missing = [], roster = [], byCompany = [],
    byIndustry = [], vips = [], exceptions = [], itinerary = [], trip = {},
    passportIssues = [],
  } = snapshot;
  const has = (...ws) => ws.some((w) => q.includes(w));
  const asksCount = /\b(how many|number of|count|total)\b/.test(q);
  const asksWho = /\b(who|whom|which delegates?|names?|list|show me)\b/.test(q);

  // 1) Greetings / thanks
  if (/^(hi|hello|hey|yo|hiya|greetings|good (morning|afternoon|evening))\b/.test(q)
    || /^(thanks|thank you|thx|ty|cheers|great|nice|ok|okay)\b[\s!.]*$/.test(q)) {
    return `Hi! I can help with the ${trip.name || "trip"} — attendance, who's missing, coach status, open exceptions, today's itinerary, or delegate and company look-ups. What would you like?`;
  }

  // Open-ended / generative requests ("draft an email…", "explain why…") want
  // the model, not a data lookup — even if they mention a keyword like "missing".
  if (/\b(draft|write|compose|email|notify|remind|suggest|recommend|advise|explain|translate|why|how should|what should i (do|say)|help me (write|draft|plan))\b/.test(q)) {
    return null;
  }

  // 2) Person look-up / status of a specific named delegate. Checked before the
  //    aggregate + breakdown intents so "what company is X from" isn't misread.
  const named = findDelegateInText(q, roster);
  if (named && /\b(who|what|which|where|whose|is|are|does|has|from|on|about|status|company|industry|role|coach|bus|here|present|missing|checked|arrived|boarded)\b/.test(q)) {
    const statusText = (named.status === "PRESENT" || named.status === "ARRIVED") ? "checked in"
      : named.status === "MISSING" ? "missing" : "not on a coach yet";
    const facts = [];
    if (named.role) facts.push(named.role);
    if (named.company) facts.push(`from ${bold(named.company)}`);
    if (named.industry) facts.push(`${named.industry} sector`);
    const coach = coachNameById(named.coach_id, coaches);
    let s = `${named.name}${named.vip ? " (VIP)" : ""}${facts.length ? " — " + facts.join(", ") : ""}. Currently ${bold(statusText)}`;
    if (coach) s += `, on ${coach}`;
    return s + ".";
  }

  // 3) Coach superlative (most/fewest missing or boarded) — checked before the
  //    plain missing/present intents since "which coach has the most missing"
  //    also contains "missing".
  if (has("coach", "bus", "vehicle") && has("most", "least", "fewest", "highest", "lowest", "fullest", "emptiest", "biggest", "smallest")) {
    const metric = has("missing", "unaccounted", "not checked", "not boarded") ? "missing" : "boarded";
    const least = has("least", "fewest", "lowest", "emptiest", "smallest");
    const vals = coaches
      .map((c) => ({ label: `${c.name}${c.city ? ` (${c.city})` : ""}`, v: Number(c[metric] ?? 0) }))
      .filter((x) => Number.isFinite(x.v));
    if (vals.length) {
      vals.sort((a, b) => b.v - a.v);
      const pick = least ? vals[vals.length - 1] : vals[0];
      return `${pick.label} has the ${least ? "fewest" : "most"} ${metric} — ${bold(pick.v)}.`;
    }
  }

  // 4) Attendance summary / overview
  if (has("attendance", "summary", "summarise", "summarize", "overview", "how are we doing", "how's it going", "hows it going", "where are we", "overall")) {
    return `${kpis.total} delegates total — ${kpis.present} present, ${kpis.missing} missing, ${kpis.unassigned} unassigned (not yet on a coach).`;
  }

  // 4) Present / checked-in count — coach-scoped when a coach is named.
  if (!named && (/\b(present|checked[- ]?in|turnout|arrived)\b/.test(q) || has("here yet", "how many are here"))) {
    const coach = findCoachInText(q, coaches);
    if (coach) {
      const cname = coach.label || coach.name;
      const onCoach = roster.filter((d) => d.coach_id === coach.id);
      const boarded = onCoach.filter((d) => d.status === "PRESENT" || d.status === "ARRIVED").length;
      return `${bold(boarded)} of ${bold(onCoach.length)} on ${cname} have boarded — ${onCoach.length - boarded} still to go.`;
    }
    return `${bold(kpis.present)} of ${bold(kpis.total)} delegates are checked in — ${kpis.missing} still missing, ${kpis.unassigned} not yet on a coach.`;
  }

  // 5) Missing (count or list) — scoped to a coach if the question names one, so
  //    "who is missing from Coach 2?" answers about Coach 2, not the whole trip.
  if (!named && has("missing", "not checked in", "not here", "haven't arrived", "havent arrived", "unaccounted", "who's left", "still to board", "not boarded")) {
    const coach = findCoachInText(q, coaches);
    const cname = coach ? (coach.label || coach.name) : null;
    const list = coach ? missing.filter((m) => m.coach_id === coach.id) : missing;
    // Global count cites kpis.missing (now equal to the list length — both come
    // from the one buildSnapshot partition); coach-scoped cites the filtered list.
    if (asksCount && !asksWho) return cname
      ? `${bold(list.length)} on ${cname} are missing (expected but not yet checked in).`
      : `${bold(kpis.missing)} delegates are missing (expected but not yet checked in).`;
    if (!list.length) return cname ? `Everyone on ${cname} has boarded — nobody missing there.` : "Nobody is currently marked missing — everyone expected is accounted for.";
    const ordered = [...list].sort((a, b) => (b.vip ? 1 : 0) - (a.vip ? 1 : 0));
    const lines = ordered.slice(0, 15).map((m) => `- ${m.name}${m.vip ? " (VIP)" : ""}${!cname && m.coach ? ` · ${m.coach}` : ""}`);
    const more = list.length > 15 ? `\n…and ${list.length - 15} more.` : "";
    return `${bold(list.length)} missing${cname ? ` on ${cname}` : ""}:\n${lines.join("\n")}${more}`;
  }

  // 6) Unassigned (not on any coach yet)
  if (!named && has("unassigned", "not on a coach", "no coach", "not placed", "without a coach", "not yet assigned", "not on any coach")) {
    const un = roster.filter((d) => !d.coach_id && d.status !== "PRESENT");
    if ((asksCount && !asksWho) || !un.length) return `${bold(kpis.unassigned)} delegates aren't on any coach yet.`;
    const lines = un.slice(0, 15).map((d) => `- ${d.name}${d.company ? ` · ${d.company}` : ""}`);
    const more = un.length > 15 ? `\n…and ${un.length - 15} more.` : "";
    return `${bold(kpis.unassigned)} not yet on a coach:\n${lines.join("\n")}${more}`;
  }

  // 8) Company breakdown
  if (has("compan", "organisation", "organization", "employer", "firms")) {
    if (!byCompany.length) return "No company information has been captured for the delegates yet.";
    const top = byCompany.slice(0, 8).map(([name, n]) => `- ${name} — ${bold(n)}`);
    return `Delegates by company:\n${top.join("\n")}`;
  }

  // 9) Industry breakdown
  if (has("industr", "sector")) {
    if (!byIndustry.length) return "No industry information has been captured for the delegates yet.";
    const top = byIndustry.slice(0, 8).map(([name, n]) => `- ${name} — ${bold(n)}`);
    return `Delegates by industry:\n${top.join("\n")}`;
  }

  // 10) VIPs
  if (has("vip", "important", "priority guest", "priority delegate")) {
    if (!vips.length) return "No delegates are flagged as VIPs.";
    const missingVips = vips.filter((v) => v.status === "MISSING");
    const lines = vips.slice(0, 15).map((v) => `- ${v.name}${v.company ? ` · ${v.company}` : ""} — ${(v.status === "PRESENT" || v.status === "ARRIVED") ? "checked in" : v.status === "MISSING" ? "missing" : "not on a coach"}`);
    const head = `${bold(vips.length)} VIP${vips.length > 1 ? "s" : ""}${missingVips.length ? `, ${bold(missingVips.length)} still missing` : ""}:`;
    return `${head}\n${lines.join("\n")}`;
  }

  // 11) Open exception tickets (but not "passport issues" — that's its own intent)
  if (!has("passport") && has("exception", "issue", "problem", "ticket", "incident", "anything wrong", "any issues")) {
    if (!exceptions.length) return "No open exception tickets right now.";
    const lines = exceptions.slice(0, 10).map((e) => `- [${e.priority}] ${e.type}${e.delegate ? ` · ${e.delegate}` : ""}`);
    return `${bold(exceptions.length)} open exception${exceptions.length > 1 ? "s" : ""}:\n${lines.join("\n")}`;
  }

  // 12) Today's itinerary
  if (has("itinerary", "schedule", "agenda", "what's on", "whats on", "plan for today", "today's plan", "programme", "program")) {
    if (!itinerary.length) return "There are no itinerary items scheduled for today.";
    const lines = itinerary.map((i) => `- ${i.start_time} ${i.title}${i.location ? ` @ ${i.location}` : ""}`);
    return `Today's itinerary:\n${lines.join("\n")}`;
  }

  // 13) Passport validity
  if (has("passport", "expiry", "expiring", "expire", "travel doc", "travel document")) {
    if (!passportIssues.length) return "No passport issues — every captured passport expiry is valid for at least 6 months.";
    const lines = passportIssues.slice(0, 15).map((p) => `- ${p.name}${p.vip ? " (VIP)" : ""} — ${p.status === "expired" ? "EXPIRED" : "expires"} ${p.expiry}`);
    const more = passportIssues.length > 15 ? `\n…and ${passportIssues.length - 15} more.` : "";
    return `${bold(passportIssues.length)} passport${passportIssues.length > 1 ? "s" : ""} to check:\n${lines.join("\n")}${more}`;
  }

  // 14) Risk / "who should I worry about" — a ranked, computed priority list
  if (has("worry", "worried", "concern", "risk", "chase", "priorit", "attention", "watch", "focus on", "urgent", "trouble")) {
    const risks = computeRisk(snapshot);
    if (!risks.length) return `Nothing urgent right now — no missing VIPs and no critical exceptions.${kpis.missing ? ` ${kpis.missing} delegates are still to check in.` : " Everyone's accounted for."}`;
    return `Here's what to watch right now, most urgent first:\n${risks.map((r) => `- ${r.text}`).join("\n")}`;
  }

  return null; // no confident match → let the model answer
}

async function answer(messages, lang, tripUuid) {
  const snapshot = await getSnapshot(tripUuid);
  const history = normaliseHistory(messages);
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return { content: "What would you like to know about the trip?", source: "none" };
  }
  // Deterministic fast-path (English) — instant, exact answers with no model call.
  if (lang !== "zh") {
    const local = answerLocally(history[history.length - 1].content, snapshot);
    if (local != null) return { content: local, source: "local" };
  }
  const system = buildSystemPrompt(snapshot, lang === "zh" ? "zh" : "en");
  // Generous timeout: a cold model load (~27s) plus generation can exceed a
  // minute, and Ollama serialises requests (a running parse blocks chat).
  const viaOllama = await ollamaChat(history, system, { timeoutMs: 120000 });
  if (viaOllama) return { content: viaOllama, source: "ollama" };
  try {
    const viaClaude = await anthropicChat(history, system, 700);
    if (viaClaude) return { content: viaClaude, source: "anthropic" };
  } catch (err) {
    console.error("Assistant (Anthropic) failed:", err.message || err);
    const e = new Error("The assistant is temporarily unavailable. Please try again shortly.");
    e.status = 502;
    throw e;
  }
  // Ollama is installed but didn't answer in time → it's busy, not missing.
  if (await ollamaUp()) {
    const e = new Error("The assistant is busy right now (a document may still be processing). Please try again in a moment.");
    e.status = 503;
    throw e;
  }
  // No AI text engine available (e.g. the deployed cloud host, where Ollama can't
  // run). The fast-path above already answers the common factual questions with
  // no model at all, so rather than error out, degrade gracefully for open-ended
  // ones and point the user at what still works instantly.
  return {
    content: "I can answer questions about attendance, who's missing, coach status, exceptions, the itinerary, VIPs, and specific delegates or companies — all instantly. Open-ended questions need the AI text engine, which isn't available in this environment. Try asking, for example, \"who's missing?\", \"which coach has the most missing?\", or \"who should I worry about?\"",
    source: "unavailable",
  };
}

/* ---- Stateless chat (mobile) -------------------------------------------- */
router.post("/api/chat/messages", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  try {
    const tripUuid = await resolveTripUuid(req.body?.tripId || "t-1");
    const reply = await answer(req.body?.messages, req.body?.lang, tripUuid);
    res.json({ reply: { content: reply.content }, source: reply.source });
  } catch (err) {
    res.status(err.status || 500).json({ error: "ASSISTANT_ERROR", message: err.message });
  }
}));

/* ---- Saved chat history (desktop sidebar) -------------------------------- */
router.get("/api/chat/sessions", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  // Optional ?tripId= (2026-07-31, multi-trip support) scopes the sidebar list
  // to whichever trip is currently selected in the assistant's trip switcher,
  // so switching trips shows that trip's own chat history instead of every
  // trip's chats mixed together. Omitted entirely = every chat (back-compat).
  const wantScoped = !!req.query.tripId;
  const tripUuid = wantScoped ? await resolveTripUuid(req.query.tripId) : null;
  const r = await q(`
    SELECT s.id, s.title, s.updated_at, s.pinned,
           (SELECT COUNT(*)::int FROM chat_messages m WHERE m.session_id = s.id) AS message_count
      FROM chat_sessions s
     WHERE s.account_id = $1 AND ($2::boolean IS NOT TRUE OR s.trip_id = $3)
     ORDER BY s.pinned DESC, s.updated_at DESC LIMIT 50`, [req.account.id, wantScoped, tripUuid]);
  res.json({ sessions: r.rows });
}));

/* Rename and/or pin a chat. */
router.patch("/api/chat/sessions/:id", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const owned = await q(`SELECT id FROM chat_sessions WHERE id = $1 AND account_id = $2`, [req.params.id, req.account.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  const sets = [];
  const params = [];
  if (typeof req.body?.title === "string") {
    const title = req.body.title.trim().slice(0, 120) || "Untitled chat";
    params.push(title); sets.push(`title = $${params.length}`);
  }
  if (typeof req.body?.pinned === "boolean") {
    params.push(req.body.pinned); sets.push(`pinned = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ error: "NOTHING_TO_UPDATE" });
  params.push(req.params.id);
  const r = await q(`UPDATE chat_sessions SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING id, title, pinned`, params);
  res.json(r.rows[0]);
}));

router.post("/api/chat/sessions", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const id = randomUUID();
  // The trip a chat is created for sticks for its whole life (2026-07-31,
  // multi-trip support) — continuing it later always answers about THIS trip,
  // not whatever the switcher currently shows. Defaults to Beijing (t-1) so a
  // caller that never passes tripId (e.g. any pre-existing client) behaves
  // exactly as before.
  const tripUuid = await resolveTripUuid(req.body?.tripId || "t-1");
  await q(`INSERT INTO chat_sessions (id, account_id, title, trip_id) VALUES ($1, $2, 'New chat', $3)`, [id, req.account.id, tripUuid]);
  res.status(201).json({ id, title: "New chat", messages: [] });
}));

router.get("/api/chat/sessions/:id", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const owned = await q(`SELECT id, title FROM chat_sessions WHERE id = $1 AND account_id = $2`, [req.params.id, req.account.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  const msgs = await q(`SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at`, [req.params.id]);
  res.json({ id: req.params.id, title: owned.rows[0].title, messages: msgs.rows });
}));

router.post("/api/chat/sessions/:id/messages", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const sessionId = req.params.id;
  const owned = await q(`SELECT id, title, trip_id FROM chat_sessions WHERE id = $1 AND account_id = $2`, [sessionId, req.account.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  const userText = (req.body?.content || "").toString().trim();
  if (!userText) return res.status(400).json({ error: "EMPTY", message: "Type a question first." });

  const prior = await q(`SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
  const history = [...prior.rows, { role: "user", content: userText }];
  let reply;
  try {
    reply = await answer(history, req.body?.lang, owned.rows[0].trip_id);
  } catch (err) {
    return res.status(err.status || 500).json({ error: "ASSISTANT_ERROR", message: err.message });
  }
  await q(`INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1,$2,'user',$3)`, [randomUUID(), sessionId, userText]);
  await q(`INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1,$2,'assistant',$3)`, [randomUUID(), sessionId, reply.content]);

  let title = owned.rows[0].title;
  if (title === "New chat") {
    title = userText.length > 48 ? userText.slice(0, 47) + "…" : userText;
  }
  await q(`UPDATE chat_sessions SET updated_at = now(), title = $2 WHERE id = $1`, [sessionId, title]);
  res.json({ reply: { content: reply.content }, title, source: reply.source });
}));

/* Streaming reply (Server-Sent Events) — tokens appear as they're generated. */
router.post("/api/chat/sessions/:id/stream", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const sessionId = req.params.id;
  const owned = await q(`SELECT id, title, trip_id FROM chat_sessions WHERE id = $1 AND account_id = $2`, [sessionId, req.account.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  const userText = (req.body?.content || "").toString().trim();
  if (!userText) return res.status(400).json({ error: "EMPTY", message: "Type a question first." });

  const prior = await q(`SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
  const priorRows = prior.rows;
  const history = normaliseHistory([...priorRows, { role: "user", content: userText }]);
  const tripUuid = owned.rows[0].trip_id;
  const snapshot = await getSnapshot(tripUuid);
  const lang = req.body?.lang === "zh" ? "zh" : "en";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Fast-path: answer common factual questions instantly from the snapshot
  // (English only; Chinese and open-ended questions fall through to the model).
  let full = lang === "en" ? answerLocally(userText, snapshot) : null;
  if (full != null) {
    sse({ token: full });
  } else {
    const system = buildSystemPrompt(snapshot, lang);
    full = await ollamaStream(history, system, (tok) => sse({ token: tok }));
    // Fallback if Ollama couldn't stream (not running / busy) — use the same
    // non-streaming path (Claude, or a clear error message).
    if (full == null) {
      try {
        const r = await answer([...priorRows, { role: "user", content: userText }], req.body?.lang, tripUuid);
        full = r.content;
        sse({ token: full });
      } catch (err) {
        sse({ error: err.message });
        return res.end();
      }
    }
  }

  await q(`INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1,$2,'user',$3)`, [randomUUID(), sessionId, userText]);
  await q(`INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1,$2,'assistant',$3)`, [randomUUID(), sessionId, full]);
  let title = owned.rows[0].title;
  if (title === "New chat") title = userText.length > 48 ? userText.slice(0, 47) + "…" : userText;
  await q(`UPDATE chat_sessions SET updated_at = now(), title = $2 WHERE id = $1`, [sessionId, title]);
  sse({ done: true, title });
  res.end();
}));

/* Regenerate the last answer (SSE): drop the previous assistant reply and
 * stream a fresh one for the same last question. */
router.post("/api/chat/sessions/:id/regenerate", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const sessionId = req.params.id;
  const owned = await q(`SELECT id, title, trip_id FROM chat_sessions WHERE id = $1 AND account_id = $2`, [sessionId, req.account.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: "NOT_FOUND" });

  const msgs = (await q(`SELECT id, role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at`, [sessionId])).rows;
  // Remove the most recent assistant message (the one being regenerated).
  let lastA = -1;
  for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === "assistant") { lastA = i; break; } }
  if (lastA >= 0) { await q(`DELETE FROM chat_messages WHERE id = $1`, [msgs[lastA].id]); msgs.splice(lastA, 1); }
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
    return res.status(400).json({ error: "NOTHING_TO_REGENERATE", message: "There's no question to regenerate." });
  }

  const tripUuid = owned.rows[0].trip_id;
  const history = normaliseHistory(msgs);
  const snapshot = await getSnapshot(tripUuid);
  const system = buildSystemPrompt(snapshot, req.body?.lang === "zh" ? "zh" : "en");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let full = await ollamaStream(history, system, (tok) => sse({ token: tok }));
  if (full == null) {
    try { const r = await answer(msgs, req.body?.lang, tripUuid); full = r.content; sse({ token: full }); }
    catch (err) { sse({ error: err.message }); return res.end(); }
  }
  await q(`INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1,$2,'assistant',$3)`, [randomUUID(), sessionId, full]);
  await q(`UPDATE chat_sessions SET updated_at = now() WHERE id = $1`, [sessionId]);
  sse({ done: true });
  res.end();
}));

/* Delegate roster with details — powers clickable delegate cards in the chat. */
router.get("/api/assistant/roster", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  // Coach-captain scoping added 2026-07-28 (audit finding): this returned EVERY
  // delegate — including their email — to any signed-in account, with no
  // scoping at all, which made it the widest delegate-PII surface in the app.
  // Now scoped to the assistant's own trip (same as buildSnapshot, defaulting
  // to Beijing/t-1; ?tripId= added 2026-07-31 for the assistant's trip
  // switcher) and to the coaches the caller can actually see, matching every
  // other delegate-reading route.
  const tripUuid = await resolveTripUuid(req.query.tripId || "t-1");
  const r = await q(`
    SELECT d.name, d.company, d.role, d.industry, d.status, d.vip, d.email,
           d."coachId" AS coach_id,
           c.name AS coach, c.city AS coach_city
      FROM delegates d
      LEFT JOIN coaches c ON c.id = d."coachId"
     WHERE ($1::uuid IS NULL OR d.trip_id = $1)
     ORDER BY d.name`, [tripUuid]);
  const visibleCoachIds = tripUuid ? await getVisibleCoachIds(tripUuid, req.account) : null;
  const rows = visibleCoachIds
    ? r.rows.filter((d) => d.coach_id && visibleCoachIds.has(d.coach_id))
    : r.rows;
  // coach_id was only needed for the filter — not part of the public shape.
  res.json({ delegates: rows.map(({ coach_id, ...rest }) => rest) });
}));

/* Compact live "trip pulse" for the page headers (Onboarding + Assistant):
 * trip context + attendance KPIs + the top ranked risks. Reuses the cached
 * assistant snapshot and computeRisk(), so repeated polls are cheap. */
router.get("/api/assistant/pulse", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const tripUuid = req.query.tripId ? await resolveTripUuid(req.query.tripId) : undefined;
  const s = await getSnapshot(tripUuid);
  res.json({
    trip: { name: s.trip?.name || null, dayOf: s.trip?.dayOf ?? null, totalDays: s.trip?.totalDays ?? null, departsIn: s.trip?.departsIn || null },
    kpis: s.kpis || { total: 0, present: 0, missing: 0, unassigned: 0 },
    risk: computeRisk(s).slice(0, 3),
    asOf: s.asOf,
  });
}));

router.delete("/api/chat/sessions/:id", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const r = await q(`DELETE FROM chat_sessions WHERE id = $1 AND account_id = $2`, [req.params.id, req.account.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({ deleted: true });
}));

/* =============================================================================
 *  MUSTERCHAT — person-to-person messaging (lives beside the AI assistant in
 *  the same inbox). Only staff accounts authenticate, so the SENDER is always
 *  an account; the peer is another account (fully two-way) or a delegate (a
 *  staff→delegate log, since delegates never log in). Messages persist and are
 *  polled via /updates for near-real-time delivery.
 * ========================================================================== */

// Order-independent key for a conversation's two parties, so A→B and B→A share
// one thread. Account↔account sorts the ids; account↔delegate is per-staffer
// (each staff member keeps their own thread with a given delegate).
function convoKey(meAcctId, peerKind, peerId) {
  if (peerKind === "delegate") return `a:${meAcctId}|d:${peerId}`;
  const [lo, hi] = [String(meAcctId), String(peerId)].sort();
  return `a:${lo}|a:${hi}`;
}

const MSG_KINDS = new Set(["text", "video", "doc", "call", "sticker"]);

// Media allowlist (JQ, added at integration time 2026-07-27): `media` is
// rendered straight into <img>/<video> src on the client, so only inline data:
// payloads of the right type (or JSON for doc/call cards) are accepted — a
// remote http(s) URL stored here would beacon every viewer's IP to whoever
// sent it.
// Tightened 2026-07-28 after pen-testing: a bare startsWith("data:video/")
// prefix check also accepted junk like "data:video/..%2f..%2fetc". Require a
// real, well-formed inline data URL — subtype of safe chars, then the
// base64/comma separator — so only something a browser would actually decode
// as media can be stored.
const DATA_VIDEO_RE = /^data:video\/[a-z0-9][a-z0-9.+-]*(;[a-z0-9-]+=[^,;]*)*(;base64)?,/i;
const DATA_IMAGE_RE = /^data:image\/[a-z0-9][a-z0-9.+-]*(;[a-z0-9-]+=[^,;]*)*(;base64)?,/i;
function validMedia(kind, media) {
  if (media === null || media === undefined || media === "") return true;
  const s = String(media);
  if (kind === "video") return DATA_VIDEO_RE.test(s);
  // SVG is excluded deliberately: it's the one image type that can carry
  // script, and nothing here needs it.
  if (kind === "sticker") return DATA_IMAGE_RE.test(s) && !/^data:image\/svg/i.test(s);
  if (kind === "doc" || kind === "call") { try { JSON.parse(s); return true; } catch { return false; } }
  return false; // plain text messages carry no media
}

/* Per-account send throttle (JQ, 2026-07-28 pen-test finding: 50 rapid sends
 * were all accepted, and each may carry ~12MB of base64 media — that's a
 * trivial way for one signed-in account to flood the shared DB). In-memory
 * sliding window: fine for this single-process app, and it fails OPEN on
 * restart rather than locking anyone out. Generous enough that real
 * conversation never hits it. */
const SEND_WINDOW_MS = 10_000;
const SEND_MAX_TEXT = 25;   // messages per window per account
const SEND_MAX_MEDIA = 5;   // of which, at most this many carrying media
const sendLog = new Map();  // accountId -> [{ at, media }]
function throttleSend(accountId, hasMedia) {
  const now = Date.now();
  const recent = (sendLog.get(accountId) || []).filter((e) => now - e.at < SEND_WINDOW_MS);
  if (recent.length >= SEND_MAX_TEXT) return false;
  if (hasMedia && recent.filter((e) => e.media).length >= SEND_MAX_MEDIA) return false;
  recent.push({ at: now, media: hasMedia });
  sendLog.set(accountId, recent);
  // Keep the map from growing forever on a long-running server.
  if (sendLog.size > 500) {
    for (const [k, v] of sendLog) if (!v.some((e) => now - e.at < SEND_WINDOW_MS)) sendLog.delete(k);
  }
  return true;
}
const MAX_BODY = 8000;                 // chars of text / caption
const MAX_MEDIA = 12 * 1024 * 1024;    // ~12MB base64 (short clips / small docs)

// Shape a dm_messages row for the client. A soft-deleted message keeps its slot
// (for ordering) but its content is blanked so it can never leak — the client
// shows "This message was deleted" from the `deleted` flag. `edited` tags edits.
function mapMessageRow(me) {
  return (m) => {
    const deleted = !!m.deleted_at;
    return {
      id: m.id,
      kind: m.kind,
      body: deleted ? null : m.body,
      media: deleted ? null : m.media,
      at: m.created_at,
      mine: m.sender_id === me,
      read: !!m.read_at,
      edited: !!m.edited_at,
      deleted,
    };
  };
}

// Restriction point: staff are always contactable; delegate contacts require
// the same delegate visibility the rest of the app gates on. Tighten here.
function canSeeDelegates(account) {
  const p = accountPermissions(account) || {};
  return !!(p.viewDocuments || p.viewDashboard || p.manageDelegates);
}

async function resolvePeer(peerKind, peerId, account) {
  if (peerKind === "account") {
    return (await q(`SELECT id, name, username FROM accounts WHERE id = $1`, [peerId])).rows[0] || null;
  }
  if (peerKind === "delegate") {
    if (!canSeeDelegates(account)) return null;
    const row = (await q(`SELECT id, name, company, trip_id, "coachId" FROM delegates WHERE id = $1`, [peerId])).rows[0];
    if (!row) return null;
    // Coach-captain scoping (JQ, 2026-07-28 pen-test finding). The CONTACTS
    // list was already scoped, but this lookup wasn't — so a scoped Staff
    // account could still read any delegate's name/company, and open a thread
    // against them, just by asking for the id directly (ids are sequential
    // "d-N", so the whole roster was walkable). Same rule, enforced at the
    // point the record is actually read.
    if (row.trip_id) {
      const visibleCoachIds = await getVisibleCoachIds(row.trip_id, account);
      if (visibleCoachIds && !(row.coachId && visibleCoachIds.has(row.coachId))) return null;
    }
    return { id: row.id, name: row.name, company: row.company };
  }
  return null;
}

const previewOf = (m) =>
  !m ? null
  : m.deleted_at ? "🚫 Message deleted"
  : m.kind === "sticker" ? "💟 Sticker"
  : m.kind === "video" ? "📹 Video message"
  : m.kind === "doc" ? "📄 Document"
  : m.kind === "call" ? (m.body || "📞 Call")
  : (m.body || "").slice(0, 80);

// GET /api/messages/contacts — everyone I can message, each with last-message
// preview, unread count and presence; conversations with history float to top.
router.get("/api/messages/contacts", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id;

  // Coach(es) each staff contact currently captains (2026-07-31, "add filter
  // by coach assigned" — the New Group modal's member picker), via a
  // correlated subquery rather than a plain JOIN: multi-captain support
  // (coach_captains) means one account can now captain more than one coach,
  // and a plain JOIN would return that account as multiple duplicate contact
  // rows. Not trip-scoped since contacts themselves aren't per-trip; an
  // account with no coach anywhere just gets an empty array (no filter chip).
  const accounts = (await q(
    `SELECT a.id, a.name, a.username, a.role, a."photoUrl" AS photo_url,
            (a.last_seen_at IS NOT NULL AND a.last_seen_at > now() - interval '45 seconds') AS online,
            (SELECT COALESCE(json_agg(json_build_object('id', c.id, 'label', COALESCE(c.label, c.name)) ORDER BY c.label), '[]'::json)
               FROM coach_captains cc JOIN coaches c ON c.id = cc.coach_id
              WHERE cc.account_id = a.id) AS coaches
       FROM accounts a
      WHERE a.id <> $1 ORDER BY a.name NULLS LAST, a.username`, [me]
  )).rows;

  let delegates = [];
  if (canSeeDelegates(req.account)) {
    const tripUuid = await resolveTripUuid("t-1");
    delegates = (await q(
      `SELECT id, name, company, "coachId" FROM delegates
        WHERE ($1::uuid IS NULL OR trip_id = $1) ORDER BY name`, [tripUuid]
    )).rows;
    // Coach-captain Staff scoping (JQ, added at integration time 2026-07-27):
    // the delegate CONTACTS list respects the same visibility rule as every
    // other delegate-reading route — a scoped Staff account only sees (and can
    // only message) delegates on coaches they captain. Admin sees everyone.
    const visibleCoachIds = tripUuid ? await getVisibleCoachIds(tripUuid, req.account) : null;
    if (visibleCoachIds) delegates = delegates.filter((d) => d.coachId && visibleCoachIds.has(d.coachId));
    delegates = delegates.map(({ coachId, ...rest }) => rest);
  }

  // All my messages, oldest→newest, so the last write per convo wins the preview.
  const mine = (await q(
    `SELECT convo_key, sender_id, recipient_kind, recipient_id, kind, body, created_at, read_at, deleted_at
       FROM dm_messages
      WHERE sender_id = $1 OR (recipient_kind = 'account' AND recipient_id = $1)
      ORDER BY created_at`, [me]
  )).rows;

  const lastByConvo = new Map();
  const unreadByConvo = new Map();
  for (const m of mine) {
    lastByConvo.set(m.convo_key, m);
    if (m.recipient_kind === "account" && m.recipient_id === me && !m.read_at) {
      unreadByConvo.set(m.convo_key, (unreadByConvo.get(m.convo_key) || 0) + 1);
    }
  }

  const build = (kind, row, subtitle, online) => {
    const key = convoKey(me, kind, row.id);
    const last = lastByConvo.get(key);
    return {
      kind, id: row.id, name: row.name || row.username || "Unknown", subtitle,
      online: !!online,
      lastMessage: previewOf(last), lastAt: last?.created_at || null,
      lastMine: last ? last.sender_id === me : false,
      unread: unreadByConvo.get(key) || 0,
    };
  };

  const contacts = [
    ...accounts.map((a) => ({
      ...build("account", a, a.role === "admin" ? "Staff · admin" : "Staff", a.online),
      // coachIds/coachLabels (2026-07-31, multi-captain support) replace the
      // old singular coachId/coachLabel — a staff member can now captain more
      // than one coach.
      coachIds: (a.coaches || []).map((c) => c.id),
      coachLabels: (a.coaches || []).map((c) => c.label),
      photoUrl: a.photo_url || null,
    })),
    ...delegates.map((d) => build("delegate", d, d.company || "Delegate", false)),
  ];
  contacts.sort((a, b) => {
    if (a.lastAt && b.lastAt) return new Date(b.lastAt) - new Date(a.lastAt);
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return a.name.localeCompare(b.name);
  });

  res.json({ me: { id: me, name: req.account.name, username: req.account.username }, contacts });
}));

// GET /api/messages/thread?peerKind=&peerId= — full history with one peer,
// marking everything they sent me as read.
router.get("/api/messages/thread", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id;
  const peerKind = (req.query.peerKind || "account").toString();
  const peerId = (req.query.peerId || "").toString();
  const peer = await resolvePeer(peerKind, peerId, req.account);
  if (!peer) return res.status(404).json({ error: "NO_PEER", message: "That contact isn't available." });

  const key = convoKey(me, peerKind, peerId);
  await q(`UPDATE dm_messages SET read_at = now()
            WHERE convo_key = $1 AND recipient_kind = 'account' AND recipient_id = $2 AND read_at IS NULL`,
          [key, me]);

  const rows = (await q(
    `SELECT id, sender_id, kind, body, media, created_at, read_at, edited_at, deleted_at
       FROM dm_messages WHERE convo_key = $1 ORDER BY created_at`, [key]
  )).rows;

  res.json({
    peer: { kind: peerKind, id: peerId, name: peer.name || peer.username, subtitle: peer.company || null },
    messages: rows.map(mapMessageRow(me)),
  });
}));

// POST /api/messages/thread — send a message (text | video clip | doc share | call log).
router.post("/api/messages/thread", requireAuth(), express.json({ limit: "16mb" }), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id;
  const { peerKind = "account", peerId, kind = "text", body = null, media = null } = req.body || {};
  if (!peerId) return res.status(400).json({ error: "NO_PEER" });
  if (!MSG_KINDS.has(kind)) return res.status(400).json({ error: "BAD_KIND" });
  if (body && String(body).length > MAX_BODY) return res.status(413).json({ error: "BODY_TOO_LONG" });
  if (media && String(media).length > MAX_MEDIA) return res.status(413).json({ error: "MEDIA_TOO_LARGE", message: "That attachment is too large — keep clips short." });
  if (!validMedia(kind, media)) return res.status(400).json({ error: "BAD_MEDIA", message: "Attachments must be inline media of the right type." });
  if ((kind === "text" || kind === "sticker") && !String(body || "").trim() && !media) return res.status(400).json({ error: "EMPTY" });
  if (!throttleSend(me, !!media)) return res.status(429).json({ error: "TOO_FAST", message: "Slow down a moment — too many messages at once." });

  const peer = await resolvePeer(peerKind, peerId, req.account);
  if (!peer) return res.status(404).json({ error: "NO_PEER", message: "That contact isn't available." });

  const id = randomUUID();
  const key = convoKey(me, peerKind, peerId);
  await q(
    `INSERT INTO dm_messages (id, convo_key, sender_id, recipient_kind, recipient_id, kind, body, media)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, key, me, peerKind, peerId, kind, body, media]
  );
  res.json({ message: { id, kind, body, media, at: new Date().toISOString(), mine: true, read: false } });
}));

// GET /api/messages/updates?since=ISO — incoming messages addressed to me since
// a timestamp (lightweight polling) + my total unread across all threads.
router.get("/api/messages/updates", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id;
  const since = req.query.since ? new Date(req.query.since.toString()) : new Date(Date.now() - 60000);
  const rows = (await q(
    `SELECT id, convo_key, sender_id, kind, body, created_at, deleted_at
       FROM dm_messages
      WHERE recipient_kind = 'account' AND recipient_id = $1 AND created_at > $2
      ORDER BY created_at`, [me, since.toISOString()]
  )).rows;
  const dmUnread = (await q(
    `SELECT COUNT(*)::int AS n FROM dm_messages
      WHERE recipient_kind = 'account' AND recipient_id = $1 AND read_at IS NULL`, [me]
  )).rows[0].n;
  // Group unread: messages in my groups, from someone else, newer than my last
  // read of that group (or all, if I've never opened it). Groups have no
  // per-message read_at, so we track it in chat_group_reads.
  const groupUnread = (await q(
    `SELECT COUNT(*)::int AS n
       FROM dm_messages d
       JOIN chat_group_members m ON m.group_id = d.recipient_id AND m.account_id = $1
       LEFT JOIN chat_group_reads r ON r.group_id = d.recipient_id AND r.account_id = $1
      WHERE d.recipient_kind = 'group' AND d.sender_id <> $1 AND d.deleted_at IS NULL
        AND (r.last_read_at IS NULL OR d.created_at > r.last_read_at)`, [me]
  )).rows[0].n;
  res.json({
    now: new Date().toISOString(),
    unread: dmUnread + groupUnread,
    dmUnread, groupUnread,
    incoming: rows.map((m) => ({ id: m.id, convoKey: m.convo_key, senderId: m.sender_id, kind: m.kind, preview: previewOf(m), at: m.created_at })),
  });
}));

// POST /api/messages/read — mark a whole thread read.
router.post("/api/messages/read", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id;
  const { peerKind = "account", peerId } = req.body || {};
  if (!peerId) return res.status(400).json({ error: "NO_PEER" });
  const key = convoKey(me, peerKind, peerId);
  await q(`UPDATE dm_messages SET read_at = now()
            WHERE convo_key = $1 AND recipient_kind = 'account' AND recipient_id = $2 AND read_at IS NULL`, [key, me]);
  res.json({ ok: true });
}));

// PATCH /api/messages/:id — edit your OWN text message (DMs or groups; keyed by
// message id, so one endpoint covers both). Stamps `edited_at`.
router.patch("/api/messages/:id", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id;
  const id = req.params.id;
  const body = (req.body?.body ?? "").toString();
  const row = (await q(`SELECT sender_id, kind, deleted_at FROM dm_messages WHERE id = $1`, [id])).rows[0];
  if (!row) return res.status(404).json({ error: "NO_MESSAGE" });
  if (row.sender_id !== me) return res.status(403).json({ error: "NOT_YOURS", message: "You can only edit your own messages." });
  if (row.deleted_at) return res.status(409).json({ error: "DELETED", message: "That message was deleted." });
  if (row.kind !== "text") return res.status(400).json({ error: "NOT_EDITABLE", message: "Only text messages can be edited." });
  if (!body.trim()) return res.status(400).json({ error: "EMPTY" });
  if (body.length > MAX_BODY) return res.status(413).json({ error: "BODY_TOO_LONG" });
  await q(`UPDATE dm_messages SET body = $1, edited_at = now() WHERE id = $2`, [body, id]);
  res.json({ ok: true, id, body, edited: true });
}));

// DELETE /api/messages/:id — soft-delete your OWN message (any kind). The row
// stays for ordering but body/media are wiped so the content is truly gone.
router.delete("/api/messages/:id", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id;
  const id = req.params.id;
  const row = (await q(`SELECT sender_id FROM dm_messages WHERE id = $1`, [id])).rows[0];
  if (!row) return res.status(404).json({ error: "NO_MESSAGE" });
  if (row.sender_id !== me) return res.status(403).json({ error: "NOT_YOURS", message: "You can only delete your own messages." });
  await q(`UPDATE dm_messages SET deleted_at = now(), body = NULL, media = NULL WHERE id = $1`, [id]);
  res.json({ ok: true, id, deleted: true });
}));

/* =============================================================================
 *  MUSTERCHAT CALLING — WebRTC signaling relay (staff↔staff). The two peers
 *  exchange invite / offer / answer / ICE / hangup through these rows, polled
 *  by the client, so a real peer-to-peer audio/video call connects with just a
 *  public STUN server — no dedicated signaling server needed.
 * ========================================================================== */
// 1:1 kinds + group-mesh kinds (ginvite = ring a member into a group call;
// gjoin/gpresence = mesh roster discovery; gleave = a member left the room).
const CALL_SIGNAL_KINDS = new Set([
  // "accept" was in this allowlist but is never sent or handled — accepting a
  // call emits "answer" (see callManager.accept). Dropped 2026-07-28.
  "invite", "offer", "answer", "ice", "reject", "hangup", "busy",
  "ginvite", "gjoin", "gpresence", "gleave",
]);

// POST /api/calls/signal — relay one signal to a peer (another staff account).
router.post("/api/calls/signal", requireAuth(), express.json({ limit: "1mb" }), wrap(async (req, res) => {
  await ensureReady();
  const { callId, toId, kind, payload = null, mode = null } = req.body || {};
  if (!callId || !toId || !CALL_SIGNAL_KINDS.has(kind)) return res.status(400).json({ error: "BAD_SIGNAL" });
  if (toId === req.account.id) return res.status(400).json({ error: "BAD_SIGNAL", message: "You can't call yourself." });
  const peer = (await q(`SELECT id FROM accounts WHERE id = $1`, [toId])).rows[0];
  if (!peer) return res.status(404).json({ error: "NO_PEER", message: "That teammate isn't reachable." });

  // Group-call signals must come from an ACTUAL member of that group (JQ,
  // 2026-07-28 pen-test finding): `ginvite`/`gjoin`/`gpresence`/`gleave` carry
  // a groupId in the payload and were relayed with no membership check at all,
  // so any account could ring anyone into a fabricated "group" and pick its
  // display name. The group-call callId is the groupId (see callManager's
  // startGroupCall), so verify against whichever the client supplied.
  if (kind.startsWith("g")) {
    const gid = payload?.groupId || callId;
    if (!gid || !(await isGroupMember(gid, req.account.id))) {
      return res.status(403).json({ error: "NOT_MEMBER", message: "You're not in that group." });
    }
    // Never trust a client-supplied group NAME — read the real one, so a ring
    // can't be labelled with attacker-chosen text.
    const g = (await q(`SELECT name FROM chat_groups WHERE id = $1`, [gid])).rows[0];
    if (g && payload && typeof payload === "object") payload.groupName = g.name;
  }

  // Cap the relayed payload. It's WebRTC SDP/ICE (a few KB at most); without a
  // bound, `call_signals` doubles as a 1MB-per-row scratch store any two
  // accounts could stuff arbitrary data into.
  const payloadText = payload ? JSON.stringify(payload) : null;
  if (payloadText && payloadText.length > 64 * 1024) {
    return res.status(413).json({ error: "PAYLOAD_TOO_LARGE", message: "Signal payload too large." });
  }
  await q(
    `INSERT INTO call_signals (id, call_id, from_id, from_name, to_id, kind, payload, mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), callId, req.account.id, req.account.name || req.account.username, toId, kind, payloadText, mode]
  );
  res.json({ ok: true });
}));

// GET /api/calls/poll?since=ISO — signals addressed to me since a timestamp.
router.get("/api/calls/poll", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const since = req.query.since ? new Date(req.query.since.toString()) : new Date(Date.now() - 20000);
  const rows = (await q(
    `SELECT id, call_id, from_id, from_name, kind, payload, mode, created_at
       FROM call_signals WHERE to_id = $1 AND created_at > $2 ORDER BY created_at`,
    [req.account.id, since.toISOString()]
  )).rows;
  // Opportunistic cleanup so the relay table never grows unbounded.
  q(`DELETE FROM call_signals WHERE created_at < now() - interval '5 minutes'`).catch(() => {});
  res.json({
    now: new Date().toISOString(),
    meId: req.account.id, // lets the client know its own id (needed to order WebRTC mesh offers)
    signals: rows.map((r) => ({
      id: r.id, callId: r.call_id, fromId: r.from_id, fromName: r.from_name,
      kind: r.kind, payload: r.payload ? JSON.parse(r.payload) : null, mode: r.mode, at: r.created_at,
    })),
  });
}));

/* =============================================================================
 *  MUSTERCHAT GROUPS — group chats. Messages reuse dm_messages with
 *  convo_key = 'g:<groupId>' (recipient_kind 'group'), so all the media/kind
 *  handling is shared; only membership lives in its own tables.
 * ========================================================================== */
async function isGroupMember(groupId, accountId) {
  return (await q(`SELECT 1 FROM chat_group_members WHERE group_id = $1 AND account_id = $2`, [groupId, accountId])).rows.length > 0;
}

// POST /api/groups — create a group (creator + chosen staff members).
router.post("/api/groups", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id;
  const name = (req.body?.name || "").toString().trim();
  const memberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  if (!name) return res.status(400).json({ error: "NO_NAME", message: "Give the group a name." });
  const ids = Array.from(new Set([me, ...memberIds])).filter(Boolean);
  const valid = (await q(`SELECT id FROM accounts WHERE id = ANY($1)`, [ids])).rows.map((r) => r.id);
  if (valid.length < 2) return res.status(400).json({ error: "TOO_FEW", message: "Add at least one other member." });
  const id = randomUUID();
  await q(`INSERT INTO chat_groups (id, name, created_by) VALUES ($1,$2,$3)`, [id, name, me]);
  for (const aid of valid) await q(`INSERT INTO chat_group_members (group_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, aid]);
  // createdByMe (not the raw account id — the frontend's cached session has no
  // account id to compare against, only staffId/username; computing the flag
  // server-side sidesteps that entirely) drives whether the Delete button
  // shows at all in GroupThread.jsx.
  res.json({ group: { id, name, memberCount: valid.length, createdByMe: true } });
}));

// GET /api/groups — groups I'm in, with member count + last-message preview.
router.get("/api/groups", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id;
  const groups = (await q(
    `SELECT g.id, g.name, g.created_by,
            (SELECT COUNT(*)::int FROM chat_group_members m WHERE m.group_id = g.id) AS member_count
       FROM chat_groups g
       JOIN chat_group_members mine ON mine.group_id = g.id AND mine.account_id = $1
      ORDER BY g.created_at DESC`, [me]
  )).rows;
  const out = [];
  for (const g of groups) {
    const last = (await q(`SELECT sender_id, kind, body, created_at, deleted_at FROM dm_messages WHERE convo_key = $1 ORDER BY created_at DESC LIMIT 1`, [`g:${g.id}`])).rows[0];
    out.push({
      id: g.id, name: g.name, memberCount: g.member_count, createdByMe: g.created_by === me,
      lastMessage: last ? previewOf(last) : null, lastAt: last?.created_at || null,
      lastMine: last ? last.sender_id === me : false,
    });
  }
  out.sort((a, b) => (a.lastAt && b.lastAt) ? new Date(b.lastAt) - new Date(a.lastAt) : a.lastAt ? -1 : b.lastAt ? 1 : a.name.localeCompare(b.name));
  res.json({ groups: out });
}));

// GET /api/groups/:id/thread — messages with sender names.
router.get("/api/groups/:id/thread", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id, gid = req.params.id;
  if (!(await isGroupMember(gid, me))) return res.status(403).json({ error: "NOT_MEMBER" });
  const g = (await q(`SELECT id, name, created_by FROM chat_groups WHERE id = $1`, [gid])).rows[0];
  if (!g) return res.status(404).json({ error: "NO_GROUP" });
  const memberCount = (await q(`SELECT COUNT(*)::int AS n FROM chat_group_members WHERE group_id = $1`, [gid])).rows[0]?.n || 0;
  const rows = (await q(
    `SELECT d.id, d.sender_id, a.name AS sender_name, d.kind, d.body, d.media, d.created_at, d.read_at, d.edited_at, d.deleted_at
       FROM dm_messages d LEFT JOIN accounts a ON a.id = d.sender_id
      WHERE d.convo_key = $1 ORDER BY d.created_at`, [`g:${gid}`]
  )).rows;
  // Opening the thread marks the group read for me → clears the unread badge.
  await q(
    `INSERT INTO chat_group_reads (group_id, account_id, last_read_at) VALUES ($1, $2, now())
     ON CONFLICT (group_id, account_id) DO UPDATE SET last_read_at = now()`,
    [gid, me]
  );
  const mapRow = mapMessageRow(me);
  res.json({
    group: { id: g.id, name: g.name, memberCount, createdByMe: g.created_by === me },
    messages: rows.map((m) => ({ ...mapRow(m), sender: m.sender_name || "?" })),
  });
}));

// POST /api/groups/:id/messages — send to the group.
router.post("/api/groups/:id/messages", requireAuth(), express.json({ limit: "16mb" }), wrap(async (req, res) => {
  await ensureReady();
  const me = req.account.id, gid = req.params.id;
  if (!(await isGroupMember(gid, me))) return res.status(403).json({ error: "NOT_MEMBER" });
  const { kind = "text", body = null, media = null } = req.body || {};
  if (!MSG_KINDS.has(kind)) return res.status(400).json({ error: "BAD_KIND" });
  if ((kind === "text" || kind === "sticker") && !String(body || "").trim() && !media) return res.status(400).json({ error: "EMPTY" });
  // MAX_BODY was enforced on the DM path and the edit path but NOT here
  // (2026-07-28 audit) — a group member could store a ~16MB text body, capped
  // only by the express JSON limit.
  if (body && String(body).length > MAX_BODY) return res.status(413).json({ error: "BODY_TOO_LONG" });
  if (media && String(media).length > MAX_MEDIA) return res.status(413).json({ error: "MEDIA_TOO_LARGE" });
  if (!validMedia(kind, media)) return res.status(400).json({ error: "BAD_MEDIA", message: "Attachments must be inline media of the right type." });
  if (!throttleSend(me, !!media)) return res.status(429).json({ error: "TOO_FAST", message: "Slow down a moment — too many messages at once." });
  const id = randomUUID();
  await q(`INSERT INTO dm_messages (id, convo_key, sender_id, recipient_kind, recipient_id, kind, body, media)
           VALUES ($1,$2,$3,'group',$4,$5,$6,$7)`, [id, `g:${gid}`, me, gid, kind, body, media]);
  res.json({ message: { id, kind, body, media, at: new Date().toISOString(), mine: true, sender: req.account.name || req.account.username } });
}));

// GET /api/groups/:id/members
router.get("/api/groups/:id/members", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const gid = req.params.id;
  if (!(await isGroupMember(gid, req.account.id))) return res.status(403).json({ error: "NOT_MEMBER" });
  const rows = (await q(`SELECT a.id, a.name, a.username FROM chat_group_members m JOIN accounts a ON a.id = m.account_id WHERE m.group_id = $1 ORDER BY a.name`, [gid])).rows;
  res.json({ members: rows.map((r) => ({ id: r.id, name: r.name || r.username })) });
}));

// PATCH /api/groups/:id — rename and/or add/remove members (2026-07-31, "allow
// me to edit and delete the groupchat"). Any current member can edit — this is
// an internal staff tool, not a public chat app, so there's no separate
// "admin" concept per group; deleting the whole group is more sensitive and
// stays creator-only below.
router.patch("/api/groups/:id", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  const gid = req.params.id;
  const me = req.account.id;
  if (!(await isGroupMember(gid, me))) return res.status(403).json({ error: "NOT_MEMBER" });
  const g = (await q(`SELECT id, name, created_by FROM chat_groups WHERE id = $1`, [gid])).rows[0];
  if (!g) return res.status(404).json({ error: "NO_GROUP" });

  if (typeof req.body?.name === "string") {
    const name = req.body.name.trim();
    if (!name) return res.status(400).json({ error: "NO_NAME", message: "Give the group a name." });
    await q(`UPDATE chat_groups SET name = $2 WHERE id = $1`, [gid, name]);
  }

  const addIds = Array.isArray(req.body?.addMemberIds) ? req.body.addMemberIds : [];
  if (addIds.length) {
    const valid = (await q(`SELECT id FROM accounts WHERE id = ANY($1)`, [addIds])).rows.map((r) => r.id);
    for (const aid of valid) await q(`INSERT INTO chat_group_members (group_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [gid, aid]);
  }

  const removeIds = Array.isArray(req.body?.removeMemberIds) ? req.body.removeMemberIds : [];
  if (removeIds.length) {
    // Leave at least 2 members (creator + one other) — a "group" of one isn't
    // a group anymore, and it'd otherwise strand the thread with no one able
    // to message it.
    const countRow = (await q(`SELECT COUNT(*)::int AS n FROM chat_group_members WHERE group_id = $1`, [gid])).rows[0];
    const remaining = (countRow?.n || 0) - removeIds.length;
    if (remaining < 2) return res.status(400).json({ error: "TOO_FEW", message: "A group needs at least 2 members." });
    await q(`DELETE FROM chat_group_members WHERE group_id = $1 AND account_id = ANY($2)`, [gid, removeIds]);
  }

  const memberCount = (await q(`SELECT COUNT(*)::int AS n FROM chat_group_members WHERE group_id = $1`, [gid])).rows[0]?.n || 0;
  const name = (await q(`SELECT name FROM chat_groups WHERE id = $1`, [gid])).rows[0]?.name;
  res.json({ group: { id: gid, name, memberCount, createdByMe: g.created_by === me } });
}));

// DELETE /api/groups/:id — creator-only (2026-07-31): unlike renaming/
// membership, deleting the whole group (and its message history for
// everyone) is irreversible, so it's restricted to whoever made it rather
// than any member.
router.delete("/api/groups/:id", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const gid = req.params.id;
  const g = (await q(`SELECT id, created_by FROM chat_groups WHERE id = $1`, [gid])).rows[0];
  if (!g) return res.status(404).json({ error: "NO_GROUP" });
  if (g.created_by !== req.account.id) return res.status(403).json({ error: "NOT_CREATOR", message: "Only the person who created this group can delete it." });
  // dm_messages has no FK to chat_groups (convo_key is a plain string shared
  // with 1:1 DMs), so it isn't covered by chat_groups' ON DELETE CASCADE —
  // clean it up explicitly or the group's messages would be orphaned forever.
  await q(`DELETE FROM dm_messages WHERE convo_key = $1`, [`g:${gid}`]);
  await q(`DELETE FROM chat_groups WHERE id = $1`, [gid]);
  res.json({ deleted: true });
}));

export default router;

/* ---- Exposed for unit testing (tests/vance/) ----------------------------- *
 * These are the pure, side-effect-free helpers behind document parsing and the
 * confirm-time junk guard. They're exported here so the test suite can exercise
 * them directly without spinning up the HTTP layer or a database. The live app
 * only ever consumes the router (default export above). */
export {
  extractRecords,
  cleanName,
  dedupeByName,
  preferRomanised,
  finalizeRecords,
  toRow,
  isPlausibleDelegate,
  answerLocally,
  computeRisk,
  checkPassportExpiry,
  convoKey,
};
