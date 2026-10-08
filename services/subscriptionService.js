const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const Organization = require('../models/Organization');
const AppError = require('../utils/AppError');
const ProofFile = require('../models/ProofFile');
const storage = require('./storageService');
const { hasValidSignature } = require('../utils/fileSignature');
const { addMonths, daysBetween } = require('../utils/helpers');
const { ROLES, PLANS, SUB_STATUS, PAYMENT_STATUS, RENEWAL_WINDOW_DAYS } = require('../config/constants');
const { notify, notifyAdmins } = require('./notificationService');
const activity = require('./activityService');
const pricing = require('./pricingService');

const fmtNaira = (n) => `₦${Number(n).toLocaleString('en-NG')}`;
const fmtMoney = (n, currency) => pricing.fmtMoney(n, currency);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Which "subject" holds the subscription: the user (Individual) or the organization (Business).
function subjectFor(user) {
  if (user.role === ROLES.INDIVIDUAL) return { user: user._id };
  if ((user.role === ROLES.ORGANIZATION_OWNER || user.role === ROLES.ORGANIZATION_MEMBER) && user.organization) {
    return { organization: user.organization._id || user.organization };
  }
  return null;
}
const planFor = (user) => (user.role === ROLES.INDIVIDUAL ? 'INDIVIDUAL' : 'BUSINESS');

/**
 * Access is always derived from subscription dates - never from a boolean flag.
 * Active + inside [startDate, endDate) => full access. Anything else => read-only.
 */
async function getAccess(user) {
  if (user.role === ROLES.SUPER_ADMIN) return { state: 'Active', canWrite: true, isAdmin: true };
  const subject = subjectFor(user);
  if (!subject) return { state: 'None', canWrite: false, message: 'Your account is not attached to a subscription.' };

  const now = new Date();
  const plan = PLANS[planFor(user)];
  const [current, latest, pending, lastPayment] = await Promise.all([
    Subscription.findOne({ ...subject, status: SUB_STATUS.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now } }).sort({ endDate: -1 }).lean(),
    Subscription.findOne({ ...subject, status: SUB_STATUS.ACTIVE }).sort({ endDate: -1 }).lean(),
    // Only bank-transfer payments count as "awaiting approval": an unfinished online checkout never blocks anyone.
    Payment.exists({ ...subject, status: PAYMENT_STATUS.PENDING, 'gateway.provider': { $exists: false } }),
    Payment.findOne({ ...subject }).sort({ createdAt: -1 }).select('status rejectionReason').lean(),
  ]);

  const base = {
    plan: plan.key, planName: plan.name, price: await pricing.getPrice(plan.key), currency: 'NGN',
    hasPendingPayment: !!pending,
    canRenew: !pending,
    paidUntil: latest?.endDate || null,
  };
  if (current) {
    const daysLeft = daysBetween(latest.endDate, now);
    const renewOpensAt = new Date(new Date(latest.endDate).getTime() - RENEWAL_WINDOW_DAYS * 86400000);
    // Renewal is only possible near expiry, which also prevents paying twice by mistake.
    return { ...base, state: 'Active', canWrite: true, startDate: current.startDate, endDate: latest.endDate, daysLeft, expiringSoon: daysLeft <= 7, canRenew: !pending && daysLeft <= RENEWAL_WINDOW_DAYS, renewOpensAt };
  }
  if (latest) {
    return { ...base, state: 'Expired', canWrite: false, endDate: latest.endDate, message: 'Your subscription has expired. Renew your subscription to continue managing your tasks.' };
  }
  if (pending) return { ...base, state: 'Pending', canWrite: false, message: 'Your payment is awaiting approval. You will get full access as soon as it is approved.' };
  if (lastPayment?.status === PAYMENT_STATUS.REJECTED) {
    return { ...base, state: 'Rejected', canWrite: false, message: 'Your last payment was rejected. Submit a new payment to activate your subscription.' };
  }
  return { ...base, state: 'None', canWrite: false, message: 'Subscribe to start managing your tasks.' };
}

// Who should hear about a subscription event: the individual, or the organization owner.
async function recipientsFor(subject) {
  if (subject.user) return [subject.user];
  const org = await Organization.findById(subject.organization).select('owner').lean();
  return org ? [org.owner] : [];
}
const subjectOf = (doc) => (doc.user ? { user: doc.user } : { organization: doc.organization });

async function submitPayment(user, body, file) {
  const subject = subjectFor(user);
  if (!subject) throw new AppError('Your account cannot submit payments.', 403);
  const planKey = planFor(user);
  const plan = PLANS[planKey];
  const methods = await pricing.getMethods();
  if (!methods.bankTransfer) throw new AppError('Bank transfer is not available right now. Please pay online.', 403);
  const price = await pricing.getPrice(planKey);

  if (file && !hasValidSignature(file)) throw new AppError('That file is not a valid JPG, PNG, WEBP or PDF.', 400);
  const access = await getAccess(user);
  if (access.hasPendingPayment) throw new AppError('You already have a payment awaiting approval.', 409);
  if (!access.canRenew) throw new AppError(`Your subscription is active until ${fmtDate(access.endDate)}. You can renew from ${fmtDate(access.renewOpensAt)}.`, 400);
  if (Number(body.amount) !== price) throw new AppError(`The ${plan.name} plan costs ${fmtNaira(price)} per month. Enter that amount.`, 400);
  if (await Payment.exists({ ...subject, status: PAYMENT_STATUS.PENDING })) {
    throw new AppError('You already have a payment awaiting approval.', 409);
  }

  const stored = file ? await storage.storeReceipt(file) : null; // Cloudinary, or null -> database fallback below
  const payment = await Payment.create({
    ...subject, plan: planKey, amount: price, currency: 'NGN', submittedBy: user._id,
    paymentDate: body.paymentDate, reference: body.reference, description: body.description,
    proof: file ? { originalName: file.originalname, mimeType: file.mimetype, size: file.size, cloudinary: stored?.cloudinary } : undefined,
  });
  if (file && !stored) await ProofFile.create({ payment: payment._id, data: file.buffer, mimeType: file.mimetype, originalName: file.originalname, size: file.size });
  const sub = await Subscription.create({ ...subject, plan: planKey, amount: price, currency: 'NGN', status: SUB_STATUS.PENDING, payment: payment._id });
  payment.subscription = sub._id;
  await payment.save();

  const orgId = subject.organization;
  await activity.log({ actor: user, action: 'PAYMENT_SUBMITTED', message: `${user.name} submitted a ${plan.name} payment of ${fmtNaira(price)}`, organization: orgId, entityType: 'Payment', entityId: payment._id });
  await notifyAdmins({ type: 'PAYMENT_SUBMITTED', title: 'New payment request', message: `${user.name} submitted ${fmtNaira(price)} (${plan.name}).`, link: '/admin/payments' });
  return payment;
}

// admin = null means the system approved it (a Paystack payment confirmed by Paystack itself). allowFrom lets a late online
// payment revive a checkout that was already marked Cancelled.
async function approvePayment(paymentId, admin, { allowFrom = [PAYMENT_STATUS.PENDING] } = {}) {
  const now = new Date();
  // Atomic status flip prevents double-approval.
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: { $in: allowFrom } },
    { status: PAYMENT_STATUS.APPROVED, reviewedBy: admin?._id, reviewedAt: now },
    { new: true }
  );
  if (!payment) throw new AppError('This payment was not found or has already been reviewed.', 409);

  const subject = subjectOf(payment);
  const latest = await Subscription.findOne({ ...subject, status: SUB_STATUS.ACTIVE }).sort({ endDate: -1 });
  // Renewal while still active starts when the current period ends; otherwise it starts now.
  const startDate = latest && latest.endDate > now ? latest.endDate : now;
  const endDate = addMonths(startDate, PLANS[payment.plan].durationMonths);

  let sub = payment.subscription ? await Subscription.findById(payment.subscription) : null;
  if (!sub) sub = new Subscription({ ...subject, plan: payment.plan, amount: payment.amount, payment: payment._id });
  Object.assign(sub, { status: SUB_STATUS.ACTIVE, startDate, endDate, remindersSent: [], expiryNotified: false });
  await sub.save();
  payment.subscription = sub._id;
  await payment.save();

  const recipients = await recipientsFor(subject);
  await notify(recipients, { type: 'PAYMENT_APPROVED', title: 'Payment approved', message: `Your payment of ${fmtMoney(payment.amount, payment.currency)} was approved. Your subscription is active until ${fmtDate(endDate)}.`, link: '/subscription' });
  await activity.log({ actor: admin, action: 'PAYMENT_APPROVED', message: `Payment of ${fmtMoney(payment.amount, payment.currency)} approved${admin ? '' : ' (online, confirmed by Paystack)'}`, organization: subject.organization, entityType: 'Payment', entityId: payment._id });
  await activity.log({ actor: admin, action: 'SUBSCRIPTION_ACTIVATED', message: `${PLANS[payment.plan].name} subscription active ${fmtDate(startDate)} to ${fmtDate(endDate)}`, organization: subject.organization, entityType: 'Subscription', entityId: sub._id });
  return { payment, subscription: sub };
}

async function rejectPayment(paymentId, admin, reason) {
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: PAYMENT_STATUS.PENDING },
    { status: PAYMENT_STATUS.REJECTED, reviewedBy: admin._id, reviewedAt: new Date(), rejectionReason: reason },
    { new: true }
  );
  if (!payment) throw new AppError('This payment was not found or has already been reviewed.', 409);
  if (payment.subscription) await Subscription.updateOne({ _id: payment.subscription }, { status: SUB_STATUS.REJECTED });

  const subject = subjectOf(payment);
  await notify(await recipientsFor(subject), { type: 'PAYMENT_REJECTED', title: 'Payment rejected', message: reason ? `Your payment was rejected: ${reason}` : 'Your payment was rejected. Please check the details and submit again.', link: '/subscription' });
  await activity.log({ actor: admin, action: 'PAYMENT_REJECTED', message: `Payment of ${fmtNaira(payment.amount)} rejected`, organization: subject.organization, entityType: 'Payment', entityId: payment._id });
  return payment;
}

module.exports = { subjectFor, planFor, getAccess, recipientsFor, submitPayment, approvePayment, rejectPayment, fmtNaira, fmtDate };
