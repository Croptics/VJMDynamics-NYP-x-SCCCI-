/* =============================================================================
 *  OWNED BY:  Vance — DocuSync AI (Document Parsing) + Trip Assistant (Chatbot)
 *  PART OF:   MusterGo — Screen 4 (Document Parsing) + Screen 6 (Trip Assistant)
 *
 *  This is a self-contained feature module (same pattern as Jayden's
 *  exceptions.js and Desmond's desmond.js). It does NOT edit any of JQ's base
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
 *       or the upload is an image, it falls back to Claude VISION, which can
 *       actually "see" the document.
 *    This is why one uploader handles directories, spreadsheets AND passport
 *    scans — the strongest talking point for the Section C AI reflection.
 *
 *  Provider split:
 *    - Parsing prefers Claude when a key is set (best extraction accuracy),
 *      and falls back to local Ollama for text-based docs when it isn't.
 *      Vision (scanned docs / images) needs Claude — Ollama can't see.
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
  getMissing,
  COACHES,
} from "../data.js";
import { requireAuth, requirePermission } from "../auth.js";

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
  await q(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_acct ON chat_sessions(account_id, updated_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_chat_messages_sess ON chat_messages(session_id, created_at)`);
  console.log("  DocuSync/Assistant module ready -> delegate doc fields, chat_sessions, chat_messages");
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

    // Vision path (scanned PDF / image) — Claude only.
    if (!hasClaude) {
      job.status = "error";
      job.error = mediaType.startsWith("image/")
        ? "Reading images/scans needs Claude vision. Set ANTHROPIC_API_KEY in backend/.env."
        : "This looks like a scanned document, which needs Claude vision. Set ANTHROPIC_API_KEY, or upload a text-based PDF.";
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
  requirePermission("manageDelegates"),
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
  requirePermission("manageDelegates"),
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
  requirePermission("manageDelegates"),
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
      const delegate = await createDelegate({
        name,
        status: coachId ? "MISSING" : "UNASSIGNED",
        vip: !!r.vip,
        coachId,
      });
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
  const cols = `id, name, company, role, "coachId" AS coach_id, status, vip, qr_code`;
  const r = tripUuid
    ? await q(`SELECT ${cols} FROM delegates WHERE trip_id = $1 ORDER BY name`, [tripUuid])
    : await q(`SELECT ${cols} FROM delegates ORDER BY name`);
  const coaches = (await q(`SELECT id, label, name, city FROM coaches ORDER BY sort_order NULLS LAST, id`)).rows;
  const present = r.rows.filter((d) => d.status === "PRESENT").length;
  res.json({ delegates: r.rows, coaches, total: r.rows.length, present });
}));

// Scan → board. Resolve a QR token, mark the delegate PRESENT (+ coach), and log
// the scan. This is what the on-site scanner calls.
router.post("/api/onboarding/checkin", requireAuth(), express.json(), wrap(async (req, res) => {
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
  const d = await q(
    `SELECT dg.id, dg.name, dg."coachId" AS coach_id, dg.status, t.id AS trip_str
       FROM delegates dg
       LEFT JOIN trips t ON t.uuid_id = dg.trip_id
      WHERE dg.qr_code = $1`,
    [code]
  );
  if (!d.rows.length) return res.status(404).json({ error: "UNKNOWN_CODE", message: "That badge isn't recognised." });
  const del = d.rows[0];
  const tripId = del.trip_str || requestedTripId;
  const alreadyBoarded = del.status === "PRESENT";
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

  const counts = await q(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='PRESENT')::int AS present
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
async function buildSnapshot() {
  const [trip, dashboard, missing] = await Promise.all([getTrip(), getDashboard(), getMissing()]);

  /* Rich delegate roster (drives company/industry/VIP analytics + lookups). */
  let roster = [];
  try {
    const r = await q(`SELECT name, company, industry, role, status, vip, "coachId" AS coach_id, email
                         FROM delegates ORDER BY name`);
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
    const r = await q(`
      SELECT i.day_number, to_char(i.start_time,'HH24:MI') AS start_time, i.title, i.location, i.category
        FROM itinerary_items i
        JOIN trips t ON t.uuid_id = i.trip_id
       WHERE t.id = 't-1' AND i.day_number = $1
       ORDER BY i.sort_order, i.start_time`, [trip?.dayOf || 1]);
    itinerary = r.rows;
  } catch { /* itinerary not present yet */ }

  return {
    asOf: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    trip, kpis: dashboard.kpis,
    coaches: dashboard.coaches.length ? dashboard.coaches : COACHES,
    missing, exceptions, checkins, itinerary,
    roster, byIndustry, byCompany, vips,
  };
}

/* Short-TTL cache over buildSnapshot(). Every chat turn rebuilds the snapshot
 * from ~6 DB queries; within a few seconds the data barely changes, so caching
 * it makes rapid follow-up questions (and the fast-path below) much cheaper.
 * Writes that change the picture (confirm, check-in) call invalidateSnapshot(). */
let _snapshotCache = { at: 0, data: null };
const SNAPSHOT_TTL_MS = 5000;
async function getSnapshot() {
  const now = Date.now();
  if (_snapshotCache.data && now - _snapshotCache.at < SNAPSHOT_TTL_MS) return _snapshotCache.data;
  const data = await buildSnapshot();
  _snapshotCache = { at: now, data };
  return data;
}
function invalidateSnapshot() { _snapshotCache = { at: 0, data: null }; }

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

  const methodLine = Object.keys(snapshot.checkins.byMethod).length
    ? Object.entries(snapshot.checkins.byMethod).map(([m, n]) => `${m}: ${n}`).join(", ")
    : "no check-ins logged yet";

  const itineraryLines = snapshot.itinerary.length
    ? snapshot.itinerary.map((i) => `- ${i.start_time} ${i.title}${i.location ? ` @ ${i.location}` : ""}`).join("\n")
    : "(no itinerary items for today)";

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

Coaches:
${coachLines}

Missing delegates:
${missingLines}

Open exception tickets:
${exceptionLines}

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

function answerLocally(question, snapshot) {
  if (!snapshot) return null;
  const q = (question || "").toLowerCase().trim();
  if (!q || q.length > 200) return null; // very long → probably freeform; let the model handle it
  const {
    kpis = {}, coaches = [], missing = [], roster = [], byCompany = [],
    byIndustry = [], vips = [], exceptions = [], itinerary = [], trip = {},
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
    const statusText = named.status === "PRESENT" ? "checked in"
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

  // 4) Present / checked-in count
  if (!named && (/\b(present|checked[- ]?in|turnout|arrived)\b/.test(q) || has("here yet", "how many are here"))) {
    return `${bold(kpis.present)} of ${bold(kpis.total)} delegates are checked in — ${kpis.missing} still missing, ${kpis.unassigned} not yet on a coach.`;
  }

  // 5) Missing (count or list)
  if (!named && has("missing", "not checked in", "not here", "haven't arrived", "havent arrived", "unaccounted", "who's left", "still to board", "not boarded")) {
    if (asksCount && !asksWho) return `${bold(kpis.missing)} delegates are missing (expected but not yet checked in).`;
    if (!missing.length) return "Nobody is currently marked missing — everyone expected is accounted for.";
    const ordered = [...missing].sort((a, b) => (b.vip ? 1 : 0) - (a.vip ? 1 : 0));
    const lines = ordered.slice(0, 15).map((m) => `- ${m.name}${m.vip ? " (VIP)" : ""}${m.coach ? ` · ${m.coach}` : ""}`);
    const more = missing.length > 15 ? `\n…and ${missing.length - 15} more.` : "";
    return `${bold(missing.length)} missing:\n${lines.join("\n")}${more}`;
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
    const lines = vips.slice(0, 15).map((v) => `- ${v.name}${v.company ? ` · ${v.company}` : ""} — ${v.status === "PRESENT" ? "checked in" : v.status === "MISSING" ? "missing" : "not on a coach"}`);
    const head = `${bold(vips.length)} VIP${vips.length > 1 ? "s" : ""}${missingVips.length ? `, ${bold(missingVips.length)} still missing` : ""}:`;
    return `${head}\n${lines.join("\n")}`;
  }

  // 11) Open exception tickets
  if (has("exception", "issue", "problem", "ticket", "incident", "anything wrong", "any issues")) {
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

  // 13) Risk / "who should I worry about" — a computed priority list
  if (has("worry", "worried", "concern", "risk", "chase", "priorit", "attention", "watch", "focus on", "urgent", "trouble")) {
    const missingVips = missing.filter((m) => m.vip);
    const critical = exceptions.filter((e) => (e.priority || "").toUpperCase() === "CRITICAL");
    const topMissingCoach = [...coaches]
      .map((c) => ({ label: `${c.name}${c.city ? ` (${c.city})` : ""}`, v: Number(c.missing ?? 0) }))
      .sort((a, b) => b.v - a.v)[0];
    const lines = [];
    if (missingVips.length) lines.push(`- ${bold(missingVips.length)} VIP${missingVips.length > 1 ? "s" : ""} still missing: ${missingVips.map((m) => m.name).join(", ")}`);
    if (critical.length) lines.push(`- ${bold(critical.length)} critical exception${critical.length > 1 ? "s" : ""}: ${critical.map((e) => e.type + (e.delegate ? ` (${e.delegate})` : "")).join("; ")}`);
    if (topMissingCoach && topMissingCoach.v > 0) lines.push(`- ${topMissingCoach.label} has the most missing (${bold(topMissingCoach.v)})`);
    if (!lines.length) return `Nothing urgent right now — no missing VIPs and no critical exceptions.${kpis.missing ? ` ${kpis.missing} delegates are still to check in.` : " Everyone's accounted for."}`;
    return `Here's what to watch right now:\n${lines.join("\n")}`;
  }

  return null; // no confident match → let the model answer
}

async function answer(messages, lang) {
  const snapshot = await getSnapshot();
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
  const e = new Error("The AI assistant isn't running. Start Ollama (it should be running in the background), or ask an admin to set ANTHROPIC_API_KEY in backend/.env.");
  e.status = 503;
  throw e;
}

/* ---- Stateless chat (mobile) -------------------------------------------- */
router.post("/api/chat/messages", requireAuth(), express.json(), wrap(async (req, res) => {
  await ensureReady();
  try {
    const reply = await answer(req.body?.messages, req.body?.lang);
    res.json({ reply: { content: reply.content }, source: reply.source });
  } catch (err) {
    res.status(err.status || 500).json({ error: "ASSISTANT_ERROR", message: err.message });
  }
}));

/* ---- Saved chat history (desktop sidebar) -------------------------------- */
router.get("/api/chat/sessions", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const r = await q(`
    SELECT s.id, s.title, s.updated_at, s.pinned,
           (SELECT COUNT(*)::int FROM chat_messages m WHERE m.session_id = s.id) AS message_count
      FROM chat_sessions s
     WHERE s.account_id = $1
     ORDER BY s.pinned DESC, s.updated_at DESC LIMIT 50`, [req.account.id]);
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
  await q(`INSERT INTO chat_sessions (id, account_id, title) VALUES ($1, $2, 'New chat')`, [id, req.account.id]);
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
  const owned = await q(`SELECT id, title FROM chat_sessions WHERE id = $1 AND account_id = $2`, [sessionId, req.account.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  const userText = (req.body?.content || "").toString().trim();
  if (!userText) return res.status(400).json({ error: "EMPTY", message: "Type a question first." });

  const prior = await q(`SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
  const history = [...prior.rows, { role: "user", content: userText }];
  let reply;
  try {
    reply = await answer(history, req.body?.lang);
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
  const owned = await q(`SELECT id, title FROM chat_sessions WHERE id = $1 AND account_id = $2`, [sessionId, req.account.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: "NOT_FOUND" });
  const userText = (req.body?.content || "").toString().trim();
  if (!userText) return res.status(400).json({ error: "EMPTY", message: "Type a question first." });

  const prior = await q(`SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
  const priorRows = prior.rows;
  const history = normaliseHistory([...priorRows, { role: "user", content: userText }]);
  const snapshot = await getSnapshot();
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
        const r = await answer([...priorRows, { role: "user", content: userText }], req.body?.lang);
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
  const owned = await q(`SELECT id, title FROM chat_sessions WHERE id = $1 AND account_id = $2`, [sessionId, req.account.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: "NOT_FOUND" });

  const msgs = (await q(`SELECT id, role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at`, [sessionId])).rows;
  // Remove the most recent assistant message (the one being regenerated).
  let lastA = -1;
  for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === "assistant") { lastA = i; break; } }
  if (lastA >= 0) { await q(`DELETE FROM chat_messages WHERE id = $1`, [msgs[lastA].id]); msgs.splice(lastA, 1); }
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
    return res.status(400).json({ error: "NOTHING_TO_REGENERATE", message: "There's no question to regenerate." });
  }

  const history = normaliseHistory(msgs);
  const snapshot = await getSnapshot();
  const system = buildSystemPrompt(snapshot, req.body?.lang === "zh" ? "zh" : "en");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let full = await ollamaStream(history, system, (tok) => sse({ token: tok }));
  if (full == null) {
    try { const r = await answer(msgs, req.body?.lang); full = r.content; sse({ token: full }); }
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
  const r = await q(`
    SELECT d.name, d.company, d.role, d.industry, d.status, d.vip, d.email,
           c.name AS coach, c.city AS coach_city
      FROM delegates d
      LEFT JOIN coaches c ON c.id = d."coachId"
     ORDER BY d.name`);
  res.json({ delegates: r.rows });
}));

router.delete("/api/chat/sessions/:id", requireAuth(), wrap(async (req, res) => {
  await ensureReady();
  const r = await q(`DELETE FROM chat_sessions WHERE id = $1 AND account_id = $2`, [req.params.id, req.account.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: "NOT_FOUND" });
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
};
