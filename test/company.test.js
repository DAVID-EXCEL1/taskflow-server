const test = require('node:test'); const assert = require('node:assert/strict');
const { fakeSettings, thrown } = require('./helpers');
const settings = fakeSettings(); const company = require('../services/companyService');
const reset = () => { settings.clear(); company._reset(); };
test('defaults carry the support contact until the admin changes them', async () => {
  reset(); const c = await company.getCompany(); assert.equal(c.email, 'dextadmin@gmail.com'); assert.equal(c.whatsapp, '2348111189267'); assert.equal(c.vatRate, 0);
});
test('WhatsApp numbers are turned into the form wa.me needs', () => {
  assert.equal(company.normalizeWhatsapp('08111189267'), '2348111189267'); assert.equal(company.normalizeWhatsapp('+234 811 118 9267'), '2348111189267'); assert.equal(company.normalizeWhatsapp(''), '');
  assert.throws(() => company.normalizeWhatsapp('123'), /7 to 15 digits/); assert.throws(() => company.normalizeWhatsapp('1'.repeat(16)), /7 to 15 digits/);
});
test('saving validates every field and never stores junk', async () => {
  reset(); const ok = { name: 'SetYourTask', email: 'help@setyourtask.com', phone: '08111189267', whatsapp: '08111189267', address: 'Abuja', website: 'https://setyourtask.com', supportHours: 'Mon-Fri 9am-5pm', vatRate: 7.5, taxId: '12345' };
  const saved = await company.setCompany(ok, '507f1f77bcf86cd799439011'); assert.equal(saved.whatsapp, '2348111189267'); assert.equal((await company.getCompany()).email, 'help@setyourtask.com');
  for (const [label, patch] of [['no name', { name: '  ' }], ['bad email', { email: 'not-an-email' }], ['bad website', { website: 'setyourtask.com' }], ['VAT over 30', { vatRate: 31 }], ['negative VAT', { vatRate: -1 }], ['VAT as text', { vatRate: 'abc' }], ['huge address', { address: 'x'.repeat(201) }]]) {
    const e = await thrown(company.setCompany({ ...ok, ...patch }, '507f1f77bcf86cd799439011')); assert.equal(e?.statusCode, 400, label);
  }
  assert.equal((await company.getCompany()).email, 'help@setyourtask.com', 'a rejected change must not alter what is saved');
});
test('unknown fields are ignored, and an empty email or website is allowed (shown as not set)', async () => {
  reset(); const saved = await company.setCompany({ name: 'X', email: '', website: '', evil: '<script>', vatRate: 0 }, '507f1f77bcf86cd799439011'); assert.equal(saved.evil, undefined); assert.equal(saved.email, '');
});
