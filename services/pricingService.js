/**
 * Plan prices, Business size bands, payment-method switches - all editable by the Super Admin (no code change, no redeploy).
 *
 *  - Personal plan: one flat price per currency.
 *  - Business plan: priced by TEAM SIZE in "bands" (up to 10 people, up to 30, ...). Each band has a price per currency and the
 *    daily AI allowance for that size. Above the largest band the price is "custom" (the customer contacts you).
 *  - A currency is on only if it has a price for Personal AND every band.
 * The numbers in DEFAULT_BANDS are used until you change them.
 */
const Setting = require('../models/Setting');
const AppError = require('../utils/AppError');
const { PLANS } = require('../config/constants');

const SUPPORTED = Object.freeze({
  NGN: { name: 'Nigerian naira', symbol: '₦', min: 100, decimals: 0 },
  USD: { name: 'US dollar', symbol: '$', min: 1, decimals: 2 },
  GHS: { name: 'Ghanaian cedi', symbol: 'GH₵', min: 1, decimals: 2 },
  KES: { name: 'Kenyan shilling', symbol: 'KSh ', min: 10, decimals: 2 },
  ZAR: { name: 'South African rand', symbol: 'R', min: 1, decimals: 2 },
});
const MAX_PRICE = 10_000_000; const MAX_BANDS = 12; const TTL = 30_000;
const DEFAULT_BANDS = [[10, 10000], [30, 20000], [60, 40000], [100, 65000], [200, 110000], [300, 160000]]
  .map(([maxMembers, ngn]) => ({ maxMembers, prices: { NGN: ngn }, aiPerUser: 10, aiOrgDaily: maxMembers * 3 }));
const defaults = () => ({ individual: { NGN: PLANS.INDIVIDUAL.price }, bands: DEFAULT_BANDS.map((b) => ({ ...b, prices: { ...b.prices } })) });
let cache = null;

const bandsSorted = (bands) => [...bands].sort((a, b) => a.maxMembers - b.maxMembers);
async function load() {
  if (cache && Date.now() - cache.at < TTL) return cache;
  let stored = null; let billing = null;
  try {
    stored = (await Setting.findOne({ key: 'plans' }).lean())?.value || null;
    billing = (await Setting.findOne({ key: 'billing' }).lean())?.value || null;
  } catch { if (cache) return cache; /* database hiccup: keep the last known values */ }
  const d = defaults();
  const individual = { ...d.individual, ...(stored?.individual || stored?.INDIVIDUAL || {}) }; // the older saved shape used INDIVIDUAL
  const bands = Array.isArray(stored?.bands) && stored.bands.length ? bandsSorted(stored.bands) : d.bands;
  cache = { at: Date.now(), individual, bands, billing: billing || {} };
  return cache;
}
const getIndividual = async () => (await load()).individual;
const getBands = async () => (await load()).bands;
const enabledCurrencies = async () => { const { individual, bands } = await load(); return Object.keys(individual).filter((c) => SUPPORTED[c] && bands.every((b) => b.prices?.[c] != null)).sort((a, b) => (a === 'NGN' ? -1 : b === 'NGN' ? 1 : a.localeCompare(b))); };

// The smallest band that fits `seats` people. null = bigger than every band (custom pricing).
const bandForSeats = (bands, seats) => bands.find((b) => seats <= b.maxMembers) || null;
const bandByMax = (bands, max) => bands.find((b) => b.maxMembers === max) || null;

async function getPrice(planKey, currency = 'NGN', seats = 1) {
  const { individual, bands } = await load();
  let p;
  if (planKey === 'INDIVIDUAL') p = individual[currency];
  else {
    const band = bandForSeats(bands, Math.max(seats, 1));
    if (!band) throw new AppError(`Teams of more than ${bands[bands.length - 1].maxMembers} people have custom pricing. Please contact us.`, 400, { code: 'CUSTOM_PLAN' });
    p = band.prices?.[currency];
  }
  if (typeof p !== 'number' || !(p > 0)) throw new AppError(`No ${currency} price is set for this plan.`, 400, { code: 'NO_PRICE' });
  return p;
}

const toSubunits = (amount) => Math.round(amount * 100);
function roundFor(currency, amount) { const d = SUPPORTED[currency]?.decimals ?? 2; const f = 10 ** d; return Math.round(amount * f) / f; }
/**
 * Fair price for moving to a bigger band part-way through a paid month: the DIFFERENCE between the new and old band price,
 * for the part of the period that is left. Never below the currency's minimum charge. 0 if the new band is not dearer.
 */
function prorate({ oldPrice, newPrice, start, end, now = new Date(), currency = 'NGN' }) {
  const total = new Date(end) - new Date(start); const left = Math.min(Math.max(new Date(end) - now, 0), total);
  const raw = (newPrice - (oldPrice || 0)) * (total > 0 ? left / total : 0);
  if (!(newPrice > (oldPrice || 0)) || raw <= 0) return 0;
  return Math.max(roundFor(currency, raw), SUPPORTED[currency]?.min ?? 1);
}

/* ---------------- admin editing (validated hard; nothing is "fixed up") ---------------- */
function cleanPrice(cur, v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new AppError(`${label}: enter ${cur} as a number.`, 400);
  const s = SUPPORTED[cur];
  if (v < s.min || v > MAX_PRICE) throw new AppError(`${label}: the ${cur} price must be between ${s.min.toLocaleString()} and ${MAX_PRICE.toLocaleString()}.`, 400);
  if (s.decimals === 0 ? !Number.isInteger(v) : Math.abs(Math.round(v * 100) - v * 100) > 1e-6) throw new AppError(`${label}: ${cur} ${s.decimals === 0 ? 'must be a whole number' : 'can have at most 2 decimal places'}.`, 400);
  return v;
}
function cleanPricesMap(map, label) {
  const out = {};
  for (const [cur, v] of Object.entries(map || {})) {
    if (v === null || v === undefined || v === '') continue;
    if (!SUPPORTED[cur]) throw new AppError(`${label}: ${cur} is not a supported currency.`, 400);
    out[cur] = cleanPrice(cur, v, label);
  }
  if (out.NGN == null) throw new AppError(`${label}: the naira (NGN) price is required.`, 400);
  return out;
}
function cleanPricing(input) {
  const individual = cleanPricesMap(input?.individual, 'Personal');
  const raw = input?.bands;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_BANDS) throw new AppError(`Add between 1 and ${MAX_BANDS} Business size bands.`, 400);
  const bands = raw.map((b, i) => {
    const label = `Business band ${i + 1}`;
    if (!Number.isInteger(b?.maxMembers) || b.maxMembers < 2 || b.maxMembers > 100000) throw new AppError(`${label}: "up to how many people" must be a whole number from 2 to 100,000.`, 400);
    const aiPerUser = b.aiPerUser ?? 10; const aiOrgDaily = b.aiOrgDaily ?? b.maxMembers * 3;
    if (!Number.isInteger(aiPerUser) || aiPerUser < 0 || aiPerUser > 1000) throw new AppError(`${label}: AI uses per person must be a whole number from 0 to 1,000.`, 400);
    if (!Number.isInteger(aiOrgDaily) || aiOrgDaily < 0 || aiOrgDaily > 1_000_000) throw new AppError(`${label}: the team AI pool must be a whole number from 0 to 1,000,000.`, 400);
    return { maxMembers: b.maxMembers, prices: cleanPricesMap(b.prices, label), aiPerUser, aiOrgDaily };
  }).sort((a, b) => a.maxMembers - b.maxMembers);
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].maxMembers === bands[i - 1].maxMembers) throw new AppError(`Two bands both stop at ${bands[i].maxMembers} people. Each band needs a different size.`, 400);
    if (bands[i].prices.NGN < bands[i - 1].prices.NGN) throw new AppError(`A bigger team cannot cost less: the "up to ${bands[i].maxMembers}" band is cheaper than "up to ${bands[i - 1].maxMembers}".`, 400);
  }
  // A currency must be offered everywhere or nowhere, otherwise some customers would see no price.
  for (const cur of Object.keys(individual)) for (const b of bands) if (b.prices[cur] == null) throw new AppError(`Add a ${cur} price to the "up to ${b.maxMembers}" band, or remove ${cur} from the other prices.`, 400);
  for (const b of bands) for (const cur of Object.keys(b.prices)) if (individual[cur] == null) throw new AppError(`Add a Personal ${cur} price, or remove ${cur} from the bands.`, 400);
  return { individual, bands };
}
async function setPricing(input, userId) {
  const value = cleanPricing(input);
  await Setting.findOneAndUpdate({ key: 'plans' }, { value, updatedBy: userId }, { upsert: true });
  cache = null;
  return value;
}

/* ---------------- payment-method switches ---------------- */
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

function fmtMoney(amount, currency = 'NGN') {
  const s = SUPPORTED[currency]; const n = Number(amount);
  if (!s) return `${currency} ${n.toLocaleString('en-US')}`;
  if (currency === 'NGN') return `₦${n.toLocaleString('en-NG')}`;
  return `${s.symbol}${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
const bandLabel = (bands, band) => { const i = bands.indexOf(band); const from = i <= 0 ? 2 : bands[i - 1].maxMembers + 1; return i <= 0 ? `Up to ${band.maxMembers} people` : `${from} to ${band.maxMembers} people`; };

module.exports = { SUPPORTED, MAX_PRICE, DEFAULT_BANDS, getIndividual, getBands, enabledCurrencies, bandForSeats, bandByMax, bandLabel, getPrice, toSubunits, prorate, cleanPricing, setPricing, getMethods, setMethods, paystackConfigured, fmtMoney, _reset: () => { cache = null; } };
