const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const { pageParams } = require('../utils/helpers');

exports.listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 20, 100);
  const filter = { user: req.user._id };
  const [data, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...filter, read: false }),
  ]);
  res.json({ success: true, data, unread, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});
exports.markRead = asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { read: true });
  res.json({ success: true });
});
exports.markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ success: true });
});

exports.listActivity = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 30, 100);
  let filter;
  if (req.user.role === ROLES.SUPER_ADMIN) filter = {};
  else if (req.user.role === ROLES.ORGANIZATION_OWNER) filter = { organization: req.user.organization };
  else if (req.user.role === ROLES.INDIVIDUAL) filter = { actor: req.user._id };
  else throw new AppError('You do not have permission to view activity.', 403);
  if (req.query.action) filter.action = req.query.action;
  const [data, total] = await Promise.all([ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), ActivityLog.countDocuments(filter)]);
  res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});
