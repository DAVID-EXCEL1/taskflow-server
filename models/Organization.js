const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, trim: true, default: 'Company' },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    website: { type: String, trim: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    isActive: { type: Boolean, default: true },
    deletion: { requestedAt: Date, scheduledFor: Date, reason: String, purging: Boolean, purgingAt: Date }, // set while an account is in its 30-day grace period
    seatLimitOverride: Number, // set by the platform admin for custom deals (e.g. teams above the largest band)
    aiEnabled: { type: Boolean, default: false }, // set by the owner; covers the whole organization
  },
  { timestamps: true }
);
module.exports = mongoose.model('Organization', schema);
