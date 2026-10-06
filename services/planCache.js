/**
 * Plan my day: reuse the AI suggestion for a short time when nothing has changed, so pressing the button again
 * (or Refresh) does not spend another AI use.
 *  - One remembered answer per user, valid for AI_PLAN_CACHE_MINUTES (default 15; 0 turns this off).
 *  - It is only reused when the tasks the AI would see are EXACTLY the same (titles, dates, priorities, statuses, which
 *    day it is). Add, edit or finish a task - or let a deadline pass - and the next press asks the AI again.
 *  - Kept in this server's memory only (nothing is written to the database); a restart simply forgets it.
 */
const crypto = require('crypto');
const MAX_ENTRIES = 5000;
const store = new Map(); // userId -> { fp, summary, at }
const ttlMs = () => { const n = Number(process.env.AI_PLAN_CACHE_MINUTES); return (Number.isFinite(n) && n >= 0 ? n : 15) * 60000; };

// Fingerprint of exactly what the AI would be shown.
const fingerprint = (plan) => crypto.createHash('sha256').update(JSON.stringify([
  plan.today,
  plan.sections.map((s) => [s.key, s.items.map((i) => [i.id, i.title, i.priority, i.status, i.dueDate ? new Date(i.dueDate).toISOString() : null, !!i.dueHasTime])]),
])).digest('hex');

function get(userId, fp, now = Date.now()) {
  const ttl = ttlMs(); if (!ttl) return null;
  const k = String(userId); const e = store.get(k);
  if (!e) return null;
  if (now - e.at > ttl) { store.delete(k); return null; }
  return e.fp === fp ? { summary: e.summary, minutesAgo: Math.floor((now - e.at) / 60000) } : null;
}
function set(userId, fp, summary, now = Date.now()) {
  if (!ttlMs()) return;
  const k = String(userId); store.delete(k); store.set(k, { fp, summary, at: now });
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value); // forget the oldest first
}
module.exports = { fingerprint, get, set, _clear: () => store.clear(), _size: () => store.size };
