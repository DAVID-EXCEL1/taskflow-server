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

async function startCheckout(user) {
  const methods = await pricing.getMethods();
  if (!methods.online) throw new AppError('Online payment is not available right now. Please pay by bank transfer.', 503);
  const subject = subs.subjectFor(user);
  if (!subject) throw new AppError('Your account cannot make payments.', 403);
  const planKey = subs.planFor(user);
  await settleOpenCheckouts(subject);

  const access = await subs.getAccess(user);
  if (access.hasPendingPayment) throw new AppError('You already have a bank-transfer payment waiting for approval.', 409);
  if (!access.canRenew) throw new AppError(`Your subscription is active until ${subs.fmtDate(access.endDate)}. You can renew from ${subs.fmtDate(access.renewOpensAt)}.`, 400);

  const currency = 'NGN';
  const amount = await pricing.getPrice(planKey, currency);
  const reference = `TF-${crypto.randomBytes(9).toString('hex')}`;
  const payment = await Payment.create({ ...subject, plan: planKey, amount, currency, method: 'paystack', paymentDate: new Date(), status: PAYMENT_STATUS.PENDING, submittedBy: user._id, gateway: { provider: 'paystack', reference } });
  const sub = await Subscription.create({ ...subject, plan: planKey, amount, currency, status: SUB_STATUS.PENDING, payment: payment._id });
  payment.subscription = sub._id; await payment.save();
  try {
    const init = await paystack.initialize({ email: user.email, amount: Math.round(amount * 100), currency, reference, callbackUrl: `${clientUrl()}/subscription`, metadata: { plan: planKey, paymentId: String(payment._id) } });
    return { authorizationUrl: init.authorization_url, reference, amount, currency };
  } catch (e) { await cancel(payment, 'Could not start checkout'); throw e; }
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
module.exports = { startCheckout, confirm, verifyForUser, reconcile, settleOpenCheckouts };
