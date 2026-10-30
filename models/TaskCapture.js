const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  source: { type: String, enum: ['email', 'whatsapp', 'shortcut', 'voice', 'manual'], required: true },
  sourceId: { type: String, sparse: true, unique: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  content: { type: String, trim: true, maxlength: 10000 },
}, { timestamps: true });

schema.index({ user: 1, createdAt: -1 });
module.exports = mongoose.model('TaskCapture', schema);
