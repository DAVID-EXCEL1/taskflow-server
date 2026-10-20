const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('crypto');
const { query, fakeModel, fakeSettings, thrown } = require('./helpers');
const Payment = require('../models/Payment'); const Subscription = require('../models/Subscription'); const User = require('../models/User'); const Organization = require('../models/Organization');
const Notification = require('../models/Notification'); const PushSubscription = require('../models/PushSubscription'); const ActivityLog = require('../models/ActivityLog');
const pays = fakeModel(Payment); const subsDb = fakeModel(Subscription); const users = fakeModel(User); const orgs = fakeModel(Organization); const settings = fakeSettings();
let notified = []; Notification.insertMany = async (rows) => { notified.push(...rows); return []; }; PushSubscription.find = () => query([]); ActivityLog.create = async () => ({});
const paystack = require('../services/paystackService'); const subs = require('../services/subscriptionService'); const pricing = require('../services/pricingService'); const online = require('../services/onlinePaymentService');
const realApprove = subs.approvePayment; const DAY = 86400000; const KEY = process.env.PAYSTACK_SECRET_KEY;

let init = []; let verifyAnswers = {}; let approvals = []; let access;
paystack.initialize = async (o) => { init.push(o); return { authorization_url: 'https://checkout.paystack.com/abc', reference: o.reference }; };
paystack.verify = async (ref) => ({ data: verifyAnswers[ref] });
subs.getAccess = async () => access;
subs.approvePayment = async (id, admin, opts) => { const p = pays.rows.find((x) => x._id === id); if (!opts.allowFrom.includes(p.status)) { const e = new Error('x'); e.statusCode = 409; throw e; } p.status = 'Approved'; approvals.push({ id, admin, opts }); };
const fresh = () => { pays.clear(); subsDb.clear(); users.clear(); orgs.clear(); settings.clear(); pricing._reset(); init = []; verifyAnswers = {}; approvals = []; notified = []; access = { canRenew: true, hasPendingPayment: false, endDate: new Date(Date.now() + 40 * DAY), renewOpensAt: new Date() }; };
const addPeople = (n) => { for (let i = 0; i < n; i++) users.rows.push({ _id: `m${i}`, organization: 'org1', isActive: true }); };
const person = { _id: 'u1', email: 'ada@x.com', name: 'Ada', role: 'INDIVIDUAL' }; const owner = { _id: 'o1', email: 'boss@x.com', name: 'Boss', role: 'ORGANIZATION_OWNER', organization: 'org1' };
const ADMIN = '507f1f77bcf86cd799439011';
const withUsd = async () => pricing.setPricing({ individual: { NGN: 2000, USD: 3 }, bands: [{ maxMembers: 10, prices: { NGN: 10000, USD: 8 } }, { maxMembers: 30, prices: { NGN: 20000, USD: 16 } }, { maxMembers: 60, prices: { NGN: 40000, USD: 30 } }] }, ADMIN);
const activeBusinessSub = (over = {}) => subsDb.rows.push({ _id: 'cur', organization: 'org1', plan: 'BUSINESS', status: 'Active', maxMembers: 10, bandPrice: 10000, amount: 10000, currency: 'NGN', startDate: new Date(Date.now() - 15 * DAY), endDate: new Date(Date.now() + 15 * DAY), ...over });

test('webhook signature: only the exact bytes signed with our key are accepted', () => {
  const body = Buffer.from('{"event":"charge.success","data":{"reference":"TF-1"}}'); const sign = (b, k = KEY) => crypto.createHmac('sha512', k).update(b).digest('hex');
  assert.equal(paystack.verifySignature(body, sign(body)), true);
  assert.equal(paystack.verifySignature(body, 'f'.repeat(128)), false); assert.equal(paystack.verifySignature(body, undefined), false);
  assert.equal(paystack.verifySignature(Buffer.from(body.toString().replace('TF-1', 'TF-2')), sign(body)), false, 'a swapped reference must be refused');
  assert.equal(paystack.verifySignature(body, sign(body, 'someone-elses-key')), false);
});
test('Personal checkout: server price, kobo to Paystack, pending subscription, returns to the first site address', async () => {
  fresh(); const r = await online.startCheckout(person);
  assert.equal(r.amount, 2000); assert.equal(init[0].amount, 200000); assert.equal(init[0].currency, 'NGN'); assert.equal(init[0].callbackUrl, 'https://taxkflow.com/subscription'); assert.match(r.reference, /^TF-[a-f0-9]{18}$/);
  assert.equal(pays.rows[0].status, 'Pending'); assert.equal(pays.rows[0].method, 'paystack'); assert.equal(subsDb.rows[0].status, 'Pending'); assert.equal(subsDb.rows[0].maxMembers, undefined);
});
test('another currency: only when switched on, and the amount is sent in that currency', async () => {
  fresh(); let e = await thrown(online.startCheckout(person, { currency: 'USD' })); assert.equal(e.statusCode, 400); assert.equal(pays.rows.length, 0);
  await withUsd(); const r = await online.startCheckout(person, { currency: 'usd' });
  assert.equal(r.amount, 3); assert.equal(init[0].amount, 300); assert.equal(init[0].currency, 'USD'); assert.equal(pays.rows[0].currency, 'USD');
  e = await thrown(online.startCheckout(person, { currency: 'EUR' })); assert.equal(e.statusCode, 400);
});
test('Business checkout is priced by how many active people the organization has', async () => {
  fresh(); addPeople(5); await online.startCheckout(owner);
  assert.equal(pays.rows[0].amount, 10000); assert.equal(pays.rows[0].seats, 5); assert.equal(init[0].amount, 1000000); assert.equal(subsDb.rows[0].maxMembers, 10); assert.equal(subsDb.rows[0].bandPrice, 10000);
  fresh(); addPeople(25); await online.startCheckout(owner); assert.equal(pays.rows[0].amount, 20000); assert.equal(subsDb.rows[0].maxMembers, 30);
  fresh(); addPeople(10); users.rows.push({ _id: 'gone', organization: 'org1', isActive: false }); await online.startCheckout(owner); assert.equal(pays.rows[0].amount, 10000, 'deactivated people do not count');
});
test('a team larger than the biggest band gets a clear "custom pricing" refusal and no payment', async () => {
  fresh(); addPeople(301); const e = await thrown(online.startCheckout(owner)); assert.equal(e.statusCode, 400); assert.equal(e.details.code, 'CUSTOM_PLAN'); assert.equal(pays.rows.length, 0); assert.equal(init.length, 0);
});
test('checkout refusals: too early to renew, bank transfer pending, online switched off', async () => {
  fresh(); access.canRenew = false; let e = await thrown(online.startCheckout(person)); assert.equal(e.statusCode, 400); assert.match(e.message, /can renew from/);
  fresh(); access.hasPendingPayment = true; e = await thrown(online.startCheckout(person)); assert.equal(e.statusCode, 409);
  fresh(); await pricing.setMethods({ onlineEnabled: false }, ADMIN); e = await thrown(online.startCheckout(person)); assert.equal(e.statusCode, 503); assert.equal(pays.rows.length, 0);
});
test('upgrade mid-month: pay only the difference for the days left, no new subscription period', async () => {
  fresh(); addPeople(8); activeBusinessSub(); const r = await online.startCheckout(owner, { upgradeTo: 30 });
  assert.equal(r.kind, 'upgrade'); assert.equal(r.amount, 5000); assert.equal(init[0].amount, 500000);
  const p = pays.rows[0]; assert.equal(p.kind, 'upgrade'); assert.equal(p.upgrade.toMaxMembers, 30); assert.equal(p.upgrade.toBandPrice, 20000); assert.equal(subsDb.rows.length, 1, 'an upgrade never creates a second period');
});
test('upgrade refusals: not bigger, wrong currency, Personal, no active plan, unknown size', async () => {
  fresh(); activeBusinessSub(); let e = await thrown(online.startCheckout(owner, { upgradeTo: 10 })); assert.equal(e.statusCode, 400);
  e = await thrown(online.startCheckout(owner, { upgradeTo: 999 })); assert.equal(e.statusCode, 400);
  fresh(); e = await thrown(online.startCheckout(owner, { upgradeTo: 30 })); assert.equal(e.statusCode, 400, 'needs an active plan');
  fresh(); e = await thrown(online.startCheckout(person, { upgradeTo: 30 })); assert.equal(e.statusCode, 400, 'Personal cannot be upgraded to a team size');
  fresh(); await withUsd(); activeBusinessSub({ currency: 'USD', bandPrice: 8, amount: 8 }); e = await thrown(online.startCheckout(owner, { upgradeTo: 30, currency: 'NGN' })); assert.equal(e.statusCode, 400); assert.match(e.message, /same currency/);
  assert.equal(pays.rows.length, 0);
});
test('upgrade options list only bigger sizes, with the price for what is left of the month', async () => {
  fresh(); activeBusinessSub({ maxMembers: 100, bandPrice: 65000, amount: 65000 }); const o = await online.upgradeOptions(owner);
  assert.deepEqual(o.map((x) => x.maxMembers), [200, 300]); assert.ok(Math.abs(o[0].amount - (110000 - 65000) / 2) <= 1); assert.equal(o[0].fullPrice, 110000);
  assert.deepEqual(await online.upgradeOptions({ ...owner, role: 'ORGANIZATION_MEMBER' }), [], 'only the owner may upgrade'); assert.deepEqual(await online.upgradeOptions(person), []);
});
test('payment confirmation: activates only when Paystack says paid AND amount, currency and reference match', async () => {
  fresh(); await online.startCheckout(person); let ref = pays.rows[0].gateway.reference;
  verifyAnswers[ref] = { status: 'success', amount: 200000, currency: 'NGN', reference: ref, channel: 'card' };
  assert.equal((await online.confirm(ref)).state, 'paid'); assert.equal(approvals.length, 1); assert.equal(approvals[0].admin, null); assert.equal(pays.rows[0].gateway.channel, 'card');
  assert.equal((await online.confirm(ref)).state, 'paid'); assert.equal(approvals.length, 1, 'a second confirmation (double webhook / refresh) never activates twice');
  for (const [label, answer] of [['wrong amount', { amount: 20000, currency: 'NGN' }], ['wrong currency', { amount: 200000, currency: 'USD' }], ['someone else\'s reference', { amount: 200000, currency: 'NGN', reference: 'TF-other' }]]) {
    fresh(); await online.startCheckout(person); ref = pays.rows[0].gateway.reference; verifyAnswers[ref] = { status: 'success', reference: ref, ...answer };
    assert.equal((await online.confirm(ref)).state, 'mismatch', label); assert.equal(approvals.length, 0, label); assert.equal(pays.rows[0].status, 'Rejected', label);
  }
});
test('confirmation: failed, abandoned, late payment, Paystack unreachable, unknown reference, strangers', async () => {
  fresh(); await online.startCheckout(person); const ref = pays.rows[0].gateway.reference;
  verifyAnswers[ref] = { status: 'abandoned', reference: ref }; assert.equal((await online.confirm(ref)).state, 'pending'); assert.equal(pays.rows[0].status, 'Pending');
  assert.equal((await online.confirm(ref, { markStale: true })).state, 'cancelled'); assert.equal(pays.rows[0].status, 'Cancelled');
  verifyAnswers[ref] = { status: 'success', amount: 200000, currency: 'NGN', reference: ref }; assert.equal((await online.confirm(ref)).state, 'paid', 'a payment made after we gave up is still honoured');
  fresh(); await online.startCheckout(person); const r2 = pays.rows[0].gateway.reference; verifyAnswers[r2] = { status: 'failed', reference: r2 }; assert.equal((await online.confirm(r2)).state, 'failed'); assert.equal(approvals.length, 0);
  fresh(); await online.startCheckout(person); const r3 = pays.rows[0].gateway.reference; paystack.verify = async () => { throw new Error('down'); }; assert.equal((await online.confirm(r3)).state, 'pending'); assert.equal(pays.rows[0].status, 'Pending'); paystack.verify = async (r) => ({ data: verifyAnswers[r] });
  assert.equal((await online.confirm('TF-nope')).state, 'unknown');
  verifyAnswers[r3] = { status: 'success', amount: 200000, currency: 'NGN', reference: r3 };
  assert.equal((await thrown(online.verifyForUser({ _id: 'u2', role: 'INDIVIDUAL' }, r3))).statusCode, 404, 'another customer cannot trigger my payment');
});
test('approving an upgrade changes the size of the CURRENT period and nothing else', async () => {
  fresh(); activeBusinessSub(); pays.rows.push({ _id: 'up1', organization: 'org1', plan: 'BUSINESS', kind: 'upgrade', status: 'Pending', amount: 5000, currency: 'NGN', upgrade: { subscription: 'cur', toMaxMembers: 30, toBandPrice: 20000 } });
  orgs.rows.push({ _id: 'org1', owner: 'o1' }); const r = await realApprove('up1', null, { allowFrom: ['Pending'] });
  const cur = subsDb.rows.find((s) => s._id === 'cur'); assert.equal(cur.maxMembers, 30); assert.equal(cur.bandPrice, 20000); assert.ok(cur.upgradedAt); assert.equal(subsDb.rows.length, 1);
  assert.equal(pays.rows.find((p) => p._id === 'up1').status, 'Approved'); assert.equal(r.subscription._id, 'cur'); assert.ok(notified.some((n) => /up to 30 people/.test(n.message)));
  const again = await thrown(realApprove('up1', null, { allowFrom: ['Pending'] })); assert.equal(again.statusCode, 409, 'cannot be applied twice');
});
test('a paid upgrade whose subscription has vanished raises an alert instead of silently losing the money', async () => {
  fresh(); users.rows.push({ _id: 'adm', role: 'SUPER_ADMIN', isActive: true }); User.find = (f) => query(users.rows.filter((u) => u.role === 'SUPER_ADMIN'));
  pays.rows.push({ _id: 'up2', organization: 'org1', plan: 'BUSINESS', kind: 'upgrade', status: 'Pending', amount: 5000, currency: 'NGN', upgrade: { subscription: 'gone', toMaxMembers: 30, toBandPrice: 20000 } }); orgs.rows.push({ _id: 'org1', owner: 'o1' });
  const r = await realApprove('up2', null, { allowFrom: ['Pending'] }); assert.equal(r.subscription, null); assert.ok(notified.some((n) => n.type === 'UPGRADE_UNAPPLIED'));
});
