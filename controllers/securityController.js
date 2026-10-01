const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken } = require('../middleware/auth');
const { buildSession } = require('./authController');
const totp = require('../utils/totp');
const { encrypt, decrypt, sha256 } = require('../utils/crypto');
const email = require('../services/emailService');
const activity = require('../services/activityService');

const clientUrl = () => String(process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
const mail = (to, tpl) => email.send({ to, ...tpl }).catch(() => {}); // fire and forget: email trouble must never break a request
const SECOND_FACTOR_FIELDS = '+twoFactor.secretEnc +twoFactor.recoveryHashes +twoFactor.lastStep +twoFactor.lockedUntil';

/* ================= Password reset ================= */
exports.forgotPassword = asyncHandler(async (req, res) => {
  // Same answer whether or not the email exists, so this cannot be used to discover who has an account.
  const response = { success: true, message: 'If an account exists for that email, a reset link has been sent. It works for 30 minutes.' };
  const user = await User.findOne({ email: req.body.email });
  if (!user || !user.isActive) return res.json(response);
  const recent = await PasswordReset.exists({ user: user._id, usedAt: null, createdAt: { $gt: new Date(Date.now() - 60000) } });
  if (recent) return res.json(response); // one email per minute per account

  const token = crypto.randomBytes(32).toString('hex');
  await PasswordReset.deleteMany({ user: user._id, usedAt: null }); // older links stop working
  await PasswordReset.create({ user: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60000) });
  const link = `${clientUrl()}/reset-password/${token}`;
  if (process.env.NODE_ENV !== 'production') console.log(`[dev] Password reset link for ${user.email}: ${link}`);
  mail(user.email, email.templates.resetPassword(link));
  res.json(response);
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const bad = () => new AppError('This reset link is invalid or has expired. Request a new one.', 400);
  const rec = await PasswordReset.findOne({ tokenHash: sha256(req.body.token), usedAt: null, expiresAt: { $gt: new Date() } });
  if (!rec) throw bad();
  // Atomic claim: a link can only ever be used once, even if opened twice at the same moment.
  if (!(await PasswordReset.findOneAndUpdate({ _id: rec._id, usedAt: null }, { usedAt: new Date() }))) throw bad();
  const user = await User.findById(rec.user).select('+password');
  if (!user || !user.isActive) throw bad();
  user.password = req.body.password;
  user.passwordChangedAt = new Date(); // signs out every existing session
  await user.save();
  await PasswordReset.deleteMany({ user: user._id, usedAt: null });
  mail(user.email, email.templates.passwordChanged());
  await activity.log({ actor: user, action: 'PASSWORD_RESET', message: `${user.name} reset their password`, organization: user.organization, entityType: 'User', entityId: user._id });
  res.json({ success: true, message: 'Password updated. You can now log in.' });
});

/* ================= Two-factor authentication ================= */
const normalizeRecovery = (c) => String(c).toLowerCase().replace(/[\s-]/g, '');
const newRecoveryCode = () => { const c = crypto.randomBytes(5).toString('hex'); return `${c.slice(0, 5)}-${c.slice(5)}`; };

// Checks an authenticator code or a one-time recovery code. Throws on failure. 5 misses lock the account's 2FA for 15 minutes.
async function checkSecondFactor(user, rawCode) {
  const tf = user.twoFactor || {};
  if (tf.lockedUntil && tf.lockedUntil > new Date()) throw new AppError('Too many wrong codes. Try again in 15 minutes.', 429);
  const code = String(rawCode || '').trim();
  let ok = false;
  if (/^\d{6}$/.test(code)) {
    const step = totp.verifyTotp(decrypt(tf.secretEnc), code, { lastStep: tf.lastStep });
    if (step != null) {
      // Conditional update = replay protection even under parallel requests.
      const r = await User.updateOne({ _id: user._id, $or: [{ 'twoFactor.lastStep': { $lt: step } }, { 'twoFactor.lastStep': { $exists: false } }] }, { $set: { 'twoFactor.lastStep': step } });
      ok = r.modifiedCount === 1;
    }
  } else {
    const norm = normalizeRecovery(code);
    if (/^[0-9a-f]{10}$/.test(norm)) {
      const h = sha256(norm);
      const r = await User.updateOne({ _id: user._id, 'twoFactor.recoveryHashes': h }, { $pull: { 'twoFactor.recoveryHashes': h } });
      ok = r.modifiedCount === 1; // each recovery code works once
    }
  }
  if (!ok) {
    const upd = await User.findOneAndUpdate({ _id: user._id }, { $inc: { 'twoFactor.failedAttempts': 1 } }, { new: true }).select('+twoFactor.failedAttempts');
    if (upd?.twoFactor?.failedAttempts >= 5) await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.lockedUntil': new Date(Date.now() + 15 * 60000), 'twoFactor.failedAttempts': 0 } });
    throw new AppError('Incorrect code.', 400); // 400 (not 401) so a wrong code never signs a logged-in user out
  }
  await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.failedAttempts': 0 }, $unset: { 'twoFactor.lockedUntil': 1 } });
}

exports.login2fa = asyncHandler(async (req, res) => {
  let payload;
  try { payload = jwt.verify(req.body.challengeToken, process.env.JWT_SECRET); } catch { throw new AppError('Your login session expired. Please log in again.', 401); }
  if (payload.purpose !== '2fa') throw new AppError('Please log in again.', 401);
  const user = await User.findById(payload.id).select(SECOND_FACTOR_FIELDS);
  if (!user || !user.isActive || !user.twoFactor?.enabled) throw new AppError('Please log in again.', 401);
  await checkSecondFactor(user, req.body.code);
  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  res.json({ success: true, token: signToken(user._id, user.role), ...(await buildSession(user)) });
});

exports.setup2fa = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.twoFactor?.enabled) throw new AppError('Two-factor authentication is already on.', 409);
  const secret = totp.generateSecret();
  await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.pendingSecretEnc': encrypt(secret) } });
  const uri = totp.otpauthUri({ secret, account: user.email, issuer: process.env.APP_NAME || 'TaskDesk' });
  res.json({ success: true, secret, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
});

exports.enable2fa = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+twoFactor.pendingSecretEnc');
  if (user.twoFactor?.enabled) throw new AppError('Two-factor authentication is already on.', 409);
  if (!user.twoFactor?.pendingSecretEnc) throw new AppError('Start the setup first.', 400);
  const secret = decrypt(user.twoFactor.pendingSecretEnc);
  const step = totp.verifyTotp(secret, req.body.code);
  if (step == null) throw new AppError("That code is not correct. Make sure your phone's clock is automatic and try the newest code.", 400);
  const codes = Array.from({ length: 10 }, newRecoveryCode);
  await User.updateOne({ _id: user._id }, {
    $set: { 'twoFactor.enabled': true, 'twoFactor.enabledAt': new Date(), 'twoFactor.secretEnc': encrypt(secret), 'twoFactor.recoveryHashes': codes.map((c) => sha256(normalizeRecovery(c))), 'twoFactor.lastStep': step, 'twoFactor.failedAttempts': 0 },
    $unset: { 'twoFactor.pendingSecretEnc': 1 },
  });
  mail(user.email, email.templates.twoFactorEnabled());
  await activity.log({ actor: user, action: 'TWO_FACTOR_ENABLED', message: `${user.name} turned on two-factor authentication`, organization: user.organization, entityType: 'User', entityId: user._id });
  res.json({ success: true, recoveryCodes: codes }); // shown once, only hashes are kept
});

exports.disable2fa = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(`+password ${SECOND_FACTOR_FIELDS}`);
  if (!user.twoFactor?.enabled) throw new AppError('Two-factor authentication is not on.', 400);
  if (!(await user.comparePassword(req.body.password))) throw new AppError('Password is incorrect.', 400);
  await checkSecondFactor(user, req.body.code);
  await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.enabled': false }, $unset: { 'twoFactor.secretEnc': 1, 'twoFactor.recoveryHashes': 1, 'twoFactor.lastStep': 1, 'twoFactor.pendingSecretEnc': 1, 'twoFactor.lockedUntil': 1 } });
  mail(user.email, email.templates.twoFactorDisabled());
  await activity.log({ actor: user, action: 'TWO_FACTOR_DISABLED', message: `${user.name} turned off two-factor authentication`, organization: user.organization, entityType: 'User', entityId: user._id });
  res.json({ success: true, message: 'Two-factor authentication is off.' });
});
