const mongoose = require('mongoose');
// Only a SHA-256 hash of the emailed token is stored, so a database leak cannot be used to reset passwords.
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }, // MongoDB deletes expired records automatically
    usedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
module.exports = mongoose.model('PasswordReset', schema);
