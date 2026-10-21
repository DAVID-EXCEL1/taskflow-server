const test = require('node:test'); const assert = require('node:assert/strict');
const { query, fakeModel } = require('./helpers');
require('../services/subscriptionService').getAccess = async () => ({ state: 'Active' });
const User = require('../models/User'); const Organization = require('../models/Organization');
const users = fakeModel(User); const orgs = fakeModel(Organization); const ctl = require('../controllers/authController');
const call = async (body) => { const out = {}; await ctl.login({ body }, { status() { return this; }, json(b) { out.body = b; } }, (e) => { out.err = e; }); return out; };
const person = (over = {}) => { users.clear(); orgs.clear(); const u = { _id: 'u1', name: 'Ada', email: 'ada@x.com', role: 'INDIVIDUAL', isActive: true, comparePassword: async (p) => p === 'right-password', ...over }; users.rows.push(Object.assign(u, { save: async () => u })); return u; };

test('password login: right password signs in; wrong password and unknown email get the SAME message', async () => {
  person(); assert.ok((await call({ email: 'ada@x.com', password: 'right-password' })).body.token);
  const wrong = await call({ email: 'ada@x.com', password: 'nope' }); const unknown = await call({ email: 'nobody@x.com', password: 'nope' });
  assert.equal(wrong.err.statusCode, 401); assert.equal(unknown.err.statusCode, 401); assert.equal(wrong.err.message, unknown.err.message);
});
test('password login: deactivated accounts, closed organizations and two-factor accounts are handled', async () => {
  person({ isActive: false }); assert.equal((await call({ email: 'ada@x.com', password: 'right-password' })).err.statusCode, 403);
  person({ role: 'ORGANIZATION_MEMBER', organization: 'o1' }); orgs.rows.push({ _id: 'o1', deletion: { scheduledFor: new Date() } }); assert.equal((await call({ email: 'ada@x.com', password: 'right-password' })).err.statusCode, 403);
  person({ twoFactor: { enabled: true } }); const r = await call({ email: 'ada@x.com', password: 'right-password' }); assert.equal(r.body.twoFactorRequired, true); assert.equal(r.body.token, undefined);
});
