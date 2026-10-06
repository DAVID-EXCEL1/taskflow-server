const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const { SUB_STATUS, REMINDER_DAYS } = require('../config/constants');
const { notify } = require('./notificationService');
const { recipientsFor } = require('./subscriptionService');
const activity = require('./activityService');
const { daysBetween } = require('../utils/helpers');
const { runTaskReminders } = require('./taskReminderService');
const { runAccountPurges } = require('./accountDeletionService');
const { runCleanup } = require('./cleanupService');

const subjectOf = (d) => (d.user ? { user: d.user } : { organization: d.organization });

/**
 * Subscription notices (7/3/1 days before expiry, and on expiry). Idempotent: each notice is claimed
 * atomically in the database, so overlapping runs (cron + external scheduler) never double-send.
 */
async function runSubscriptionChecks() {
  const now = new Date();
  const subs = await Subscription.find({ status: SUB_STATUS.ACTIVE, endDate: { $lte: new Date(now.getTime() + 8 * 86400000) } });
  let sent = 0;
  for (const sub of subs) {
    const subject = subjectOf(sub);
    // A queued renewal suppresses reminders for the earlier period.
    if (await Subscription.exists({ ...subject, status: SUB_STATUS.ACTIVE, endDate: { $gt: sub.endDate } })) continue;
    const recipients = await recipientsFor(subject);

    if (sub.endDate <= now) {
      const r = await Subscription.updateOne({ _id: sub._id, expiryNotified: { $ne: true } }, { expiryNotified: true });
      if (r.modifiedCount) {
        await notify(recipients, { type: 'SUBSCRIPTION_EXPIRED', title: 'Subscription expired', message: 'Your subscription has expired. Your account is now in read-only mode.', link: '/subscription' });
        await activity.log({ action: 'SUBSCRIPTION_EXPIRED', message: `${sub.plan} subscription expired`, organization: subject.organization, entityType: 'Subscription', entityId: sub._id });
        sent++;
      }
      continue;
    }
    const daysLeft = daysBetween(sub.endDate, now);
    const threshold = [...REMINDER_DAYS].sort((a, b) => a - b).find((d) => daysLeft <= d);
    if (threshold) {
      const r = await Subscription.updateOne({ _id: sub._id, remindersSent: { $ne: threshold } }, { $addToSet: { remindersSent: threshold } });
      if (r.modifiedCount) {
        await notify(recipients, { type: 'SUBSCRIPTION_EXPIRING', title: 'Subscription expiring', message: threshold === 1 ? 'Your subscription expires tomorrow.' : `Your subscription expires in ${threshold} days.`, link: '/subscription' });
        sent++;
      }
    }
  }
  return sent;
}

let running = false;
async function runScheduledJobs() {
  if (running) return { skipped: true };
  running = true;
  try {
    const subscriptionNotices = await runSubscriptionChecks();
    const taskReminders = await runTaskReminders();
    const accountsDeleted = await runAccountPurges();
    // Housekeeping must never break the reminders above, so a failure here is only logged.
    const cleanup = await runCleanup().catch((e) => { console.error('Cleanup failed:', e.message); return null; });
    return { subscriptionNotices, taskReminders, accountsDeleted, ...(cleanup ? { cleanup } : {}) };
  } finally { running = false; }
}

function startReminderJob() {
  if (process.env.ENABLE_CRON === 'false') return;
  const run = () => runScheduledJobs().catch((e) => console.error('Scheduled jobs failed:', e.message));
  run();
  cron.schedule('*/5 * * * *', run);
  console.log('Reminder job scheduled (every 5 minutes). An external scheduler may also call /api/cron/run.');
}
module.exports = { runSubscriptionChecks, runScheduledJobs, startReminderJob };
