const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const { SUB_STATUS, REMINDER_DAYS } = require('../config/constants');
const { notify } = require('./notificationService');
const { recipientsFor } = require('./subscriptionService');
const subjectOf = (d) => (d.user ? { user: d.user } : { organization: d.organization });
const activity = require('./activityService');
const { daysBetween } = require('../utils/helpers');

/**
 * Idempotent: safe to run as often as you like (each reminder is sent once per subscription period).
 * Reminders apply to the LAST active period only, so a queued renewal suppresses them.
 */
async function runSubscriptionChecks() {
  const now = new Date();
  const subs = await Subscription.find({ status: SUB_STATUS.ACTIVE, endDate: { $lte: new Date(now.getTime() + 8 * 86400000) } });
  let sent = 0;
  for (const sub of subs) {
    const subject = subjectOf(sub);
    const hasLater = await Subscription.exists({ ...subject, status: SUB_STATUS.ACTIVE, endDate: { $gt: sub.endDate } });
    if (hasLater) continue;
    const recipients = await recipientsFor(subject);

    if (sub.endDate <= now) {
      if (!sub.expiryNotified) {
        sub.expiryNotified = true;
        await sub.save();
        await notify(recipients, { type: 'SUBSCRIPTION_EXPIRED', title: 'Subscription expired', message: 'Your subscription has expired. Your account is now in read-only mode.', link: '/subscription' });
        await activity.log({ action: 'SUBSCRIPTION_EXPIRED', message: `${sub.plan} subscription expired`, organization: subject.organization, entityType: 'Subscription', entityId: sub._id });
        sent++;
      }
      continue;
    }
    const daysLeft = daysBetween(sub.endDate, now);
    const threshold = [...REMINDER_DAYS].sort((a, b) => a - b).find((d) => daysLeft <= d);
    if (threshold && !sub.remindersSent.includes(threshold)) {
      sub.remindersSent.push(threshold);
      await sub.save();
      const msg = threshold === 1 ? 'Your subscription expires tomorrow.' : `Your subscription expires in ${threshold} days.`;
      await notify(recipients, { type: 'SUBSCRIPTION_EXPIRING', title: 'Subscription expiring', message: msg, link: '/subscription' });
      sent++;
    }
  }
  return sent;
}

function startReminderJob() {
  if (process.env.ENABLE_CRON === 'false') return;
  runSubscriptionChecks().catch((e) => console.error('Reminder run failed:', e.message));
  cron.schedule('0 * * * *', () => runSubscriptionChecks().catch((e) => console.error('Reminder run failed:', e.message)));
  console.log('Subscription reminder job scheduled (hourly)');
}
module.exports = { runSubscriptionChecks, startReminderJob };
