/**
 * Account deletion with a 30-day grace period.
 *  request  -> account is locked immediately (can only sign in to restore); organizations close for all members
 *  restore  -> cancels it, any time before the purge starts
 *  purge    -> after 30 days (or "delete now" by the Super Admin): content is permanently deleted, a record goes into the
 *              DeletedAccount register, and payments/subscriptions are kept (labelled with who they belonged to) for accounting.
 */
const User = require('../models/User');
const Organization = require('../models/Organization');
const Team = require('../models/Team');
const Task = require('../models/Task');
const Category = require('../models/Category');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const PushSubscription = require('../models/PushSubscription');
const PasswordReset = require('../models/PasswordReset');
const Invitation = require('../models/Invitation');
const AiUsage = require('../models/AiUsage');
const DeletedAccount = require('../models/DeletedAccount');
const AppError = require('../utils/AppError');
const { ROLES } = require('../config/constants');
const { notify } = require('./notificationService');
const email = require('./emailService');
const activity = require('./activityService');

const GRACE_DAYS = 30;
const DAY = 86400000;
const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const mail = (to, tpl) => email.send({ to, ...tpl }).catch(() => {});

async function requestDeletion(user, reason) {
  const now = new Date();
  const scheduledFor = new Date(now.getTime() + GRACE_DAYS * DAY);
  const deletion = { requestedAt: now, scheduledFor, ...(reason ? { reason } : {}) };
  // Conditional update: a second click (or a race) cannot restart the clock.
  const claimed = await User.findOneAndUpdate({ _id: user._id, 'deletion.scheduledFor': null }, { $set: { deletion, passwordChangedAt: now } });
  if (!claimed) throw new AppError('Your account is already scheduled for deletion.', 409);
  const isOwner = user.role === ROLES.ORGANIZATION_OWNER;
  if (isOwner) {
    await Organization.updateOne({ _id: user.organization }, { $set: { deletion } });
    const members = await User.find({ organization: user.organization, _id: { $ne: user._id }, isActive: true }).select('_id').lean();
    await notify(members.map((m) => m._id), { type: 'ORG_CLOSING', title: 'Your organization is closing', message: 'The owner has scheduled the organization for deletion. You no longer have access.', link: '/' });
  }
  await activity.log({ actor: user, action: 'ACCOUNT_DELETION_REQUESTED', message: `${user.name} asked to delete ${isOwner ? 'their organization' : 'their account'}`, organization: isOwner ? user.organization : undefined, entityType: 'User', entityId: user._id });
  mail(user.email, email.templates.accountDeletionScheduled({ date: fmt(scheduledFor), organization: isOwner }));
  return scheduledFor;
}

async function restore(userId, actor) {
  const user = await User.findOneAndUpdate({ _id: userId, 'deletion.scheduledFor': { $ne: null }, 'deletion.purging': { $ne: true } }, { $unset: { deletion: 1 } }).select('name email role organization').lean();
  if (!user) throw new AppError('This account is not scheduled for deletion, or the deletion has already started and cannot be undone.', 409);
  if (user.role === ROLES.ORGANIZATION_OWNER && user.organization) {
    await Organization.updateOne({ _id: user.organization }, { $unset: { deletion: 1 } });
    const members = await User.find({ organization: user.organization, _id: { $ne: user._id }, isActive: true }).select('_id').lean();
    await notify(members.map((m) => m._id), { type: 'ORG_REOPENED', title: 'Your organization is open again', message: 'The owner cancelled the deletion. You have access again.', link: '/' });
  }
  await activity.log({ actor: actor || user, action: 'ACCOUNT_DELETION_CANCELLED', message: `Deletion cancelled for ${user.name}`, organization: user.role === ROLES.ORGANIZATION_OWNER ? user.organization : undefined, entityType: 'User', entityId: user._id });
  mail(user.email, email.templates.accountDeletionCancelled());
  return user;
}

const staleClaim = () => ({ $or: [{ 'deletion.purging': { $ne: true } }, { 'deletion.purgingAt': { $lt: new Date(Date.now() - 3600000) } }] });

async function purgeUser(userId, purgedBy = 'system') {
  // Claim first so two workers (cron + an admin click) can never purge the same account twice.
  const user = await User.findOneAndUpdate(
    { _id: userId, 'deletion.scheduledFor': { $ne: null, $lte: new Date() }, ...staleClaim() }, // only accounts whose grace period is over
    { $set: { 'deletion.purging': true, 'deletion.purgingAt': new Date() } },
    { new: true }
  ).lean();
  if (!user) return null;

  const isOwner = user.role === ROLES.ORGANIZATION_OWNER && user.organization;
  const org = isOwner ? await Organization.findById(user.organization).lean() : null;
  const subject = org ? { organization: org._id } : { user: user._id };

  // 1) Write the permanent record FIRST (safe to retry: one record per account).
  const [payments, subs] = await Promise.all([Payment.find(subject).select('amount status').lean(), Subscription.find(subject).select('status endDate').lean()]);
  const members = org ? await User.find({ organization: org._id, _id: { $ne: user._id } }).select('name email role isActive orgDeactivation').lean() : [];
  if (!(await DeletedAccount.findOne({ originalUserId: user._id }).lean())) {
    await DeletedAccount.create({
      kind: org ? 'ORGANIZATION' : 'INDIVIDUAL', originalUserId: user._id, originalOrganizationId: org?._id,
      name: user.name, email: user.email, phone: user.phone,
      organization: org ? { name: org.name, type: org.type, phone: org.phone, address: org.address, website: org.website } : undefined,
      members: members.map((m) => ({ name: m.name, email: m.email, role: m.role, active: m.isActive, deactivatedAt: m.orgDeactivation?.at, reason: m.orgDeactivation?.reason })),
      counts: { tasks: await Task.countDocuments(org ? { organization: org._id } : { owner: user._id, organization: null }), teams: org ? await Team.countDocuments({ organization: org._id }) : 0, members: members.length },
      billing: { payments: payments.length, approvedTotal: payments.filter((p) => p.status === 'Approved').reduce((n, p) => n + p.amount, 0), subscriptions: subs.length, paidUntil: subs.filter((s) => s.status === 'Active').reduce((m, s) => (!m || s.endDate > m ? s.endDate : m), null) },
      reason: user.deletion?.reason, accountCreatedAt: user.createdAt, lastLoginAt: user.lastLoginAt, requestedAt: user.deletion?.requestedAt, purgedBy: String(purgedBy),
    });
  }

  // 2) Keep money records for accounting, but label them so the admin screens still show who they were.
  const holder = { name: org ? org.name : user.name, email: user.email, deleted: true };
  await Payment.updateMany(subject, { $set: { holder } });
  await Subscription.updateMany(subject, { $set: { holder } });

  // 3) Permanently delete the content.
  if (org) {
    await Task.deleteMany({ organization: org._id });
    await Category.deleteMany({ organization: org._id });
    await Team.deleteMany({ organization: org._id });
    await Invitation.deleteMany({ organization: org._id });
    const inactive = members.filter((m) => !m.isActive).map((m) => m._id);
    if (inactive.length) { // members the owner had deactivated are removed with the organization
      await Notification.deleteMany({ user: { $in: inactive } }); await PushSubscription.deleteMany({ user: { $in: inactive } }); await User.deleteMany({ _id: { $in: inactive } });
    }
    // active members keep their login and become ordinary personal accounts
    await User.updateMany({ organization: org._id, _id: { $ne: user._id } }, { $set: { role: ROLES.INDIVIDUAL, teams: [] }, $unset: { organization: 1 } });
    await Organization.deleteOne({ _id: org._id });
  } else {
    await Task.deleteMany({ owner: user._id, organization: null });
    await Category.deleteMany({ user: user._id });
  }
  await Notification.deleteMany({ user: user._id });
  await PushSubscription.deleteMany({ user: user._id });
  await PasswordReset.deleteMany({ user: user._id });
  await AiUsage.deleteMany({ key: `u:${user._id}` });
  await User.deleteOne({ _id: user._id }); // last: the email address becomes free again
  await activity.log({ action: 'ACCOUNT_PURGED', message: `${org ? 'Organization' : 'Account'} of ${user.name} permanently deleted`, entityType: 'User', entityId: user._id });
  return { kind: org ? 'ORGANIZATION' : 'INDIVIDUAL', name: user.name };
}

async function purgeNow(userId, adminId) {
  const r = await User.updateOne({ _id: userId, 'deletion.scheduledFor': { $ne: null }, 'deletion.purging': { $ne: true } }, { $set: { 'deletion.scheduledFor': new Date() } });
  if (!r.matchedCount) throw new AppError('This account is not scheduled for deletion.', 409);
  return purgeUser(userId, adminId);
}

// Called by the scheduler. One failure never stops the others.
async function runAccountPurges() {
  const due = await User.find({ 'deletion.scheduledFor': { $lte: new Date() }, ...staleClaim() }).select('_id').limit(20).lean();
  let purged = 0;
  for (const u of due) {
    try { if (await purgeUser(u._id)) purged++; } catch (e) { console.error('Account purge failed:', e.message); }
  }
  return purged;
}
module.exports = { GRACE_DAYS, requestDeletion, restore, purgeUser, purgeNow, runAccountPurges };
