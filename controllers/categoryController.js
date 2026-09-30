const Category = require('../models/Category');
const Task = require('../models/Task');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

const scope = (u) => (u.role === ROLES.INDIVIDUAL ? { user: u._id } : { organization: u.organization });
const scopeDoc = (u) => (u.role === ROLES.INDIVIDUAL ? { user: u._id } : { organization: u.organization });

exports.list = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.SUPER_ADMIN) throw new AppError('Not available for this account.', 403);
  res.json({ success: true, data: await Category.find(scope(req.user)).sort({ name: 1 }) });
});
exports.create = asyncHandler(async (req, res) => {
  if (await Category.exists({ ...scope(req.user), name: new RegExp(`^${req.body.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw new AppError('A category with this name already exists.', 409);
  res.status(201).json({ success: true, data: await Category.create({ ...req.body, ...scopeDoc(req.user) }) });
});
exports.update = asyncHandler(async (req, res) => {
  const cat = await Category.findOneAndUpdate({ _id: req.params.id, ...scope(req.user) }, req.body, { new: true, runValidators: true });
  if (!cat) throw new AppError('Category not found.', 404);
  res.json({ success: true, data: cat });
});
exports.remove = asyncHandler(async (req, res) => {
  const cat = await Category.findOneAndDelete({ _id: req.params.id, ...scope(req.user) });
  if (!cat) throw new AppError('Category not found.', 404);
  await Task.updateMany({ category: cat._id }, { $unset: { category: 1 } }); // tasks are kept, just uncategorised
  res.json({ success: true, message: 'Category deleted. Its tasks were kept.' });
});
