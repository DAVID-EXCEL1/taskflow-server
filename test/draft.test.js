const test = require('node:test');
const assert = require('node:assert/strict');
const draft = require('../services/draftService');

test('AI drafts normalize task fields and only retain available organization assignments', () => {
  const parsed = draft.parseDrafts(JSON.stringify([{
    title: 'Review budget',
    date: 'tomorrow',
    when: 'Friday 9am',
    note: 'Bring the latest figures',
    status: 'In Progress',
    priority: 'High',
    category: 'Finance',
    assignedTo: 'Amina Bello',
    assignedTeam: 'Operations',
  }]), ['Finance'], {
    members: [{ id: 'member-id', name: 'Amina Bello' }],
    teams: [{ id: 'team-id', name: 'Operations' }],
  });

  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], {
    title: 'Review budget',
    description: null,
    date: 'tomorrow',
    note: 'Bring the latest figures',
    when: 'Friday 9am',
    priority: 'High',
    status: 'In Progress',
    category: 'Finance',
    assignedTo: 'member-id',
    assignedTeam: 'team-id',
    repeat: null,
    remind: null,
  });
});

test('AI drafts discard invalid or ambiguous assignment names and statuses', () => {
  const parsed = draft.parseDrafts(JSON.stringify([{
    title: 'Prepare report',
    assignedTo: 'Alex',
    assignedTeam: 'Unknown team',
    status: 'Blocked',
  }]), [], {
    members: [{ id: 'member-one', name: 'Alex' }, { id: 'member-two', name: 'Alex' }],
    teams: [],
  });

  assert.equal(parsed[0].assignedTo, null);
  assert.equal(parsed[0].assignedTeam, null);
  assert.equal(parsed[0].status, null);
});

test('AI prompt receives only the available assignment names', () => {
  const messages = draft.buildMessages('Assign the report to Amina', [], {
    members: [{ id: 'member-id', name: 'Amina Bello' }],
    teams: [{ id: 'team-id', name: 'Operations' }],
  });
  assert.match(messages[0].content, /Amina Bello/);
  assert.match(messages[0].content, /Operations/);
});
