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
  if (!user.isActive) throw new AppError('This account has been deactivated. Contact support.', 403);
  if (user.passwordChangedAt && payload.iat < Math.floor(new Date(user.passwordChangedAt).getTime() / 1000)) throw new AppError('Your password was changed. Please log in again.', 401);
  if (user.organization && user.role !== ROLES.SUPER_ADMIN) {
    const org = await Organization.findById(user.organization).select('isActive').lean();
    if (org && !org.isActive) throw new AppError('This organization has been deactivated. Contact support.', 403);
  }
  req.user = user;
  next();
});

const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : next(new AppError('You do not have permission to perform this action.', 403));

// Sensitive Super Admin actions (money, payment details, account status) require 2FA to be switched on.
const requireTwoFactor = (req, res, next) =>
  req.user?.twoFactor?.enabled ? next() : next(new AppError('Set up two-factor authentication in your profile before doing this.', 403, { code: 'TWO_FA_REQUIRED' }));

module.exports = { protect, authorize, signToken, signChallenge, requireTwoFactor };
