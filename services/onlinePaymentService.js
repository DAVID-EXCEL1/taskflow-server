/**
 * Online payments with Paystack.
 *  startCheckout -> creates a Pending payment + returns Paystack's hosted checkout link
 *  confirm       -> asks PAYSTACK (never trusting the browser or the webhook body) whether it was really paid, and checks the
 *                   amount and currency match what we asked for; only then activates the subscription (same code as manual approval)
 *  reconcile     -> scheduled safety net: finds checkouts that were paid but never confirmed (browser closed, webhook missed)
 *                   and cancels ones that were abandoned
 */
const crypto = require('crypto');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { PAYMENT_STATUS, SUB_STATUS } = require('../config/constants');
const paystack = require('./paystackService');
const pricing = require('./pricingService');
const subs = require('./subscriptionService');
const activity = require('./activityService');
const { notifyAdmins } = require('./notificationService');

const clientUrl = () => String(process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
const subjectOf = (p) => (p.user ? { user: p.user } : { organization: p.organization });

async function cancel(payment, reason) {
  await Payment.updateOne({ _id: payment._id, status: PAYMENT_STATUS.PENDING }, { status: PAYMENT_STATUS.CANCELLED, rejectionReason: reason, reviewedAt: new Date() });
  if (payment.subscription) await Subscription.updateOne({ _id: payment.subscription, status: SUB_STATUS.PENDING }, { status: SUB_STATUS.REJECTED });
}

async function confirm(reference, { markStale = false } = {}) {
  const payment = await Payment.findOne({ 'gateway.reference': reference, method: 'paystack' });
  if (!payment) return { state: 'unknown' };
  if (payment.status === PAYMENT_STATUS.APPROVED) return { state: 'paid', payment };

  let result;
  try { result = await paystack.verify(reference); } catch { return { state: 'pending' }; } // cannot reach Paystack right now: try again later
  const d = result.data || {};

  if (d.status === 'success') {
    const expected = Math.round(payment.amount * 100);
    // Amount, currency and reference must all match what WE asked for. Otherwise nothing is activated.
    if (d.amount !== expected || String(d.currency || '').toUpperCase() !== payment.currency || d.reference !== reference) {
      await Payment.updateOne({ _id: payment._id, status: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CANCELLED] } }, { status: PAYMENT_STATUS.REJECTED, rejectionReason: 'Paystack amount or currency did not match', reviewedAt: new Date() });
      await activity.log({ action: 'PAYMENT_MISMATCH', message: `Paystack payment ${reference} did not match (paid ${d.amount} ${d.currency}, expected ${expected} ${payment.currency})`, organization: payment.organization, entityType: 'Payment', entityId: payment._id });
      await notifyAdmins({ type: 'PAYMENT_MISMATCH', title: 'Online payment mismatch', message: `A Paystack payment (${reference}) did not match the expected amount. Nothing was activated. Check it in Paystack.`, link: '/admin/payments' });
      return { state: 'mismatch' };
    }
    try {
      await subs.approvePayment(payment._id, null, { allowFrom: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CANCELLED] });
    } catch (e) {
      if (e.statusCode !== 409) throw e; // 409 = someone (the webhook, the return page, the job) already activated it - fine
    }
    await Payment.updateOne({ _id: payment._id }, { $set: { 'gateway.paidAt': d.paid_at ? new Date(d.paid_at) : new Date(), 'gateway.channel': d.channel } });
    return { state: 'paid' };
  }
  if (d.status === 'failed' || d.status === 'reversed') { await cancel(payment, 'Payment failed at Paystack'); return { state: 'failed' }; }
  if (markStale) { await cancel(payment, 'Checkout not completed'); return { state: 'cancelled' }; }
  return { state: 'pending' };
}

// Before a new checkout: settle any earlier unfinished ones (they may even have been paid), and drop the abandoned.
async function settleOpenCheckouts(subject) {
  const open = await Payment.find({ ...subject, method: 'paystack', status: PAYMENT_STATUS.PENDING }).select('gateway').lean();
  for (const p of open) await confirm(p.gateway.reference, { markStale: true });
}

async function startCheckout(user, { currency = 'NGN', upgradeTo } = {}) {
  const methods = await pricing.getMethods();
  if (!methods.online) throw new AppError('Online payment is not available right now. Please pay by bank transfer.', 503);
  const subject = subs.subjectFor(user);
  if (!subject) throw new AppError('Your account cannot make payments.', 403);
  const planKey = subs.planFor(user);
  currency = String(currency || 'NGN').toUpperCase();
  if (!(await pricing.enabledCurrencies()).includes(currency)) throw new AppError('That currency is not available.', 400);
  await settleOpenCheckouts(subject);

  let amount; let kind = 'subscription'; let upgrade; let seatCount = 1; let tier = {};
  if (upgradeTo) {
    // Part-way through a paid month: pay only the difference for the days that are left.
    if (planKey !== 'BUSINESS') throw new AppError('Only Business plans can be upgraded to a bigger size.', 400);
    const now = new Date();
    const current = await Subscription.findOne({ ...subject, status: SUB_STATUS.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now } }).sort({ endDate: -1 });
    if (!current) throw new AppError('You need an active subscription to upgrade.', 400);
    const bands = await pricing.getBands();
    const toBand = pricing.bandByMax(bands, Number(upgradeTo));
    if (!toBand) throw new AppError('That plan size does not exist.', 400);
    const fromMax = current.maxMembers || bands[0].maxMembers;
    if (toBand.maxMembers <= fromMax) throw new AppError('Choose a size bigger than your current plan.', 400);
    if ((current.currency || 'NGN') !== currency) throw new AppError(`Your current plan was paid in ${current.currency || 'NGN'}. Pay the upgrade in the same currency.`, 400);
    const newPrice = toBand.prices[currency];
    amount = pricing.prorate({ oldPrice: current.bandPrice ?? current.amount ?? 0, newPrice, start: current.startDate, end: current.endDate, now, currency });
    if (!(amount > 0)) throw new AppError('There is nothing to pay for this upgrade.', 400);
    kind = 'upgrade'; upgrade = { subscription: current._id, toMaxMembers: toBand.maxMembers, toBandPrice: newPrice };
  } else {
    const access = await subs.getAccess(user);
    if (access.hasPendingPayment) throw new AppError('You already have a bank-transfer payment waiting for approval.', 409);
    if (!access.canRenew) throw new AppError(`Your subscription is active until ${subs.fmtDate(access.endDate)}. You can renew from ${subs.fmtDate(access.renewOpensAt)}.`, 400);
    if (planKey === 'BUSINESS') seatCount = await User.countDocuments({ organization: subject.organization, isActive: true });
    amount = await pricing.getPrice(planKey, currency, seatCount); // throws a clear "custom pricing" error for very large teams
    if (planKey === 'BUSINESS') tier = { maxMembers: pricing.bandForSeats(await pricing.getBands(), Math.max(seatCount, 1)).maxMembers, bandPrice: amount };
  }

  const reference = `TF-${crypto.randomBytes(9).toString('hex')}`;
  const payment = await Payment.create({ ...subject, plan: planKey, amount, currency, method: 'paystack', kind, seats: seatCount, ...(upgrade ? { upgrade } : {}), paymentDate: new Date(), status: PAYMENT_STATUS.PENDING, submittedBy: user._id, gateway: { provider: 'paystack', reference } });
  if (kind === 'subscription') {
    const sub = await Subscription.create({ ...subject, plan: planKey, amount, currency, ...tier, status: SUB_STATUS.PENDING, payment: payment._id });
    payment.subscription = sub._id; await payment.save();
  }
  try {
    const init = await paystack.initialize({ email: user.email, amount: pricing.toSubunits(amount), currency, reference, callbackUrl: `${clientUrl()}/subscription`, metadata: { plan: planKey, kind, paymentId: String(payment._id) } });
    return { authorizationUrl: init.authorization_url, reference, amount, currency, kind };
  } catch (e) { await cancel(payment, 'Could not start checkout'); throw e; }
}

// What a Business owner could move up to right now, and what each costs for the rest of the paid month.
async function upgradeOptions(user) {
  if (subs.planFor(user) !== 'BUSINESS' || user.role !== 'ORGANIZATION_OWNER') return [];
  const subject = subs.subjectFor(user); const now = new Date();
  const current = await Subscription.findOne({ ...subject, status: SUB_STATUS.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now } }).sort({ endDate: -1 }).lean();
  if (!current) return [];
  const bands = await pricing.getBands(); const currency = current.currency || 'NGN';
  const fromMax = current.maxMembers || bands[0].maxMembers;
  return bands.filter((b) => b.maxMembers > fromMax && b.prices[currency] != null).map((b) => ({
    maxMembers: b.maxMembers, label: pricing.bandLabel(bands, b), currency, fullPrice: b.prices[currency],
    amount: pricing.prorate({ oldPrice: current.bandPrice ?? current.amount ?? 0, newPrice: b.prices[currency], start: current.startDate, end: current.endDate, now, currency }),
  })).filter((o) => o.amount > 0);
}

// Only the account that made the payment (or the admin, via a separate route) may check it.
async function verifyForUser(user, reference) {
  const payment = await Payment.findOne({ 'gateway.reference': String(reference), method: 'paystack' }).select('user organization').lean();
  const subject = subs.subjectFor(user);
  const mine = payment && subject && ((subject.user && String(payment.user) === String(subject.user)) || (subject.organization && String(payment.organization) === String(subject.organization)));
  if (!mine) throw new AppError('Payment not found.', 404);
  return confirm(String(reference));
}

async function reconcile() {
  const now = Date.now();
  const open = await Payment.find({ method: 'paystack', status: PAYMENT_STATUS.PENDING, createdAt: { $lt: new Date(now - 2 * 60000) } }).select('gateway createdAt').limit(25).lean();
  let activated = 0; let cancelled = 0;
  for (const p of open) {
    const stale = new Date(p.createdAt).getTime() < now - 2 * 3600000;
    try { const r = await confirm(p.gateway.reference, { markStale: stale }); if (r.state === 'paid') activated++; else if (r.state === 'cancelled' || r.state === 'failed') cancelled++; }
    catch (e) { console.error('Online payment check failed:', e.message); }
  }
  return { activated, cancelled };
}
module.exports = { startCheckout, upgradeOptions, confirm, verifyForUser, reconcile, settleOpenCheckouts };
