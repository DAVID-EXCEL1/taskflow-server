/**
 * Keeps us inside the email provider's plan limits (Resend free plan: 100 emails a day, 3,000 a month - change with
 * EMAIL_DAILY_LIMIT / EMAIL_MONTHLY_LIMIT when you upgrade).
 *  - "transactional" emails (confirm your email, reset password, security alerts) may use everything.
 *  - "notification" emails (reminders, daily summary) may only use 70% of it, so sign-ups and password resets always have room.
 *  - Each person gets at most EMAIL_PER_USER_DAILY (default 8) notification emails a day.
 * Counters live in the same small collection as the AI counters and delete themselves after 45 days.
 */
const AiUsage = require('../models/AiUsage');
const int = (v, d) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : d; };
const limits = () => ({ day: int(process.env.EMAIL_DAILY_LIMIT, 100), month: int(process.env.EMAIL_MONTHLY_LIMIT, 3000), perUser: int(process.env.EMAIL_PER_USER_DAILY, 8), share: 0.7 });
const dayKey = () => new Date().toISOString().slice(0, 10);
const monthKey = () => new Date().toISOString().slice(0, 7);

async function bump(key, period, limit) {
  if (!(limit > 0)) return false;
  try { return !!(await AiUsage.findOneAndUpdate({ key, day: period, count: { $lt: limit } }, { $inc: { count: 1 } }, { upsert: true, new: true })); }
  catch (e) { if (e.code === 11000) return false; throw e; } // duplicate key = the counter is already at its limit
}
const dec = (key, period) => AiUsage.updateOne({ key, day: period, count: { $gt: 0 } }, { $inc: { count: -1 } }).catch(() => {});

async function reserve(kind, userId) {
  const l = limits(); const cap = (n) => (kind === 'notification' ? Math.floor(n * l.share) : n);
  const d = dayKey(); const m = monthKey();
  if (!(await bump('mail:d', d, cap(l.day)))) return false;
  if (!(await bump('mail:m', m, cap(l.month)))) { await dec('mail:d', d); return false; }
  if (kind === 'notification' && userId && !(await bump(`mail:u:${userId}`, d, l.perUser))) { await dec('mail:d', d); await dec('mail:m', m); return false; }
  return true;
}
// The email could not be sent: give the allowance back.
async function refund(kind, userId) { await dec('mail:d', dayKey()); await dec('mail:m', monthKey()); if (kind === 'notification' && userId) await dec(`mail:u:${userId}`, dayKey()); }
async function usage() {
  const [d, m] = await Promise.all([AiUsage.findOne({ key: 'mail:d', day: dayKey() }).lean(), AiUsage.findOne({ key: 'mail:m', day: monthKey() }).lean()]);
  const l = limits(); return { today: d?.count || 0, month: m?.count || 0, dayLimit: l.day, monthLimit: l.month };
}
module.exports = { reserve, refund, usage, limits };
