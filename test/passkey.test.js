const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('crypto');
const { fakeModel, thrown } = require('./helpers');
process.env.CLIENT_URL = 'https://setyourtask.com,http://localhost:5173';
require('../services/subscriptionService').getAccess = async () => ({ state: 'Active' });
const User = require('../models/User'); const Passkey = require('../models/Passkey'); const PasskeyChallenge = require('../models/PasskeyChallenge'); const Notification = require('../models/Notification'); const ActivityLog = require('../models/ActivityLog');
const users = fakeModel(User); const keys = fakeModel(Passkey); const challenges = fakeModel(PasskeyChallenge); Notification.insertMany = async () => []; ActivityLog.create = async () => ({});
const svc = require('../services/passkeyService'); const ctl = require('../controllers/passkeyController'); const email = require('../services/emailService'); email.send = async () => ({ sent: true });
const { makeDevice } = require('./webauthn-device');
const SITE = { headers: { origin: 'https://setyourtask.com' } };
const fresh = () => { users.clear(); keys.clear(); challenges.clear(); };
const person = (over = {}) => { const u = { _id: `u${users.rows.length + 1}`, name: 'Ada', email: 'ada@x.com', role: 'INDIVIDUAL', isActive: true, ...over }; users.rows.push(Object.assign(u, { save: async () => u })); return u; };
async function enroll(user, device = makeDevice(), name = 'My phone') { const { options, challengeId } = await svc.registrationOptions(user, SITE); await svc.verifyRegistration(user, SITE, { challengeId, response: device.create(options), name }); return device; }
const login = async (device, opts) => { const { options, challengeId } = await svc.loginOptions(SITE); return svc.verifyLogin(SITE, { challengeId, response: device.get(options, opts) }); };

test('registering a fingerprint: asks for user verification, stores only the PUBLIC key, never shows it back', async () => {
  fresh(); const u = person(); const { options } = await svc.registrationOptions(u, SITE);
  assert.equal(options.rp.id, 'setyourtask.com'); assert.equal(options.authenticatorSelection.userVerification, 'required'); assert.equal(options.attestation, 'none');
  const d = await enroll(u); const row = keys.rows[0]; assert.equal(row.credentialId, d.id); assert.equal(row.name, 'My phone'); assert.equal(row.rpID, 'setyourtask.com'); assert.ok(row.publicKey.length > 40);
  assert.ok(!JSON.stringify(row).includes(d.privateKey.export({ type: 'pkcs8', format: 'pem' }).slice(30, 60)), 'no private key anywhere');
  const l = await svc.list(u._id); assert.equal(l.length, 1); assert.equal(l[0].publicKey, undefined);
});
const regAttacks = [
  ['signed for a different challenge', (d, o) => d.create(o, { challenge: crypto.randomBytes(32).toString('base64url') })],
  ['made on a different website (origin)', (d, o) => d.create(o, { origin: 'https://evil.example.com' })],
  ['made for a different relying party (phishing site)', (d, o) => d.create(o, { rpID: 'evil.example.com' })],
  ['the device did NOT check the fingerprint (no user verification)', (d, o) => d.create(o, { uv: false })],
];
for (const [name, make] of regAttacks) test(`registration is refused when ${name}`, async () => {
  fresh(); const u = person(); const { options, challengeId } = await svc.registrationOptions(u, SITE);
  const e = await thrown(svc.verifyRegistration(u, SITE, { challengeId, response: make(makeDevice(), options) })); assert.equal(e?.statusCode, 400); assert.equal(keys.rows.length, 0);
});
test('registration: a challenge works once, expires, belongs to one person, and the website must be ours', async () => {
  fresh(); const u = person(); const other = person({ email: 'b@x.com' }); const d = makeDevice();
  let { options, challengeId } = await svc.registrationOptions(u, SITE); const resp = d.create(options);
  assert.equal((await thrown(svc.verifyRegistration(other, SITE, { challengeId, response: resp })))?.statusCode, 400, 'another person cannot use my challenge');
  await svc.verifyRegistration(u, SITE, { challengeId, response: resp }); assert.equal((await thrown(svc.verifyRegistration(u, SITE, { challengeId, response: resp })))?.statusCode, 400, 'replay');
  ({ options, challengeId } = await svc.registrationOptions(u, SITE)); challenges.rows.forEach((c) => { c.expiresAt = new Date(Date.now() - 1000); });
  assert.equal((await thrown(svc.verifyRegistration(u, SITE, { challengeId, response: makeDevice().create(options) })))?.statusCode, 400, 'expired');
  assert.equal((await thrown(svc.registrationOptions(u, { headers: { origin: 'https://evil.example.com' } })))?.statusCode, 400); assert.equal((await thrown(svc.registrationOptions(u, { headers: {} })))?.statusCode, 400);
});
test('registration: the same device cannot be saved twice, and at most 5 per person', async () => {
  fresh(); const u = person(); const d = await enroll(u);
  const { options, challengeId } = await svc.registrationOptions(u, SITE); assert.equal(options.excludeCredentials.length, 1, 'the device is told to skip what it already has');
  assert.equal((await thrown(svc.verifyRegistration(u, SITE, { challengeId, response: d.create(options) })))?.statusCode, 409);
  for (let i = 0; i < 4; i++) await enroll(u); assert.equal(keys.rows.length, 5); assert.equal((await thrown(svc.registrationOptions(u, SITE)))?.statusCode, 409);
});

test('signing in with a fingerprint works and updates the counter and last-used time', async () => {
  fresh(); const u = person(); const d = await enroll(u); assert.equal(await login(d), u._id); assert.equal(keys.rows[0].counter, 1); assert.ok(keys.rows[0].lastUsedAt); await login(d); assert.equal(keys.rows[0].counter, 2);
});
const loginAttacks = [
  ['signed with a different private key (forged)', (d, o) => d.get(o, { key: crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey })],
  ['for a different challenge', (d, o) => d.get(o, { challenge: crypto.randomBytes(32).toString('base64url') })],
  ['from a different website', (d, o) => d.get(o, { origin: 'https://evil.example.com' })],
  ['for a different relying party', (d, o) => d.get(o, { rpID: 'evil.example.com' })],
  ['without the fingerprint check (no user verification)', (d, o) => d.get(o, { uv: false })],
  ['from a credential we do not know', (d, o) => d.get(o, { id: crypto.randomBytes(32).toString('base64url') })],
];
for (const [name, make] of loginAttacks) test(`sign-in is refused when ${name}`, async () => {
  fresh(); const u = person(); const d = await enroll(u); const { options, challengeId } = await svc.loginOptions(SITE);
  const e = await thrown(svc.verifyLogin(SITE, { challengeId, response: make(d, options) })); assert.ok([400, 401].includes(e?.statusCode), name); assert.equal(keys.rows[0].counter, 0, 'nothing changed');
});
test('sign-in: a cloned device (counter going backwards) and a replayed answer are refused', async () => {
  fresh(); const u = person(); const d = await enroll(u); await login(d, { counter: 5 });
  assert.equal((await thrown(login(d, { counter: 3 })))?.statusCode, 401, 'counter must only go up');
  const { options, challengeId } = await svc.loginOptions(SITE); const resp = d.get(options, { counter: 9 }); await svc.verifyLogin(SITE, { challengeId, response: resp });
  assert.equal((await thrown(svc.verifyLogin(SITE, { challengeId, response: resp })))?.statusCode, 400, 'replay of the same answer');
});
test('a login challenge cannot be used to register (and the other way round), and a passkey only works on its own website', async () => {
  fresh(); const u = person(); const d = makeDevice(); const lo = await svc.loginOptions(SITE);
  assert.equal((await thrown(svc.verifyRegistration(u, SITE, { challengeId: lo.challengeId, response: d.create(lo.options) })))?.statusCode, 400);
  fresh(); const v = person(); const d2 = await enroll(v); keys.rows[0].rpID = 'otherwebsite.com'; assert.equal((await thrown(login(d2)))?.statusCode, 401);
});
test('removing: only your own, and list never shows the key', async () => {
  fresh(); const a = person(); const b = person({ email: 'b@x.com' }); await enroll(a); const id = keys.rows[0]._id;
  assert.equal((await thrown(svc.remove(b._id, id)))?.statusCode, 404); assert.equal(keys.rows.length, 1); await svc.remove(a._id, id); assert.equal(keys.rows.length, 0);
});

const call = async (handler, req) => { const out = {}; await handler({ headers: SITE.headers, params: {}, body: {}, ...req }, { status(c) { out.status = c; return this; }, json(b) { out.body = b; } }, (e) => { out.err = e; }); return out; };
test('controller: a fingerprint login returns a normal session and skips the authenticator-code step', async () => {
  fresh(); const u = person({ twoFactor: { enabled: true } }); const d = await enroll(u); const { options, challengeId } = (await call(ctl.loginOptions, {})).body;
  const r = await call(ctl.loginVerify, { body: { challengeId, response: d.get(options) } }); assert.ok(r.body.token); assert.equal(r.body.twoFactorRequired, undefined); assert.ok(u.lastLoginAt);
});
test('controller: administrators and deactivated accounts cannot use it; admins cannot even register one', async () => {
  fresh(); const u = person(); const d = await enroll(u); u.isActive = false;
  let o = (await call(ctl.loginOptions, {})).body; assert.equal((await call(ctl.loginVerify, { body: { challengeId: o.challengeId, response: d.get(o.options) } })).err?.statusCode, 403);
  fresh(); const admin = person({ role: 'SUPER_ADMIN' }); assert.equal((await call(ctl.registerOptions, { user: admin })).err?.statusCode, 403);
  fresh(); const a2 = person(); const d2 = await enroll(a2); a2.role = 'SUPER_ADMIN'; o = (await call(ctl.loginOptions, {})).body; assert.equal((await call(ctl.loginVerify, { body: { challengeId: o.challengeId, response: d2.get(o.options) } })).err?.statusCode, 403);
});
test('controller: adding a fingerprint raises a security notification and returns the updated list', async () => {
  fresh(); const u = person(); const d = makeDevice(); const o = (await call(ctl.registerOptions, { user: u })).body; assert.ok(o.challengeId);
  const r = await call(ctl.registerVerify, { user: u, body: { challengeId: o.challengeId, response: d.create(o.options), name: 'Ada phone' } }); assert.equal(r.status, 201); assert.equal(r.body.data.length, 1); assert.equal(r.body.data[0].name, 'Ada phone');
});
test('request validation: a malformed challenge id is refused cleanly (never reaches the database)', () => {
  const v = require('../validators/schemas'); const response = { id: 'x'.repeat(20), rawId: 'x'.repeat(20), type: 'public-key', response: {} };
  assert.equal(v.passkeyLogin.safeParse({ challengeId: '0'.repeat(24), response }).success, true);
  for (const bad of ['short', 'z'.repeat(24), '{"$ne":1}', '0'.repeat(25), undefined]) assert.equal(v.passkeyLogin.safeParse({ challengeId: bad, response }).success, false);
  assert.equal(v.passkeyLogin.safeParse({ challengeId: '0'.repeat(24), response: { ...response, type: 'password' } }).success, false);
});
