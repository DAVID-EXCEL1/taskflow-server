/**
 * Master switches for features that need a paid account or a key (SMS, WhatsApp, email forwarding, Google Calendar).
 * A feature is visible to users ONLY when the admin switched it on AND its server keys are present.
 * Until then users see nothing about it, and the server answers its routes as if they do not exist.
 */
const Setting = require('../models/Setting');
const AppError = require('../utils/AppError');

const FEATURES = {
  sms: { label: 'SMS: phone verification and the morning plan by text', needs: ['AT_USERNAME', 'AT_API_KEY'], note: "Africa's Talking. Costs a few naira per text." },
  whatsapp: { label: 'WhatsApp: add tasks by message or voice note, and the morning plan', needs: ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'], note: 'Meta WhatsApp Cloud API. Meta charges for messages you send.' },
  emailForwarding: { label: 'Forward an email to your task inbox', needs: ['MAILGUN_INBOUND_DOMAIN', 'MAILGUN_SIGNING_KEY'], note: 'Mailgun. Needs an account that can receive email.' },
  calendar: { label: 'Google Calendar', needs: ['GOOGLE_CLIENT_SECRET', 'GOOGLE_CALENDAR_REDIRECT_URI'], note: 'Free. Needs the Google client secret.' },
};
const KEYS = Object.keys(FEATURES);
const missing = (key) => FEATURES[key].needs.filter((n) => !process.env[n]);
let cache = null; const TTL = 20_000;

async function enabledMap() {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  let stored = {};
  try { stored = (await Setting.findOne({ key: 'features' }).lean())?.value || {}; } catch { if (cache) return cache.value; }
  cache = { at: Date.now(), value: stored };
  return stored;
}
async function isOn(key) { if (!FEATURES[key]) return false; return (await enabledMap())[key] === true && missing(key).length === 0; }
async function mine() { const m = await enabledMap(); return Object.fromEntries(KEYS.map((k) => [k, m[k] === true && missing(k).length === 0])); }
async function adminView() {
  const m = await enabledMap();
  return KEYS.map((key) => ({ key, label: FEATURES[key].label, note: FEATURES[key].note, enabled: m[key] === true, missing: missing(key), available: m[key] === true && missing(key).length === 0 }));
}
async function setEnabled(key, enabled, userId) {
  if (!FEATURES[key]) throw new AppError('Unknown feature.', 400);
  const value = { ...(await enabledMap()), [key]: !!enabled };
  await Setting.findOneAndUpdate({ key: 'features' }, { value, updatedBy: userId }, { upsert: true });
  cache = null;
}
// Express guard: answers exactly like a route that does not exist.
const requireFeature = (key) => async (req, res, next) => {
  try { if (await isOn(key)) return next(); return next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404)); } catch (e) { return next(e); }
};
module.exports = { FEATURES, KEYS, isOn, mine, adminView, setEnabled, requireFeature, _reset: () => { cache = null; } };
