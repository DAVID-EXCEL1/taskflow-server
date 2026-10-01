const crypto = require('crypto');
const PushSubscription = require('../models/PushSubscription');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const push = require('../services/pushService');
const { runScheduledJobs } = require('../services/reminderService');

exports.config = (req, res) => res.json({ success: true, enabled: push.isEnabled(), publicKey: push.publicKey() });

exports.subscribe = asyncHandler(async (req, res) => {
  if (!push.isEnabled()) throw new AppError('Browser notifications are not configured on the server.', 503);
  const { endpoint, keys } = req.body;
  // Upsert by endpoint: if a shared device switches accounts, the subscription follows the current user.
  await PushSubscription.findOneAndUpdate({ endpoint }, { user: req.user._id, keys, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) }, { upsert: true, new: true });
  res.json({ success: true, message: 'Browser notifications are on for this device.' });
});
exports.unsubscribe = asyncHandler(async (req, res) => {
  await PushSubscription.deleteOne({ endpoint: req.body.endpoint, user: req.user._id });
  res.json({ success: true, message: 'Browser notifications are off for this device.' });
});
exports.test = asyncHandler(async (req, res) => {
  const sent = await push.sendToUsers([req.user._id], { title: 'TaskDesk', message: 'Browser notifications are working.', link: '/profile' });
  if (!sent) throw new AppError('No device is registered yet. Turn notifications on first.', 404);
  res.json({ success: true, message: `Test sent to ${sent} device${sent === 1 ? '' : 's'}.` });
});

// Secured endpoint for an external scheduler (cron-job.org etc.). Needs header "x-cron-secret: <CRON_SECRET>" or "Authorization: Bearer <CRON_SECRET>".
exports.cron = asyncHandler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new AppError('The scheduled endpoint is not configured.', 503);
  const provided = String(req.headers['x-cron-secret'] || (req.headers.authorization || '').replace(/^Bearer /i, ''));
  const a = Buffer.from(provided); const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new AppError('Unauthorized.', 401);
  res.json({ success: true, ...(await runScheduledJobs()) });
});
