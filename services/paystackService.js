/**
 * Thin, careful wrapper around Paystack's API. The secret key lives only in the server environment
 * (PAYSTACK_SECRET_KEY) and is never logged or returned. All problems become a friendly 502 for the customer.
 */
const crypto = require('crypto');
const AppError = require('../utils/AppError');

const BASE = 'https://api.paystack.co';
const configured = () => !!process.env.PAYSTACK_SECRET_KEY;

// Whatever Paystack says, a secret key must never be written to a log.
const redact = (m) => String(m).split(process.env.PAYSTACK_SECRET_KEY || '\u0000').join('[redacted]').replace(/sk_(test|live)_[A-Za-z0-9]+/g, '[redacted]').slice(0, 120);

async function call(method, path, body) {
  if (!configured()) throw new AppError('Online payment is not set up yet.', 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.status !== true) { console.error(`Paystack ${method} ${path.split('/').slice(0, 3).join('/')} failed: HTTP ${res.status}${json?.message ? ` - ${redact(json.message)}` : ''}`); throw new AppError('We could not reach the payment service. Please try again in a moment.', 502); }
    return json;
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error(`Paystack call failed: ${e?.name === 'AbortError' ? 'timeout' : e?.name || 'error'}`);
    throw new AppError('We could not reach the payment service. Please try again in a moment.', 502);
  } finally { clearTimeout(timer); }
}

// amount is in the smallest unit (kobo for NGN).
async function initialize({ email, amount, currency, reference, callbackUrl, metadata }) {
  const json = await call('POST', '/transaction/initialize', { email, amount, currency, reference, callback_url: callbackUrl, metadata });
  if (!json.data?.authorization_url) throw new AppError('We could not start the payment. Please try again.', 502);
  return json.data;
}
const verify = (reference) => call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);

// Paystack signs every webhook: HMAC-SHA512 of the EXACT raw request body with your secret key.
function verifySignature(rawBody, signature) {
  if (!configured() || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { configured, initialize, verify, verifySignature };
