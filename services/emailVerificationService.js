/**
 * Confirming an email address: a single-use link (24 hours), stored only as a SHA-256 hash.
 * Soft rule: people can use the app before confirming, but only confirmed addresses get reminder emails.
 */
const crypto = require('crypto');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const email = require('./emailService');
const clientUrl = require('../utils/clientUrl');

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const MAX_PER_DAY = 5; const MIN_GAP_MS = 60_000; const TTL_MS = 24 * 3600_000;

async function sendVerification(user, now = new Date()) {
  if (user.emailVerified) return { alreadyVerified: true, sent: false };
  const today = now.toISOString().slice(0, 10); const v = user.emailVerify || {};
  if (v.sentAt && now - new Date(v.sentAt) < MIN_GAP_MS) throw new AppError('Please wait a minute before asking for another email.', 429);
  const count = v.sentDay === today ? v.sentCount || 0 : 0;
  if (count >= MAX_PER_DAY) throw new AppError('You have asked for too many emails today. Please try again tomorrow.', 429);
  const token = crypto.randomBytes(32).toString('hex');
  user.emailVerify = { tokenHash: sha(token), expiresAt: new Date(now.getTime() + TTL_MS), sentAt: now, sentDay: today, sentCount: count + 1 };
  await user.save();
  const mail = email.templates.verifyEmail(`${clientUrl()}/verify-email?token=${token}`);
  const r = await email.send({ to: user.email, ...mail, kind: 'transactional', userId: user._id });
  return { sent: !!r.sent, reason: r.reason };
}
async function verifyToken(token, now = new Date()) {
  if (typeof token !== 'string' || token.length < 20) throw new AppError('This link is invalid or has expired.', 400);
  const user = await User.findOne({ 'emailVerify.tokenHash': sha(token), 'emailVerify.expiresAt': { $gt: now } });
  if (!user) throw new AppError('This link is invalid or has expired. Ask for a new one from your account.', 400);
  user.emailVerified = true; user.emailVerifiedAt = now; user.emailVerify = undefined; // single use
  await user.save();
  return user;
}
module.exports = { sendVerification, verifyToken };
