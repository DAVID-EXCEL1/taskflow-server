const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  hash: { type: String, required: true, unique: true },
  label: { type: String, trim: true, maxlength: 60, default: 'Personal assistant' },
  lastUsedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('AssistantToken', schema);
