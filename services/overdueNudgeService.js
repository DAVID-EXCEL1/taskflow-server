/**
 * Overdue reminders ("nudges"): tasks that are past their date and still open keep reminding the person until they update them.
 *  - OFF unless the person turns it on (Profile): every 5 / 15 / 30 / 60 / 120 minutes, with quiet hours (default 10pm to 7am).
 *  - One grouped notification per person per round (never one per task), in the app and as a phone/browser notification.
 *  - At most OVERDUE_NUDGE_MAX (default 6) reminders per task; marking it done or changing its date/status starts it afresh.
 *  - Who is reminded: the person the task is assigned to; for an unassigned task, the person who created it; Personal tasks: the owner.
 * Safe to run from several places at once: every reminder is claimed atomically before it is sent.
 */
const Task = require('../models/Task');
const User = require('../models/User');
const notifications = require('./notificationService');
const { overdueClause } = require('./taskService');
const { DEFAULT_TZ } = require('../utils/timezone');

const OPEN = ['Pending', 'In Progress'];
const maxPerTask = () => { const n = Number(process.env.OVERDUE_NUDGE_MAX); return Number.isInteger(n) && n > 0 ? n : 6; };
const hourIn = (tz, now) => { try { return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now)); } catch { return now.getUTCHours(); } };
const inQuietHours = (hour, from, to) => (from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to);

function scopeFor(user) {
  if (!user.organization) return { owner: user._id, organization: null };
  return { organization: user.organization, $or: [{ assignedTo: user._id }, { assignedTo: null, createdBy: user._id }] };
}
function messageFor(claimed, last) {
  const t = claimed.map((x) => `"${x.title}"`);
  const listed = t.length <= 2 ? t.join(' and ') : `${t.slice(0, 2).join(', ')} and ${t.length - 2} more`;
  const base = claimed.length === 1 ? `${listed} is overdue. Mark it done, or set a new date.` : `${claimed.length} tasks are overdue: ${listed}. Mark the finished ones done, or set new dates.`;
  return last ? `${base} This is the last reminder until you update ${claimed.length === 1 ? 'it' : 'them'}.` : base;
}

async function runOverdueNudges(now = new Date()) {
  const max = maxPerTask();
  const users = await User.find({ 'overdueNudge.everyMinutes': { $gt: 0 }, isActive: true }).select('overdueNudge timezone organization role').limit(500);
  let people = 0; let tasksNudged = 0;
  for (const u of users) {
    const every = u.overdueNudge.everyMinutes;
    if (inQuietHours(hourIn(u.timezone || DEFAULT_TZ, now), u.overdueNudge.quietFrom ?? 22, u.overdueNudge.quietTo ?? 7)) continue;
    const cutoff = new Date(now.getTime() - every * 60000);
    const due = { 'nudge.count': { $lt: max }, $or: [{ 'nudge.lastAt': { $exists: false } }, { 'nudge.lastAt': { $lte: cutoff } }] };
    const candidates = await Task.find({ $and: [scopeFor(u), overdueClause(now), due], status: { $in: OPEN } }).sort({ dueDate: 1 }).limit(10);
    const claimed = [];
    for (const t of candidates) {
      // Claim atomically so two overlapping runs can never send the same reminder twice.
      const got = await Task.findOneAndUpdate({ _id: t._id, status: { $in: OPEN }, ...due }, { $set: { 'nudge.lastAt': now }, $inc: { 'nudge.count': 1 } });
      if (got) claimed.push({ title: t.title, count: (t.nudge?.count || 0) + 1 });
    }
    if (!claimed.length) continue;
    await notifications.notify([u._id], { type: 'TASK_OVERDUE', title: 'Still open', message: messageFor(claimed, claimed.some((c) => c.count >= max)), link: '/tasks' });
    people++; tasksNudged += claimed.length;
  }
  return { people, tasks: tasksNudged };
}
module.exports = { runOverdueNudges, inQuietHours, messageFor };
