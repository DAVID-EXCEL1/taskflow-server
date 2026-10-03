const Task = require('../models/Task');
const User = require('../models/User');
const Organization = require('../models/Organization');
const asyncHandler = require('../utils/asyncHandler');
const ai = require('../services/aiService');
const quota = require('../services/aiQuota');
const plan = require('../services/planService');
const { buildScope } = require('../services/taskService');
const { getAccess } = require('../services/subscriptionService');
const { ROLES } = require('../config/constants');
const { DEFAULT_TZ } = require('../utils/timezone');
const AppError = require('../utils/AppError');

async function standing(user) {
  const org = user.organization ? await Organization.findById(user.organization).select('aiEnabled').lean() : null;
  const isIndividual = user.role === ROLES.INDIVIDUAL;
  const optedIn = isIndividual ? !!user.aiOptIn : !!org?.aiEnabled; // in a business, the owner decides for the whole organization
  const limit = isIndividual ? quota.limits().personal : quota.limits().business;
  return { optedIn, canToggle: isIndividual || user.role === ROLES.ORGANIZATION_OWNER, limit, isIndividual };
}

exports.me = asyncHandler(async (req, res) => {
  const s = await standing(req.user);
  const st = await ai.status();
  res.json({ success: true, data: { optedIn: s.optedIn, canToggle: s.canToggle, dailyLimit: s.limit, usedToday: await quota.usedToday(req.user._id), providerReady: st.configured && st.enabled, scope: s.isIndividual ? 'personal' : 'organization' } });
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
  const q = await quota.consume(req.user._id, s.limit);
  if (!q.ok) { out.aiNote = 'limit'; return res.json({ success: true, data: out }); }
  try {
    const text = await ai.chat({ messages: plan.buildMessages(basic, tz), maxTokens: 220, temperature: 0.3 });
    const summary = plan.cleanAiText(text);
    if (summary) Object.assign(out, { source: 'ai', summary, remaining: q.remaining }); else { await quota.refund(req.user._id); out.aiNote = 'unavailable'; }
  } catch (e) {
    await quota.refund(req.user._id); // a failed attempt must not cost the user a use
    if (!(e instanceof ai.AiUnavailableError)) console.error('Plan my day failed:', e.message);
    out.aiNote = 'unavailable';
  }
  res.json({ success: true, data: out });
});
