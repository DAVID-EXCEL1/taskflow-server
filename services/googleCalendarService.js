const GoogleCalendarConnection = require('../models/GoogleCalendarConnection');
const AppError = require('../utils/AppError');
const { encrypt, decrypt } = require('../utils/crypto');
const googleAuth = require('./googleAuth');

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const clientId = () => process.env.GOOGLE_CLIENT_ID || googleAuth.DEFAULT_CLIENT_ID;
const configured = () => !!(clientId() && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALENDAR_REDIRECT_URI);
const redirectUri = () => process.env.GOOGLE_CALENDAR_REDIRECT_URI;

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    console.error('Google Calendar token exchange failed:', response.status);
    throw new AppError('Google Calendar could not be connected. Please try again.', 502);
  }
  return result;
}

async function refresh(connection) {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: decrypt(connection.refreshTokenEnc),
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    if (response.status === 400 || response.status === 401) {
      await GoogleCalendarConnection.deleteOne({ _id: connection._id });
      throw new AppError('Google Calendar access expired. Please reconnect it from your profile.', 401);
    }
    console.error('Google Calendar token refresh failed:', response.status);
    throw new AppError('Google Calendar is temporarily unavailable.', 502);
  }
  connection.accessTokenEnc = encrypt(result.access_token);
  connection.expiresAt = new Date(Date.now() + Number(result.expires_in || 3600) * 1000);
  await connection.save();
  return result.access_token;
}

async function accessToken(connection) {
  if (connection.expiresAt.getTime() > Date.now() + 60_000) return decrypt(connection.accessTokenEnc);
  return refresh(connection);
}

async function googleRequest(connection, url, options = {}) {
  let token = await accessToken(connection);
  let response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401) {
    token = await refresh(connection);
    response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(12000),
    });
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => {});
    if (status === 401 || status === 403) throw new AppError('Google Calendar did not authorize this action. Reconnect it and try again.', 502);
    throw new AppError('Google Calendar could not complete the request. Please try again.', 502);
  }
  return response.status === 204 ? null : response.json();
}

async function createEvent(userId, { title, description, start, end, timezone }) {
  const connection = await GoogleCalendarConnection.findOne({ user: userId }).select('+accessTokenEnc +refreshTokenEnc');
  if (!connection) throw new AppError('Connect Google Calendar from your profile first.', 400);
  const event = {
    summary: title,
    ...(description ? { description } : {}),
    start: { dateTime: start, timeZone: timezone },
    end: { dateTime: end, timeZone: timezone },
  };
  return googleRequest(connection, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

async function revoke(connection) {
  const refreshToken = decrypt(connection.refreshTokenEnc);
  const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok && response.status !== 400) {
    await response.body?.cancel().catch(() => {});
    throw new AppError('Google Calendar could not be disconnected with Google. Try again.', 502);
  }
}

module.exports = { SCOPES, configured, clientId, redirectUri, exchangeCode, createEvent, revoke };
