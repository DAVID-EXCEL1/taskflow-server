/**
 * One email a day (about 8am in the person's own timezone) listing their overdue tasks - only if there are some,
 * only to confirmed addresses, and only if they kept "Daily overdue summary" on. Phone/browser reminders are separate.
 */
const Task = require('../models/Task');
const User = require('../models/User');
const email = require('./emailService');
const clientUrl = require('../utils/clientUrl');
const { overdueClause } = require('./taskService');
const { scopeFor } = require('./overdueNudgeService');
const { wantsEmail } = require('./notificationService');
const { DEFAULT_TZ } = require('../utils/timezone');

const HOUR = 8; const OPEN = ['Pending', 'In Progress'];
const hourIn = (tz, now) => { try { return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now)); } catch { return -1; } };
const localDay = (tz, now) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
const zonesAtHour = (now) => { let zones; try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = [DEFAULT_TZ]; } return zones.filter((z) => hourIn(z, now) === HOUR); };
const fmt = (d, tz) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d));

async function runOverdueDigests(now = new Date()) {
  const zones = zonesAtHour(now); if (!zones.length) return { emails: 0 };
  const tzMatch = [{ timezone: { $in: zones } }, ...(zones.includes(DEFAULT_TZ) ? [{ timezone: { $exists: false } }] : [])];
  const users = await User.find({ emailVerified: true, isActive: true, role: { $ne: 'SUPER_ADMIN' }, $or: tzMatch }).select('email timezone organization emailPrefs role').limit(1000);
  let sent = 0;
  for (const u of users) {
    if (!wantsEmail(u, 'overdueDigest')) continue;
    const today = localDay(u.timezone || DEFAULT_TZ, now);
    // Claim today's summary atomically so two overlapping runs can never send it twice.
    const claimed = await User.findOneAndUpdate({ _id: u._id, 'emailPrefs.lastDigestDay': { $ne: today } }, { $set: { 'emailPrefs.lastDigestDay': today } });
    if (!claimed) continue;
    const filter = { $and: [scopeFor(u), overdueClause(now)], status: { $in: OPEN } };
    const items = await Task.find(filter).sort({ dueDate: 1 }).limit(10);
    if (!items.length) continue;
    const total = await Task.countDocuments(filter);
    const mail = email.templates.overdueDigest({ total, items: items.map((t) => ({ title: t.title, due: fmt(t.dueDate) })), url: `${clientUrl()}/tasks` });
    const r = await email.send({ to: u.email, ...mail, kind: 'notification', userId: u._id });
    if (r.sent) sent++;
  }
  return { emails: sent };
}
module.exports = { runOverdueDigests, zonesAtHour, localDay };
