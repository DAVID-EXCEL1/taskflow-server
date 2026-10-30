const mongoose = require('mongoose');
// A one-time challenge for a fingerprint registration or login. Deleted when used and automatically after a few minutes.
const schema = new mongoose.Schema({
  challenge: { type: String, required: true },
  purpose: { type: String, enum: ['register', 'login'], required: true },
  user: { type: mongoose.Schema.Types.ObjectId },
  origin: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});
module.exports = mongoose.model('PasskeyChallenge', schema);
