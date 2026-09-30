const crypto = require('crypto');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Category = require('../models/Category');
const Invitation = require('../models/Invitation');
const Team = require('../models/Team');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken } = require('../middleware/auth');
const { ROLES, INVITE_STATUS, DEFAULT_CATEGORIES } = require('../config/constants');
const { getAccess } = require('../services/subscriptionService');
const activity = require('../services/activityService');
const { notify } = require('../services/notificationService');

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, organization: u.organization, teams: u.teams, createdAt: u.createdAt });

async function buildSession(userDoc) {
  const user = userDoc.toObject ? userDoc.toObject() : userDoc;
  const populated = await User.findById(user._id).populate('organization', 'name type phone address website owner').populate('teams', 'name').lean();
  const access = await getAccess(user);
  return { user: publicUser(populated), access };
}

exports.register = asyncHandler(async (req, res) => {
  const { accountType, name, email, password, inviteToken, organization } = req.body;
  if (await User.exists({ email })) throw new AppError('An account with this email already exists.', 409);

  // --- Joining an organization through an invitation link ---
  if (inviteToken) {
    const invite = await Invitation.findOne({ token: inviteToken, status: INVITE_STATUS.PENDING });
    if (!invite || invite.expiresAt < new Date()) throw new AppError('This invitation is invalid or has expired.', 400);
    if (invite.email !== email) throw new AppError(`This invitation was sent to ${invite.email}. Register with that email address.`, 400);
    const user = await User.create({ name, email, password, role: ROLES.ORGANIZATION_MEMBER, organization: invite.organization, teams: invite.team ? [invite.team] : [] });
    invite.status = INVITE_STATUS.ACCEPTED; invite.respondedAt = new Date(); await invite.save();
    const org = await Organization.findById(invite.organization);
    await notify(org.owner, { type: 'INVITATION_ACCEPTED', title: 'Invitation accepted', message: `${name} joined ${org.name}.`, link: '/members' });
    await activity.log({ actor: user, action: 'MEMBER_JOINED', message: `${name} joined the organization`, organization: org._id, entityType: 'User', entityId: user._id });
    return res.status(201).json({ success: true, token: signToken(user._id), ...(await buildSession(user)) });
  }

  if (accountType === 'PERSONAL') {
    const user = await User.create({ name, email, password, role: ROLES.INDIVIDUAL });
    await Category.insertMany(DEFAULT_CATEGORIES.map((c) => ({ ...c, user: user._id })));
    await activity.log({ actor: user, action: 'USER_REGISTERED', message: `${name} registered a personal account`, entityType: 'User', entityId: user._id });
    return res.status(201).json({ success: true, token: signToken(user._id), ...(await buildSession(user)) });
  }

  // --- Business: user becomes Organization Owner ---
  const user = await User.create({ name, email, password, role: ROLES.ORGANIZATION_OWNER });
  try {
    const org = await Organization.create({ ...organization, owner: user._id });
    user.organization = org._id;
    await user.save();
    await Category.insertMany(DEFAULT_CATEGORIES.map((c) => ({ ...c, organization: org._id })));
    await activity.log({ actor: user, action: 'ORGANIZATION_CREATED', message: `${name} created ${org.name}`, organization: org._id, entityType: 'Organization', entityId: org._id });
  } catch (e) {
    await User.deleteOne({ _id: user._id }); // roll back partial signup
    throw e;
  }
  res.status(201).json({ success: true, token: signToken(user._id), ...(await buildSession(user)) });
});

exports.login = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select('+password');
  // Same message for unknown email and wrong password.
  if (!user || !(await user.comparePassword(req.body.password))) throw new AppError('Incorrect email or password.', 401);
  if (!user.isActive) throw new AppError('This account has been deactivated. Contact support.', 403);
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ success: true, token: signToken(user._id), ...(await buildSession(user)) });
});

exports.me = asyncHandler(async (req, res) => res.json({ success: true, ...(await buildSession(req.user)) }));

exports.updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user._id, { $set: req.body }, { new: true, runValidators: true });
  res.json({ success: true, ...(await buildSession(user)) });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(req.body.currentPassword))) throw new AppError('Current password is incorrect.', 400);
  user.password = req.body.newPassword;
  await user.save();
  res.json({ success: true, message: 'Password updated.' });
});
