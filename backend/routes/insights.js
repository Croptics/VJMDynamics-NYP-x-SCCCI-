/**
 * AI Analytics Insights — POST /api/trips/:id/insights
 *
 * Powers the "Generate Insights" button on the Dashboard's Analytics tab
 * (a one-shot report generator, not a chatbot). Sends a single, controlled
 * snapshot of the trip/kpis/coach breakdown/missing list to an LLM and asks
 * for a short written summary. No conversation history, no arbitrary page
 * content — only this developer-authored snapshot ever leaves the server.
 *
 * Tries a local Ollama server first (free, no API key, no data leaves the
 * machine) and falls back to the Anthropic API if Ollama isn't running.
 * Both are optional and lazily checked — a missing/unreachable Ollama or a
 * missing ANTHROPIC_API_KEY can never crash server startup, only shape the
 * response of this one route.
 */

import { Router } from "express";
import { getTrip, getDashboard, getMissing, COACHES } from "../data.js";
import { requireAuth } from "../auth.js";

const router = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function buildPrompt(snapshot, lang) {
  const languageInstruction =
    lang === "zh"
      ? "Write your entire response in Simplified Chinese (简体中文)."
      : "Write your entire response in English.";

  return `You are generating a short internal briefing for SCCCI delegation staff, based on a live attendance snapshot taken at ${snapshot.asOf}.

Trip: ${snapshot.trip.name} (${snapshot.trip.dateRange}), Day ${snapshot.trip.dayOf} of ${snapshot.trip.totalDays}. Local time ${snapshot.trip.localTime}. Departs in ${snapshot.trip.departsIn}.

Totals: ${snapshot.kpis.total} delegates · ${snapshot.kpis.present} present · ${snapshot.kpis.missing} missing · ${snapshot.kpis.unassigned} unassigned.

Coaches:
${snapshot.coaches.map((c) => `- ${c.name} (${c.city}): ${c.boarded}/${c.capacity} boarded, ${c.missing} missing`).join("\n")}

Missing delegates (${snapshot.missing.length}):
${snapshot.missing.length === 0 ? "(none)" : snapshot.missing.map((m) => `- ${m.name}${m.vip ? " (VIP)" : ""} · ${m.coach} · last seen: ${m.lastSeen || "unknown"}`).join("\n")}

Write 3-5 short numbered points (one per line, formatted like "1. ...", "2. ...") covering: overall attendance health, which coach(es) need attention, and anything notable about VIP delegates. Each point should be a single, direct sentence and include the specific numbers it's based on (counts, coach names) rather than vague language. No markdown, no headers, no intro/closing sentence — just the numbered points. Be direct and factual — this is read by busy staff, not a general audience. ${languageInstruction}`;
}

/** Try a local Ollama server. Returns the generated text, or null if Ollama isn't reachable. */
async function tryOllama(prompt) {
  const base = process.env.OLLAMA_HOST || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.2";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000); // local CPU inference can be slow
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.message?.content?.trim();
    return text || null;
  } catch {
    return null; // Ollama not installed/running — fall back to Anthropic
  } finally {
    clearTimeout(timer);
  }
}

/** Call the Anthropic API. Throws on failure; caller handles the error response. */
async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

  const response = await anthropic.messages.create({
    model,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  return (response.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

router.post(
  "/api/trips/:id/insights",
  requireAuth(),
  wrap(async (req, res) => {
    const [trip, dashboard, missing] = await Promise.all([getTrip(), getDashboard(), getMissing()]);
    const snapshot = {
      asOf: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      trip,
      kpis: dashboard.kpis,
      coaches: dashboard.coaches.length ? dashboard.coaches : COACHES,
      missing,
    };
    const lang = req.body?.lang === "zh" ? "zh" : "en";
    const prompt = buildPrompt(snapshot, lang);

    // 1. Try local Ollama first — free, no key, nothing leaves the machine.
    const ollamaText = await tryOllama(prompt);
    if (ollamaText) {
      return res.json({ insights: ollamaText, asOf: snapshot.asOf, source: "ollama" });
    }

    // 2. Fall back to the Anthropic API.
    try {
      const anthropicText = await callAnthropic(prompt);
      if (anthropicText) {
        return res.json({ insights: anthropicText, asOf: snapshot.asOf, source: "anthropic" });
      }
    } catch (err) {
      console.error("Anthropic insights call failed:", err.message || err);
      return res.status(502).json({
        error: "AI_SERVICE_ERROR",
        message: "AI insights are temporarily unavailable. Please try again shortly.",
      });
    }

    // Neither Ollama nor an Anthropic key is available.
    res.status(503).json({
      error: "AI_NOT_CONFIGURED",
      message: "Install Ollama locally (free) or ask an admin to set ANTHROPIC_API_KEY in backend/.env.",
    });
  })
);

export default router;
