/**
 * "Sign in with Google": the browser gets a signed ID token from Google; we check its signature against Google's PUBLIC keys,
 * and that it was issued for OUR client ID (GOOGLE_CLIENT_ID), by Google, not expired, with a confirmed email.
 * The client ID is public (it is in the web page). The client SECRET is never needed and must never be added anywhere.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');

const DEFAULT_CLIENT_ID = '208451396094-khq2kheg7mpaa8lpmd7rfiqjo58sfstr.apps.googleusercontent.com';
const clientId = () => process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
let jwks = { at: 0, keys: [] };

async function getKeys(force = false) {
  if (!force && jwks.keys.length && Date.now() - jwks.at < 3600_000) return jwks.keys;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    jwks = { at: Date.now(), keys: (await res.json()).keys || [] };
    return jwks.keys;
  } catch (e) {
    if (jwks.keys.length) return jwks.keys; // keep using the last keys if Google is briefly unreachable
    throw new AppError('We could not reach Google just now. Please try again, or sign in with your email and password.', 502);
  } finally { clearTimeout(t); }
}

async function verifyIdToken(credential) {
  const bad = () => new AppError('Google sign-in failed. Please try again.', 401);
  const decoded = jwt.decode(String(credential || ''), { complete: true });
  if (!decoded || decoded.header?.alg !== 'RS256' || !decoded.header.kid) throw bad();
  let key = (await getKeys()).find((k) => k.kid === decoded.header.kid);
  if (!key) key = (await getKeys(true)).find((k) => k.kid === decoded.header.kid); // Google rotates keys
  if (!key) throw bad();
  let p;
  try { p = jwt.verify(credential, crypto.createPublicKey({ key, format: 'jwk' }), { algorithms: ['RS256'], audience: clientId(), issuer: ISSUERS }); } catch { throw bad(); }
  if (!p.sub || !p.email) throw bad();
  if (p.email_verified !== true) throw new AppError('Your Google email address is not confirmed, so we cannot use it.', 401);
  const email = String(p.email).toLowerCase();
  const name = String(p.name || email.split('@')[0]).trim().slice(0, 80).padEnd(2, ' ');
  return { sub: String(p.sub), email, name };
}

// A new person: the 15-minute ticket that lets them finish sign-up (choose account type, accept the Terms) without Google again.
const signSignup = (g) => jwt.sign({ purpose: 'google-signup', sub: g.sub, email: g.email, name: g.name }, process.env.JWT_SECRET, { expiresIn: '15m' });
function readSignup(token) {
  try { const p = jwt.verify(token, process.env.JWT_SECRET); if (p.purpose !== 'google-signup' || !p.sub || !p.email) throw new Error('x'); return { sub: p.sub, email: p.email, name: p.name }; }
  catch { throw new AppError('This sign-up step expired. Please press Continue with Google again.', 400); }
}
module.exports = { verifyIdToken, signSignup, readSignup, DEFAULT_CLIENT_ID, _reset: () => { jwks = { at: 0, keys: [] }; } };
