const AiUsage = require('../models/AiUsage');
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const limits = () => ({ personal: num(process.env.AI_DAILY_LIMIT_PERSONAL, 5), business: num(process.env.AI_DAILY_LIMIT_BUSINESS, 10), global: num(process.env.AI_GLOBAL_DAILY_LIMIT, 120) });
const today = () => new Date().toISOString().slice(0, 10);

// Atomically add 1 if still under `limit`. Returns the new count, or null when the limit is reached.
async function bump(key, limit) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const doc = await AiUsage.findOneAndUpdate({ key, day: today(), count: { $lt: limit } }, { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date() } }, { upsert: true, new: true });
      return doc.count;
    } catch (e) {
      if (e.code !== 11000) throw e; // 11000 = row exists but is already at the limit (or a first-insert race: retry once)
    }
  }
  return null;
}
const dec = (key) => AiUsage.updateOne({ key, day: today(), count: { $gt: 0 } }, { $inc: { count: -1 } });

// Takes one unit from the platform-wide daily allowance AND the user's own allowance.
async function consume(userId, userLimit) {
  const g = await bump('global', limits().global);
  if (g == null) return { ok: false, why: 'global' };
  const u = await bump(`u:${userId}`, userLimit);
  if (u == null) { await dec('global'); return { ok: false, why: 'user' }; }
  return { ok: true, used: u, remaining: userLimit - u };
}
const refund = async (userId) => { await dec(`u:${userId}`); await dec('global'); }; // the provider failed: the user should not lose a use
async function usedToday(userId) { const d = await AiUsage.findOne({ key: `u:${userId}`, day: today() }).lean(); return d?.count || 0; }
module.exports = { limits, consume, refund, usedToday };
