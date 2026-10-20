/**
 * Public business and support details (shown on the Help page, the Terms and Privacy pages, and receipts).
 * Editable by the Super Admin; these defaults are used until you change them.
 */
const Setting = require('../models/Setting');
const AppError = require('../utils/AppError');

const defaults = () => ({ name: process.env.APP_NAME || 'SetYourTask', email: 'dextadmin@gmail.com', phone: '+2348111189267', whatsapp: '2348111189267', address: '', website: '', supportHours: '', vatRate: 0, taxId: '' });
let cache = null; const TTL = 30_000;
async function getCompany() {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  let stored = null;
  try { stored = (await Setting.findOne({ key: 'company' }).lean())?.value || null; } catch { if (cache) return cache.value; }
  cache = { at: Date.now(), value: { ...defaults(), ...(stored || {}) } };
  return cache.value;
}
// WhatsApp links need the number with the country code and no "+", spaces or leading zero.
function normalizeWhatsapp(input) {
  let d = String(input ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0') && d.length === 11) d = `234${d.slice(1)}`; // 08111189267 -> 2348111189267
  if (d.length < 7 || d.length > 15) throw new AppError('The WhatsApp number must have 7 to 15 digits including the country code, for example 2348111189267.', 400);
  return d;
}
function cleanCompany(input = {}) {
  const text = (v, max, label) => { const t = String(v ?? '').trim(); if (t.length > max) throw new AppError(`${label} is too long (most ${max} characters).`, 400); return t; };
  const out = { name: text(input.name, 120, 'Business name') };
  if (!out.name) throw new AppError('Business name is required.', 400);
  out.email = text(input.email, 120, 'Support email');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new AppError('Enter a valid support email address.', 400);
  out.phone = text(input.phone, 30, 'Phone');
  out.whatsapp = normalizeWhatsapp(input.whatsapp);
  out.address = text(input.address, 200, 'Address');
  out.website = text(input.website, 120, 'Website');
  if (out.website && !/^https?:\/\/\S+$/i.test(out.website)) throw new AppError('The website must start with http:// or https://', 400);
  out.supportHours = text(input.supportHours, 120, 'Support hours');
  const vat = Number(input.vatRate ?? 0);
  if (!Number.isFinite(vat) || vat < 0 || vat > 30) throw new AppError('VAT rate must be between 0 and 30 (use 0 if you do not charge VAT).', 400);
  out.vatRate = vat;
  out.taxId = text(input.taxId, 40, 'Tax ID');
  return out;
}
async function setCompany(input, userId) {
  const value = cleanCompany(input);
  await Setting.findOneAndUpdate({ key: 'company' }, { value, updatedBy: userId }, { upsert: true });
  cache = null;
  return value;
}
module.exports = { getCompany, setCompany, cleanCompany, normalizeWhatsapp, _reset: () => { cache = null; } };
