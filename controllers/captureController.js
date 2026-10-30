const crypto = require('crypto');
const User = require('../models/User');
const TaskCapture = require('../models/TaskCapture');
const AssistantToken = require('../models/AssistantToken');
const WhatsAppLink = require('../models/WhatsAppLink');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const capture = require('../services/captureService');
const { getAccess } = require('../services/subscriptionService');
const notifications = require('../services/notificationService');
const { transcribeWhatsAppAudio } = require('../services/voiceTranscriptionService');
const whatsapp = require('../services/whatsappService');

const same = (a, b) => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const normalizePhone = (value) => String(value || '').replace(/[^\d+]/g, '').replace(/^00/, '+');

exports.list = asyncHandler(async (req, res) => {
  const items = await TaskCapture.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, data: items });
});

exports.createManual = asyncHandler(async (req, res) => {
  const result = await capture.create({
    user: req.user._id,
    source: req.body.source || 'manual',
    title: req.body.title,
    content: req.body.content,
  });
  res.status(201).json({ success: true, data: result.capture });
});

exports.remove = asyncHandler(async (req, res) => {
  const result = await TaskCapture.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!result.deletedCount) throw new AppError('Captured item not found.', 404);
  res.json({ success: true });
});

exports.emailAddress = asyncHandler(async (req, res) => {
  const domain = String(process.env.MAILGUN_INBOUND_DOMAIN || '').trim().toLowerCase();
  if (!domain || !process.env.MAILGUN_SIGNING_KEY) throw new AppError('Forwarded email capture is not configured on the server.', 503);
  const token = crypto.randomBytes(24).toString('hex');
  await User.updateOne({ _id: req.user._id }, { $set: { captureEmailHash: capture.digest(token) } });
  res.json({ success: true, data: { address: `capture+${token}@${domain}` }, message: 'Save this address in your contacts. It is a private forwarding address; generating a new one disables this one.' });
});

exports.whatsappPair = asyncHandler(async (req, res) => {
  if (!process.env.WHATSAPP_VERIFY_TOKEN || !process.env.WHATSAPP_APP_SECRET) throw new AppError('WhatsApp capture is not configured on the server.', 503);
  const code = crypto.randomBytes(8).toString('hex').toUpperCase();
  await WhatsAppLink.findOneAndUpdate(
    { user: req.user._id },
    { $set: { pairingHash: capture.digest(code), pairingExpiresAt: new Date(Date.now() + 10 * 60_000) }, $unset: { phone: 1, linkedAt: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ success: true, data: { code }, message: 'Send this code to your configured Taskflow WhatsApp number within 10 minutes. It can only be used once.' });
});

exports.whatsappStatus = asyncHandler(async (req, res) => {
  const link = await WhatsAppLink.findOne({ user: req.user._id }).select('phone linkedAt').lean();
  res.json({ success: true, data: { configured: whatsapp.configured(), linked: !!link?.phone, phone: link?.phone || null, linkedAt: link?.linkedAt || null } });
});

exports.whatsappUnlink = asyncHandler(async (req, res) => {
  await WhatsAppLink.deleteOne({ user: req.user._id });
  res.json({ success: true, message: 'WhatsApp was disconnected.' });
});

exports.createAssistantToken = asyncHandler(async (req, res) => {
  const token = `tf_${crypto.randomBytes(32).toString('base64url')}`;
  await AssistantToken.deleteMany({ user: req.user._id });
  await AssistantToken.create({ user: req.user._id, hash: capture.digest(token), label: 'Siri Shortcuts and assistants' });
  res.json({ success: true, data: { token }, message: 'Copy this key now. It is shown only once. You can revoke it at any time.' });
});

exports.revokeAssistantToken = asyncHandler(async (req, res) => {
  await AssistantToken.deleteMany({ user: req.user._id });
  res.json({ success: true, message: 'Assistant access was revoked.' });
});

exports.assistantTokenStatus = asyncHandler(async (req, res) => {
  const token = await AssistantToken.findOne({ user: req.user._id }).select('_id lastUsedAt').lean();
  res.json({ success: true, data: { enabled: !!token, lastUsedAt: token?.lastUsedAt || null } });
});

exports.assistantCapture = asyncHandler(async (req, res) => {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer tf_') ? auth.slice(7) : '';
  if (!token) throw new AppError('Assistant key is missing or invalid.', 401);
  const record = await AssistantToken.findOne({ hash: capture.digest(token) });
  if (!record) throw new AppError('Assistant key is missing or invalid.', 401);
  const user = await User.findById(record.user).lean();
  if (!user || !user.isActive) throw new AppError('This account is unavailable.', 401);
  const access = await getAccess(user);
  if (!access.canWrite) throw new AppError('An active subscription is required to capture tasks.', 402);
  record.lastUsedAt = new Date();
  await record.save();
  const result = await capture.create({ user: user._id, source: 'shortcut', title: req.body.title, content: req.body.content });
  res.status(201).json({ success: true, data: { id: result.capture._id, status: 'needs_review' } });
});

exports.mailgun = asyncHandler(async (req, res) => {
  const key = process.env.MAILGUN_SIGNING_KEY;
  const { timestamp, token, signature } = req.body.signature || {};
  const seconds = Number(timestamp);
  if (!key || !timestamp || !token || !signature || !Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 600 || !same(crypto.createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex'), signature)) {
    throw new AppError('Invalid inbound email signature.', 401);
  }
  const to = String(req.body.recipient || req.body.To || '');
  const match = /capture\+([a-f\d]{48})@/i.exec(to);
  if (!match) return res.json({ success: true, ignored: true });
  const user = await User.findOne({ captureEmailHash: capture.digest(match[1]) }).select('_id').lean();
  if (!user) return res.json({ success: true, ignored: true });
  const sourceId = String(req.body['Message-Id'] || req.body['message-id'] || token).slice(0, 250);
  const message = String(req.body['stripped-text'] || req.body['body-plain'] || '').slice(0, 10000);
  const subject = String(req.body.subject || '').slice(0, 200);
  const result = await capture.create({ user: user._id, source: 'email', sourceId: `mailgun:${sourceId}`, title: subject, content: message });
  if (!result.duplicate) await notifications.notify([user._id], { type: 'CAPTURE_RECEIVED', title: 'Email draft received', message: 'A forwarded email is ready to review in your task inbox.', link: '/inbox' });
  res.json({ success: true, duplicate: result.duplicate });
});

exports.whatsappVerify = (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) return res.sendStatus(503);
  const valid = req.query['hub.mode'] === 'subscribe' && same(req.query['hub.verify_token'], verifyToken);
  if (!valid) return res.sendStatus(403);
  return res.status(200).send(String(req.query['hub.challenge'] || ''));
};

exports.whatsappWebhook = asyncHandler(async (req, res) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const signature = String(req.headers['x-hub-signature-256'] || '');
  const expected = secret && req.rawBody ? `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')}` : '';
  if (!expected || !same(signature, expected)) throw new AppError('Invalid WhatsApp signature.', 401);
  const messages = (req.body.entry || []).flatMap((entry) => entry.changes || []).flatMap((change) => change.value?.messages || []);
  for (const message of messages) {
    const phone = normalizePhone(message.from);
    let body = message.type === 'text' ? String(message.text?.body || '').trim() : '';
    const pair = /^\/?link\s+([a-f\d]{16})$/i.exec(body);
    if (pair) {
      const filter = { pairingHash: capture.digest(pair[1].toUpperCase()), pairingExpiresAt: { $gt: new Date() } };
      const pending = await WhatsAppLink.findOne(filter).select('user').lean();
      if (pending) {
        try {
          const link = await WhatsAppLink.findOneAndUpdate(
            filter,
            { $set: { phone, linkedAt: new Date() }, $unset: { pairingHash: 1, pairingExpiresAt: 1 } },
            { new: true }
          );
          if (link) continue;
        } catch (error) {
          if (error.code !== 11000) throw error;
          await WhatsAppLink.updateOne(
            { _id: pending._id, pairingHash: filter.pairingHash },
            { $unset: { pairingHash: 1, pairingExpiresAt: 1 } }
          );
          console.error('WhatsApp pairing rejected because the number is already linked to another account.');
          await notifications.notify([pending.user], {
            type: 'CAPTURE_RECEIVED',
            title: 'WhatsApp could not be connected',
            message: 'This number is already linked to another account. Disconnect it there before trying again.',
            link: '/profile',
          });
          continue;
        }
      }
      continue;
    }
    if (!phone || (!body && message.type !== 'audio')) continue;
    const link = await WhatsAppLink.findOne({ phone }).select('user').lean();
    if (!link) continue;
    if (message.type === 'audio' && message.audio?.id) {
      try {
        body = await transcribeWhatsAppAudio(message.audio.id) || 'Voice note received. Configure AI_STT_MODEL and the AI provider to transcribe WhatsApp voice notes.';
      } catch (error) {
        console.error('WhatsApp voice note could not be transcribed:', error.message);
        body = 'Voice note received, but transcription failed. Please try recording it again or type the task.';
      }
    }
    if (!body || !message.id) continue;
    const result = await capture.create({ user: link.user, source: 'whatsapp', sourceId: `whatsapp:${message.id}`, content: body });
    if (!result.duplicate) await notifications.notify([link.user], {
      type: 'CAPTURE_RECEIVED',
      title: 'WhatsApp draft received',
      message: 'A message is ready to review in your task inbox.',
      link: '/inbox',
    });
  }
  res.sendStatus(200);
});

exports._helpers = { normalizePhone };
