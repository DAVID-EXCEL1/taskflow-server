const Payment = require('../models/Payment');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const paystack = require('../services/paystackService');
const online = require('../services/onlinePaymentService');
const pricing = require('../services/pricingService');
const subs = require('../services/subscriptionService');
const seatService = require('../services/seatService');
const activity = require('../services/activityService');
const { notifyAdmins } = require('../services/notificationService');

exports.methods = asyncHandler(async (req, res) => {
  const m = await pricing.getMethods();
  const planKey = subs.planFor(req.user);
  const [bands, currencies, individual] = await Promise.all([pricing.getBands(), pricing.enabledCurrencies(), pricing.getIndividual()]);
  const out = { online: m.online, bankTransfer: m.bankTransfer, plan: planKey, defaultCurrency: 'NGN', currencies: [], upgrades: [] };
  if (planKey === 'INDIVIDUAL') { out.currencies = currencies.map((code) => ({ code, price: individual[code] })); out.bankPrice = individual.NGN; }
  else {
    const seats = await seatService.seatInfo(req.user.organization);
    const band = pricing.bandForSeats(bands, Math.max(seats.used, 1));
    out.seats = { used: seats.used, pending: seats.pending, limit: seats.limit };
    if (!band) { out.custom = true; out.largestBand = bands[bands.length - 1].maxMembers; }
    else { out.band = { maxMembers: band.maxMembers, label: pricing.bandLabel(bands, band) }; out.currencies = currencies.map((code) => ({ code, price: band.prices[code] })); out.bankPrice = band.prices.NGN; }
    if (m.online) out.upgrades = await online.upgradeOptions(req.user);
  }
  res.json({ success: true, data: out });
});
exports.start = asyncHandler(async (req, res) => res.json({ success: true, data: await online.startCheckout(req.user, { currency: req.body.currency, upgradeTo: req.body.upgradeTo }) }));
exports.verify = asyncHandler(async (req, res) => {
  const r = await online.verifyForUser(req.user, req.body.reference);
  res.json({ success: true, data: { state: r.state } });
});

// Paystack calls this itself when someone pays. Anyone can POST to it, so the signature is checked FIRST and the payment is then
// confirmed by asking Paystack - the body of this request is never trusted for amounts or status.
exports.webhook = async (req, res) => {
  if (!paystack.verifySignature(req.rawBody, req.headers['x-paystack-signature'])) return res.status(401).json({ success: false, message: 'Invalid signature' });
  try {
    if (req.body?.event === 'charge.success' && req.body?.data?.reference) await online.confirm(String(req.body.data.reference));
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Paystack webhook handling failed:', e.message);
    return res.status(500).json({ success: false }); // Paystack will retry later
  }
};

exports.adminVerify = asyncHandler(async (req, res) => {
  const p = await Payment.findById(req.params.id).select('method gateway').lean();
  if (!p || p.method !== 'paystack') throw new AppError('This is not an online payment.', 400);
  const r = await online.confirm(p.gateway.reference);
  res.json({ success: true, data: { state: r.state }, message: { paid: 'Paystack confirms it was paid. The subscription is active.', pending: 'Paystack has not received the money yet.', failed: 'The payment failed at Paystack.', cancelled: 'The checkout was never completed.', mismatch: 'Paystack reported a different amount. Nothing was activated.', unknown: 'Payment not found.' }[r.state] });
});

/* ---------------- Super Admin: payment methods and prices ---------------- */
exports.billingSettings = asyncHandler(async (req, res) => {
  const m = await pricing.getMethods();
  res.json({ success: true, data: { ...m, individual: await pricing.getIndividual(), bands: await pricing.getBands(), enabledCurrencies: await pricing.enabledCurrencies(), supported: Object.entries(pricing.SUPPORTED).map(([code, c]) => ({ code, name: c.name, symbol: c.symbol, min: c.min, decimals: c.decimals })), maxPrice: pricing.MAX_PRICE, webhookUrl: `${req.protocol}://${req.get('host')}/api/webhooks/paystack`, keyMode: process.env.PAYSTACK_SECRET_KEY ? (process.env.PAYSTACK_SECRET_KEY.startsWith('sk_live') ? 'live' : 'test') : null } });
});
exports.setMethods = asyncHandler(async (req, res) => {
  const m = await pricing.setMethods(req.body, req.user._id);
  await activity.log({ actor: req.user, action: 'PAYMENT_METHODS_CHANGED', message: `Online payment ${m.online ? 'on' : 'off'}, bank transfer ${m.bankTransfer ? 'on' : 'off'}`, entityType: 'Setting' });
  res.json({ success: true, data: m, message: 'Payment methods saved.' });
});
exports.setPrices = asyncHandler(async (req, res) => {
  const before = { individual: await pricing.getIndividual(), bands: await pricing.getBands() };
  const value = await pricing.setPricing(req.body, req.user._id);
  const msg = `${req.user.name} changed plan prices: Personal ${pricing.fmtMoney(before.individual.NGN)} to ${pricing.fmtMoney(value.individual.NGN)}; ${before.bands.length} size bands to ${value.bands.length}; smallest Business ${pricing.fmtMoney(before.bands[0].prices.NGN)} to ${pricing.fmtMoney(value.bands[0].prices.NGN)}`;
  await activity.log({ actor: req.user, action: 'PRICES_CHANGED', message: msg, entityType: 'Setting' });
  await notifyAdmins({ type: 'PRICES_CHANGED', title: 'Plan prices changed', message: msg, link: '/admin/settings' });
  res.json({ success: true, data: value, message: 'Prices saved. They apply to new payments from now on.' });
});
