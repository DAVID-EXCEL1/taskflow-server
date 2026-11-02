/**
 * Small daily limits that protect you from surprise bills and abuse (SMS, voice notes, inbox items).
 * Counters share the same tiny self-cleaning collection used for the AI and email limits.
 */
const AiUsage = require('../models/AiUsage');
const day = () => new Date().toISOString().slice(0, 10);
const intEnv = (name, fallback) => { const n = Number(process.env[name]); return Number.isInteger(n) && n > 0 ? n : fallback; };
// true = one more is allowed (and has been counted); false = today's limit is reached.
async function take(key, limit) {
  if (!(limit > 0)) return false;
  try { return !!(await AiUsage.findOneAndUpdate({ key, day: day(), count: { $lt: limit } }, { $inc: { count: 1 } }, { upsert: true, new: true })); }
  catch (e) { if (e.code === 11000) return false; throw e; } // duplicate key = the counter is already at its limit
}
const give = (key) => AiUsage.updateOne({ key, day: day(), count: { $gt: 0 } }, { $inc: { count: -1 } }).catch(() => {});
module.exports = { take, give, intEnv };
