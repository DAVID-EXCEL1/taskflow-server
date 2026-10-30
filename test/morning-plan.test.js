const test = require('node:test');
const assert = require('node:assert/strict');
const { timeInZone, dayInZone, zonesAtTime, formatPlan, limitPlan } = require('../services/morningPlanService');

test('morning plan scheduling uses the selected local time and timezone date', () => {
  const now = new Date('2026-10-28T07:00:00.000Z');
  assert.equal(timeInZone('Africa/Lagos', now), '08:00');
  assert.equal(dayInZone('Africa/Lagos', now), '2026-10-28');
  assert.deepEqual(zonesAtTime(now, '08:00', ['Africa/Lagos', 'UTC']), ['Africa/Lagos']);
});

test('morning plan message contains concise sections and handles an empty day', () => {
  assert.equal(formatPlan({ sections: [] }), 'You have no open tasks due soon. Enjoy the breathing room, or add anything new to your list.');
  const message = formatPlan({
    sections: [{
      title: 'Due today',
      total: 1,
      items: [{ title: 'Review the budget', priority: 'High', dueDate: '2026-10-28T10:00:00.000Z', dueHasTime: true }],
    }],
  }, 'Africa/Lagos');
  assert.match(message, /Due today \(1\)/);
  assert.match(message, /Review the budget/);
  assert.match(message, /High/);
});

test('provider-limited morning plans keep complete lines and add a pointer to the app', () => {
  const message = limitPlan('Today\n- first task\n- second task\n- third task', 58);
  assert.ok(message.length <= 58);
  assert.match(message, /first task/);
  assert.match(message, /Open Taskflow for the rest\./);
  assert.doesNotMatch(message, /third task/);
});
