/**
 * Business plans are priced by team size, so the app must know how many people an organization has and how many it has paid for.
 * "People" = active users in the organization (the owner counts; deactivated members do not).
 */
const User = require('../models/User');
const Invitation = require('../models/Invitation');
const Organization = require('../models/Organization');
const Subscription = require('../models/Subscription');
const AppError = require('../utils/AppError');
const pricing = require('./pricingService');
const { SUB_STATUS } = require('../config/constants');

async function seatInfo(orgId) {
  const now = new Date();
  const [used, pending, org, sub, bands] = await Promise.all([
    User.countDocuments({ organization: orgId, isActive: true }),
    Invitation.countDocuments({ organization: orgId, status: 'Pending', expiresAt: { $gt: now } }),
    Organization.findById(orgId).select('seatLimitOverride').lean(),
    Subscription.findOne({ organization: orgId, status: SUB_STATUS.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now } }).sort({ endDate: -1 }).lean(),
    pricing.getBands(),
  ]);
  const hasPlan = !!sub;
  // Plans bought before team-size pricing existed (no recorded size) are treated as the smallest band.
  const planLimit = sub ? (sub.maxMembers || bands[0].maxMembers) : 0;
  const limit = Math.max(planLimit, org?.seatLimitOverride || 0);
  return { used, pending, limit, hasPlan, remaining: Math.max(limit - used - pending, 0) };
}

// Throws when one more person would not fit. includePending counts invitations that are still open.
async function assertSeatFree(orgId, { includePending = true } = {}) {
  const s = await seatInfo(orgId);
  if (!s.hasPlan) return s; // no active plan = the account is read-only anyway
  if (s.used + (includePending ? s.pending : 0) >= s.limit) throw new AppError(`Your plan covers up to ${s.limit} people and you are at the limit. Upgrade your plan to add more people.`, 403, { code: 'SEAT_LIMIT', limit: s.limit });
  return s;
}
module.exports = { seatInfo, assertSeatFree };
