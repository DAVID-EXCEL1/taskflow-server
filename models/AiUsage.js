const mongoose = require('mongoose');
// Daily AI request counters: one per user per day, plus one "global" per day to protect the shared provider allowance.
const schema = new mongoose.Schema({
  key: { type: String, required: true },   // "u:<userId>" or "global"
  day: { type: String, required: true },   // YYYY-MM-DD (UTC)
  count: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 45 * 86400 } }, // old counters delete themselves
});
schema.index({ key: 1, day: 1 }, { unique: true });
module.exports = mongoose.model('AiUsage', schema);
