const mongoose = require('mongoose');
// Permanent register of accounts that were deleted (after the 30-day grace period). Holds account + billing facts only -
// never tasks, notes, passwords or 2FA secrets. Used by the Super Admin "Deleted accounts" page.
const schema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['INDIVIDUAL', 'ORGANIZATION'], required: true },
    originalUserId: { type: mongoose.Schema.Types.ObjectId, index: true, unique: true },
    originalOrganizationId: mongoose.Schema.Types.ObjectId,
    name: String,
    email: { type: String, index: true },
    phone: String,
    organization: mongoose.Schema.Types.Mixed, // { name, type, phone, address, website } for organizations
    members: [mongoose.Schema.Types.Mixed],    // { name, email, role, active, deactivatedAt, reason } at the time of deletion
    counts: mongoose.Schema.Types.Mixed,       // { tasks, teams, members }
    billing: mongoose.Schema.Types.Mixed,      // { payments, approvedTotal, subscriptions, paidUntil }
    reason: String,
    accountCreatedAt: Date,
    lastLoginAt: Date,
    requestedAt: Date,
    purgedAt: { type: Date, default: Date.now, index: true },
    purgedBy: String, // "system" or the admin's id
  },
  { timestamps: true }
);
module.exports = mongoose.model('DeletedAccount', schema);
