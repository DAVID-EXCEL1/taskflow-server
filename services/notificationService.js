const Notification = require('../models/Notification');
const User = require('../models/User');
const { ROLES } = require('../config/constants');
const push = require('./pushService');
const email = require('./emailService');
const clientUrl = require('../utils/clientUrl');

/**
 * Delivery channels. Every notify() call goes through all of them.
 * To add email later, push another function onto `channels`.
 */
const inApp = async (userIds, payload) => {
  if (!userIds.length) return;
  await Notification.insertMany(userIds.map((user) => ({ user, ...payload })));
};
const browserPush = async (userIds, payload) => {
  if (payload.type !== 'MORNING_PLAN') return push.sendToUsers(userIds, payload);
  const users = await User.find({ _id: { $in: userIds }, isActive: true }).select('_id morningPlan').lean();
  const optedIn = users.filter((u) => u.morningPlan?.enabled && u.morningPlan?.push !== false).map((u) => u._id);
  await push.sendToUsers(optedIn, payload);
};
// Email: only these kinds of notification, only to CONFIRMED addresses, only if the person wants them (Profile, Email notifications).
const EMAIL_TYPES = { TASK_REMINDER: 'reminders', SUBSCRIPTION_EXPIRING: 'subscription', SUBSCRIPTION_EXPIRED: 'subscription', TASK_ASSIGNED: 'assignments' };
const EMAIL_DEFAULTS = { enabled: true, reminders: true, subscription: true, overdueDigest: true, assignments: false };
const wantsEmail = (u, key) => { const p = { ...EMAIL_DEFAULTS, ...Object.fromEntries(Object.entries(u.emailPrefs || {}).filter(([, v]) => typeof v === 'boolean')) }; return p.enabled && !!p[key]; };
async function deliverEmails(userIds, payload) {
  const key = EMAIL_TYPES[payload.type];
  if (!key && payload.type !== 'MORNING_PLAN') return 0;
  const users = await User.find({ _id: { $in: userIds }, isActive: true, emailVerified: true }).select('email emailPrefs morningPlan').lean();
  let sent = 0;
  for (const u of users) {
    if (payload.type === 'MORNING_PLAN') {
      if (!wantsEmail(u, 'enabled') || !u.morningPlan?.enabled || u.morningPlan?.email === false) continue;
    } else if (!wantsEmail(u, key)) continue;
    const mail = email.templates.notification({ title: payload.title, message: payload.message, url: `${clientUrl()}${payload.link || '/'}` });
    const r = await email.send({ to: u.email, ...mail, kind: 'notification', userId: u._id });
    if (r.sent) sent++;
  }
  return sent;
}
// Never hold up the request (or scheduler round) that triggered the notification.
const emailChannel = async (userIds, payload) => { setImmediate(() => deliverEmails(userIds, payload).catch((e) => console.error('Email notification failed:', e.message))); };
const channels = [inApp, browserPush, emailChannel];

async function notify(userIds, payload) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
  if (!ids.length) return;
  for (const channel of channels) {
    try { await channel(ids, payload); } catch (e) { console.error('Notification channel failed:', e.message); }
  }
}
async function notifyAdmins(payload) {
  const admins = await User.find({ role: ROLES.SUPER_ADMIN, isActive: true }).select('_id').lean();
  return notify(admins.map((a) => a._id), payload);
}
module.exports = { notify, notifyAdmins, deliverEmails, wantsEmail, EMAIL_DEFAULTS };
