const path = require('path');
const fs = require('fs');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const Setting = require('../models/Setting');
const ProofFile = require('../models/ProofFile');
const storage = require('../services/storageService');
const User = require('../models/User');
const email = require('../services/emailService');
const { notifyAdmins } = require('../services/notificationService');
const activity = require('../services/activityService');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES, PLANS } = require('../config/constants');
const { pageParams } = require('../utils/helpers');
const svc = require('../services/subscriptionService');
const { runSubscriptionChecks } = require('../services/reminderService');

const isAdmin = (u) => u.role === ROLES.SUPER_ADMIN;
const scopeFor = (u) => {
  if (isAdmin(u)) return {};
  const s = svc.subjectFor(u);
  if (!s) throw new AppError('Not available for this account.', 403);
  return s;
};

exports.plans = (req, res) => res.json({ success: true, data: Object.values(PLANS) });

exports.myStatus = asyncHandler(async (req, res) => res.json({ success: true, data: await svc.getAccess(req.user) }));

exports.listSubscriptions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = scopeFor(req.user);
  if (req.query.plan) filter.plan = req.query.plan;
  const now = new Date();
  // Effective status is derived from dates: an "Active" record past its endDate is reported "Expired".
  if (req.query.status === 'Active') Object.assign(filter, { status: 'Active', startDate: { $lte: now }, endDate: { $gt: now } });
  else if (req.query.status === 'Expired') Object.assign(filter, { status: 'Active', endDate: { $lte: now } });
  else if (req.query.status) filter.status = req.query.status;

  const [rows, total] = await Promise.all([
    Subscription.find(filter).populate('user', 'name email').populate('organization', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Subscription.countDocuments(filter),
  ]);
  const data = rows.map((s) => ({ ...s, effectiveStatus: s.holder?.deleted ? 'Closed' : s.status === 'Active' && s.endDate <= now ? 'Expired' : s.status === 'Active' && s.startDate > now ? 'Scheduled' : s.status }));
  res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

exports.listPayments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = scopeFor(req.user);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.plan) filter.plan = req.query.plan;
  const [rows, total] = await Promise.all([
    Payment.find(filter).populate('user', 'name email').populate('organization', 'name').populate('submittedBy', 'name email').populate('reviewedBy', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);
  res.json({ success: true, data: rows.map(({ proof, ...p }) => ({ ...p, hasProof: !!proof?.mimeType })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

exports.submitPayment = asyncHandler(async (req, res) => {
  const payment = await svc.submitPayment(req.user, req.body, req.file);
  res.status(201).json({ success: true, data: payment, message: 'Payment submitted. You will be notified once it is reviewed.' });
});

// Proof files are never public: only the Super Admin or the submitting account can open them.
exports.proof = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({ _id: req.params.id, ...scopeFor(req.user) }).select('proof').lean();
  if (!payment?.proof?.mimeType) throw new AppError('No proof was uploaded for this payment.', 404);
  res.setHeader('Content-Type', payment.proof.mimeType);
  res.setHeader('Content-Disposition', 'inline');
  if (payment.proof.cloudinary?.publicId) {
    try { return res.send(await storage.downloadReceipt(payment.proof.cloudinary)); }
    catch (e) { console.error('Receipt download failed:', e.message); throw new AppError('Could not load this receipt from storage. Please try again.', 502); }
  }
  const stored = await ProofFile.findOne({ payment: payment._id });
  if (stored) return res.send(stored.data);
  // Legacy: files saved on disk before proofs moved to MongoDB (lost if the server's disk was reset).
  if (payment.proof.filename) {
    const file = path.join(__dirname, '..', 'uploads', path.basename(payment.proof.filename));
    if (fs.existsSync(file)) return res.sendFile(file);
  }
  throw new AppError('This proof file is no longer available. It was stored on temporary server storage that was reset.', 404);
});

exports.approve = asyncHandler(async (req, res) => {
  const { payment, subscription } = await svc.approvePayment(req.params.id, req.user);
  res.json({ success: true, data: { payment, subscription }, message: 'Payment approved and subscription activated.' });
});
exports.reject = asyncHandler(async (req, res) => {
  const payment = await svc.rejectPayment(req.params.id, req.user, req.body.reason);
  res.json({ success: true, data: payment, message: 'Payment rejected.' });
});

// Payment (bank) info: anyone logged in may read it (needed to pay); only Super Admin edits.
exports.getPaymentInfo = asyncHandler(async (req, res) => {
  const s = await Setting.findOne({ key: 'payment' }).lean();
  res.json({ success: true, data: s?.value || null });
});
exports.setPaymentInfo = asyncHandler(async (req, res) => {
  const before = (await Setting.findOne({ key: 'payment' }).lean())?.value || null;
  const s = await Setting.findOneAndUpdate({ key: 'payment' }, { value: req.body, updatedBy: req.user._id }, { upsert: true, new: true });
  // Swapping the account customers pay into is the highest-impact admin action, so every admin is alerted.
  if (!before || before.accountNumber !== req.body.accountNumber || before.bankName !== req.body.bankName || before.accountName !== req.body.accountName) {
    await activity.log({ actor: req.user, action: 'PAYMENT_DETAILS_CHANGED', message: 'Changed the payment (bank) details', entityType: 'Setting' });
    await notifyAdmins({ type: 'PAYMENT_DETAILS_CHANGED', title: 'Payment details changed', message: `${req.user.name} changed the bank details customers pay into.`, link: '/admin/settings' });
    const admins = await User.find({ role: 'SUPER_ADMIN', isActive: true }).select('email').lean();
    const tpl = email.templates.paymentDetailsChanged({ actor: req.user.name, before, after: req.body });
    admins.forEach((a) => email.send({ to: a.email, ...tpl }).catch(() => {}));
  }
  res.json({ success: true, data: s.value, message: 'Payment details saved.' });
});

// Manual trigger for the reminder job (Super Admin) - the same function cron runs.
exports.runChecks = asyncHandler(async (req, res) => res.json({ success: true, message: `Checked subscriptions. ${await runSubscriptionChecks()} notification(s) sent.` }));
