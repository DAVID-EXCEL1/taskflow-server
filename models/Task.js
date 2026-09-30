const mongoose = require('mongoose');
const { TASK_PRIORITIES, TASK_STATUSES } = require('../config/constants');

const historySchema = new mongoose.Schema(
  { field: String, from: String, to: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, byName: String, at: { type: Date, default: Date.now } },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 5000 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'Medium' },
    status: { type: String, enum: TASK_STATUSES, default: 'Pending', index: true },
    date: { type: Date, default: Date.now },
    dueDate: Date,
    note: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Scope: personal tasks have `owner` only. Organization tasks have `organization`.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', index: true },
    completedAt: Date,
    history: [historySchema],
  },
  { timestamps: true }
);
schema.index({ organization: 1, status: 1, dueDate: 1 });
module.exports = mongoose.model('Task', schema);
