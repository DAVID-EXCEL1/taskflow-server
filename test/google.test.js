const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('crypto'); const jwt = require('jsonwebtoken');
const { query, fakeModel, thrown } = require('./helpers');
require('../services/subscriptionService').getAccess = async () => ({ state: 'Active' }); // before the controller is loaded
const User = require('../models/User'); const Category = require('../models/Category'); const Organization = require('../models/Organization'); const ActivityLog = require('../models/ActivityLog'); const Notification = require('../models/Notification');
const users = fakeModel(User); const orgs = fakeModel(Organization); let cats = []; Category.insertMany = async (rows) => { cats.push(...rows); return rows; }; ActivityLog.create = async () => ({}); Notification.insertMany = async () => [];
const google = require('../services/googleAuth'); const ctl = require('../controllers/authController'); const v = require('../validators/schemas');
const CLIENT = google.DEFAULT_CLIENT_ID;

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
let fetches = 0; let googleDown = false;
global.fetch = async () => { fetches++; if (googleDown) throw new Error('offline'); return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) }; };
const claims = (over = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'g-123', email: 'Ada@Example.com', email_verified: true, name: 'Ada Obi', ...over });
const sign = (c, { key = privateKey, kid = 'k1', alg = 'RS256', exp = '5m' } = {}) => jwt.sign(c, key, { algorithm: alg, keyid: kid, expiresIn: exp });

test('a genuine Google token is accepted and the profile is cleaned up', async () => {
  google._reset(); const g = await google.verifyIdToken(sign(claims())); assert.deepEqual(g, { sub: 'g-123', email: 'ada@example.com', name: 'Ada Obi' });
});
const attacks = [
  ['meant for a different app (wrong audience)', () => sign(claims({ aud: 'someone-elses-app.apps.googleusercontent.com' }))],
  ['not issued by Google (wrong issuer)', () => sign(claims({ iss: 'https://evil.example.com' }))],
  ['expired', () => sign(claims(), { exp: '-1h' })],
  ['signed with a different key', () => sign(claims(), { key: other.privateKey })],
  ['unsigned ("alg: none")', () => `${Buffer.from('{"alg":"none","typ":"JWT","kid":"k1"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims())).toString('base64url')}.`],
  ['key-confusion: HS256 signed with the public key', () => jwt.sign(claims(), publicKey.export({ type: 'spki', format: 'pem' }), { algorithm: 'HS256', keyid: 'k1', expiresIn: '5m' })],
  ['key id Google does not publish', () => sign(claims(), { kid: 'nope' })],
  ['payload tampered after signing', () => { const [h, , s] = sign(claims()).split('.'); return `${h}.${Buffer.from(JSON.stringify(claims({ email: 'boss@victim.com' }))).toString('base64url')}.${s}`; }],
  ['no email', () => sign(claims({ email: undefined }))],
  ['garbage', () => 'not-a-token'],
];
for (const [name, make] of attacks) test(`rejects a token that is ${name}`, async () => { google._reset(); const e = await thrown(google.verifyIdToken(make())); assert.equal(e?.statusCode, 401, name); });
test('rejects a Google account whose email is not confirmed (so nobody can claim an address they do not own)', async () => {
  google._reset(); const e = await thrown(google.verifyIdToken(sign(claims({ email_verified: false })))); assert.equal(e?.statusCode, 401); assert.match(e.message, /not confirmed/);
});
test('Google\'s keys are cached; if Google is unreachable the cached keys still work, and with none we fail politely', async () => {
  google._reset(); fetches = 0; await google.verifyIdToken(sign(claims())); await google.verifyIdToken(sign(claims())); assert.equal(fetches, 1);
  googleDown = true; assert.ok(await google.verifyIdToken(sign(claims())), 'cached keys still verify'); google._reset(); const e = await thrown(google.verifyIdToken(sign(claims()))); assert.equal(e?.statusCode, 502); googleDown = false;
});
test('the sign-up ticket expires, cannot be forged, and no other token can be used as one', () => {
  const t = google.signSignup({ sub: 'g1', email: 'a@x.com', name: 'A B' }); assert.deepEqual(google.readSignup(t), { sub: 'g1', email: 'a@x.com', name: 'A B' });
  for (const bad of [jwt.sign({ purpose: 'google-signup', sub: 'g', email: 'a@x.com' }, 'wrong-secret'), jwt.sign({ id: 'u1' }, process.env.JWT_SECRET), jwt.sign({ id: 'u1', purpose: '2fa' }, process.env.JWT_SECRET), jwt.sign({ purpose: 'google-signup', sub: 'g', email: 'a@x.com' }, process.env.JWT_SECRET, { expiresIn: '-1m' }), 'junk']) assert.throws(() => google.readSignup(bad), /expired|again/);
});

// ---- the controller flows ----
const call = async (handler, body) => { const out = {}; await handler({ body }, { status(c) { out.status = c; return this; }, json(b) { out.body = b; } }, (e) => { out.err = e; }); return out; };
const useGoogle = (g) => { google.verifyIdToken = async () => g; };
const profile = { sub: 'g-123', email: 'ada@example.com', name: 'Ada Obi' };
const fresh = () => { users.clear(); orgs.clear(); cats = []; };
const member = (over = {}) => { const u = { _id: `u${users.rows.length + 1}`, name: 'Ada', email: 'ada@example.com', role: 'INDIVIDUAL', isActive: true, emailVerified: true, password: 'hash', ...over }; users.rows.push(Object.assign(u, { save: async () => u })); return u; };

test('a new person gets a sign-up ticket and no account is made yet', async () => {
  fresh(); useGoogle(profile); const r = await call(ctl.googleLogin, { credential: 'x'.repeat(30) }); assert.equal(r.body.needsSignup, true); assert.deepEqual(r.body.profile, { name: 'Ada Obi', email: 'ada@example.com' }); assert.ok(r.body.signupToken); assert.equal(users.rows.length, 0); assert.equal(r.body.token, undefined);
});
test('finishing sign-up creates a confirmed Personal account with a password nobody knows', async () => {
  fresh(); useGoogle(profile); const t = (await call(ctl.googleLogin, { credential: 'x'.repeat(30) })).body.signupToken;
  const r = await call(ctl.googleComplete, { signupToken: t, accountType: 'PERSONAL', acceptTerms: true }); assert.equal(r.status, 201); assert.ok(r.body.token);
  const u = users.rows[0]; assert.equal(u.email, 'ada@example.com'); assert.equal(u.role, 'INDIVIDUAL'); assert.equal(u.googleId, 'g-123'); assert.equal(u.emailVerified, true); assert.ok(u.termsAcceptedAt); assert.ok(u.password.length >= 32); assert.ok(cats.length > 0);
});
test('finishing sign-up for a Business creates the organization; Business needs organization details; Terms must be accepted', async () => {
  fresh(); useGoogle(profile); const t = (await call(ctl.googleLogin, { credential: 'x'.repeat(30) })).body.signupToken;
  const r = await call(ctl.googleComplete, { signupToken: t, accountType: 'BUSINESS', organization: { name: 'Acme Ltd', type: 'Technology' }, acceptTerms: true }); assert.equal(r.status, 201); assert.equal(users.rows[0].role, 'ORGANIZATION_OWNER'); assert.equal(orgs.rows[0].name, 'Acme Ltd');
  const ok = { signupToken: 'x'.repeat(30), accountType: 'PERSONAL', acceptTerms: true };
  assert.equal(v.googleComplete.safeParse(ok).success, true); assert.equal(v.googleComplete.safeParse({ ...ok, acceptTerms: false }).success, false); assert.equal(v.googleComplete.safeParse({ ...ok, accountType: 'BUSINESS' }).success, false); assert.equal(v.googleComplete.safeParse({ ...ok, accountType: 'ADMIN' }).success, false);
});
test('a ticket cannot create a second account for an address that already has one, and a bad ticket is refused', async () => {
  fresh(); useGoogle(profile); const t = (await call(ctl.googleLogin, { credential: 'x'.repeat(30) })).body.signupToken; member();
  assert.equal((await call(ctl.googleComplete, { signupToken: t, accountType: 'PERSONAL', acceptTerms: true })).err?.statusCode, 409);
  assert.equal((await call(ctl.googleComplete, { signupToken: 'f'.repeat(40), accountType: 'PERSONAL', acceptTerms: true })).err?.statusCode, 400); assert.equal(users.rows.length, 1);
});
test('an existing confirmed account signs in with Google and is linked', async () => {
  fresh(); const u = member(); useGoogle(profile); const r = await call(ctl.googleLogin, { credential: 'x'.repeat(30) }); assert.ok(r.body.token); assert.equal(u.googleId, 'g-123'); assert.equal(u.password, 'hash', 'the password is untouched when the address was already confirmed');
});
test('SAFETY: an account whose email was never confirmed has its old password retired when Google proves who owns the address', async () => {
  fresh(); const u = member({ emailVerified: false, password: 'attackers-password-hash' }); useGoogle(profile); const r = await call(ctl.googleLogin, { credential: 'x'.repeat(30) });
  assert.ok(r.body.token); assert.notEqual(u.password, 'attackers-password-hash'); assert.ok(u.password.length >= 32); assert.ok(u.passwordChangedAt, 'old sessions end'); assert.equal(u.emailVerified, true);
});
test('Google never bypasses two-factor authentication', async () => {
  fresh(); member({ twoFactor: { enabled: true } }); useGoogle(profile); const r = await call(ctl.googleLogin, { credential: 'x'.repeat(30) }); assert.equal(r.body.twoFactorRequired, true); assert.ok(r.body.challengeToken); assert.equal(r.body.token, undefined);
});
test('refused: deactivated accounts, administrators, and an email linked to a different Google account', async () => {
  fresh(); member({ isActive: false }); useGoogle(profile); assert.equal((await call(ctl.googleLogin, { credential: 'x'.repeat(30) })).err?.statusCode, 403);
  fresh(); member({ role: 'SUPER_ADMIN' }); assert.equal((await call(ctl.googleLogin, { credential: 'x'.repeat(30) })).err?.statusCode, 403);
  fresh(); member({ googleId: 'someone-else' }); assert.equal((await call(ctl.googleLogin, { credential: 'x'.repeat(30) })).err?.statusCode, 409);
});
test('a failed Google check creates nothing and signs nobody in', async () => {
  fresh(); google.verifyIdToken = async () => { const E = require('../utils/AppError'); throw new E('Google sign-in failed. Please try again.', 401); };
  const r = await call(ctl.googleLogin, { credential: 'x'.repeat(30) }); assert.equal(r.err?.statusCode, 401); assert.equal(users.rows.length, 0);
});
test('the request must carry a credential', () => { assert.equal(v.googleLogin.safeParse({}).success, false); assert.equal(v.googleLogin.safeParse({ credential: 'short' }).success, false); });
