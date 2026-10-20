const test = require('node:test'); const assert = require('node:assert/strict');
const { fakeModel, fakeSettings, thrown } = require('./helpers');
const User = require('../models/User'); const Invitation = require('../models/Invitation'); const Organization = require('../models/Organization'); const Subscription = require('../models/Subscription'); const AiUsage = require('../models/AiUsage');
const users = fakeModel(User); const invites = fakeModel(Invitation); const orgs = fakeModel(Organization); const subs = fakeModel(Subscription); const settings = fakeSettings();
const seats = require('../services/seatService'); const pricing = require('../services/pricingService'); const DAY = 86400000;
const fresh = () => { users.clear(); invites.clear(); orgs.clear(); subs.clear(); settings.clear(); pricing._reset(); orgs.rows.push({ _id: 'org1' }); };
const people = (n) => { for (let i = 0; i < n; i++) users.rows.push({ _id: `m${i}`, organization: 'org1', isActive: true }); };
const plan = (over = {}) => subs.rows.push({ organization: 'org1', status: 'Active', maxMembers: 10, startDate: new Date(Date.now() - DAY), endDate: new Date(Date.now() + 20 * DAY), ...over });
const pending = (n) => { for (let i = 0; i < n; i++) invites.rows.push({ organization: 'org1', status: 'Pending', expiresAt: new Date(Date.now() + DAY) }); };

test('seat info: people = active users; the limit comes from the paid team size', async () => {
  fresh(); people(4); users.rows.push({ _id: 'x', organization: 'org1', isActive: false }); plan({ maxMembers: 30 }); pending(2);
  const s = await seats.seatInfo('org1'); assert.deepEqual([s.used, s.pending, s.limit, s.remaining, s.hasPlan], [4, 2, 30, 24, true]);
});
test('plans bought before team-size pricing are treated as the smallest band; admin override can raise the limit', async () => {
  fresh(); people(1); plan({ maxMembers: undefined }); assert.equal((await seats.seatInfo('org1')).limit, 10);
  orgs.rows[0].seatLimitOverride = 500; assert.equal((await seats.seatInfo('org1')).limit, 500);
  orgs.rows[0].seatLimitOverride = 5; assert.equal((await seats.seatInfo('org1')).limit, 10, 'an override never LOWERS what was paid for');
});
test('an organization at its limit cannot add anyone; open invitations count as taken seats', async () => {
  fresh(); people(10); plan(); const e = await thrown(seats.assertSeatFree('org1')); assert.equal(e.statusCode, 403); assert.equal(e.details.code, 'SEAT_LIMIT'); assert.equal(e.details.limit, 10);
  fresh(); people(8); pending(2); plan(); assert.equal((await thrown(seats.assertSeatFree('org1')))?.details.code, 'SEAT_LIMIT', '8 people + 2 open invitations = full');
  fresh(); people(8); pending(1); plan(); assert.ok(await seats.assertSeatFree('org1'), 'one seat still free');
});
test('when a person joins through THEIR OWN invitation, that invitation is not counted against them', async () => {
  fresh(); people(9); pending(1); plan(); assert.ok(await seats.assertSeatFree('org1', { includePending: false }));
  fresh(); people(10); pending(1); plan(); assert.equal((await thrown(seats.assertSeatFree('org1', { includePending: false })))?.statusCode, 403);
});
test('no active plan: the account is read-only anyway, so the seat check does not interfere', async () => {
  fresh(); people(50); const s = await seats.assertSeatFree('org1'); assert.equal(s.hasPlan, false);
});
test('inviting is refused at the limit and creates nothing', async () => {
  fresh(); const orgCtl = require('../controllers/organizationController'); const Team = require('../models/Team');
  people(10); plan(); const created = []; Invitation.create = async (d) => { created.push(d); return d; }; Team.exists = async () => true;
  let out = {}; await orgCtl.createInvitation({ user: { _id: 'o1', name: 'Boss', organization: 'org1', role: 'ORGANIZATION_OWNER' }, body: { email: 'new@x.com' } }, { status() { return this; }, json(b) { out.body = b; } }, (e) => { out.err = e; });
  assert.equal(out.err?.details?.code, 'SEAT_LIMIT'); assert.equal(created.length, 0);
});

// ---- AI allowance: per person + a shared team pool + the platform-wide pool ----
const usage = new Map(); const day = () => new Date().toISOString().slice(0, 10);
AiUsage.findOneAndUpdate = async (f, u) => { const id = `${f.key}|${f.day}`; const x = usage.get(id); if (x) { if (!(x.count < f.count.$lt)) { const e = new Error('dup'); e.code = 11000; throw e; } x.count += u.$inc.count; return x; } const n = { key: f.key, day: f.day, count: u.$inc.count }; usage.set(id, n); return n; };
AiUsage.updateOne = async (f, u) => { const x = usage.get(`${f.key}|${f.day}`); if (x && x.count > 0) x.count += u.$inc.count; return {}; };
AiUsage.findOne = (f) => ({ lean: async () => usage.get(`${f.key}|${f.day}`) || null });
const quota = require('../services/aiQuota'); const n = (k) => usage.get(`${k}|${day()}`)?.count || 0;
test('team AI pool: each person is capped AND the whole team shares a daily pool', async () => {
  usage.clear(); process.env.AI_GLOBAL_DAILY_LIMIT = '1000'; const org = { id: 'org1', limit: 5 };
  for (let i = 0; i < 3; i++) assert.equal((await quota.consume('a', 3, org)).ok, true);
  assert.equal((await quota.consume('a', 3, org)).why, 'user', 'person a used all 3');
  assert.equal((await quota.consume('b', 3, org)).ok, true); assert.equal((await quota.consume('b', 3, org)).ok, true);
  const r = await quota.consume('c', 3, org); assert.equal(r.ok, false); assert.equal(r.why, 'org', 'the team pool of 5 is empty');
  assert.equal(n('o:org1'), 5); assert.equal(n('global'), 5, 'refused attempts never use up shared allowance'); assert.equal(n('u:c'), 0);
  assert.equal(await quota.remaining('b', 3, org), 0);
});
test('a limit of 0 means "none" - the first call must not slip through', async () => {
  usage.clear(); process.env.AI_GLOBAL_DAILY_LIMIT = '1000'; assert.equal((await quota.consume('a', 0)).ok, false); assert.equal((await quota.consume('a', 3, { id: 'o', limit: 0 })).ok, false); assert.equal(n('global'), 0);
});
test('a failed AI call gives the use back to the person, the team and the platform', async () => {
  usage.clear(); process.env.AI_GLOBAL_DAILY_LIMIT = '1000'; const org = { id: 'org1', limit: 5 }; await quota.consume('a', 3, org); await quota.refund('a', 'org1');
  assert.deepEqual([n('u:a'), n('o:org1'), n('global')], [0, 0, 0]);
});
