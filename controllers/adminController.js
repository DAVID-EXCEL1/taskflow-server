const User = require('../models/User');
const Organization = require('../models/Organization');
const Task = require('../models/Task');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const { escapeRegex, pageParams } = require('../utils/helpers');
const { getAccess } = require('../services/subscriptionService');
const activity = require('../services/activityService');

exports.listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { role: { $ne: ROLES.SUPER_ADMIN } };
  if (req.query.role && Object.values(ROLES).includes(req.query.role)) filter.role = req.query.role;
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;
  if (req.query.organization) filter.organization = req.query.organization;
  if (req.query.search) { const r = new RegExp(escapeRegex(req.query.search), 'i'); filter.$or = [{ name: r }, { email: r }]; }

  const [users, total] = await Promise.all([
    User.find(filter).populate('organization', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  // Attach subscription summary (Individuals hold their own; org users show the org's)
  const now = new Date();
  const subs = await Subscription.find({ status: 'Active', $or: [{ user: { $in: users.map((u) => u._id) } }, { organization: { $in: users.map((u) => u.organization?._id).filter(Boolean) } }] }).select('user organization startDate endDate').lean();
  const data = users.map((u) => {
    const mine = subs.filter((s) => (s.user && String(s.user) === String(u._id)) || (s.organization && u.organization && String(s.organization) === String(u.organization._id)));
    const end = mine.reduce((m, s) => (!m || s.endDate > m ? s.endDate : m), null);
    const current = mine.some((s) => s.startDate <= now && s.endDate > now);
    return { ...u, subscriptionStatus: current ? 'Active' : end ? 'Expired' : 'None', expiresAt: end };
  });
  // subscription status filter is applied post-query on the page (kept simple for v1)
  const sf = req.query.subscription;
  res.json({ success: true, data: sf ? data.filter((d) => d.subscriptionStatus === sf) : data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

exports.getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate('organization', 'name type owner').populate('teams', 'name').lean();
  if (!user || user.role === ROLES.SUPER_ADMIN) throw new AppError('User not found.', 404);
  const subject = user.role === ROLES.INDIVIDUAL ? { user: user._id } : user.organization ? { organization: user.organization._id } : { _id: null };
  const [access, subscriptions, payments, taskCount] = await Promise.all([
    getAccess(user),
    Subscription.find(subject).sort({ createdAt: -1 }).lean(),
    Payment.find(subject).sort({ createdAt: -1 }).lean(),
    Task.countDocuments(user.role === ROLES.INDIVIDUAL ? { owner: user._id, organization: null } : { organization: user.organization?._id, createdBy: user._id }),
  ]);
  res.json({ success: true, data: { ...user, access, subscriptions, payments, taskCount } });
});

exports.setUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || user.role === ROLES.SUPER_ADMIN) throw new AppError('User not found.', 404);
  user.isActive = req.body.isActive;
  await user.save();
  await activity.log({ actor: req.user, action: req.body.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', message: `${req.body.isActive ? 'Activated' : 'Deactivated'} ${user.name}`, organization: user.organization, entityType: 'User', entityId: user._id });
  res.json({ success: true, data: { id: user._id, isActive: user.isActive } });
});
