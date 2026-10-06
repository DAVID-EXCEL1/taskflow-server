/**
 * Housekeeping so the database does not fill up with data nobody needs (important on a small database plan).
 * Runs from the same scheduler as the reminders, at most once every 6 hours. Settings (days; 0 = never delete that kind):
 *   NOTIFICATION_READ_DAYS=30     in-app notifications that were READ are deleted after this many days
 *   NOTIFICATION_MAX_DAYS=90      ANY notification (even unread) older than this is deleted
 *   INVITATION_DAYS=90            invitations that were never accepted (expired / declined / unused) are deleted after this
 *   ACTIVITY_RETENTION_DAYS=0     activity log entries older than this are deleted. OFF by default: the log is your audit trail.
 * It never touches tasks, payments, subscriptions, receipts or the deleted-accounts record.
 */
const Notification = require('../models/Notification');
const Invitation = require('../models/Invitation');
const ActivityLog = require('../models/ActivityLog');

const DAY = 86400000;
const EVERY = 6 * 3600000;
const setting = (name, fallback) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? n : fallback; };
let lastRun = 0;

async function runCleanup(now = Date.now(), { force = false } = {}) {
  if (!force && now - lastRun < EVERY) return null; // not due yet
  lastRun = now;
  const before = (days) => new Date(now - days * DAY);
  const out = {};
  const readDays = setting('NOTIFICATION_READ_DAYS', 30);
  const maxDays = setting('NOTIFICATION_MAX_DAYS', 90);
  const inviteDays = setting('INVITATION_DAYS', 90);
  const activityDays = setting('ACTIVITY_RETENTION_DAYS', 0);
  if (readDays) out.readNotifications = (await Notification.deleteMany({ read: true, createdAt: { $lt: before(readDays) } })).deletedCount;
  if (maxDays) out.oldNotifications = (await Notification.deleteMany({ createdAt: { $lt: before(maxDays) } })).deletedCount;
  if (inviteDays) out.invitations = (await Invitation.deleteMany({ status: { $ne: 'Accepted' }, createdAt: { $lt: before(inviteDays) } })).deletedCount;
  if (activityDays) out.activity = (await ActivityLog.deleteMany({ createdAt: { $lt: before(activityDays) } })).deletedCount;
  return out;
}
module.exports = { runCleanup, _reset: () => { lastRun = 0; } };
