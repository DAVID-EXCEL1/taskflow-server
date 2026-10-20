const test = require('node:test'); const assert = require('node:assert/strict');
const { fakeModel } = require('./helpers');
const Task = require('../models/Task'); const User = require('../models/User');
const tasks = fakeModel(Task); const users = fakeModel(User);
const notifications = require('../services/notificationService'); let sent = []; notifications.notify = async (ids, payload) => { sent.push({ ids: [].concat(ids).map(String), ...payload }); };
const nudge = require('../services/overdueNudgeService'); const MIN = 60000;
// 12:00 Lagos (UTC+1) on 5 Oct 2026
const NOON = new Date('2026-10-05T11:00:00Z');
const fresh = () => { tasks.clear(); users.clear(); sent = []; delete process.env.OVERDUE_NUDGE_MAX; };
const person = (over = {}) => users.rows.push({ _id: 'u1', isActive: true, timezone: 'Africa/Lagos', overdueNudge: { everyMinutes: 30, quietFrom: 22, quietTo: 7 }, ...over });
const task = (over = {}) => tasks.rows.push({ _id: `t${tasks.rows.length + 1}`, title: 'Pay the NEPA bill', status: 'Pending', owner: 'u1', organization: null, createdBy: 'u1', dueHasTime: true, dueDate: new Date(NOON - 3 * 3600000), nudge: { count: 0 }, ...over });

test('only people who turned it on are reminded', async () => {
  fresh(); person({ overdueNudge: { everyMinutes: 0, quietFrom: 22, quietTo: 7 } }); task(); await nudge.runOverdueNudges(NOON); assert.equal(sent.length, 0);
  users.rows[0].overdueNudge.everyMinutes = 30; await nudge.runOverdueNudges(NOON); assert.equal(sent.length, 1); assert.equal(sent[0].type, 'TASK_OVERDUE'); assert.match(sent[0].message, /Pay the NEPA bill.*overdue/);
});
test('the chosen interval is respected, then it reminds again', async () => {
  fresh(); person(); task(); await nudge.runOverdueNudges(NOON); assert.equal(sent.length, 1);
  await nudge.runOverdueNudges(new Date(NOON.getTime() + 10 * MIN)); assert.equal(sent.length, 1, 'only 10 minutes later: too soon for a 30-minute setting');
  await nudge.runOverdueNudges(new Date(NOON.getTime() + 31 * MIN)); assert.equal(sent.length, 2);
  users.rows[0].overdueNudge.everyMinutes = 5; await nudge.runOverdueNudges(new Date(NOON.getTime() + 37 * MIN)); assert.equal(sent.length, 3, 'a 5-minute setting reminds again after 5 minutes');
});
test('stops after the maximum number of reminders for a task, and starts afresh when the task is updated', async () => {
  fresh(); person({ overdueNudge: { everyMinutes: 5, quietFrom: 0, quietTo: 0 } }); task(); let now = NOON.getTime();
  for (let i = 0; i < 10; i++) { await nudge.runOverdueNudges(new Date(now)); now += 6 * MIN; }
  assert.equal(sent.length, 6, 'default maximum is 6'); assert.match(sent[5].message, /last reminder/); assert.doesNotMatch(sent[0].message, /last reminder/);
  tasks.rows[0].nudge = { count: 0 }; await nudge.runOverdueNudges(new Date(now)); assert.equal(sent.length, 7, 'a changed date/status resets the count');
  fresh(); process.env.OVERDUE_NUDGE_MAX = '2'; person({ overdueNudge: { everyMinutes: 5, quietFrom: 0, quietTo: 0 } }); task(); now = NOON.getTime(); for (let i = 0; i < 6; i++) { await nudge.runOverdueNudges(new Date(now)); now += 6 * MIN; } assert.equal(sent.length, 2);
});
test('quiet hours: nothing is sent at night in the person\'s own timezone', async () => {
  fresh(); person(); task({ dueDate: new Date('2026-10-04T10:00:00Z') }); // overdue all through the test
  await nudge.runOverdueNudges(new Date('2026-10-05T22:30:00Z')); assert.equal(sent.length, 0, '23:30 in Lagos is inside 22:00 to 07:00');
  await nudge.runOverdueNudges(new Date('2026-10-05T05:30:00Z')); assert.equal(sent.length, 0, '06:30 in Lagos is still quiet');
  await nudge.runOverdueNudges(new Date('2026-10-05T06:30:00Z')); assert.equal(sent.length, 1, '07:30 in Lagos is fine');
  fresh(); person({ timezone: 'America/New_York' }); task({ dueDate: new Date('2026-10-04T10:00:00Z') });
  await nudge.runOverdueNudges(new Date('2026-10-05T04:00:00Z')); assert.equal(sent.length, 0, '00:00 in New York is quiet even though it is 05:00 in Lagos');
  await nudge.runOverdueNudges(new Date('2026-10-05T13:00:00Z')); assert.equal(sent.length, 1, '09:00 in New York is fine');
});
test('only open tasks that are really overdue', async () => {
  fresh(); person();
  task({ status: 'Completed' }); task({ status: 'Cancelled' }); task({ dueDate: new Date(NOON.getTime() + 3600000) }); task({ dueDate: undefined });
  task({ dueHasTime: false, dueDate: new Date('2026-10-05T00:00:00Z') }); // date-only task due TODAY is not overdue until the day ends
  await nudge.runOverdueNudges(NOON); assert.equal(sent.length, 0);
  task({ dueHasTime: false, dueDate: new Date('2026-10-04T00:00:00Z') }); await nudge.runOverdueNudges(NOON); assert.equal(sent.length, 1, 'yesterday\'s date-only task is overdue');
});
test('one grouped notification per person per round, never one per task', async () => {
  fresh(); person(); for (let i = 0; i < 5; i++) task({ title: `Task ${i + 1}`, dueDate: new Date(NOON - (i + 1) * 3600000) });
  await nudge.runOverdueNudges(NOON); assert.equal(sent.length, 1); assert.match(sent[0].message, /5 tasks are overdue/); assert.match(sent[0].message, /and 3 more/);
});
test('whose tasks: own Personal tasks; assigned to me; unassigned ones I created - never someone else\'s', async () => {
  fresh(); person({ _id: 'u1' }); users.rows.push({ _id: 'u2', isActive: true, timezone: 'Africa/Lagos', overdueNudge: { everyMinutes: 30, quietFrom: 22, quietTo: 7 }, organization: 'org1' }); users.rows.push({ _id: 'u3', isActive: true, timezone: 'Africa/Lagos', overdueNudge: { everyMinutes: 30, quietFrom: 22, quietTo: 7 }, organization: 'org1' });
  task({ title: 'My own task' });                                                                                  // u1 personal
  task({ title: 'Assigned to u2', owner: undefined, organization: 'org1', assignedTo: 'u2', createdBy: 'u3' });   // u2 only
  task({ title: 'Unassigned by u3', owner: undefined, organization: 'org1', assignedTo: null, createdBy: 'u3' });  // u3 only
  task({ title: 'Someone else personal', owner: 'u9' });                                                          // nobody here
  await nudge.runOverdueNudges(NOON); const by = Object.fromEntries(sent.map((s) => [s.ids[0], s.message]));
  assert.match(by.u1, /My own task/); assert.doesNotMatch(by.u1, /Assigned to u2|Unassigned|Someone else/);
  assert.match(by.u2, /Assigned to u2/); assert.doesNotMatch(by.u2, /Unassigned/); assert.match(by.u3, /Unassigned by u3/); assert.equal(sent.length, 3);
});
test('two overlapping runs (cron + in-process) can never send the same reminder twice', async () => {
  fresh(); person(); task(); await Promise.all([nudge.runOverdueNudges(NOON), nudge.runOverdueNudges(NOON), nudge.runOverdueNudges(NOON)]); assert.equal(sent.length, 1); assert.equal(tasks.rows[0].nudge.count, 1);
});
test('deactivated people are skipped', async () => {
  fresh(); person({ isActive: false }); task(); await nudge.runOverdueNudges(NOON); assert.equal(sent.length, 0);
});
test('quiet-hours maths, including a window that crosses midnight and an "all day awake" setting', () => {
  assert.equal(nudge.inQuietHours(23, 22, 7), true); assert.equal(nudge.inQuietHours(3, 22, 7), true); assert.equal(nudge.inQuietHours(7, 22, 7), false); assert.equal(nudge.inQuietHours(12, 22, 7), false);
  assert.equal(nudge.inQuietHours(13, 12, 14), true); assert.equal(nudge.inQuietHours(3, 0, 0), false);
});
