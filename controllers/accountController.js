const User = require('../models/User');
const Organization = require('../models/Organization');
const DeletedAccount = require('../models/DeletedAccount');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const { signToken } = require('../middleware/auth');
const { checkSecondFactor } = require('./securityController');
const svc = require('../services/accountDeletionService');
const { escapeRegex, pageParams } = require('../utils/helpers');

const SECOND_FACTOR_FIELDS = '+twoFactor.secretEnc +twoFactor.recoveryHashes +twoFactor.lastStep +twoFactor.lockedUntil';

exports.requestDeletion = asyncHandler(async (req, res) => {
  const role = req.user.role;
  if (role === ROLES.ORGANIZATION_MEMBER) throw new AppError('Members cannot delete their account. Ask your organization owner to deactivate your access.', 403);
  if (role === ROLES.SUPER_ADMIN) throw new AppError('The platform admin account cannot be deleted here.', 403);
  const user = await User.findById(req.user._id).select(`+password ${SECOND_FACTOR_FIELDS}`);
  if (user.deletion?.scheduledFor) throw new AppError('Your account is already scheduled for deletion.', 409);
  if (!(await user.comparePassword(req.body.password))) throw new AppError('Password is incorrect.', 400);
  if (user.twoFactor?.enabled) await checkSecondFactor(user, req.body.code);

  // Typing a confirmation prevents accidents: "DELETE" for a personal account, the organization's name for an owner.
  const org = role === ROLES.ORGANIZATION_OWNER ? await Organization.findById(user.organization).select('name').lean() : null;
  const expected = org ? org.name : 'DELETE';
  if (req.body.confirm.trim().toLowerCase() !== expected.toLowerCase()) throw new AppError(org ? `Type your organization's name (${org.name}) to confirm.` : 'Type DELETE to confirm.', 400);

  const scheduledFor = await svc.requestDeletion(user, req.body.reason);
  res.json({ success: true, scheduledFor, token: signToken(user._id, user.role), message: 'Your account is scheduled for deletion. You can restore it any time until then.' });
});

exports.restore = asyncHandler(async (req, res) => {
  await svc.restore(req.user._id, req.user);
  res.json({ success: true, message: 'Welcome back. Your account has been restored.' });
});

/* ---------------- Super Admin: "Deleted accounts" ---------------- */
exports.adminList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 20);
  const search = req.query.search ? new RegExp(escapeRegex(req.query.search), 'i') : null;
  if (req.query.tab === 'deleted') {
    const filter = search ? { $or: [{ name: search }, { email: search }, { 'organization.name': search }] } : {};
    const [data, total] = await Promise.all([DeletedAccount.find(filter).sort({ purgedAt: -1 }).skip(skip).limit(limit).lean(), DeletedAccount.countDocuments(filter)]);
    return res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  }
  const filter = { 'deletion.scheduledFor': { $ne: null }, role: { $in: [ROLES.INDIVIDUAL, ROLES.ORGANIZATION_OWNER] } };
  if (search) filter.$or = [{ name: search }, { email: search }];
  const [users, total] = await Promise.all([User.find(filter).select('name email phone role organization deletion createdAt').populate('organization', 'name type').sort({ 'deletion.scheduledFor': 1 }).skip(skip).limit(limit).lean(), User.countDocuments(filter)]);
  const data = users.map((u) => ({ id: u._id, kind: u.role === ROLES.ORGANIZATION_OWNER ? 'ORGANIZATION' : 'INDIVIDUAL', name: u.name, email: u.email, organizationName: u.organization?.name, requestedAt: u.deletion.requestedAt, scheduledFor: u.deletion.scheduledFor, reason: u.deletion.reason, deleting: !!u.deletion.purging, daysLeft: Math.max(Math.ceil((new Date(u.deletion.scheduledFor) - Date.now()) / 86400000), 0) }));
  res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});
exports.adminRestore = asyncHandler(async (req, res) => {
  await svc.restore(req.params.id, req.user);
  res.json({ success: true, message: 'Account restored.' });
});
exports.adminPurgeNow = asyncHandler(async (req, res) => {
  const out = await svc.purgeNow(req.params.id, req.user._id);
  res.json({ success: true, message: out ? 'Account permanently deleted and added to the deleted accounts record.' : 'Nothing to delete.' });
});
