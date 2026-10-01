const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

let ready = false;
function init() {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
  if (pub && priv) { webpush.setVapidDetails(subject || 'mailto:admin@example.com', pub, priv); ready = true; }
  return ready;
}
init();
const isEnabled = () => ready;
const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

// Sends to every device of the given users. Dead subscriptions (404/410) are removed. Returns the number delivered.
async function sendToUsers(userIds, payload) {
  if (!ready || !userIds.length) return 0;
  const subs = await PushSubscription.find({ user: { $in: userIds } });
  const body = JSON.stringify({ title: payload.title, body: payload.message || '', url: payload.link || '/' });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, body, { TTL: 3600 }); sent++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await PushSubscription.deleteOne({ _id: s._id });
      else console.error('Push failed:', e.statusCode || e.message);
    }
  }));
  return sent;
}
module.exports = { init, isEnabled, publicKey, sendToUsers };
