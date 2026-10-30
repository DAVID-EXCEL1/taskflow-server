const mongoose = require('mongoose');
// One saved "fingerprint / face / screen-lock" login. Only the PUBLIC key is stored; the private key never leaves the person's device.
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  credentialId: { type: String, required: true, unique: true },
  publicKey: { type: String, required: true },   // base64url COSE public key
  counter: { type: Number, default: 0 },
  transports: [String],
  rpID: { type: String, required: true },        // the website address it was created for (a passkey only works there)
  name: { type: String, default: 'This device' },
  backedUp: Boolean,
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: Date,
});
module.exports = mongoose.model('Passkey', schema);
