const Task = require('../models/Task');
const Team = require('../models/Team');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { escapeRegex, pageParams } = require('../utils/helpers');
const { ROLES } = require('../config/constants');
const svc = require('../services/taskService');
const activity = require('../services/activityService');
const { notify } = require('../services/notificationService');

const POP = [
  { path: 'category', select: 'name color' },
  { path: 'assignedTo', select: 'name email' },
  { path: 'assignedTeam', select: 'name' },
  { path: 'createdBy', select: 'name' },
];
const orgId = (u) => u.organization?._id || u.organization;
const isOrgUser = (u) => u.role === ROLES.ORGANIZATION_OWNER || u.role === ROLES.ORGANIZATION_MEMBER;

function serialize(task, user) {
  const obj = task.toObject ? task.toObject() : task;
  obj.permissions = { editableFields: svc.editableFields(user, obj), canDelete: svc.canDelete(user, obj) };
  return obj;
}
async function findScoped(user, id) {
  const task = await Task.findOne({ _id: id, ...svc.buildScope(user) });
  if (!task) throw new AppError('Task not found.', 404); // 404 (not 403) so IDs of other tenants are not revealed
  return task;
}

exports.list = asyncHandler(async (req, res) => {
  const q = req.query;
  const filter = { ...svc.buildScope(req.user) };
  const and = [];
  if (filter.$or) { and.push({ $or: filter.$or }); delete filter.$or; }
  if (q.search) { const r = new RegExp(escapeRegex(q.search), 'i'); and.push({ $or: [{ title: r }, { description: r }, { note: r }] }); }
  if (q.status) filter.status = q.status;
  if (q.priority) filter.priority = q.priority;
  if (q.category) filter.category = q.category;
  if (isOrgUser(req.user)) {
    if (q.assignedTo) filter.assignedTo = q.assignedTo === 'me' ? req.user._id : q.assignedTo;
    if (q.team) filter.assignedTeam = q.team;
    if (q.view === 'mine') and.push({ $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }] });
    if (q.view === 'team') and.push({ assignedTeam: { $in: req.user.teams || [] } });
  }
  if (q.dueFrom || q.dueTo) {
    filter.dueDate = {};
    if (q.dueFrom) filter.dueDate.$gte = new Date(q.dueFrom);
    if (q.dueTo) filter.dueDate.$lte = new Date(q.dueTo);
  }
  if (q.overdue === 'true') { filter.dueDate = { ...(filter.dueDate || {}), $lt: new Date() }; filter.status = { $in: ['Pending', 'In Progress'] }; }
  if (and.length) filter.$and = and;

  const sortable = ['date', 'title', 'priority', 'status', 'dueDate', 'createdAt', 'updatedAt'];
  const sortField = sortable.includes(q.sort) ? q.sort : 'date';
  const sort = { [sortField]: q.order === 'asc' ? 1 : -1, _id: -1 };
  const { page, limit, skip } = pageParams(q, 50, 1000);

  const [tasks, total] = await Promise.all([
    Task.find(filter).sort(sort).skip(skip).limit(limit).populate(POP).select('-history'),
    Task.countDocuments(filter),
  ]);
  res.json({ success: true, data: tasks.map((t) => serialize(t, req.user)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

exports.get = asyncHandler(async (req, res) => {
  const task = await findScoped(req.user, req.params.id);
  await task.populate(POP);
  res.json({ success: true, data: serialize(task, req.user) });
});

exports.create = asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if (req.user.role === ROLES.ORGANIZATION_MEMBER && !data.assignedTo && !data.assignedTeam) data.assignedTo = req.user._id;
  await svc.validateReferences(req.user, data);
  const doc = { ...data, createdBy: req.user._id, date: data.date || new Date() };
  if (isOrgUser(req.user)) doc.organization = orgId(req.user); else doc.owner = req.user._id;
  for (const k of ['category', 'assignedTo', 'assignedTeam', 'dueDate']) if (!doc[k]) delete doc[k];
  if (doc.status === 'Completed') doc.completedAt = new Date();
  const task = await Task.create(doc);

  await activity.log({ actor: req.user, action: 'TASK_CREATED', message: `Created task "${task.title}"`, organization: task.organization, entityType: 'Task', entityId: task._id });
  await notifyAssignment(req.user, task);
  await task.populate(POP);
  res.status(201).json({ success: true, data: serialize(task, req.user) });
});

async function notifyAssignment(actor, task) {
  const recipients = [];
  if (task.assignedTo) recipients.push(task.assignedTo);
  if (task.assignedTeam) recipients.push(...(await User.find({ teams: task.assignedTeam }).select('_id').lean()).map((u) => u._id));
  await notify(recipients.filter((id) => String(id) !== String(actor._id)), { type: 'TASK_ASSIGNED', title: 'Task assigned', message: `${actor.name} assigned you "${task.title}".`, link: '/tasks' });
}

exports.update = asyncHandler(async (req, res) => {
  const task = await findScoped(req.user, req.params.id);
  const allowed = svc.editableFields(req.user, task);
  const changes = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) throw new AppError(`You are not allowed to change "${k}" on this task.`, 403);
    changes[k] = v;
  }
  if (!Object.keys(changes).length) return res.json({ success: true, data: serialize(await task.populate(POP), req.user) });
  if ('title' in changes && !changes.title) throw new AppError('Title is required.', 400);
  await svc.validateReferences(req.user, changes);

  const history = svc.diffHistory(task, changes, req.user);
  const wasAssignedTo = String(task.assignedTo || ''); const wasTeam = String(task.assignedTeam || '');
  const wasStatus = task.status;
  for (const [k, v] of Object.entries(changes)) task[k] = v === '' ? undefined : v;
  if (changes.status && changes.status !== wasStatus) task.completedAt = changes.status === 'Completed' ? new Date() : undefined;
  if (history.length) task.history.push(...history);
  await task.save();

  const completed = changes.status === 'Completed' && wasStatus !== 'Completed';
  await activity.log({ actor: req.user, action: completed ? 'TASK_COMPLETED' : 'TASK_UPDATED', message: `${completed ? 'Completed' : 'Updated'} task "${task.title}"`, organization: task.organization, entityType: 'Task', entityId: task._id });

  if (isOrgUser(req.user)) {
    if ((changes.assignedTo && String(task.assignedTo) !== wasAssignedTo) || (changes.assignedTeam && String(task.assignedTeam) !== wasTeam)) await notifyAssignment(req.user, task);
    if (completed) await notify([task.createdBy, task.assignedTo].filter((id) => id && String(id) !== String(req.user._id)), { type: 'TASK_COMPLETED', title: 'Task completed', message: `${req.user.name} completed "${task.title}".`, link: '/tasks' });
    else if (history.length && task.assignedTo && String(task.assignedTo) !== String(req.user._id)) await notify(task.assignedTo, { type: 'TASK_UPDATED', title: 'Task updated', message: `${req.user.name} updated "${task.title}".`, link: '/tasks' });
  }
  await task.populate(POP);
  res.json({ success: true, data: serialize(task, req.user) });
});

exports.remove = asyncHandler(async (req, res) => {
  const task = await findScoped(req.user, req.params.id);
  if (!svc.canDelete(req.user, task)) throw new AppError('You are not allowed to delete this task.', 403);
  await task.deleteOne();
  await activity.log({ actor: req.user, action: 'TASK_DELETED', message: `Deleted task "${task.title}"`, organization: task.organization, entityType: 'Task', entityId: task._id });
  res.json({ success: true, message: 'Task deleted.' });
});
