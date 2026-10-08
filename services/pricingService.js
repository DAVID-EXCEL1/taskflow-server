/**
 * Plan prices and payment-method switches, editable by the Super Admin (no code change, no redeploy).
 * Prices are stored per plan per currency so more currencies can be added later; only NGN is enabled for now.
 * The values in config/constants.js are the defaults used until you change them.
 */
const Setting = require('../models/Setting');
const { PLANS } = require('../config/constants');
const AppError = require('../utils/AppError');

const CURRENCIES = ['NGN']; // add 'USD' etc. here once Paystack has enabled them on your account
const MIN = 100; const MAX = 10_000_000;
const defaults = () => ({ INDIVIDUAL: { NGN: PLANS.INDIVIDUAL.price }, BUSINESS: { NGN: PLANS.BUSINESS.price } });
let cache = null; // { at, prices, billing }
const TTL = 30_000;

async function load() {
  if (cache && Date.now() - cache.at < TTL) return cache;
  let prices = null; let billing = null;
  try {
    prices = (await Setting.findOne({ key: 'plans' }).lean())?.value || null;
    billing = (await Setting.findOne({ key: 'billing' }).lean())?.value || null;
  } catch { if (cache) return cache; /* database hiccup: keep the last known values */ }
  const d = defaults();
  const merged = {};
  for (const plan of Object.keys(d)) merged[plan] = { ...d[plan], ...(prices?.[plan] || {}) };
  cache = { at: Date.now(), prices: merged, billing: billing || {} };
  return cache;
}
const getPrices = async () => (await load()).prices;
async function getPrice(planKey, currency = 'NGN') {
  const p = (await getPrices())[planKey]?.[currency];
  if (!Number.isInteger(p) || p <= 0) throw new AppError(`No price is set for the ${planKey} plan in ${currency}.`, 500);
  return p;
}

// Only whole amounts, within sensible limits, for known plans and currencies. Anything else is rejected, never "fixed up".
function cleanPrices(input) {
  const out = {};
  for (const plan of ['INDIVIDUAL', 'BUSINESS']) {
    out[plan] = {};
    for (const cur of CURRENCIES) {
      const v = input?.[plan]?.[cur];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN || v > MAX) throw new AppError(`The ${plan === 'INDIVIDUAL' ? 'Personal' : 'Business'} price must be a whole number between ${MIN.toLocaleString()} and ${MAX.toLocaleString()}.`, 400);
      out[plan][cur] = v;
    }
  }
  return out;
}
async function setPrices(input, userId) {
  const value = cleanPrices(input);
  await Setting.findOneAndUpdate({ key: 'plans' }, { value, updatedBy: userId }, { upsert: true });
  cache = null;
  return value;
}

const paystackConfigured = () => !!process.env.PAYSTACK_SECRET_KEY;
async function getMethods() {
  const b = (await load()).billing;
  return { online: paystackConfigured() && b.onlineEnabled !== false, bankTransfer: b.bankTransferEnabled !== false, paystackConfigured: paystackConfigured(), onlineEnabled: b.onlineEnabled !== false, bankTransferEnabled: b.bankTransferEnabled !== false };
}
async function setMethods({ onlineEnabled, bankTransferEnabled }, userId) {
  const cur = await getMethods();
  const next = { onlineEnabled: onlineEnabled ?? cur.onlineEnabled, bankTransferEnabled: bankTransferEnabled ?? cur.bankTransferEnabled };
  if (!(paystackConfigured() && next.onlineEnabled) && !next.bankTransferEnabled) throw new AppError('At least one way to pay must stay on, otherwise nobody can subscribe.', 400);
  await Setting.findOneAndUpdate({ key: 'billing' }, { value: next, updatedBy: userId }, { upsert: true });
  cache = null;
  return getMethods();
}
const fmtMoney = (amount, currency = 'NGN') => (currency === 'NGN' ? `₦${Number(amount).toLocaleString('en-NG')}` : `${currency} ${Number(amount).toLocaleString('en-US')}`);
module.exports = { CURRENCIES, MIN, MAX, getPrices, getPrice, setPrices, cleanPrices, getMethods, setMethods, paystackConfigured, fmtMoney, _reset: () => { cache = null; } };
