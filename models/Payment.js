const mongoose = require('mongoose');
const { PAYMENT_STATUS } = require('../config/constants');
const schema = new mongoose.Schema(
  {
    plan: { type: String, enum: ['INDIVIDUAL', 'BUSINESS'], required: true },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },
    reference: { type: String, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    // `filename` is legacy (old disk storage). New uploads store the bytes in the ProofFile collection.
    proof: { filename: String, originalName: String, mimeType: String, size: Number, cloudinary: { publicId: String, resourceType: String, format: String } },
    status: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.PENDING, index: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    rejectionReason: String,
  },
  { timestamps: true }
);
module.exports = mongoose.model('Payment', schema);
