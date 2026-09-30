const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { getAccess } = require('../services/subscriptionService');

/**
 * Apply to every WRITE route. Expired / unpaid accounts are read-only.
 * Super Admin bypasses. Access is derived from subscription dates on each request.
 */
const requireActiveSubscription = asyncHandler(async (req, res, next) => {
  const access = await getAccess(req.user);
  req.access = access;
  if (!access.canWrite) {
    throw new AppError(access.message || 'Your subscription is not active. Your account is read-only.', 402, { code: 'READ_ONLY', state: access.state });
  }
  next();
});
module.exports = { requireActiveSubscription };
