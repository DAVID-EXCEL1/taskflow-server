const test = require('node:test');
const assert = require('node:assert/strict');
const AssistantToken = require('../models/AssistantToken');
const controller = require('../controllers/captureController');

async function callRevoke() {
  let response;
  let error;
  await controller.revokeAssistantToken(
    { user: { _id: 'user-id' } },
    { json: (body) => { response = body; } },
    (err) => { error = err; }
  );
  return { response, error };
}

test('revoking an assistant key confirms the user has no remaining key', async () => {
  const originalDeleteMany = AssistantToken.deleteMany;
  const originalExists = AssistantToken.exists;
  try {
    AssistantToken.deleteMany = async () => ({ deletedCount: 1 });
    AssistantToken.exists = async () => null;
    const { response, error } = await callRevoke();
    assert.equal(error, undefined);
    assert.deepEqual(response.data, { enabled: false, revoked: true });

    AssistantToken.deleteMany = async () => ({ deletedCount: 0 });
    const alreadyRevoked = await callRevoke();
    assert.equal(alreadyRevoked.error, undefined);
    assert.deepEqual(alreadyRevoked.response.data, { enabled: false, revoked: false });
  } finally {
    AssistantToken.deleteMany = originalDeleteMany;
    AssistantToken.exists = originalExists;
  }
});

test('revoking reports an error if a key remains enabled', async () => {
  const originalDeleteMany = AssistantToken.deleteMany;
  const originalExists = AssistantToken.exists;
  try {
    AssistantToken.deleteMany = async () => ({ deletedCount: 0 });
    AssistantToken.exists = async () => ({ _id: 'still-enabled' });
    const { response, error } = await callRevoke();
    assert.equal(response, undefined);
    assert.equal(error.statusCode, 500);
    assert.match(error.message, /could not be revoked/i);
  } finally {
    AssistantToken.deleteMany = originalDeleteMany;
    AssistantToken.exists = originalExists;
  }
});
