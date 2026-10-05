const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organization = require('../models/Organization');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

// Admin sessions are shorter (12h). The challenge token only proves the password step passed; it is NOT a session.
const signToken = (id, role) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: role === ROLES.SUPER_ADMIN ? '12h' : process.env.JWT_EXPIRES_IN || '7d' });
const signChallenge = (id) => jwt.sign({ id, purpose: '2fa' }, process.env.JWT_SECRET, { expiresIn: '5m' });

const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError('Please log in to continue.', 401);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new AppError('Your session has expired. Please log in again.', 401);
  }
  if (payload.purpose) throw new AppError('Please log in to continue.', 401);
  const user = await User.findById(payload.id).lean();
  if (!user) throw new AppError('Account no longer exists.', 401);
  if (!user.isActive) {
    const byOwner = !!user.orgDeactivation?.at;
    throw new AppError(byOwner ? 'Your access was deactivated by your organization owner. Please contact them.' : 'This account has been deactivated. Contact support.', 403, { code: byOwner ? 'MEMBER_DEACTIVATED' : 'DEACTIVATED' });
  }
  if (user.passwordChangedAt && payload.iat < Math.floor(new Date(user.passwordChangedAt).getTime() / 1000)) throw new AppError('Your password was changed. Please log in again.', 401);
  if (user.organization && user.role !== ROLES.SUPER_ADMIN) {
    const org = await Organization.findById(user.organization).select('isActive deletion').lean();
    const closed = !!org?.deletion?.scheduledFor;
    // An organization in its deletion grace period is closed for members; the owner can still sign in to restore it.
    if (closed && user.role !== ROLES.ORGANIZATION_OWNER) throw new AppError('Your organization has been closed by its owner.', 403, { code: 'ORG_CLOSED' });
    if (org && !org.isActive && !closed) throw new AppError('This organization has been deactivated. Contact support.', 403);
  }
  req.user = user;
  req.deletionPending = !!user.deletion?.scheduledFor;
  next();
});

const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : next(new AppError('You do not have permission to perform this action.', 403));

// While an account is in its 30-day deletion grace period it can do nothing except look at itself and restore.
const deletionGate = (req, res, next) => {
  if (!req.deletionPending) return next();
  const allowed = (req.method === 'GET' && req.path === '/auth/me') || (req.method === 'POST' && req.path === '/account/restore');
  if (allowed) return next();
  return next(new AppError('Your account is scheduled for deletion. Restore it to continue.', 403, { code: 'PENDING_DELETION', scheduledFor: req.user.deletion.scheduledFor }));
};

// Sensitive Super Admin actions (money, payment details, account status) require 2FA to be switched on.
const requireTwoFactor = (req, res, next) =>
  req.user?.twoFactor?.enabled ? next() : next(new AppError('Set up two-factor authentication in your profile before doing this.', 403, { code: 'TWO_FA_REQUIRED' }));

module.exports = { protect, authorize, signToken, signChallenge, requireTwoFactor, deletionGate };
