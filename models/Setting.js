const mongoose = require('mongoose');
// Key/value platform settings. Currently holds the payment (bank) details under key "payment".
const schema = new mongoose.Schema(
  { key: { type: String, unique: true, required: true }, value: mongoose.Schema.Types.Mixed, updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } },
  { timestamps: true }
);
module.exports = mongoose.model('Setting', schema);
