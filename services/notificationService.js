const Notification = require('../models/Notification');
const User = require('../models/User');
const { ROLES } = require('../config/constants');

/**
 * Delivery channels. Add an email channel here later, e.g.
 *   channels.push(async (userIds, payload) => sendEmail(...))
 * and every notify() call will use it automatically.
 */
const inApp = async (userIds, payload) => {
  if (!userIds.length) return;
  await Notification.insertMany(userIds.map((user) => ({ user, ...payload })));
};
const channels = [inApp];

async function notify(userIds, payload) {
  try {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
    for (const channel of channels) await channel(ids, payload);
  } catch (e) {
    console.error('Notification failed:', e.message);
  }
}
async function notifyAdmins(payload) {
  const admins = await User.find({ role: ROLES.SUPER_ADMIN, isActive: true }).select('_id').lean();
  return notify(admins.map((a) => a._id), payload);
}
module.exports = { notify, notifyAdmins };
