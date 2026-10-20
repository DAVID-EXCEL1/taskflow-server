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
    // false = date-only (legacy/all-day, due at end of that day). true = dueDate is an exact moment.
    dueHasTime: { type: Boolean, default: false },
    note: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Scope: personal tasks have `owner` only. Organization tasks have `organization`.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', index: true },
    completedAt: Date,
    // Repeating tasks. `anchor` is the series' original due date (used to avoid month-end drift).
    recurrence: {
      frequency: { type: String, enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'], default: 'none' },
      interval: { type: Number, default: 1, min: 1, max: 365 },
      endDate: Date,
      anchor: Date,
    },
    seriesId: { type: mongoose.Schema.Types.ObjectId, index: true },
    // What FUTURE occurrences are copied from (title, priority...). Lets an edit apply to "this one only" or "all future ones".
    seriesTemplate: mongoose.Schema.Types.Mixed,
    // Overdue reminders already sent for this task (reset when its date or status changes).
    nudge: { count: { type: Number, default: 0 }, lastAt: Date },
    // Reminders: minutesBefore (null = none). remindAt is computed by the server; reminderSent prevents repeats.
    reminder: { minutesBefore: { type: Number, min: 0, max: 10080 } },
    remindAt: { type: Date, index: true },
    reminderSent: { type: Boolean, default: false },
    recurrenceSpawned: { type: Boolean, default: false }, // guards against creating the next occurrence twice
    history: [historySchema],
  },
  { timestamps: true }
);
schema.index({ organization: 1, status: 1, dueDate: 1 });
module.exports = mongoose.model('Task', schema);
