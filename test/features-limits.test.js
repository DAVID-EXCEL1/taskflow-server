const test = require('node:test'); const assert = require('node:assert/strict');
const { fakeModel, fakeSettings, fakeUsage, matches, thrown } = require('./helpers');
const KEYS = { AT_USERNAME: 'sandbox', AT_API_KEY: 'k', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_SECRET: 's', WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1', MAILGUN_INBOUND_DOMAIN: 'in.x.com', MAILGUN_SIGNING_KEY: 'm', GOOGLE_CLIENT_SECRET: 'g', GOOGLE_CALENDAR_REDIRECT_URI: 'https://x/cb' };
const setKeys = () => Object.assign(process.env, KEYS); const clearKeys = () => Object.keys(KEYS).forEach((k) => delete process.env[k]);
const User = require('../models/User'); const Task = require('../models/Task'); const TaskCapture = require('../models/TaskCapture'); const WhatsAppLink = require('../models/WhatsAppLink');
const users = fakeModel(User); const tasks = fakeModel(Task); const links = fakeModel(WhatsAppLink); const caps = fakeModel(TaskCapture); const settings = fakeSettings(); const usage = fakeUsage();
User.distinct = async (field, f) => [...new Set(users.rows.filter((r) => matches(r, f)).map((r) => field.split('.').reduce((a, k) => a?.[k], r)))];
const features = require('../services/featureService'); const sms = require('../services/smsService'); const whatsapp = require('../services/whatsappService'); const notifications = require('../services/notificationService');
const morning = require('../services/morningPlanService'); const authCtl = require('../controllers/authController'); const capture = require('../services/captureService'); const cap = require('../services/dailyCap');
const realSend = sms.sendSms; let texts = []; let waSent = []; let notified = [];
sms.sendSms = async (a) => { texts.push(a); }; whatsapp.sendMorningPlan = async (to, m) => { waSent.push({ to, m }); }; notifications.notify = async (ids, p) => { notified.push(p); };
const fresh = () => { settings.clear(); features._reset(); users.clear(); tasks.clear(); links.clear(); caps.clear(); usage.clear(); texts = []; waSent = []; notified = []; clearKeys(); };
const ADMIN = '507f1f77bcf86cd799439011';

test('every paid feature is hidden until the admin switches it on, even when its keys are present', async () => {
  fresh(); setKeys(); assert.deepEqual(await features.mine(), { sms: false, whatsapp: false, emailForwarding: false, calendar: false });
  await features.setEnabled('sms', true, ADMIN); assert.deepEqual(await features.mine(), { sms: true, whatsapp: false, emailForwarding: false, calendar: false });
});
test('switched on but the server keys are missing: still hidden, and the admin is told exactly which keys', async () => {
  fresh(); await features.setEnabled('whatsapp', true, ADMIN); assert.equal((await features.mine()).whatsapp, false);
  const w = (await features.adminView()).find((f) => f.key === 'whatsapp'); assert.equal(w.enabled, true); assert.equal(w.available, false); assert.deepEqual(w.missing, ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']);
  process.env.WHATSAPP_VERIFY_TOKEN = 'x'; assert.equal((await features.adminView()).find((f) => f.key === 'whatsapp').missing.length, 3);
});
test('switching off hides it again; an unknown feature is refused; the user view carries only true/false', async () => {
  fresh(); setKeys(); await features.setEnabled('calendar', true, ADMIN); assert.equal((await features.mine()).calendar, true); await features.setEnabled('calendar', false, ADMIN); assert.equal((await features.mine()).calendar, false);
  assert.equal((await thrown(features.setEnabled('rocket', true, ADMIN)))?.statusCode, 400); assert.ok(Object.values(await features.mine()).every((v) => typeof v === 'boolean'));
});
test('the server answers a hidden feature exactly like a route that does not exist (404), and lets it through when on', async () => {
  fresh(); setKeys(); const guard = features.requireFeature('sms'); let out;
  await guard({ method: 'POST', originalUrl: '/api/auth/phone/send-code' }, {}, (e) => { out = e; }); assert.equal(out.statusCode, 404); assert.match(out.message, /Route not found/);
  await features.setEnabled('sms', true, ADMIN); out = 'x'; await guard({ method: 'POST', originalUrl: '/api/auth/phone/send-code' }, {}, (e) => { out = e; }); assert.equal(out, undefined, 'next() with no error');
});

const NOW = new Date('2026-10-28T07:00:00.000Z'); // 08:00 in Lagos
const person = (id = 'u1') => { users.rows.push(Object.assign({ _id: id, isActive: true, role: 'INDIVIDUAL', timezone: 'Africa/Lagos', morningPlan: { enabled: true, time: '08:00', sms: true, whatsapp: true }, smsPhone: '+2348111189267', smsVerifiedAt: new Date() }, { save: async () => {} })); links.rows.push({ user: id, phone: '2348111189267' }); tasks.rows.push({ _id: `t${id}`, owner: id, organization: null, title: 'Pay rent', status: 'Pending', priority: 'High', dueDate: new Date('2026-10-28T10:00:00Z'), dueHasTime: true }); };
test('morning plan: while SMS and WhatsApp are switched off, only the free phone notification goes out', async () => {
  fresh(); setKeys(); person(); const r = await morning.runMorningPlans(NOW);
  assert.equal(r.sent, 1); assert.equal(notified.length, 1); assert.equal(notified[0].type, 'MORNING_PLAN'); assert.equal(texts.length, 0); assert.equal(waSent.length, 0);
});
test('morning plan: once the admin switches them on (and keys exist) texts and WhatsApp are sent; missing keys keep them off', async () => {
  fresh(); setKeys(); await features.setEnabled('sms', true, ADMIN); await features.setEnabled('whatsapp', true, ADMIN); person(); await morning.runMorningPlans(NOW);
  assert.equal(texts.length, 1); assert.equal(texts[0].to, '+2348111189267'); assert.equal(waSent.length, 1);
  fresh(); setKeys(); await features.setEnabled('sms', true, ADMIN); delete process.env.AT_API_KEY; person(); await morning.runMorningPlans(NOW); assert.equal(texts.length, 0, 'enabled but no key: nothing is sent');
});
test('saving the morning plan while those features are off quietly drops the text/WhatsApp choices', async () => {
  fresh(); setKeys(); const u = { _id: 'u9', role: 'INDIVIDUAL', morningPlan: {}, save: async () => u }; users.rows.push(u);
  const out = {}; await authCtl.updateMorningPlan({ user: { _id: 'u9' }, body: { enabled: true, time: '08:00', push: true, email: false, sms: true, whatsapp: true } }, { json: (b) => { out.body = b; } }, (e) => { out.err = e; });
  assert.equal(out.err, undefined, out.err?.message); assert.equal(u.morningPlan.sms, false); assert.equal(u.morningPlan.whatsapp, false); assert.equal(u.morningPlan.enabled, true);
});

const phoneCall = async (user, phone) => { const out = {}; await authCtl.sendPhoneCode({ user, body: { phone } }, { json: (b) => { out.body = b; } }, (e) => { out.err = e; }); return out; };
const person2 = (id, over = {}) => { const u = { _id: id, role: 'INDIVIDUAL', emailVerified: true, ...over }; users.rows.push(Object.assign(u, { save: async () => u })); return u; };
test('text codes: only allowed countries, and only after the email is confirmed - and nothing is stored or sent when refused', async () => {
  fresh(); setKeys(); const u = person2('p1'); let r = await phoneCall(u, '+14155550123'); assert.equal(r.err?.statusCode, 400); assert.match(r.err.message, /\+234/);
  const v = person2('p2', { emailVerified: false }); r = await phoneCall(v, '+2348111189267'); assert.equal(r.err?.statusCode, 403); assert.equal(texts.length, 0); assert.equal(v.smsVerification, undefined, 'no code was stored');
  r = await phoneCall(u, '+2348111189267'); assert.equal(r.err, undefined); assert.equal(texts.length, 1); process.env.SMS_ALLOWED_PREFIXES = '+234,+233'; r = await phoneCall(person2('p3'), '+233201234567'); assert.equal(r.err, undefined); delete process.env.SMS_ALLOWED_PREFIXES;
});
test('text codes: at most N a day per person (and the 60-second wait still applies)', async () => {
  fresh(); setKeys(); process.env.SMS_CODES_PER_USER_DAILY = '2'; const u = person2('p1');
  assert.equal((await phoneCall(u, '+2348111189267')).err, undefined); assert.equal((await phoneCall(u, '+2348111189267')).err?.statusCode, 429, 'wait a minute'); u.smsVerification = undefined;
  assert.equal((await phoneCall(u, '+2348111189267')).err, undefined); u.smsVerification = undefined; const r = await phoneCall(u, '+2348111189267'); assert.equal(r.err?.statusCode, 429); assert.match(r.err.message, /too many codes today/); assert.equal(texts.length, 2); delete process.env.SMS_CODES_PER_USER_DAILY;
});
test('text codes: one phone number cannot be bombarded from many accounts, and a refused request costs the person nothing', async () => {
  fresh(); setKeys(); process.env.SMS_CODES_PER_PHONE_DAILY = '2'; const a = person2('a'); const b = person2('b'); const c = person2('c');
  await phoneCall(a, '+2348111189267'); await phoneCall(b, '+2348111189267'); const r = await phoneCall(c, '+2348111189267'); assert.equal(r.err?.statusCode, 429); assert.equal(texts.length, 2); assert.equal(usage.n('sms:u:c'), 0, 'refund'); delete process.env.SMS_CODES_PER_PHONE_DAILY;
});
test('text codes: if the provider fails the person gets their allowance back', async () => {
  fresh(); setKeys(); const u = person2('p1'); const keep = sms.sendSms; sms.sendSms = async () => { throw new Error('SMS could not be sent. Please try again later.'); };
  const r = await phoneCall(u, '+2348111189267'); assert.equal(r.err?.statusCode, 503); assert.equal(usage.n('sms:u:p1'), 0); sms.sendSms = keep;
});
test('the whole app has a daily text limit, refunded when the provider refuses', async () => {
  fresh(); setKeys(); process.env.SMS_DAILY_LIMIT = '2'; let ok = true;
  global.fetch = async () => (ok ? { ok: true, status: 200, json: async () => ({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } }) } : { ok: false, status: 500, json: async () => ({}) });
  await realSend({ to: '+2348111189267', message: 'a' }); await realSend({ to: '+2348111189267', message: 'b' });
  assert.match((await thrown(realSend({ to: '+2348111189267', message: 'c' }))).message, /daily text-message limit/); assert.equal(usage.n('sms:g'), 2);
  fresh(); setKeys(); process.env.SMS_DAILY_LIMIT = '5'; ok = false; const e = await thrown(realSend({ to: '+2348111189267', message: 'x' })); assert.ok(e); assert.equal(usage.n('sms:g'), 0, 'a failed send does not use the allowance'); delete process.env.SMS_DAILY_LIMIT;
});

test('inbox: a daily limit and a size limit, duplicates never count, and a refusal stores nothing', async () => {
  fresh(); process.env.CAPTURE_DAILY_LIMIT = '2'; const mk = (sourceId) => capture.create({ user: 'u1', source: 'email', sourceId, content: `Task ${sourceId}` });
  assert.equal((await mk('a')).limited, undefined); assert.equal((await mk('b')).limited, undefined); const dup = await mk('a'); assert.equal(dup.duplicate, true); assert.equal(dup.limited, undefined, 'a repeat of something already saved is not counted');
  const third = await mk('c'); assert.equal(third.limited, 'daily'); assert.equal(third.capture, null); assert.match(third.message, /today’s limit/); assert.equal(caps.rows.length, 2);
  assert.equal((await capture.create({ user: 'u2', source: 'email', sourceId: 'z', content: 'other person' })).limited, undefined, 'another person is unaffected'); delete process.env.CAPTURE_DAILY_LIMIT;
  fresh(); process.env.CAPTURE_MAX_STORED = '2'; await mk('a'); await mk('b'); const full = await mk('c'); assert.equal(full.limited, 'full'); assert.match(full.message, /inbox is full/); delete process.env.CAPTURE_MAX_STORED;
});
test('daily limits: counted per key, a limit of 0 means none, and refunds give the unit back', async () => {
  fresh(); assert.equal(await cap.take('k', 2), true); assert.equal(await cap.take('k', 2), true); assert.equal(await cap.take('k', 2), false); await cap.give('k'); assert.equal(await cap.take('k', 2), true);
  assert.equal(await cap.take('other', 2), true, 'a different key is separate'); assert.equal(await cap.take('zero', 0), false); assert.equal(cap.intEnv('NOT_SET_ANYWHERE', 7), 7);
});
