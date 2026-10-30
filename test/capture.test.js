const test = require('node:test');
const assert = require('node:assert/strict');
const TaskCapture = require('../models/TaskCapture');
const capture = require('../services/captureService');

test('capture deduplication is idempotent per user without suppressing another user', async () => {
  const originalFindOne = TaskCapture.findOne;
  const originalCreate = TaskCapture.create;
  const records = new Map();
  TaskCapture.findOne = ({ sourceId }) => ({ lean: async () => records.get(sourceId) || null });
  TaskCapture.create = async (item) => {
    if (records.has(item.sourceId)) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    const saved = { ...item, _id: String(records.size + 1) };
    records.set(item.sourceId, saved);
    return saved;
  };
  try {
    const first = await capture.create({ user: 'user-a', source: 'email', sourceId: 'message-1', content: 'Review the proposal.' });
    const duplicate = await capture.create({ user: 'user-a', source: 'email', sourceId: 'message-1', content: 'Review the proposal.' });
    const otherUser = await capture.create({ user: 'user-b', source: 'email', sourceId: 'message-1', content: 'Review the proposal.' });
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.capture._id, first.capture._id);
    assert.equal(otherUser.duplicate, false);
    assert.notEqual(otherUser.capture.sourceId, first.capture.sourceId);
  } finally {
    TaskCapture.findOne = originalFindOne;
    TaskCapture.create = originalCreate;
  }
});
