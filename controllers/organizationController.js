const Organization = require('../models/Organization');
const User = require('../models/User');
const Team = require('../models/Team');
const Task = require('../models/Task');
const Invitation = require('../models/Invitation');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES, INVITE_STATUS } = require('../config/constants');
const { escapeRegex, pageParams } = require('../utils/helpers');
const activity = require('../services/activityService');
const { notify } = require('../services/notificationService');
const crypto = require('crypto');
const APP = () => process.env.APP_NAME || 'Taxkflow';

exports.getMine = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization).populate('owner', 'name email');
  if (!org) throw new AppError('Organization not found.', 404);
  res.json({ success: true, data: org });
});
exports.updateMine = asyncHandler(async (req, res) => {
  const org = await Organization.findByIdAndUpdate(req.user.organization, { $set: req.body }, { new: true, runValidators: true });
  await activity.log({ actor: req.user, action: 'ORGANIZATION_UPDATED', message: 'Updated organization information', organization: org._id, entityType: 'Organization', entityId: org._id });
  res.json({ success: true, data: org });
});

// ---- Members ----
exports.listMembers = asyncHandler(async (req, res) => {
  const members = await User.find({ organization: req.user.organization }).select('name email role teams isActive createdAt lastLoginAt').populate('teams', 'name').sort({ name: 1 }).lean();
  res.json({ success: true, data: members });
});
exports.setMemberTeams = asyncHandler(async (req, res) => {
  const member = await User.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!member) throw new AppError('Member not found.', 404);
  const teams = await Team.find({ _id: { $in: req.body.teamIds }, organization: req.user.organization }).select('_id').lean();
  if (teams.length !== new Set(req.body.teamIds).size) throw new AppError('One or more teams were not found.', 400);
  member.teams = teams.map((t) => t._id);
  await member.save();
  await activity.log({ actor: req.user, action: 'MEMBER_TEAMS_UPDATED', message: `Updated team assignment for ${member.name}`, organization: req.user.organization, entityType: 'User', entityId: member._id });
  res.json({ success: true, data: await User.findById(member._id).select('name email role teams').populate('teams', 'name') });
});
exports.removeMember = asyncHandler(async (req, res) => {
  const member = await User.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!member) throw new AppError('Member not found.', 404);
  if (member.role === ROLES.ORGANIZATION_OWNER) throw new AppError('The organization owner cannot be removed.', 400);
  // Detach: account is kept (as an unsubscribed personal account); org tasks stay with the org.
  await Task.updateMany({ organization: req.user.organization, assignedTo: member._id }, { $unset: { assignedTo: 1 } });
  member.organization = undefined; member.teams = []; member.role = ROLES.INDIVIDUAL;
  await member.save();
  await notify(member._id, { type: 'MEMBER_REMOVED', title: 'Removed from organization', message: 'You were removed from your organization.', link: '/' });
  await activity.log({ actor: req.user, action: 'MEMBER_REMOVED', message: `Removed ${member.name} from the organization`, organization: req.user.organization, entityType: 'User', entityId: member._id });
  res.json({ success: true, message: 'Member removed.' });
});

// ---- Teams ----
exports.listTeams = asyncHandler(async (req, res) => {
  const filter = { organization: req.user.organization };
  if (req.user.role === ROLES.ORGANIZATION_MEMBER) filter._id = { $in: req.user.teams || [] };
  const teams = await Team.find(filter).populate('leader', 'name').sort({ name: 1 }).lean();
  const counts = await User.aggregate([{ $match: { organization: req.user.organization } }, { $unwind: '$teams' }, { $group: { _id: '$teams', n: { $sum: 1 } } }]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.json({ success: true, data: teams.map((t) => ({ ...t, memberCount: map[String(t._id)] || 0 })) });
});
async function checkLeader(orgId, leader) {
  if (leader && !(await User.exists({ _id: leader, organization: orgId }))) throw new AppError('Team leader must be a member of your organization.', 400);
}
exports.createTeam = asyncHandler(async (req, res) => {
  await checkLeader(req.user.organization, req.body.leader);
  const body = { ...req.body }; if (!body.leader) delete body.leader;
  const team = await Team.create({ ...body, organization: req.user.organization, createdBy: req.user._id });
  await activity.log({ actor: req.user, action: 'TEAM_CREATED', message: `Created team "${team.name}"`, organization: team.organization, entityType: 'Team', entityId: team._id });
  res.status(201).json({ success: true, data: team });
});
exports.updateTeam = asyncHandler(async (req, res) => {
  await checkLeader(req.user.organization, req.body.leader);
  const team = await Team.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!team) throw new AppError('Team not found.', 404);
  Object.assign(team, req.body, { leader: req.body.leader || undefined });
  await team.save();
  await activity.log({ actor: req.user, action: 'TEAM_UPDATED', message: `Updated team "${team.name}"`, organization: team.organization, entityType: 'Team', entityId: team._id });
  res.json({ success: true, data: team });
});
exports.deleteTeam = asyncHandler(async (req, res) => {
  const team = await Team.findOneAndDelete({ _id: req.params.id, organization: req.user.organization });
  if (!team) throw new AppError('Team not found.', 404);
  await User.updateMany({ teams: team._id }, { $pull: { teams: team._id } });
  await Task.updateMany({ assignedTeam: team._id }, { $unset: { assignedTeam: 1 } });
  await activity.log({ actor: req.user, action: 'TEAM_DELETED', message: `Deleted team "${team.name}"`, organization: team.organization, entityType: 'Team', entityId: team._id });
  res.json({ success: true, message: 'Team deleted. Its members and tasks were kept.' });
});

// ---- Invitations ----
exports.listInvitations = asyncHandler(async (req, res) => {
  await Invitation.updateMany({ organization: req.user.organization, status: INVITE_STATUS.PENDING, expiresAt: { $lt: new Date() } }, { status: INVITE_STATUS.EXPIRED });
  // Pending invites to an email that has since registered can no longer be used - close them so the list stays honest.
  const pending = await Invitation.find({ organization: req.user.organization, status: INVITE_STATUS.PENDING }).select('email').lean();
  if (pending.length) {
    const taken = await User.find({ email: { $in: pending.map((p) => p.email) } }).select('email').lean();
    if (taken.length) await Invitation.updateMany({ organization: req.user.organization, status: INVITE_STATUS.PENDING, email: { $in: taken.map((t) => t.email) } }, { status: INVITE_STATUS.EXPIRED });
  }
  res.json({ success: true, data: await Invitation.find({ organization: req.user.organization }).populate('team', 'name').sort({ createdAt: -1 }).limit(100) });
});
exports.createInvitation = asyncHandler(async (req, res) => {
  const { email, team } = req.body;
  const orgId = req.user.organization;
  if (await User.exists({ email, organization: orgId })) throw new AppError('This person is already a member.', 409);
  // Someone who already has an account can't be invited: joining would move them into the organization and hide their own personal tasks.
  // The message is deliberately general so it doesn't confirm who has an account.
  if (await User.exists({ email })) throw new AppError(`This email can't be invited. If the person already uses ${APP()}, they'll need to use a different email address to join.`, 409, { code: 'EMAIL_HAS_ACCOUNT' });
  if (team && !(await Team.exists({ _id: team, organization: orgId }))) throw new AppError('Team not found.', 400);
  await Invitation.updateMany({ organization: orgId, email, status: INVITE_STATUS.PENDING }, { status: INVITE_STATUS.EXPIRED });
  const invite = await Invitation.create({ organization: orgId, email, team: team || undefined, invitedBy: req.user._id, token: crypto.randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + 7 * 86400000) });
  await activity.log({ actor: req.user, action: 'MEMBER_INVITED', message: `Invited ${email}`, organization: orgId, entityType: 'Invitation', entityId: invite._id });
  res.status(201).json({ success: true, data: invite });
});
exports.cancelInvitation = asyncHandler(async (req, res) => {
  const r = await Invitation.findOneAndDelete({ _id: req.params.id, organization: req.user.organization, status: INVITE_STATUS.PENDING });
  if (!r) throw new AppError('Pending invitation not found.', 404);
  res.json({ success: true, message: 'Invitation cancelled.' });
});

// Public: minimal details so the invitee can see who invited them (no org data beyond the name).
exports.inviteByToken = asyncHandler(async (req, res) => {
  const inv = await Invitation.findOne({ token: req.params.token }).populate('organization', 'name').populate('team', 'name');
  if (!inv) throw new AppError('Invitation not found.', 404);
  let status = inv.status;
  if (status === INVITE_STATUS.PENDING && inv.expiresAt < new Date()) status = INVITE_STATUS.EXPIRED;
  const userExists = !!(await User.exists({ email: inv.email }));
  res.json({ success: true, data: { email: inv.email, status, organizationName: inv.organization?.name, teamName: inv.team?.name, userExists } });
});
async function loadOwnInvite(req) {
  const inv = await Invitation.findOne({ token: req.params.token });
  if (!inv) throw new AppError('Invitation not found.', 404);
  if (inv.email !== req.user.email) throw new AppError('This invitation was sent to a different email address.', 403);
  if (inv.status !== INVITE_STATUS.PENDING) throw new AppError(`This invitation is already ${inv.status.toLowerCase()}.`, 409);
  if (inv.expiresAt < new Date()) { inv.status = INVITE_STATUS.EXPIRED; await inv.save(); throw new AppError('This invitation has expired.', 400); }
  return inv;
}
exports.acceptInvite = asyncHandler(async (req, res) => {
  await loadOwnInvite(req);
  // Existing accounts can no longer be converted into members: it used to hide their personal tasks. New people join by registering through the invite link.
  throw new AppError(`This email already has a ${APP()} account, so it can't join an organization. Ask the organization to invite a different email address.`, 409, { code: 'EMAIL_HAS_ACCOUNT' });
});
exports.rejectInvite = asyncHandler(async (req, res) => {
  const inv = await loadOwnInvite(req);
  inv.status = INVITE_STATUS.REJECTED; inv.respondedAt = new Date(); await inv.save();
  res.json({ success: true, message: 'Invitation declined.' });
});

// ---- Super Admin views ----
exports.adminList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = {};
  if (req.query.search) filter.name = new RegExp(escapeRegex(req.query.search), 'i');
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;
  const [orgs, total] = await Promise.all([Organization.find(filter).populate('owner', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Organization.countDocuments(filter)]);
  const now = new Date();
  const ids = orgs.map((o) => o._id);
  const [members, subs] = await Promise.all([
    User.aggregate([{ $match: { organization: { $in: ids } } }, { $group: { _id: '$organization', n: { $sum: 1 } } }]),
    Subscription.find({ organization: { $in: ids }, status: 'Active' }).select('organization endDate startDate').lean(),
  ]);
  const mc = Object.fromEntries(members.map((m) => [String(m._id), m.n]));
  const data = orgs.map((o) => {
    const mine = subs.filter((s) => String(s.organization) === String(o._id));
    const end = mine.reduce((m, s) => (!m || s.endDate > m ? s.endDate : m), null);
    const current = mine.some((s) => s.startDate <= now && s.endDate > now);
    return { ...o, memberCount: mc[String(o._id)] || 0, subscriptionStatus: current ? 'Active' : end ? 'Expired' : 'None', expiresAt: end };
  });
  res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});
exports.adminGet = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id).populate('owner', 'name email phone').lean();
  if (!org) throw new AppError('Organization not found.', 404);
  const [members, teams, subscriptions, payments, taskCount] = await Promise.all([
    User.find({ organization: org._id }).select('name email role isActive createdAt').lean(),
    Team.find({ organization: org._id }).lean(),
    Subscription.find({ organization: org._id }).sort({ createdAt: -1 }).lean(),
    Payment.find({ organization: org._id }).sort({ createdAt: -1 }).lean(),
    Task.countDocuments({ organization: org._id }),
  ]);
  res.json({ success: true, data: { ...org, members, teams, subscriptions, payments, taskCount } });
});
exports.adminSetStatus = asyncHandler(async (req, res) => {
  const org = await Organization.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive }, { new: true });
  if (!org) throw new AppError('Organization not found.', 404);
  await activity.log({ actor: req.user, action: req.body.isActive ? 'ORGANIZATION_ACTIVATED' : 'ORGANIZATION_DEACTIVATED', message: `${req.body.isActive ? 'Activated' : 'Deactivated'} ${org.name}`, organization: org._id, entityType: 'Organization', entityId: org._id });
  res.json({ success: true, data: org });
});
