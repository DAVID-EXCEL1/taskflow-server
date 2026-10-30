/**
 * Fingerprint / face / screen-lock sign-in ("passkeys", the WebAuthn standard).
 *  - Requires user verification (the device checks the fingerprint or PIN), so a passkey sign-in counts as two-step on its own.
 *  - Challenges are single-use and expire after 5 minutes. The public key is stored; the private key never leaves the device.
 *  - A passkey only works on the website it was created on (checked against CLIENT_URL).
 * Uses the audited @simplewebauthn/server library for the cryptography.
 */
const webauthn = require('@simplewebauthn/server');
const Passkey = require('../models/Passkey');
const PasskeyChallenge = require('../models/PasskeyChallenge');
const AppError = require('../utils/AppError');

const RP_NAME = () => process.env.APP_NAME || 'SetYourTask';
const MAX_PER_USER = 5; const CHALLENGE_MS = 5 * 60_000;
const allowedOrigins = () => String(process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
// The browser tells us which site the person is on; it must be one of ours. The passkey's "relying party" is that site's hostname.
function siteFrom(req) {
  const origin = String(req.headers?.origin || '').replace(/\/$/, '');
  if (!allowedOrigins().includes(origin)) throw new AppError('Fingerprint sign-in is not available from this website address.', 400);
  return { origin, rpID: new URL(origin).hostname };
}
const fail = () => new AppError('Fingerprint sign-in failed. Please try again, or log in with your password.', 401);
const toB64 = (u8) => Buffer.from(u8).toString('base64url');

async function newChallenge(purpose, challenge, origin, user) {
  const doc = await PasskeyChallenge.create({ challenge, purpose, origin, ...(user ? { user } : {}), expiresAt: new Date(Date.now() + CHALLENGE_MS) });
  return String(doc._id);
}
// Single use: taking it removes it, so the same signed answer can never be replayed.
const takeChallenge = (id, purpose, user) => PasskeyChallenge.findOneAndDelete({ _id: id, purpose, expiresAt: { $gt: new Date() }, ...(user ? { user } : {}) });

async function registrationOptions(user, req) {
  const { origin, rpID } = siteFrom(req);
  const existing = await Passkey.find({ user: user._id }).lean();
  if (existing.length >= MAX_PER_USER) throw new AppError(`You can save up to ${MAX_PER_USER} fingerprint logins. Remove one first.`, 409);
  const options = await webauthn.generateRegistrationOptions({
    rpName: RP_NAME(), rpID, userName: user.email, userDisplayName: user.name, userID: new TextEncoder().encode(String(user._id)), attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, timeout: 120_000,
  });
  return { options, challengeId: await newChallenge('register', options.challenge, origin, user._id) };
}
async function verifyRegistration(user, req, { challengeId, response, name }) {
  const { origin, rpID } = siteFrom(req);
  const ch = await takeChallenge(challengeId, 'register', user._id);
  if (!ch || ch.origin !== origin) throw new AppError('This step expired. Please try again.', 400);
  let v;
  try { v = await webauthn.verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }); } catch { throw new AppError('We could not confirm that fingerprint. Please try again.', 400); }
  if (!v.verified || !v.registrationInfo) throw new AppError('We could not confirm that fingerprint. Please try again.', 400);
  const c = v.registrationInfo.credential;
  if (await Passkey.exists({ credentialId: c.id })) throw new AppError('This device is already saved.', 409);
  const label = String(name || '').trim().slice(0, 40) || 'This device';
  return Passkey.create({ user: user._id, credentialId: c.id, publicKey: toB64(c.publicKey), counter: c.counter || 0, transports: response?.response?.transports || c.transports || [], rpID, name: label, backedUp: !!v.registrationInfo.credentialBackedUp });
}

async function loginOptions(req) {
  const { origin, rpID } = siteFrom(req);
  const options = await webauthn.generateAuthenticationOptions({ rpID, userVerification: 'required', timeout: 120_000 });
  return { options, challengeId: await newChallenge('login', options.challenge, origin) };
}
// Returns the user id the passkey belongs to (the caller applies the normal "may this account sign in" checks).
async function verifyLogin(req, { challengeId, response }) {
  const { origin, rpID } = siteFrom(req);
  const ch = await takeChallenge(challengeId, 'login');
  if (!ch || ch.origin !== origin) throw new AppError('This step expired. Please try again.', 400);
  const pk = await Passkey.findOne({ credentialId: String(response?.id || '') });
  if (!pk || pk.rpID !== rpID) throw fail();
  let v;
  try {
    v = await webauthn.verifyAuthenticationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: pk.credentialId, publicKey: new Uint8Array(Buffer.from(pk.publicKey, 'base64url')), counter: pk.counter || 0, transports: pk.transports } });
  } catch { throw fail(); }
  if (!v.verified) throw fail();
  pk.counter = v.authenticationInfo.newCounter; pk.lastUsedAt = new Date(); await pk.save();
  return pk.user;
}
const list = (userId) => Passkey.find({ user: userId }).sort({ createdAt: -1 }).select('name createdAt lastUsedAt backedUp transports').lean();
async function remove(userId, id) {
  const r = await Passkey.deleteOne({ _id: id, user: userId });
  if (!r.deletedCount) throw new AppError('Fingerprint login not found.', 404);
}
module.exports = { registrationOptions, verifyRegistration, loginOptions, verifyLogin, list, remove, MAX_PER_USER };
