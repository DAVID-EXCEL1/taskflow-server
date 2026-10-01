const Category = require('../models/Category');
const Team = require('../models/Team');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { ROLES } = require('../config/constants');

const ALL_FIELDS = ['title', 'description', 'category', 'priority', 'status', 'date', 'dueDate', 'dueHasTime', 'note', 'assignedTo', 'assignedTeam', 'recurrence', 'reminder'];
const ASSIGNEE_FIELDS = ['status', 'note'];

// Query filter limiting tasks to what this user may SEE.
function buildScope(user) {
  const org = user.organization?._id || user.organization;
  switch (user.role) {
    case ROLES.INDIVIDUAL:
      return { owner: user._id, organization: null };
    case ROLES.ORGANIZATION_OWNER:
      return { organization: org };
    case ROLES.ORGANIZATION_MEMBER:
      return { organization: org, $or: [{ assignedTo: user._id }, { createdBy: user._id }, { assignedTeam: { $in: user.teams || [] } }] };
    default:
      throw new AppError('Task management is not available for this account.', 403);
  }
}

// Fields this user may CHANGE on this task.
function editableFields(user, task) {
  if (user.role === ROLES.INDIVIDUAL || user.role === ROLES.ORGANIZATION_OWNER) return ALL_FIELDS;
  if (user.role === ROLES.ORGANIZATION_MEMBER) {
    return String(task.createdBy) === String(user._id) ? ALL_FIELDS : ASSIGNEE_FIELDS;
  }
  return [];
}
const canDelete = (user, task) =>
  user.role === ROLES.INDIVIDUAL || user.role === ROLES.ORGANIZATION_OWNER || (user.role === ROLES.ORGANIZATION_MEMBER && String(task.createdBy) === String(user._id));

// Checks category / assignee / team belong to the caller's scope. Throws otherwise.
async function validateReferences(user, data) {
  const org = user.organization?._id || user.organization;
  if (data.category) {
    const filter = user.role === ROLES.INDIVIDUAL ? { _id: data.category, user: user._id } : { _id: data.category, organization: org };
    if (!(await Category.exists(filter))) throw new AppError('Selected category does not exist.', 400);
  }
  if (user.role === ROLES.INDIVIDUAL) {
    if (data.assignedTo || data.assignedTeam) throw new AppError('Personal accounts cannot assign tasks.', 400);
    return;
  }
  const isMember = user.role === ROLES.ORGANIZATION_MEMBER;
  const myTeams = (user.teams || []).map(String);
  if (data.assignedTeam) {
    if (!(await Team.exists({ _id: data.assignedTeam, organization: org }))) throw new AppError('Selected team does not exist.', 400);
    if (isMember && !myTeams.includes(String(data.assignedTeam))) throw new AppError('You can only assign tasks to your own teams.', 403);
  }
  if (data.assignedTo) {
    const target = await User.findOne({ _id: data.assignedTo, organization: org }).select('teams').lean();
    if (!target) throw new AppError('Selected member does not belong to your organization.', 400);
    if (isMember && String(data.assignedTo) !== String(user._id) && !target.teams.some((t) => myTeams.includes(String(t)))) {
      throw new AppError('You can only assign tasks to yourself or people in your teams.', 403);
    }
  }
}

const HISTORY_FIELDS = ['title', 'status', 'priority', 'dueDate', 'category', 'assignedTo', 'assignedTeam'];
const str = (v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const dueStr = (date, hasTime) => (!date ? '' : hasTime ? new Date(date).toISOString() : new Date(date).toISOString().slice(0, 10));

// Overdue / upcoming rules. Date-only tasks are due at the END of their day; timed tasks at the exact moment.
const startOfTodayUTC = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const overdueClause = (now = new Date()) => ({ $or: [{ dueHasTime: true, dueDate: { $lt: now } }, { dueHasTime: { $ne: true }, dueDate: { $lt: startOfTodayUTC(now) } }] });
const upcomingClause = (now = new Date()) => ({ $or: [{ dueHasTime: true, dueDate: { $gte: now } }, { dueHasTime: { $ne: true }, dueDate: { $gte: startOfTodayUTC(now) } }] });

function diffHistory(task, changes, user) {
  const entries = [];
  for (const f of HISTORY_FIELDS) {
    if (!(f in changes)) continue;
    let before = str(task[f]);
    let after = str(changes[f]);
    if (f === 'dueDate') {
      before = dueStr(task.dueDate, task.dueHasTime);
      after = dueStr(changes.dueDate, changes.dueHasTime ?? task.dueHasTime);
    }
    if (before === after) continue;
    const scalar = ['title', 'status', 'priority', 'dueDate'].includes(f);
    entries.push({ field: f, from: scalar ? before : '', to: scalar ? after : '', by: user._id, byName: user.name, at: new Date() });
  }
  return entries;
}

module.exports = { overdueClause, upcomingClause, buildScope, editableFields, canDelete, validateReferences, diffHistory, ALL_FIELDS };
