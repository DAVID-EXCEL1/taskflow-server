const Task = require('../models/Task');
const User = require('../models/User');
const notifications = require('./notificationService');
const plan = require('./planService');
const { buildScope } = require('./taskService');
const { DEFAULT_TZ } = require('../utils/timezone');
const sms = require('./smsService');
const whatsapp = require('./whatsappService');
const WhatsAppLink = require('../models/WhatsAppLink');

const timeInZone = (tz, now) => {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now); }
  catch { return ''; }
};
const dayInZone = (tz, now) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
function zonesAtTime(now, time, candidates) {
  let zones = candidates;
  if (!zones) {
    try { zones = [...Intl.supportedValuesOf('timeZone'), 'UTC']; } catch { zones = [DEFAULT_TZ]; }
  }
  return [...new Set(zones)].filter((zone) => timeInZone(zone, now) === time);
}
function formatPlan(built, tz = DEFAULT_TZ) {
  if (!built.sections.length) return 'You have no open tasks due soon. Enjoy the breathing room, or add anything new to your list.';
  return built.sections.map((section) => {
    const items = section.items.slice(0, 5).map((item) => {
      const due = item.dueDate
        ? item.dueHasTime
          ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(item.dueDate))
          : new Date(item.dueDate).toISOString().slice(0, 10)
        : '';
      return `• ${item.title}${due ? ` — ${due}` : ''} (${item.priority})`;
    });
    const more = section.total > items.length ? `\n…and ${section.total - items.length} more` : '';
    return `${section.title} (${section.total})\n${items.join('\n')}${more}`;
  }).join('\n\n').slice(0, 3500);
}

function limitPlan(message, maxLength) {
  const lines = String(message).split('\n');
  const kept = [];
  for (const line of lines) {
    const next = [...kept, line].join('\n');
    if (next.length + 36 > maxLength) break;
    kept.push(line);
  }
  if (kept.length < lines.length) kept.push('Open Taskflow for the rest.');
  return kept.join('\n');
}

async function runMorningPlans(now = new Date()) {
  const active = { 'morningPlan.enabled': true, isActive: true };
  const [times, configuredZones] = await Promise.all([
    User.distinct('morningPlan.time', active),
    User.distinct('timezone', active),
  ]);
  const zonesToCheck = [...new Set([...configuredZones.filter(Boolean), DEFAULT_TZ])];
  const validTimes = [...new Set(times)].filter((x) => /^\d{2}:\d{2}$/.test(x || ''));
  let sent = 0;
  for (const time of validTimes) {
    const zones = zonesAtTime(now, time, zonesToCheck);
    const includeMissingZone = timeInZone(DEFAULT_TZ, now) === time;
    if (!zones.length && !includeMissingZone) continue;
    const users = await User.find({
      'morningPlan.enabled': true,
      'morningPlan.time': time,
      isActive: true,
      role: { $ne: 'SUPER_ADMIN' },
      $or: [{ timezone: { $in: zones } }, ...(includeMissingZone ? [{ timezone: { $exists: false } }] : [])],
    }).select('_id timezone organization role morningPlan smsPhone smsVerifiedAt').limit(2000);

    for (const user of users) {
      const tz = user.timezone || DEFAULT_TZ;
      const day = dayInZone(tz, now);
      const tasks = await Task.find({ ...buildScope(user), status: { $in: plan.OPEN } })
        .sort({ dueDate: 1 }).limit(200).select('title dueDate dueHasTime priority status').lean();
      const built = plan.buildPlan(tasks, { tz, now });
      const claimed = await User.findOneAndUpdate({
        _id: user._id,
        'morningPlan.enabled': true,
        $or: [{ 'morningPlan.lastSentDay': { $ne: day } }, { 'morningPlan.lastSentDay': { $exists: false } }],
      }, { $set: { 'morningPlan.lastSentDay': day } });
      if (!claimed) continue;

      await notifications.notify([user._id], {
        type: 'MORNING_PLAN',
        title: 'Your plan for today',
        message: formatPlan(built, tz),
        link: '/dashboard',
      });
      if (user.morningPlan?.sms && user.smsPhone && user.smsVerifiedAt && sms.configured()) {
        try {
          await sms.sendSms({ to: user.smsPhone, message: limitPlan(formatPlan(built, tz), 1500) });
        } catch (error) {
          console.error('Morning plan SMS delivery failed:', error.message);
        }
      }
      if (user.morningPlan?.whatsapp && whatsapp.configured()) {
        try {
          const link = await WhatsAppLink.findOne({ user: user._id }).select('phone').lean();
          if (link?.phone) {
            await whatsapp.sendMorningPlan(link.phone, limitPlan(formatPlan(built, tz), 1000));
          }
        } catch (error) {
          console.error('Morning plan WhatsApp delivery failed:', error.message);
        }
      }
      sent++;
    }
  }
  return { sent };
}

module.exports = { runMorningPlans, timeInZone, dayInZone, zonesAtTime, formatPlan, limitPlan };
