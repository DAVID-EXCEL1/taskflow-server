const mongoose = require('mongoose');
// Proof-of-payment files live in MongoDB (not on the server's disk) so they survive redeploys and restarts.
// Kept in a separate collection so payment list queries never load file bytes.
const schema = new mongoose.Schema(
  {
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true },
    data: { type: Buffer, required: true },
    mimeType: { type: String, required: true },
    originalName: String,
    size: Number,
  },
  { timestamps: true }
);
module.exports = mongoose.model('ProofFile', schema);
