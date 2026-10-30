const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    phone: { type: String, trim: true },
    smsPhone: { type: String, trim: true },
    smsVerifiedAt: Date,
    smsVerification: {
      codeHash: String,
      expiresAt: Date,
      sentAt: Date,
      attempts: { type: Number, default: 0 },
      phone: String,
    },
    timezone: { type: String, default: 'Africa/Lagos' },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.INDIVIDUAL, index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    teams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
    isActive: { type: Boolean, default: true },
    deletion: { requestedAt: Date, scheduledFor: Date, reason: String, purging: Boolean, purgingAt: Date }, // set while an account is in its 30-day grace period
    // Set when an organization owner deactivates a member (the record is kept; the owner can reactivate).
    orgDeactivation: { at: Date, by: mongoose.Schema.Types.ObjectId, byName: String, reason: String },
    // Overdue reminders: off by default; the person chooses how often (minutes: 0 = off, 5, 15, 30, 60, 120) and the quiet hours.
    overdueNudge: { everyMinutes: { type: Number, default: 0 }, quietFrom: { type: Number, default: 22 }, quietTo: { type: Number, default: 7 } },
    aiOptIn: { type: Boolean, default: false },
    // Email: confirmed addresses only receive reminder emails. Google sign-in confirms the address by itself.
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: Date,
    emailVerify: { tokenHash: { type: String, index: true, sparse: true }, expiresAt: Date, sentAt: Date, sentDay: String, sentCount: Number },
    emailPrefs: { enabled: Boolean, reminders: Boolean, subscription: Boolean, overdueDigest: Boolean, assignments: Boolean, lastDigestDay: String },
    morningPlan: {
      enabled: { type: Boolean, default: false },
      time: { type: String, default: '08:00' },
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
      lastSentDay: String,
    },
    captureEmailHash: { type: String, sparse: true, unique: true },
    googleId: { type: String, index: true, sparse: true }, // consent for AI suggestions (individuals; owners set it for their organization)
    aiOptInAt: Date,
    termsAcceptedAt: Date, // when they ticked "I agree" at sign-up
    termsVersion: String,
    passwordChangedAt: Date, // sessions issued before this are rejected
    // Two-factor authentication. Secrets/recovery codes are never returned by default queries (select: false).
    twoFactor: {
      enabled: { type: Boolean, default: false },
      enabledAt: Date,
      secretEnc: { type: String, select: false },
      pendingSecretEnc: { type: String, select: false },
      recoveryHashes: { type: [String], select: false },
      lastStep: { type: Number, select: false },
      failedAttempts: { type: Number, select: false },
      lockedUntil: { type: Date, select: false },
    },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};
module.exports = mongoose.model('User', userSchema);
