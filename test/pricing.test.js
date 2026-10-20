const test = require('node:test'); const assert = require('node:assert/strict');
const { fakeSettings, thrown } = require('./helpers');
const settings = fakeSettings(); const pricing = require('../services/pricingService');
const reset = () => { settings.clear(); pricing._reset(); };
const valid = () => ({ individual: { NGN: 2000 }, bands: [{ maxMembers: 10, prices: { NGN: 10000 } }, { maxMembers: 30, prices: { NGN: 20000 } }] });
const ADMIN = '507f1f77bcf86cd799439011';

test('defaults: Personal 2,000 and the six Business size bands', async () => {
  reset(); const ind = await pricing.getIndividual(); const bands = await pricing.getBands();
  assert.equal(ind.NGN, 2000); assert.deepEqual(bands.map((b) => [b.maxMembers, b.prices.NGN]), [[10, 10000], [30, 20000], [60, 40000], [100, 65000], [200, 110000], [300, 160000]]);
});
test('a team is priced by the smallest band it fits; above the largest band the price is custom', async () => {
  reset(); const bands = await pricing.getBands();
  assert.equal(pricing.bandForSeats(bands, 1).maxMembers, 10); assert.equal(pricing.bandForSeats(bands, 10).maxMembers, 10);
  assert.equal(pricing.bandForSeats(bands, 11).maxMembers, 30); assert.equal(pricing.bandForSeats(bands, 300).maxMembers, 300); assert.equal(pricing.bandForSeats(bands, 301), null);
  assert.equal(await pricing.getPrice('BUSINESS', 'NGN', 5), 10000); assert.equal(await pricing.getPrice('BUSINESS', 'NGN', 25), 20000);
  const e = await thrown(pricing.getPrice('BUSINESS', 'NGN', 301)); assert.equal(e.statusCode, 400); assert.equal(e.details.code, 'CUSTOM_PLAN');
});
test('admin edits take effect immediately and the older saved format still works', async () => {
  reset(); settings.store.plans = { INDIVIDUAL: { NGN: 2500 }, BUSINESS: { NGN: 5000 } };
  assert.equal((await pricing.getIndividual()).NGN, 2500); assert.equal((await pricing.getBands()).length, 6);
  await pricing.setPricing(valid(), ADMIN); assert.equal((await pricing.getBands()).length, 2); assert.equal(await pricing.getPrice('BUSINESS', 'NGN', 20), 20000);
});
const bad = [
  ['no naira price for Personal', (p) => { delete p.individual.NGN; }],
  ['a bigger team cheaper than a smaller one', (p) => { p.bands[1].prices.NGN = 5000; }],
  ['two bands with the same size', (p) => { p.bands[1].maxMembers = 10; }],
  ['band smaller than 2 people', (p) => { p.bands[0].maxMembers = 1; }],
  ['negative price', (p) => { p.individual.NGN = -5; }],
  ['price below the minimum', (p) => { p.individual.NGN = 50; }],
  ['naira with decimals', (p) => { p.individual.NGN = 2000.5; }],
  ['price given as text', (p) => { p.individual.NGN = '2000'; }],
  ['absurdly large price', (p) => { p.individual.NGN = 99_999_999_999; }],
  ['unsupported currency', (p) => { p.individual.EUR = 5; p.bands.forEach((b) => { b.prices.EUR = 9; }); }],
  ['a currency on Personal but missing from a band', (p) => { p.individual.USD = 3; p.bands[0].prices.USD = 8; }],
  ['a currency on a band but missing on Personal', (p) => { p.bands[0].prices.USD = 8; p.bands[1].prices.USD = 16; }],
  ['dollars with 3 decimal places', (p) => { p.individual.USD = 3.001; p.bands.forEach((b) => { b.prices.USD = 8; }); }],
  ['too many bands', (p) => { p.bands = Array.from({ length: 13 }, (_, i) => ({ maxMembers: 10 + i, prices: { NGN: 1000 * (i + 1) } })); }],
  ['AI uses per person that is not a whole number', (p) => { p.bands[0].aiPerUser = 2.5; }],
];
for (const [name, mutate] of bad) test(`rejects: ${name}`, async () => {
  reset(); const p = valid(); mutate(p); const e = await thrown(pricing.setPricing(p, ADMIN));
  assert.equal(e?.statusCode, 400, name); assert.equal((await pricing.getIndividual()).NGN, 2000, 'a rejected change must never be saved');
});
test('a currency is only on when Personal AND every band have a price for it', async () => {
  reset(); assert.deepEqual(await pricing.enabledCurrencies(), ['NGN']);
  const p = valid(); p.individual.USD = 3; p.bands[0].prices.USD = 8; p.bands[1].prices.USD = 16; await pricing.setPricing(p, ADMIN);
  assert.deepEqual(await pricing.enabledCurrencies(), ['NGN', 'USD']); assert.equal(await pricing.getPrice('BUSINESS', 'USD', 15), 16); assert.equal(await pricing.getPrice('INDIVIDUAL', 'USD'), 3);
});
test('upgrade price = the difference for the part of the month that is left', () => {
  const start = new Date('2026-10-01T00:00:00Z'); const end = new Date('2026-10-31T00:00:00Z'); const mid = new Date('2026-10-16T00:00:00Z');
  assert.equal(pricing.prorate({ oldPrice: 10000, newPrice: 20000, start, end, now: mid }), 5000);
  assert.equal(pricing.prorate({ oldPrice: 10000, newPrice: 20000, start, end, now: start }), 10000);
  assert.equal(pricing.prorate({ oldPrice: 10000, newPrice: 20000, start, end, now: end }), 0);
  assert.equal(pricing.prorate({ oldPrice: 20000, newPrice: 10000, start, end, now: mid }), 0);
  assert.equal(pricing.prorate({ oldPrice: 0, newPrice: 20000, start, end, now: mid }), 10000);
  assert.equal(pricing.prorate({ oldPrice: 10000, newPrice: 20000, start, end, now: new Date(end - 1000) }), 100);
  assert.equal(pricing.prorate({ oldPrice: 8, newPrice: 16, start, end, now: new Date('2026-10-11T00:00:00Z'), currency: 'USD' }), 5.33);
});
test('money formatting and the amount sent to Paystack (smallest unit)', () => {
  assert.equal(pricing.fmtMoney(10000, 'NGN'), '₦10,000'); assert.equal(pricing.fmtMoney(8, 'USD'), '$8'); assert.equal(pricing.fmtMoney(8.5, 'USD'), '$8.50'); assert.equal(pricing.fmtMoney(5, 'XYZ'), 'XYZ 5');
  assert.equal(pricing.toSubunits(2000), 200000); assert.equal(pricing.toSubunits(8.99), 899); assert.equal(pricing.toSubunits(5.33), 533);
});
test('payment methods: at least one way to pay must stay on', async () => {
  reset(); const e = await thrown(pricing.setMethods({ onlineEnabled: false, bankTransferEnabled: false }, ADMIN)); assert.equal(e?.statusCode, 400);
  const m = await pricing.setMethods({ onlineEnabled: false }, ADMIN); assert.equal(m.online, false); assert.equal(m.bankTransfer, true);
});
