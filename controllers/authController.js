const crypto = require('crypto');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Category = require('../models/Category');
const Invitation = require('../models/Invitation');
const Team = require('../models/Team');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken } = require('../middleware/auth');
const { ROLES, INVITE_STATUS, DEFAULT_CATEGORIES, TERMS_VERSION } = require('../config/constants');
const terms = () => ({ termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION });
const { getAccess } = require('../services/subscriptionService');
const activity = require('../services/activityService');
const { notify } = require('../services/notificationService');
const { signChallenge } = require('../middleware/auth');
const email = require('../services/emailService');
const evs = require('../services/emailVerificationService');
const googleAuth = require('../services/googleAuth');
const { EMAIL_DEFAULTS } = require('../services/notificationService');

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, phone: u.phone, twoFactorEnabled: !!u.twoFactor?.enabled, deletionScheduledFor: u.deletion?.scheduledFor || null, timezone: u.timezone || 'Africa/Lagos', emailVerified: !!u.emailVerified || u.role === ROLES.SUPER_ADMIN, emailPrefs: { ...EMAIL_DEFAULTS, ...Object.fromEntries(Object.entries(u.emailPrefs || {}).filter(([k, v]) => k !== 'lastDigestDay' && typeof v === 'boolean')) }, hasGoogle: !!u.googleId, overdueNudge: { everyMinutes: u.overdueNudge?.everyMinutes || 0, quietFrom: u.overdueNudge?.quietFrom ?? 22, quietTo: u.overdueNudge?.quietTo ?? 7 }, role: u.role, organization: u.organization, teams: u.teams, createdAt: u.createdAt });

async function buildSession(userDoc) {
  const user = userDoc.toObject ? userDoc.toObject() : userDoc;
  const populated = await User.findById(user._id).populate('organization', 'name type phone address website owner').populate('teams', 'name').lean();
  const access = await getAccess(user);
  return { user: publicUser(populated), access };
}

exports.buildSession = buildSession;
// A new Personal account, or a Business account whose first user becomes the Organization Owner.
async function createAccount({ accountType, name, email, password, organization, extra = {} }) {
  if (accountType === 'PERSONAL') {
    const user = await User.create({ name, email, password, role: ROLES.INDIVIDUAL, ...terms(), ...extra });
    await Category.insertMany(DEFAULT_CATEGORIES.map((c) => ({ ...c, user: user._id })));
    await activity.log({ actor: user, action: 'USER_REGISTERED', message: `${name} registered a personal account`, entityType: 'User', entityId: user._id });
    return user;
  }
  const user = await User.create({ name, email, password, role: ROLES.ORGANIZATION_OWNER, ...terms(), ...extra });
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
  return user;
}
// Who may sign in at all (shared by password login and Google login).
async function assertCanLogin(user) {
  if (!user.isActive) throw new AppError(user.orgDeactivation?.at ? 'Your access was deactivated by your organization owner. Please contact them.' : 'This account has been deactivated. Contact support.', 403);
  if (user.role === ROLES.ORGANIZATION_MEMBER && user.organization) {
    const org = await Organization.findById(user.organization).select('deletion').lean();
    if (org?.deletion?.scheduledFor) throw new AppError('Your organization has been closed by its owner.', 403);
  }
}

exports.register = asyncHandler(async (req, res) => {
  const { accountType, name, email, password, inviteToken, organization } = req.body;
  if (await User.exists({ email })) throw new AppError('An account with this email already exists.', 409);

  // --- Joining an organization through an invitation link ---
  if (inviteToken) {
    const invite = await Invitation.findOne({ token: inviteToken, status: INVITE_STATUS.PENDING });
    if (!invite || invite.expiresAt < new Date()) throw new AppError('This invitation is invalid or has expired.', 400);
    if (invite.email !== email) throw new AppError(`This invitation was sent to ${invite.email}. Register with that email address.`, 400);
    await require('../services/seatService').assertSeatFree(invite.organization, { includePending: false }); // the invitation itself is the open seat
    const user = await User.create({ name, email, password, role: ROLES.ORGANIZATION_MEMBER, organization: invite.organization, teams: invite.team ? [invite.team] : [], ...terms() });
    invite.status = INVITE_STATUS.ACCEPTED; invite.respondedAt = new Date(); await invite.save();
    evs.sendVerification(user).catch(() => {});
    const org = await Organization.findById(invite.organization);
    await notify(org.owner, { type: 'INVITATION_ACCEPTED', title: 'Invitation accepted', message: `${name} joined ${org.name}.`, link: '/members' });
    await activity.log({ actor: user, action: 'MEMBER_JOINED', message: `${name} joined the organization`, organization: org._id, entityType: 'User', entityId: user._id });
    return res.status(201).json({ success: true, token: signToken(user._id, user.role), ...(await buildSession(user)) });
  }

  const user = await createAccount({ accountType, name, email, password, organization });
  evs.sendVerification(user).catch(() => {}); // ask them to confirm the address; never blocks sign-up
  res.status(201).json({ success: true, token: signToken(user._id, user.role), ...(await buildSession(user)) });
});

exports.login = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select('+password');
  // Same message for unknown email and wrong password.
  if (!user || !(await user.comparePassword(req.body.password))) throw new AppError('Incorrect email or password.', 401);
  await assertCanLogin(user);
  // Password is correct. If 2FA is on, no session yet: the client must send the code to /auth/login/2fa.
  if (user.twoFactor?.enabled) return res.json({ success: true, twoFactorRequired: true, challengeToken: signChallenge(user._id) });
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ success: true, token: signToken(user._id, user.role), ...(await buildSession(user)) });
});

exports.me = asyncHandler(async (req, res) => res.json({ success: true, ...(await buildSession(req.user)) }));

exports.updateOverdueNudge = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  user.overdueNudge = { everyMinutes: req.body.everyMinutes, quietFrom: req.body.quietFrom, quietTo: req.body.quietTo };
  await user.save();
  res.json({ success: true, data: publicUser(user), message: req.body.everyMinutes ? 'Overdue reminders saved.' : 'Overdue reminders are off.' });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user._id, { $set: req.body }, { new: true, runValidators: true });
  res.json({ success: true, ...(await buildSession(user)) });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(req.body.currentPassword))) throw new AppError('Current password is incorrect.', 400);
  user.password = req.body.newPassword;
  user.passwordChangedAt = new Date(); // signs out every other session
  await user.save();
  const mail = email.templates.passwordChanged();
  email.send({ to: user.email, ...mail }).catch(() => {});
  res.json({ success: true, message: 'Password updated.', token: signToken(user._id, user.role) });
});

/* ---------------- confirming the email address ---------------- */
exports.sendVerifyEmail = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const r = await evs.sendVerification(user);
  if (r.alreadyVerified) return res.json({ success: true, message: 'Your email is already confirmed.' });
  if (!r.sent) throw new AppError('We could not send the email right now. Please try again in a little while.', 503);
  res.json({ success: true, message: 'We sent you an email. Open it and press the button. Check your spam folder too.' });
});
exports.verifyEmail = asyncHandler(async (req, res) => {
  await evs.verifyToken(req.body.token);
  res.json({ success: true, message: 'Your email is confirmed.' });
});
exports.updateEmailPrefs = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  user.emailPrefs = { ...(user.emailPrefs?.toObject ? user.emailPrefs.toObject() : user.emailPrefs || {}), ...req.body };
  await user.save();
  res.json({ success: true, data: publicUser(user), message: 'Email preferences saved.' });
});

/* ---------------- Sign in with Google ---------------- */
exports.googleLogin = asyncHandler(async (req, res) => {
  const g = await googleAuth.verifyIdToken(req.body.credential);
  const user = await User.findOne({ $or: [{ googleId: g.sub }, { email: g.email }] });
  if (!user) return res.json({ success: true, needsSignup: true, profile: { name: g.name.trim(), email: g.email }, signupToken: googleAuth.signSignup(g) });
  if (user.role === ROLES.SUPER_ADMIN) throw new AppError('Administrators sign in with email and password.', 403);
  if (user.googleId && user.googleId !== g.sub) throw new AppError('This email is linked to a different Google account.', 409);
  await assertCanLogin(user);
  if (!user.googleId) {
    // First time with Google: Google has just proved this person owns the address. If the address was never confirmed, whoever
    // created the account (and chose its password) may not be the owner, so that password is retired and all old sessions end.
    if (!user.emailVerified) { user.password = crypto.randomBytes(32).toString('hex'); user.passwordChangedAt = new Date(); }
    user.googleId = g.sub;
  }
  user.emailVerified = true; user.emailVerifiedAt = user.emailVerifiedAt || new Date(); user.emailVerify = undefined;
  if (user.twoFactor?.enabled) { await user.save(); return res.json({ success: true, twoFactorRequired: true, challengeToken: signChallenge(user._id) }); } // Google never bypasses 2FA
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ success: true, token: signToken(user._id, user.role), ...(await buildSession(user)) });
});
exports.googleComplete = asyncHandler(async (req, res) => {
  const g = googleAuth.readSignup(req.body.signupToken);
  if (await User.exists({ email: g.email })) throw new AppError('An account with this email already exists. Please press Continue with Google to sign in.', 409);
  const user = await createAccount({ accountType: req.body.accountType, name: g.name.trim() || g.email.split('@')[0], email: g.email, password: crypto.randomBytes(32).toString('hex'), organization: req.body.organization, extra: { googleId: g.sub, emailVerified: true, emailVerifiedAt: new Date() } });
  res.status(201).json({ success: true, token: signToken(user._id, user.role), ...(await buildSession(user)) });
});
