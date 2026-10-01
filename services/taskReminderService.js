const Task = require('../models/Task');
const User = require('../models/User');
const { notify } = require('./notificationService');
const { zonedTimeToUtc, DEFAULT_TZ } = require('../utils/timezone');

const OPEN = ['Pending', 'In Progress'];
const DAY = 86400000;

// When should the reminder fire? Timed tasks: exact offset. Date-only tasks: 8:00 am (user's timezone) on the chosen day.
function computeRemindAt(task, tz) {
  const m = task.reminder?.minutesBefore;
  if (m == null || !task.dueDate || !OPEN.includes(task.status)) return null;
  if (task.dueHasTime) return new Date(new Date(task.dueDate).getTime() - m * 60000);
  const day = new Date(new Date(task.dueDate).getTime() - Math.floor(m / 1440) * DAY);
  return zonedTimeToUtc(day.toISOString().slice(0, 10), '08:00', tz || DEFAULT_TZ);
}
function applyReminder(task, tz) {
  const at = computeRemindAt(task, tz);
  task.remindAt = at || undefined;
  task.reminderSent = false;
}

const human = (m) => (m === 0 ? 'now' : m < 60 ? `in ${m} minutes` : m === 60 ? 'in 1 hour' : m === 1440 ? 'tomorrow' : m < 1440 ? `in ${Math.round(m / 60)} hours` : `in ${Math.round(m / 1440)} days`);
function messageFor(task) {
  const m = task.reminder?.minutesBefore ?? 0;
  if (!task.dueHasTime) return m >= 1440 ? `"${task.title}" is due ${m >= 2880 ? `in ${Math.floor(m / 1440)} days` : 'tomorrow'}.` : `"${task.title}" is due today.`;
  return `"${task.title}" is due ${human(m)}.`;
}
async function recipientsFor(task) {
  if (!task.organization) return [task.owner];
  const ids = [];
  if (task.assignedTo) ids.push(task.assignedTo);
  if (task.assignedTeam) ids.push(...(await User.find({ teams: task.assignedTeam, isActive: true }).select('_id').lean()).map((u) => u._id));
  return ids.length ? ids : [task.createdBy];
}

// Idempotent and safe to run from several places: each reminder is claimed atomically before sending.
async function runTaskReminders() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - DAY);
  // Reminders missed by more than a day (e.g. server was down) are dropped quietly rather than sent late in a flood.
  await Task.updateMany({ remindAt: { $lt: cutoff }, reminderSent: { $ne: true } }, { reminderSent: true });
  const due = await Task.find({ remindAt: { $lte: now, $gte: cutoff }, reminderSent: { $ne: true }, status: { $in: OPEN } }).limit(500);
  let sent = 0;
  for (const task of due) {
    const claimed = await Task.findOneAndUpdate({ _id: task._id, reminderSent: { $ne: true } }, { reminderSent: true });
    if (!claimed) continue;
    await notify(await recipientsFor(task), { type: 'TASK_REMINDER', title: 'Task reminder', message: messageFor(task), link: '/tasks' });
    sent++;
  }
  return sent;
}
module.exports = { computeRemindAt, applyReminder, runTaskReminders, messageFor };
