/**
 * Provider-neutral AI connection (any "OpenAI-style" /chat/completions API: Groq, OpenRouter, Gemini's OpenAI mode,
 * Mistral, or a local Ollama). Configure with 3 values - no code change to switch provider:
 *   AI_BASE_URL  e.g. https://api.groq.com/openai/v1   (Ollama: http://localhost:11434/v1)
 *   AI_API_KEY   (not needed for a local Ollama)
 *   AI_MODEL     the model name
 *
 * It is built so AI trouble can never take the app down:
 *   - hard timeout on every call (default 12s), no automatic retries (no retry storms)
 *   - at most N calls in flight (default 4) with a short bounded queue; extra requests are refused immediately ("busy")
 *   - circuit breaker: after 5 failures in a row it stops calling the provider for 60s
 *   - admin kill switch (database) + AI_ENABLED=false (environment)
 *   - every failure becomes a friendly AiUnavailableError; callers must have a non-AI fallback
 *   - prompts, answers and the API key are never written to logs
 */
const AppError = require('../utils/AppError');
const Setting = require('../models/Setting');

class AiUnavailableError extends AppError {
  constructor(reason, message) {
    super(message || 'The AI assistant is not available right now. Everything else keeps working.', 503, { code: 'AI_UNAVAILABLE', reason });
    this.reason = reason;
  }
}

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const cfg = () => ({
  baseUrl: String(process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
  key: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || '',
  timeoutMs: num(process.env.AI_TIMEOUT_MS, 12000),
  maxConcurrent: num(process.env.AI_MAX_CONCURRENT, 4),
  maxQueue: num(process.env.AI_MAX_QUEUE, 8),
  queueWaitMs: num(process.env.AI_QUEUE_WAIT_MS, 8000),
  breakerThreshold: num(process.env.AI_BREAKER_THRESHOLD, 5),
  breakerCooldownMs: num(process.env.AI_BREAKER_COOLDOWN_MS, 60000),
});
const configured = () => { const c = cfg(); return !!(c.baseUrl && c.model); };

// "Reasoning" models (e.g. gpt-oss) spend tokens thinking before they answer. Ask for low effort and leave headroom,
// otherwise a small max_tokens is eaten by the thinking and the reply comes back empty. AI_REASONING_EFFORT=none turns this off.
function reasoningEffort() {
  const v = String(process.env.AI_REASONING_EFFORT || '').toLowerCase();
  if (v === 'none') return null;
  if (v) return v;
  return /gpt-oss/i.test(process.env.AI_MODEL || '') ? 'low' : null;
}
const REASONING_HEADROOM = 300;

// Last problem, for the admin screen only. Never contains prompts or keys.
let lastError = null;
const redact = (s) => String(s || '').replace(/(gsk_|sk-|re_|key-)[A-Za-z0-9._-]{6,}/gi, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\s+/g, ' ').slice(0, 200);
const note = (reason, status, detail) => { lastError = { reason, status: status || null, detail: detail ? redact(detail) : null, at: new Date().toISOString() }; };

/* ---- kill switch (environment + admin toggle in the database, cached 20s) ---- */
let switchCache = { at: 0, enabled: true };
async function switchOn() {
  if (String(process.env.AI_ENABLED).toLowerCase() === 'false') return false;
  if (Date.now() - switchCache.at > 20000) {
    try { const s = await Setting.findOne({ key: 'ai' }).lean(); switchCache = { at: Date.now(), enabled: s?.value?.enabled !== false }; }
    catch { /* database hiccup: keep the last known value */ }
  }
  return switchCache.enabled;
}
const setSwitch = async (enabled, userId) => {
  await Setting.findOneAndUpdate({ key: 'ai' }, { value: { enabled: !!enabled }, updatedBy: userId }, { upsert: true });
  switchCache = { at: Date.now(), enabled: !!enabled };
};

/* ---- circuit breaker ---- */
const breaker = { failures: 0, openUntil: 0 };
const failed = () => { breaker.failures++; if (breaker.failures >= cfg().breakerThreshold) breaker.openUntil = Date.now() + cfg().breakerCooldownMs; };
const succeeded = () => { breaker.failures = 0; breaker.openUntil = 0; };

/* ---- concurrency limit with a short, bounded queue ---- */
let active = 0; const waiting = [];
function acquire() {
  const c = cfg();
  if (active < c.maxConcurrent) { active++; return Promise.resolve(); }
  if (waiting.length >= c.maxQueue) return Promise.reject(new AiUnavailableError('busy', 'The AI assistant is busy. Please try again in a moment.'));
  return new Promise((resolve, reject) => {
    const entry = { resolve };
    entry.timer = setTimeout(() => { const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); reject(new AiUnavailableError('busy', 'The AI assistant is busy. Please try again in a moment.')); }, c.queueWaitMs);
    waiting.push(entry);
  });
}
function release() {
  const next = waiting.shift();
  if (next) { clearTimeout(next.timer); next.resolve(); } else active--;
}

/** Sends chat messages, returns the reply text. Throws AiUnavailableError for ANY problem. */
async function chat({ messages, maxTokens = 400, temperature = 0.3 }) {
  if (!(await switchOn())) throw new AiUnavailableError('disabled');
  if (!configured()) throw new AiUnavailableError('not_configured');
  if (Date.now() < breaker.openUntil) throw new AiUnavailableError('circuit_open');
  await acquire();
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), c.timeoutMs);
  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) },
      body: JSON.stringify({ model: c.model, messages, max_tokens: Math.min(maxTokens + (reasoningEffort() ? REASONING_HEADROOM : 0), 2000), temperature, stream: false, ...(reasoningEffort() ? { reasoning_effort: reasoningEffort() } : {}) }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      failed(); note('upstream', res.status, body?.error?.message || body?.message);
      console.error(`AI provider error: HTTP ${res.status}`);
      throw new AiUnavailableError('upstream');
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    let text = choice?.message?.content;
    if (Array.isArray(text)) text = text.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
    if (typeof text !== 'string' || !text.trim()) {
      const truncated = choice?.finish_reason === 'length';
      failed(); note(truncated ? 'truncated' : 'bad_response', null, truncated ? 'The model used all its tokens thinking and returned no text.' : `The provider returned no text (finish_reason: ${choice?.finish_reason || 'unknown'}).`);
      console.error('AI provider returned no usable text');
      throw new AiUnavailableError(truncated ? 'truncated' : 'bad_response');
    }
    succeeded(); lastError = null;
    return text.trim().slice(0, 4000);
  } catch (e) {
    if (e instanceof AiUnavailableError) throw e;
    failed();
    const timedOut = e?.name === 'AbortError';
    note(timedOut ? 'timeout' : 'network', null, timedOut ? 'No answer within the time limit.' : 'Could not reach the provider.');
    console.error(timedOut ? 'AI call timed out' : `AI call failed: ${e?.name || 'error'}`);
    throw new AiUnavailableError(timedOut ? 'timeout' : 'network');
  } finally { clearTimeout(timer); release(); }
}

const hostOf = () => { try { return new URL(cfg().baseUrl).hostname; } catch { return null; } };
async function status() {
  return {
    configured: configured(), host: hostOf(), model: cfg().model || null,
    enabled: await switchOn(),
    circuitOpen: Date.now() < breaker.openUntil, consecutiveFailures: breaker.failures,
    reasoningEffort: reasoningEffort(), lastError,
    inFlight: active, queued: waiting.length, limits: { timeoutMs: cfg().timeoutMs, maxConcurrent: cfg().maxConcurrent },
  };
}
async function testConnection() {
  const t0 = Date.now();
  const reply = await chat({ messages: [{ role: 'user', content: 'Reply with the single word: OK' }], maxTokens: 32, temperature: 0 });
  return { ok: true, ms: Date.now() - t0, reply: reply.slice(0, 40) };
}
const _reset = () => { lastError = null; breaker.failures = 0; breaker.openUntil = 0; active = 0; waiting.length = 0; switchCache = { at: 0, enabled: true }; };
module.exports = { chat, status, testConnection, setSwitch, AiUnavailableError, configured, _reset };
