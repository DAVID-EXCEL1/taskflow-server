const test = require('node:test'); const assert = require('node:assert/strict');
const { fakeModel, fakeUsage, thrown } = require('./helpers');
process.env.EMAIL_PROVIDER = 'resend'; process.env.EMAIL_FROM = 'SetYourTask <no-reply@setyourtask.com>'; process.env.RESEND_API_KEY = 're_test'; process.env.CLIENT_URL = 'https://setyourtask.com';
const User = require('../models/User'); const Task = require('../models/Task');
const users = fakeModel(User); const tasks = fakeModel(Task); const usage = fakeUsage();
const budget = require('../services/emailBudget'); const email = require('../services/emailService'); const evs = require('../services/emailVerificationService');
const notif = require('../services/notificationService'); const digest = require('../services/overdueDigestService');

let sentMails = []; let failNext = false;
global.fetch = async (url, o) => { if (failNext) { failNext = false; return { ok: false, status: 500, text: async () => 'boom' }; } sentMails.push(JSON.parse(o.body)); return { ok: true, status: 200, text: async () => '' }; };
const fresh = () => { users.clear(); tasks.clear(); usage.clear(); sentMails = []; failNext = false; delete process.env.EMAIL_DAILY_LIMIT; delete process.env.EMAIL_MONTHLY_LIMIT; delete process.env.EMAIL_PER_USER_DAILY; };
const person = (over = {}) => { const u = { _id: `u${users.rows.length + 1}`, email: `p${users.rows.length + 1}@x.com`, isActive: true, emailVerified: true, timezone: 'Africa/Lagos', role: 'INDIVIDUAL', ...over }; return users.rows.push(Object.assign(u, { save: async () => u })) && u; };
const mail = { subject: 's', text: 't', html: 'h' };

test('budget: reminders may use only 70% of the daily limit; confirmations and resets keep the rest', async () => {
  fresh(); process.env.EMAIL_DAILY_LIMIT = '10'; process.env.EMAIL_PER_USER_DAILY = '100';
  let n = 0; for (let i = 0; i < 20; i++) if (await budget.reserve('notification', `u${i}`)) n++; assert.equal(n, 7, '70% of 10');
  let t = 0; for (let i = 0; i < 20; i++) if (await budget.reserve('transactional')) t++; assert.equal(t, 3, 'transactional can use the remaining 3');
  assert.equal(usage.n('mail:d'), 10, 'never goes past the plan limit');
});
test('budget: monthly limit, per-person limit, and a refused email never uses up allowance', async () => {
  fresh(); process.env.EMAIL_MONTHLY_LIMIT = '10'; let n = 0; for (let i = 0; i < 20; i++) if (await budget.reserve('notification', `u${i}`)) n++; assert.equal(n, 7); assert.equal(usage.n('mail:m', usage.month()), 7);
  fresh(); process.env.EMAIL_PER_USER_DAILY = '3'; n = 0; for (let i = 0; i < 6; i++) if (await budget.reserve('notification', 'same')) n++; assert.equal(n, 3); assert.equal(usage.n('mail:d'), 3, 'the 3 refused emails cost nothing');
  assert.equal(await budget.reserve('notification', 'other'), true, 'another person is unaffected');
});
test('budget: a failed send gives the allowance back', async () => {
  fresh(); await budget.reserve('notification', 'a'); await budget.refund('notification', 'a'); assert.deepEqual([usage.n('mail:d'), usage.n('mail:m', usage.month()), usage.n('mail:u:a')], [0, 0, 0]);
});
test('sending: counted, skipped when the limit is reached, refunded when the provider fails', async () => {
  fresh(); process.env.EMAIL_DAILY_LIMIT = '2'; let r = await email.send({ to: 'a@x.com', ...mail }); assert.equal(r.sent, true); assert.equal(sentMails.length, 1);
  failNext = true; r = await email.send({ to: 'a@x.com', ...mail }); assert.equal(r.sent, false); assert.equal(usage.n('mail:d'), 1, 'the failed email was refunded');
  await email.send({ to: 'a@x.com', ...mail }); r = await email.send({ to: 'a@x.com', ...mail }); assert.equal(r.reason, 'budget'); assert.equal(sentMails.length, 2, 'nothing sent past the limit');
  const keep = process.env.EMAIL_PROVIDER; delete process.env.EMAIL_PROVIDER; fresh(); r = await email.send({ to: 'a@x.com', ...mail }); assert.equal(r.reason, 'not_configured'); assert.equal(usage.n('mail:d'), 0); process.env.EMAIL_PROVIDER = keep;
});

const tokenFrom = () => /token=([a-f0-9]{64})/.exec(sentMails.at(-1).text)[1];
test('confirming an email: link works once, expires, and only a hash is stored', async () => {
  fresh(); const u = person({ emailVerified: false }); const r = await evs.sendVerification(u); assert.equal(r.sent, true); assert.match(sentMails[0].subject, /Confirm your email/); const token = tokenFrom();
  assert.notEqual(u.emailVerify.tokenHash, token); assert.equal(u.emailVerify.tokenHash.length, 64); assert.ok(!JSON.stringify(u).includes(token), 'the raw token is not stored anywhere');
  assert.match(sentMails[0].text, /https:\/\/setyourtask\.com\/verify-email\?token=/);
  const done = await evs.verifyToken(token); assert.equal(done.emailVerified, true); assert.ok(done.emailVerifiedAt); assert.equal(done.emailVerify, undefined);
  assert.equal((await thrown(evs.verifyToken(token)))?.statusCode, 400, 'a used link cannot be reused');
});
test('confirming an email: expired, unknown, junk', async () => {
  fresh(); const u = person({ emailVerified: false }); await evs.sendVerification(u); const token = tokenFrom();
  assert.equal((await thrown(evs.verifyToken(token, new Date(Date.now() + 25 * 3600_000))))?.statusCode, 400, 'after 24 hours');
  for (const bad of ['', 'short', 'a'.repeat(64), undefined, null, 12345, { $ne: 1 }]) assert.equal((await thrown(evs.verifyToken(bad)))?.statusCode, 400);
});
test('confirming an email: asking again is limited (one a minute, five a day) and a confirmed address sends nothing', async () => {
  fresh(); const u = person({ emailVerified: false }); const t0 = new Date(); await evs.sendVerification(u, t0);
  assert.equal((await thrown(evs.sendVerification(u, new Date(t0.getTime() + 20_000))))?.statusCode, 429);
  for (let i = 1; i < 5; i++) await evs.sendVerification(u, new Date(t0.getTime() + i * 61_000)); assert.equal(sentMails.length, 5);
  assert.equal((await thrown(evs.sendVerification(u, new Date(t0.getTime() + 6 * 61_000))))?.statusCode, 429, 'sixth in a day');
  const v = person({ emailVerified: true }); const before = sentMails.length; assert.equal((await evs.sendVerification(v)).alreadyVerified, true); assert.equal(sentMails.length, before);
});

test('reminder emails: only for confirmed addresses, only the kinds the person wants', async () => {
  fresh(); const ok = person(); const unverified = person({ emailVerified: false }); const off = person({ emailPrefs: { enabled: false } }); const noReminders = person({ emailPrefs: { reminders: false } }); const gone = person({ isActive: false });
  const n = await notif.deliverEmails([ok, unverified, off, noReminders, gone].map((u) => u._id), { type: 'TASK_REMINDER', title: 'Reminder: Pay rent', message: 'Pay rent is due in 1 hour.', link: '/tasks' });
  assert.equal(n, 1); assert.deepEqual(sentMails[0].to, [ok.email]); assert.equal(sentMails[0].subject, 'Reminder: Pay rent'); assert.match(sentMails[0].text, /https:\/\/setyourtask\.com\/tasks/);
});
test('reminder emails: assignments are off by default, other kinds never email, subscription notices do', async () => {
  fresh(); const a = person(); const b = person({ emailPrefs: { assignments: true } });
  assert.equal(await notif.deliverEmails([a._id, b._id], { type: 'TASK_ASSIGNED', title: 'x', message: 'y', link: '/tasks' }), 1); assert.deepEqual(sentMails[0].to, [b.email]);
  sentMails = []; assert.equal(await notif.deliverEmails([a._id], { type: 'TASK_COMPLETED', title: 'x', message: 'y' }), 0); assert.equal(sentMails.length, 0);
  assert.equal(await notif.deliverEmails([a._id], { type: 'SUBSCRIPTION_EXPIRING', title: 'Subscription ends soon', message: 'in 3 days', link: '/subscription' }), 1);
});
test('reminder emails: stop quietly when the limit is reached, and never break the caller', async () => {
  fresh(); process.env.EMAIL_DAILY_LIMIT = '10'; const ids = Array.from({ length: 12 }, () => person()._id);
  const n = await notif.deliverEmails(ids, { type: 'TASK_REMINDER', title: 't', message: 'm', link: '/' }); assert.equal(n, 7, 'reminders stop at 70% so confirmations still work');
  fresh(); const p = person(); failNext = true; assert.equal(await notif.deliverEmails([p._id], { type: 'TASK_REMINDER', title: 't', message: 'm' }), 0);
});

const LAGOS_8AM = new Date('2026-10-05T07:00:00Z'); const overdue = (over = {}) => tasks.rows.push({ _id: `t${tasks.rows.length + 1}`, title: 'Pay the NEPA bill', status: 'Pending', owner: 'u1', organization: null, createdBy: 'u1', dueHasTime: true, dueDate: new Date('2026-10-03T10:00:00Z'), ...over });
test('daily summary: sent at 8am local time, once a day, only when something is overdue', async () => {
  fresh(); const p = person({ _id: 'u1' }); overdue(); overdue({ title: 'Call Mr Bello', dueDate: new Date('2026-10-04T10:00:00Z') });
  assert.equal((await digest.runOverdueDigests(new Date('2026-10-05T06:00:00Z'))).emails, 0, '07:00 in Lagos: not yet');
  assert.equal((await digest.runOverdueDigests(LAGOS_8AM)).emails, 1); assert.match(sentMails[0].subject, /2 overdue tasks/); assert.match(sentMails[0].text, /Pay the NEPA bill/); assert.deepEqual(sentMails[0].to, [p.email]);
  assert.equal((await digest.runOverdueDigests(new Date(LAGOS_8AM.getTime() + 5 * 60_000))).emails, 0, 'a second run the same morning sends nothing');
  assert.equal((await digest.runOverdueDigests(new Date(LAGOS_8AM.getTime() + 24 * 3600_000))).emails, 1, 'the next morning it sends again');
});
test('daily summary: skipped when nothing is overdue, when unconfirmed, when switched off, for admins, and for other people\'s tasks', async () => {
  fresh(); person({ _id: 'u1' }); await digest.runOverdueDigests(LAGOS_8AM); assert.equal(sentMails.length, 0, 'no overdue tasks');
  fresh(); person({ _id: 'u1', emailVerified: false }); overdue(); await digest.runOverdueDigests(LAGOS_8AM); assert.equal(sentMails.length, 0);
  fresh(); person({ _id: 'u1', emailPrefs: { overdueDigest: false } }); overdue(); await digest.runOverdueDigests(LAGOS_8AM); assert.equal(sentMails.length, 0);
  fresh(); person({ _id: 'u1', role: 'SUPER_ADMIN' }); overdue(); await digest.runOverdueDigests(LAGOS_8AM); assert.equal(sentMails.length, 0);
  fresh(); person({ _id: 'u1' }); overdue({ owner: 'u9', createdBy: 'u9' }); await digest.runOverdueDigests(LAGOS_8AM); assert.equal(sentMails.length, 0);
  fresh(); person({ _id: 'u1' }); overdue({ status: 'Completed' }); await digest.runOverdueDigests(LAGOS_8AM); assert.equal(sentMails.length, 0);
});
test('daily summary: two overlapping runs never send it twice, and each person gets their own local morning', async () => {
  fresh(); person({ _id: 'u1' }); overdue(); await Promise.all([digest.runOverdueDigests(LAGOS_8AM), digest.runOverdueDigests(LAGOS_8AM), digest.runOverdueDigests(LAGOS_8AM)]); assert.equal(sentMails.length, 1);
  fresh(); person({ _id: 'u1', timezone: 'America/New_York' }); overdue(); await digest.runOverdueDigests(LAGOS_8AM); assert.equal(sentMails.length, 0, 'it is 3am in New York');
  await digest.runOverdueDigests(new Date('2026-10-05T12:00:00Z')); assert.equal(sentMails.length, 1, '8am in New York');
});
