const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const User = require('../models/User');
const { ROLES } = require('../config/constants');
const { signToken } = require('../middleware/auth');
const passkeys = require('../services/passkeyService');
const email = require('../services/emailService');
const activity = require('../services/activityService');
const { notify } = require('../services/notificationService');
const { buildSession, assertCanLogin } = require('./authController');

const noAdmins = (user) => { if (user.role === ROLES.SUPER_ADMIN) throw new AppError('Administrators sign in with email, password and their authenticator code.', 403); };

exports.registerOptions = asyncHandler(async (req, res) => { noAdmins(req.user); res.json({ success: true, ...(await passkeys.registrationOptions(req.user, req)) }); });
exports.registerVerify = asyncHandler(async (req, res) => {
  noAdmins(req.user);
  const pk = await passkeys.verifyRegistration(req.user, req, req.body);
  await activity.log({ actor: req.user, action: 'PASSKEY_ADDED', message: `${req.user.name} added a fingerprint login (${pk.name})`, entityType: 'User', entityId: req.user._id });
  await notify([req.user._id], { type: 'SECURITY', title: 'Fingerprint login added', message: `"${pk.name}" can now sign in to your account. If this was not you, change your password and remove it in Profile.`, link: '/profile' });
  email.send({ to: req.user.email, ...email.templates.passkeyAdded(pk.name), kind: 'transactional' }).catch(() => {}); // a security alert; never blocks
  res.status(201).json({ success: true, data: await passkeys.list(req.user._id), message: 'Fingerprint login added.' });
});
exports.list = asyncHandler(async (req, res) => res.json({ success: true, data: await passkeys.list(req.user._id) }));
exports.remove = asyncHandler(async (req, res) => {
  await passkeys.remove(req.user._id, req.params.id);
  await activity.log({ actor: req.user, action: 'PASSKEY_REMOVED', message: `${req.user.name} removed a fingerprint login`, entityType: 'User', entityId: req.user._id });
  res.json({ success: true, data: await passkeys.list(req.user._id), message: 'Fingerprint login removed.' });
});

// Public: the person is not logged in yet.
exports.loginOptions = asyncHandler(async (req, res) => res.json({ success: true, ...(await passkeys.loginOptions(req)) }));
exports.loginVerify = asyncHandler(async (req, res) => {
  const userId = await passkeys.verifyLogin(req, req.body);
  const user = await User.findById(userId);
  if (!user) throw new AppError('Fingerprint sign-in failed. Please try again, or log in with your password.', 401);
  noAdmins(user);
  await assertCanLogin(user);
  user.lastLoginAt = new Date(); await user.save();
  // The device already checked the fingerprint, so this counts as the second step: no authenticator code is asked for.
  res.json({ success: true, token: signToken(user._id, user.role), ...(await buildSession(user)) });
});
