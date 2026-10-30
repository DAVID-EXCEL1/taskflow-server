const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const CalendarOAuthState = require('../models/CalendarOAuthState');
const GoogleCalendarConnection = require('../models/GoogleCalendarConnection');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { encrypt, decrypt } = require('../utils/crypto');
const googleCalendar = require('../services/googleCalendarService');
const clientUrl = require('../utils/clientUrl');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

exports.status = asyncHandler(async (req, res) => {
  const connected = await GoogleCalendarConnection.exists({ user: req.user._id });
  res.json({ success: true, data: { configured: googleCalendar.configured(), connected: !!connected } });
});

exports.start = asyncHandler(async (req, res) => {
  if (!googleCalendar.configured()) throw new AppError('Google Calendar is not configured on the server.', 503);
  const nonce = crypto.randomBytes(32).toString('base64url');
  await CalendarOAuthState.create({ nonceHash: sha256(nonce), user: req.user._id, expiresAt: new Date(Date.now() + 10 * 60_000) });
  const state = jwt.sign({ purpose: 'google-calendar', user: String(req.user._id), nonce }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: googleCalendar.clientId(),
    redirect_uri: googleCalendar.redirectUri(),
    response_type: 'code',
    scope: googleCalendar.SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  }).toString();
  res.json({ success: true, data: { url: url.toString() } });
});

exports.callback = asyncHandler(async (req, res) => {
  const done = (result) => res.redirect(`${clientUrl()}/profile?calendar=${result}`);
  let state;
  try {
    state = jwt.verify(String(req.query.state || ''), process.env.JWT_SECRET);
  } catch {
    throw new AppError('Google Calendar connection expired. Start the connection again from your profile.', 400);
  }
  if (state.purpose !== 'google-calendar' || !state.user || !state.nonce) {
    throw new AppError('Invalid Google Calendar authorization state.', 400);
  }
  const claimed = await CalendarOAuthState.findOneAndDelete({
    user: state.user,
    nonceHash: sha256(state.nonce),
    expiresAt: { $gt: new Date() },
  });
  if (!claimed) throw new AppError('Google Calendar connection expired or was already used. Start again from your profile.', 400);
  if (req.query.error) return done('error');
  const code = String(req.query.code || '');
  if (!code || code.length > 2000) throw new AppError('Google did not return an authorization code.', 400);
  const token = await googleCalendar.exchangeCode(code);
  const existing = await GoogleCalendarConnection.findOne({ user: state.user }).select('+refreshTokenEnc');
  const grantedScopes = String(token.scope || '').split(/\s+/);
  if (!googleCalendar.SCOPES.every((scope) => grantedScopes.includes(scope))) throw new AppError('Google Calendar access was not approved. Please reconnect and allow calendar event access.', 403);
  const refreshToken = token.refresh_token || (existing && decrypt(existing.refreshTokenEnc));
  if (!refreshToken) throw new AppError('Google did not issue offline access. Please reconnect and approve the requested access.', 502);
  await GoogleCalendarConnection.findOneAndUpdate(
    { user: state.user },
    {
      user: state.user,
      accessTokenEnc: encrypt(token.access_token),
      refreshTokenEnc: encrypt(refreshToken),
      expiresAt: new Date(Date.now() + Number(token.expires_in || 3600) * 1000),
      scope: token.scope || googleCalendar.SCOPES.join(' '),
    },
    { upsert: true, new: true, runValidators: true }
  );
  return done('connected');
});

exports.disconnect = asyncHandler(async (req, res) => {
  const connection = await GoogleCalendarConnection.findOne({ user: req.user._id }).select('+refreshTokenEnc');
  if (connection) {
    await googleCalendar.revoke(connection);
    await GoogleCalendarConnection.deleteOne({ _id: connection._id, user: req.user._id });
  }
  res.json({ success: true, message: 'Google Calendar disconnected.' });
});

exports.createEvent = asyncHandler(async (req, res) => {
  const event = await googleCalendar.createEvent(req.user._id, {
    ...req.body,
    timezone: req.user.timezone || 'Africa/Lagos',
  });
  res.status(201).json({ success: true, data: { id: event.id, htmlLink: event.htmlLink || null } });
});

exports._helpers = { sha256 };
