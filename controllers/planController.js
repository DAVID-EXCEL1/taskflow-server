const Task = require('../models/Task');
const User = require('../models/User');
const Organization = require('../models/Organization');
const asyncHandler = require('../utils/asyncHandler');
const ai = require('../services/aiService');
const quota = require('../services/aiQuota');
const plan = require('../services/planService');
const draft = require('../services/draftService');
const planCache = require('../services/planCache');
const Subscription = require('../models/Subscription');
const pricing = require('../services/pricingService');
const Category = require('../models/Category');
const Team = require('../models/Team');
const { buildScope } = require('../services/taskService');
const { getAccess } = require('../services/subscriptionService');
const { ROLES } = require('../config/constants');
const { DEFAULT_TZ } = require('../utils/timezone');
const AppError = require('../utils/AppError');

// AI allowance: Personal is a flat number; Business grows with the team-size band (each person's daily uses, and a shared daily pool).
async function orgAiLimits(orgId) {
  const now = new Date(); const bands = await pricing.getBands();
  const sub = await Subscription.findOne({ organization: orgId, status: 'Active', startDate: { $lte: now }, endDate: { $gt: now } }).sort({ endDate: -1 }).select('maxMembers').lean();
  const band = pricing.bandByMax(bands, sub?.maxMembers || bands[0].maxMembers) || bands[0];
  return { perUser: band.aiPerUser ?? quota.limits().business, pool: band.aiOrgDaily ?? band.maxMembers * 3 };
}
async function standing(user) {
  const org = user.organization ? await Organization.findById(user.organization).select('aiEnabled').lean() : null;
  const isIndividual = user.role === ROLES.INDIVIDUAL;
  const optedIn = isIndividual ? !!user.aiOptIn : !!org?.aiEnabled; // in a business, the owner decides for the whole organization
  let limit = quota.limits().personal; let teamPool = null;
  if (!isIndividual) { const l = await orgAiLimits(user.organization); limit = l.perUser; teamPool = { id: String(user.organization), limit: l.pool }; }
  return { optedIn, canToggle: isIndividual || user.role === ROLES.ORGANIZATION_OWNER, limit, org: teamPool, isIndividual };
}

exports.me = asyncHandler(async (req, res) => {
  const s = await standing(req.user);
  const st = await ai.status();
  res.json({ success: true, data: { optedIn: s.optedIn, canToggle: s.canToggle, dailyLimit: s.limit, usedToday: await quota.usedToday(req.user._id), remainingToday: await quota.remaining(req.user._id, s.limit, s.org), teamPool: s.org ? s.org.limit : null, providerReady: st.configured && st.enabled, scope: s.isIndividual ? 'personal' : 'organization' } });
});

exports.setOptIn = asyncHandler(async (req, res) => {
  const s = await standing(req.user);
  if (!s.canToggle) throw new AppError('Your organization owner decides whether AI suggestions are on.', 403);
  const enabled = req.body.enabled;
  await User.updateOne({ _id: req.user._id }, { aiOptIn: enabled, aiOptInAt: new Date() });
  if (req.user.role === ROLES.ORGANIZATION_OWNER) await Organization.updateOne({ _id: req.user.organization }, { aiEnabled: enabled });
  res.json({ success: true, message: enabled ? 'AI suggestions are on.' : 'AI suggestions are off. Your plan still works without them.' });
});

exports.planDay = asyncHandler(async (req, res) => {
  const tz = req.user.timezone || DEFAULT_TZ;
  const tasks = await Task.find({ ...buildScope(req.user), status: { $in: plan.OPEN } }).sort({ dueDate: 1 }).limit(200).select('title dueDate dueHasTime priority status').lean();
  const basic = plan.buildPlan(tasks, { tz });
  const out = { sections: basic.sections, today: basic.today, source: 'basic', summary: null, aiNote: null, remaining: null };

  // The basic plan above always works. Everything below only ADDS an AI suggestion, and any problem just falls back.
  const s = await standing(req.user);
  if (!s.optedIn) { out.aiNote = 'optin'; return res.json({ success: true, data: out }); }
  if (!(await getAccess(req.user)).canWrite) { out.aiNote = 'subscription'; return res.json({ success: true, data: out }); }
  if (!basic.totalItems) return res.json({ success: true, data: out }); // nothing to plan: do not spend a request
  const st = await ai.status();
  if (!st.configured || !st.enabled || st.circuitOpen) { out.aiNote = 'unavailable'; return res.json({ success: true, data: out }); }
  // Same tasks as a few minutes ago? Reuse that answer: no AI call and no use spent.
  const fp = planCache.fingerprint(basic);
  const hit = planCache.get(req.user._id, fp);
  if (hit) {
    Object.assign(out, { source: 'ai', summary: hit.summary, remaining: await quota.remaining(req.user._id, s.limit, s.org), cached: true, cachedMinutesAgo: hit.minutesAgo });
    return res.json({ success: true, data: out });
  }
  const q = await quota.consume(req.user._id, s.limit, s.org);
  if (!q.ok) { out.aiNote = 'limit'; return res.json({ success: true, data: out }); }
  try {
    const text = await ai.chat({ messages: plan.buildMessages(basic, tz), maxTokens: 220, temperature: 0.3 });
    const summary = plan.cleanAiText(text);
    if (summary) { planCache.set(req.user._id, fp, summary); Object.assign(out, { source: 'ai', summary, remaining: q.remaining }); } else { await quota.refund(req.user._id, s.org?.id); out.aiNote = 'unavailable'; }
  } catch (e) {
    await quota.refund(req.user._id, s.org?.id); // a failed attempt must not cost the user a use
    if (!(e instanceof ai.AiUnavailableError)) console.error('Plan my day failed:', e.message);
    out.aiNote = 'unavailable';
  }
  res.json({ success: true, data: out });
});

// AI assistant: drafts tasks from a request. Creates NOTHING - the client shows a preview and the user confirms.
exports.draftTasks = asyncHandler(async (req, res) => {
  const s = await standing(req.user);
  if (!s.optedIn) throw new AppError('Turn on AI suggestions in your profile first.', 403, { code: 'AI_OPT_IN' });
  if (!(await getAccess(req.user)).canWrite) throw new AppError('The AI assistant needs an active subscription.', 402, { code: 'READ_ONLY' });
  const st = await ai.status();
  if (!st.configured || !st.enabled || st.circuitOpen) throw new ai.AiUnavailableError(!st.enabled ? 'disabled' : st.circuitOpen ? 'circuit_open' : 'not_configured');
  const q = await quota.consume(req.user._id, s.limit, s.org);
  if (!q.ok) throw new AppError(q.why === 'org' ? "Your team has used today's shared AI allowance. It resets tomorrow. Smart add in the task row still works." : q.why === 'global' ? 'The AI assistant has reached its limit for today across the platform. Please try again tomorrow, or use Smart add in the task row.' : "You've used today's AI suggestions. They reset tomorrow. Smart add in the task row still works.", 429, { code: 'AI_LIMIT' });

  let drafts;
  try {
    const orgId = req.user.organization;
    const [cats, orgMembers, orgTeams] = await Promise.all([
      Category.find(s.isIndividual ? { user: req.user._id } : { organization: orgId }).select('name').limit(30).lean(),
      s.isIndividual ? [] : User.find({ organization: orgId, isActive: true }).select('_id name teams').limit(200).lean(),
      s.isIndividual ? [] : Team.find({ organization: orgId }).select('_id name').limit(100).lean(),
    ]);
    const names = cats.map((c) => c.name);
    const myTeams = (req.user.teams || []).map(String);
    const members = orgMembers
      .filter((m) => req.user.role !== ROLES.ORGANIZATION_MEMBER || String(m._id) === String(req.user._id) || m.teams.some((id) => myTeams.includes(String(id))))
      .map((m) => ({ id: String(m._id), name: m.name }));
    const teams = orgTeams
      .filter((t) => req.user.role !== ROLES.ORGANIZATION_MEMBER || myTeams.includes(String(t._id)))
      .map((t) => ({ id: String(t._id), name: t.name }));
    const context = { tz: req.user.timezone || DEFAULT_TZ, members, teams };
    const text = await ai.chat({ messages: draft.buildMessages(req.body.prompt, names, context), maxTokens: 1000, temperature: 0.3, timeoutMs: 20000 });
    drafts = draft.parseDrafts(text, names, context);
    if (!drafts.length) throw new AppError('I could not turn that into tasks. Try saying what you need to do and when, for example: "Pay rent on 1 November and call the landlord on Friday".', 422, { code: 'AI_NO_TASKS' });
  } catch (e) {
    await quota.refund(req.user._id, s.org?.id); // a failed attempt never costs the user a use
    throw e;
  }
  res.json({ success: true, data: { drafts, remaining: q.remaining } });
});
