const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  phone: { type: String, unique: true, sparse: true },
  linkedAt: Date,
  pairingHash: String,
  pairingExpiresAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('WhatsAppLink', schema);
