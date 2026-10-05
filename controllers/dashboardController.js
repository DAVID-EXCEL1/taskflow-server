const User = require('../models/User');
const Organization = require('../models/Organization');
const Team = require('../models/Team');
const Task = require('../models/Task');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const ActivityLog = require('../models/ActivityLog');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES, PLANS } = require('../config/constants');
const { getAccess } = require('../services/subscriptionService');
const { buildScope, overdueClause, upcomingClause } = require('../services/taskService');

const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
function lastMonths(n) {
  const out = []; const now = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}
const label = (k) => new Date(k + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const series = (keys, rows, field = 'total') => keys.map((k) => ({ month: label(k), value: rows.find((r) => r._id === k)?.[field] || 0 }));

async function taskStats(scope) {
  const now = new Date();
  const [byStatus, overdue] = await Promise.all([
    Task.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Task.countDocuments({ $and: [scope, overdueClause(now), { status: { $in: ['Pending', 'In Progress'] } }] }),
  ]);
  const c = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
  return { total: byStatus.reduce((a, s) => a + s.n, 0), pending: c['Pending'] || 0, inProgress: c['In Progress'] || 0, completed: c['Completed'] || 0, cancelled: c['Cancelled'] || 0, overdue };
}
const POP = [{ path: 'category', select: 'name color' }, { path: 'assignedTo', select: 'name' }, { path: 'assignedTeam', select: 'name' }];

async function adminDashboard() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const months = lastMonths(6);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [totalUsers, individualUsers, orgCount, pendingPayments, activeSubs, allActive, monthRev, revenue, newUsers, payStatus, subActivity] = await Promise.all([
    User.countDocuments({ role: { $ne: ROLES.SUPER_ADMIN } }),
    User.countDocuments({ role: ROLES.INDIVIDUAL }),
    Organization.countDocuments(),
    Payment.countDocuments({ status: 'Pending' }),
    Subscription.find({ status: 'Active', 'holder.deleted': { $ne: true }, startDate: { $lte: now }, endDate: { $gt: now } }).select('plan user organization').lean(),
    Subscription.find({ status: 'Active', 'holder.deleted': { $ne: true } }).select('user organization endDate startDate').lean(),
    Payment.aggregate([{ $match: { status: 'Approved', reviewedAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Payment.aggregate([{ $match: { status: 'Approved', reviewedAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$reviewedAt' } }, total: { $sum: '$amount' } } }]),
    User.aggregate([{ $match: { role: { $ne: ROLES.SUPER_ADMIN }, createdAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, total: { $sum: 1 } } }]),
    Payment.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { status: 'Approved', reviewedAt: { $gte: since } } }, { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$reviewedAt' } }, plan: '$plan' }, n: { $sum: 1 } } }]),
  ]);

  // Expired = accounts that have paid before but have no current period.
  const keyOf = (s) => (s.user ? `u${s.user}` : `o${s.organization}`);
  const currentKeys = new Set(activeSubs.map(keyOf));
  const expiredKeys = new Set(allActive.filter((s) => !currentKeys.has(keyOf(s))).map(keyOf));
  const activeIndividual = new Set(activeSubs.filter((s) => s.plan === 'INDIVIDUAL').map(keyOf)).size;
  const activeBusiness = new Set(activeSubs.filter((s) => s.plan === 'BUSINESS').map(keyOf)).size;

  return {
    stats: {
      totalUsers, individualUsers, organizations: orgCount,
      activeIndividual: activeIndividual, activeBusiness: activeBusiness,
      activeSubscriptions: activeIndividual + activeBusiness,
      expiredSubscriptions: expiredKeys.size, pendingPayments,
      monthRevenue: monthRev[0]?.total || 0,
      expectedRevenue: activeIndividual * PLANS.INDIVIDUAL.price + activeBusiness * PLANS.BUSINESS.price,
    },
    charts: {
      revenue: series(months, revenue),
      newUsers: series(months, newUsers),
      paymentsByStatus: payStatus.map((p) => ({ status: p._id, count: p.n })),
      subscriptionActivity: months.map((k) => ({ month: label(k), Personal: subActivity.find((r) => r._id.m === k && r._id.plan === 'INDIVIDUAL')?.n || 0, Business: subActivity.find((r) => r._id.m === k && r._id.plan === 'BUSINESS')?.n || 0 })),
    },
    recentActivity: await ActivityLog.find().sort({ createdAt: -1 }).limit(8).lean(),
  };
}

exports.get = asyncHandler(async (req, res) => {
  const u = req.user;
  if (u.role === ROLES.SUPER_ADMIN) return res.json({ success: true, kind: 'admin', data: await adminDashboard() });

  const scope = buildScope(u);
  const access = await getAccess(u);
  const stats = await taskStats(scope);
  const recent = await Task.find(scope).sort({ createdAt: -1 }).limit(6).populate(POP).select('-history').lean();
  const upcoming = await Task.find({ $and: [scope, upcomingClause(), { status: { $in: ['Pending', 'In Progress'] } }] }).sort({ dueDate: 1 }).limit(6).populate(POP).select('-history').lean();
  const base = { stats, recent, upcoming, access };

  if (u.role === ROLES.INDIVIDUAL) return res.json({ success: true, kind: 'individual', data: base });

  const org = u.organization;
  const [members, teams] = await Promise.all([User.countDocuments({ organization: org, isActive: true }), Team.countDocuments({ organization: org })]);
  base.stats = { ...stats, members, teams };
  const teamRows = await Task.aggregate([{ $match: { ...scope, assignedTeam: { $ne: null } } }, { $group: { _id: { t: '$assignedTeam', s: '$status' }, n: { $sum: 1 } } }]);
  const teamDocs = await Team.find(u.role === ROLES.ORGANIZATION_OWNER ? { organization: org } : { _id: { $in: u.teams || [] } }).select('name').lean();
  base.teamStats = teamDocs.map((t) => {
    const rows = teamRows.filter((r) => String(r._id.t) === String(t._id));
    const n = (s) => rows.filter((r) => r._id.s === s).reduce((a, r) => a + r.n, 0);
    return { id: t._id, name: t.name, Pending: n('Pending'), 'In Progress': n('In Progress'), Completed: n('Completed'), total: rows.reduce((a, r) => a + r.n, 0) };
  });
  if (u.role === ROLES.ORGANIZATION_OWNER) base.recentActivity = await ActivityLog.find({ organization: org }).sort({ createdAt: -1 }).limit(8).lean();
  res.json({ success: true, kind: u.role === ROLES.ORGANIZATION_OWNER ? 'organization' : 'member', data: base });
});
