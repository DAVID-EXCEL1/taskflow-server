const mongoose = require('mongoose');
const { SUB_STATUS } = require('../config/constants');
// One record per paid period. Renewals create a new record starting when the previous one ends.
const schema = new mongoose.Schema(
  {
    plan: { type: String, enum: ['INDIVIDUAL', 'BUSINESS'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'NGN' },
    maxMembers: Number,   // Business: the team size this period was paid for
    bandPrice: Number,    // the full price of that size (used to price an upgrade fairly)
    upgradedAt: Date,
    source: { type: String, enum: ['payment', 'admin_grant'], default: 'payment' }, // admin_grant = free days given by the owner of the platform
    grantedBy: mongoose.Schema.Types.ObjectId,
    grantReason: String,
    status: { type: String, enum: Object.values(SUB_STATUS), default: SUB_STATUS.PENDING, index: true },
    startDate: Date,
    endDate: { type: Date, index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    holder: { name: String, email: String, deleted: Boolean }, // who it belonged to, kept after the account is deleted
    remindersSent: [Number],
    expiryNotified: { type: Boolean, default: false },
  },
  { timestamps: true }
);
module.exports = mongoose.model('Subscription', schema);
