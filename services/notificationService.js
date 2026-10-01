const Notification = require('../models/Notification');
const User = require('../models/User');
const { ROLES } = require('../config/constants');
const push = require('./pushService');

/**
 * Delivery channels. Every notify() call goes through all of them.
 * To add email later, push another function onto `channels`.
 */
const inApp = async (userIds, payload) => {
  if (!userIds.length) return;
  await Notification.insertMany(userIds.map((user) => ({ user, ...payload })));
};
const browserPush = async (userIds, payload) => { await push.sendToUsers(userIds, payload); };
const channels = [inApp, browserPush];

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
module.exports = { notify, notifyAdmins };
