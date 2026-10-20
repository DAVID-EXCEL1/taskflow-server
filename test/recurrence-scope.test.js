const test = require('node:test'); const assert = require('node:assert/strict');
const rs = require('../utils/recurrenceScope');
const weekly = () => ({ title: 'Team stand-up', description: 'Daily sync', priority: 'Medium', category: 'c1', assignedTo: 'u1', assignedTeam: 't1', note: 'bring laptop', reminder: { minutesBefore: 10 }, recurrence: { frequency: 'weekly', interval: 1 } });
// Mirrors what the update handler does: capture BEFORE applying, apply, then record for "future".
const edit = (task, changes, scope) => { rs.captureTemplate(task, changes); Object.assign(task, changes); rs.applyFuture(task, changes, scope); return task; };

test('a task that does not repeat never gets a template', () => {
  const t = { title: 'One off', recurrence: { frequency: 'none' } }; edit(t, { title: 'Changed' }, 'future'); assert.equal(t.seriesTemplate, undefined);
  assert.equal(rs.fieldsForNext(t).title, 'Changed');
});
test('"only this one": this occurrence changes, the NEXT one keeps the original', () => {
  const t = edit(weekly(), { title: 'Stand-up (guest speaker today)', priority: 'High' }, 'this');
  const n = rs.fieldsForNext(t); assert.equal(t.title, 'Stand-up (guest speaker today)'); assert.equal(n.title, 'Team stand-up'); assert.equal(n.priority, 'Medium'); assert.equal(n.assignedTo, 'u1');
});
test('"this and all future ones": the next occurrence gets the new values', () => {
  const t = edit(weekly(), { title: 'Stand-up (new name)', priority: 'High', assignedTo: 'u2' }, 'future');
  const n = rs.fieldsForNext(t); assert.equal(n.title, 'Stand-up (new name)'); assert.equal(n.priority, 'High'); assert.equal(n.assignedTo, 'u2'); assert.equal(n.assignedTeam, 't1', 'untouched fields stay as they were');
});
test('edits made in sequence: a "this one" edit after a "future" edit does not undo the future change', () => {
  const t = edit(weekly(), { title: 'New name' }, 'future'); edit(t, { priority: 'Urgent' }, 'this');
  const n = rs.fieldsForNext(t); assert.equal(n.title, 'New name'); assert.equal(n.priority, 'Medium');
  edit(t, { priority: 'Low' }, 'future'); assert.equal(rs.fieldsForNext(t).priority, 'Low');
});
test('the reminder is part of the series template, and clearing it works', () => {
  const t = edit(weekly(), { reminder: { minutesBefore: 60 } }, 'this'); assert.equal(rs.fieldsForNext(t).reminder.minutesBefore, 10);
  const u = edit(weekly(), { reminder: { minutesBefore: null } }, 'future'); assert.equal(rs.fieldsForNext(u).reminder, null);
});
test('status, notes and dates are not template fields, so they never need a template', () => {
  const t = weekly(); assert.equal(rs.touchesTemplate({ status: 'Completed', note: 'x', dueDate: new Date() }), false);
  edit(t, { note: 'new note' }, 'future'); assert.equal(t.seriesTemplate, undefined);
});
test('legacy repeating tasks (no template yet) behave exactly as before until they are edited', () => {
  const t = weekly(); const n = rs.fieldsForNext(t); assert.equal(n.title, 'Team stand-up'); assert.equal(n.reminder.minutesBefore, 10);
});
