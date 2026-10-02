/**
 * Removes the demo data created by `npm run seed` (and everything attached to it) - nothing else.
 *
 *   npm run clean-demo               DRY RUN: shows exactly what would be deleted
 *   npm run clean-demo -- --confirm  actually deletes
 *   add --detach-others              if a REAL account was invited into the demo organization, turn it into
 *                                    a normal personal account instead of aborting
 *
 * Only the 7 seeded demo emails below (and the demo organization they own) are touched.
 * The Super Admin and every other account are never deleted.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const M = (n) => require(`../models/${n}`);
const DEMO_EMAILS = ['david@demo.com', 'expired@demo.com', 'pending@demo.com', 'owner@demo.com', 'member@demo.com', 'mary@demo.com', 'john@demo.com'];
const DEMO_INVITE_TOKEN = 'demo-invite-token-123';

async function run(argv = process.argv) {
  const confirm = argv.includes('--confirm');
  const detach = argv.includes('--detach-others');
  const [User, Organization, Team, Task, Category, Subscription, Payment, ProofFile, Notification, ActivityLog, Invitation, PushSubscription, PasswordReset] =
    ['User', 'Organization', 'Team', 'Task', 'Category', 'Subscription', 'Payment', 'ProofFile', 'Notification', 'ActivityLog', 'Invitation', 'PushSubscription', 'PasswordReset'].map(M);
  await connectDB();

  const users = await User.find({ email: { $in: DEMO_EMAILS }, role: { $ne: 'SUPER_ADMIN' } }).select('_id email').lean();
  const userIds = users.map((u) => u._id);
  const orgs = await Organization.find({ owner: { $in: userIds } }).select('_id name').lean();
  const orgIds = orgs.map((o) => o._id);
  if (!userIds.length && !orgIds.length) { console.log('No demo data found. Nothing to do.'); await mongoose.disconnect(); return { deleted: false }; }

  // Real people who joined the demo organization must not be deleted along with it.
  const others = orgIds.length ? await User.find({ organization: { $in: orgIds }, _id: { $nin: userIds } }).select('_id email').lean() : [];
  if (others.length && !detach) {
    console.error(`\nSTOPPED: these real accounts belong to the demo organization:\n${others.map((o) => `  - ${o.email}`).join('\n')}\nRe-run with --detach-others to turn them into normal personal accounts, then continue.`);
    await mongoose.disconnect(); return { deleted: false, blocked: true };
  }

  const subject = { $or: [{ user: { $in: userIds } }, { organization: { $in: orgIds } }] };
  const payments = await Payment.find(subject).select('_id').lean();
  const subs = await Subscription.find(subject).select('_id').lean();
  const paymentIds = payments.map((p) => p._id);
  const entityIds = [...userIds, ...orgIds, ...paymentIds, ...subs.map((s) => s._id)];

  const plan = [
    ['Tasks', Task, { $or: [{ owner: { $in: userIds } }, { createdBy: { $in: userIds } }, { organization: { $in: orgIds } }] }],
    ['Categories', Category, { $or: [{ user: { $in: userIds } }, { organization: { $in: orgIds } }] }],
    ['Teams', Team, { organization: { $in: orgIds } }],
    ['Payment receipts', ProofFile, { payment: { $in: paymentIds } }],
    ['Payments', Payment, subject],
    ['Subscriptions', Subscription, subject],
    ['Notifications', Notification, { user: { $in: userIds } }],
    ['Browser-notification devices', PushSubscription, { user: { $in: userIds } }],
    ['Password-reset links', PasswordReset, { user: { $in: userIds } }],
    ['Activity log entries', ActivityLog, { $or: [{ actor: { $in: userIds } }, { organization: { $in: orgIds } }, { entityId: { $in: entityIds } }] }],
    ['Invitations', Invitation, { $or: [{ organization: { $in: orgIds } }, { token: DEMO_INVITE_TOKEN }] }],
    ['Organizations', Organization, { _id: { $in: orgIds } }],
    ['Users', User, { _id: { $in: userIds } }],
  ];

  console.log(`\nDemo accounts found:\n${users.map((u) => `  - ${u.email}`).join('\n')}${orgs.length ? `\nDemo organizations: ${orgs.map((o) => o.name).join(', ')}` : ''}\n`);
  for (const [label, model, filter] of plan) console.log(`  ${label.padEnd(30)} ${await model.countDocuments(filter)}`);
  if (others.length) console.log(`  Real accounts to detach        ${others.length}`);

  if (!confirm) { console.log('\nDRY RUN - nothing was deleted. Check the list above, then run again with --confirm.'); await mongoose.disconnect(); return { deleted: false }; }

  if (others.length) await User.updateMany({ _id: { $in: others.map((o) => o._id) } }, { $set: { role: 'INDIVIDUAL', teams: [] }, $unset: { organization: 1 } });
  console.log('\nDeleting...');
  for (const [label, model, filter] of plan) { const r = await model.deleteMany(filter); console.log(`  ${label.padEnd(30)} ${r.deletedCount} deleted`); }
  console.log('\nDone. Demo data is gone. Your real users and the Super Admin were not touched.');
  await mongoose.disconnect();
  return { deleted: true };
}

if (require.main === module) run().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
module.exports = { run, DEMO_EMAILS };
