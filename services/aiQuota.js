const AiUsage = require('../models/AiUsage');
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const limits = () => ({ personal: num(process.env.AI_DAILY_LIMIT_PERSONAL, 5), business: num(process.env.AI_DAILY_LIMIT_BUSINESS, 10), global: num(process.env.AI_GLOBAL_DAILY_LIMIT, 120) });
const today = () => new Date().toISOString().slice(0, 10);

// Atomically add 1 if still under `limit`. Returns the new count, or null when the limit is reached.
async function bump(key, limit) {
  if (!(limit > 0)) return null; // a limit of 0 means "none" - never let the first call slip through
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

// One use comes out of: the platform-wide allowance, the team's shared daily pool (Business), AND the person's own allowance.
// If any of them is full the others are given back, so a refused attempt never costs anyone.
async function consume(userId, userLimit, org = null) {
  const g = await bump('global', limits().global);
  if (g == null) return { ok: false, why: 'global' };
  let o = null;
  if (org) {
    o = await bump(`o:${org.id}`, org.limit);
    if (o == null) { await dec('global'); return { ok: false, why: 'org' }; }
  }
  const u = await bump(`u:${userId}`, userLimit);
  if (u == null) { await dec('global'); if (org) await dec(`o:${org.id}`); return { ok: false, why: 'user' }; }
  return { ok: true, used: u, remaining: Math.min(userLimit - u, org ? org.limit - o : Infinity) };
}
const refund = async (userId, orgId) => { await dec(`u:${userId}`); await dec('global'); if (orgId) await dec(`o:${orgId}`); }; // the provider failed: nobody should lose a use
async function remaining(userId, userLimit, org = null) {
  const [u, o] = await Promise.all([usedToday(userId), org ? usedKey(`o:${org.id}`) : 0]);
  return Math.max(Math.min(userLimit - u, org ? org.limit - o : Infinity), 0);
}
async function usedKey(key) { const d = await AiUsage.findOne({ key, day: today() }).lean(); return d?.count || 0; }
async function usedToday(userId) { return usedKey(`u:${userId}`); }
module.exports = { limits, consume, refund, remaining, usedToday };
