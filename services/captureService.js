const cap = require('./dailyCap');
const crypto = require('crypto');
const TaskCapture = require('../models/TaskCapture');

const clean = (value, max = 10000) => String(value || '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const taskTitle = (subject, content) => {
  const first = clean(subject, 200) || clean(content, 200).split(/(?<=[.!?])\s/)[0];
  return first || 'Review captured message';
};

async function create({ user, source, sourceId, title, content }) {
  const cleanedContent = clean(content);
  const cleanedTitle = clean(title, 200) || taskTitle('', cleanedContent);
  const dedupeId = sourceId ? `capture:${digest(`${user}:${sourceId}`)}` : undefined;
  if (!cleanedTitle) throw new Error('Captured message has no task text.');
  if (dedupeId) {
    const existing = await TaskCapture.findOne({ sourceId: dedupeId }).lean();
    if (existing) return { capture: existing, duplicate: true };
  }
  // Limits: how many items can sit in the inbox, and how many can arrive per day (stops spam and runaway forwarding).
  if ((await TaskCapture.countDocuments({ user })) >= cap.intEnv('CAPTURE_MAX_STORED', 500)) return { capture: null, limited: 'full', message: 'Your task inbox is full. Review or delete some items first.' };
  if (!(await cap.take(`cap:u:${user}`, cap.intEnv('CAPTURE_DAILY_LIMIT', 100)))) return { capture: null, limited: 'daily', message: 'You have reached today’s limit for new inbox items. Please try again tomorrow.' };
  try {
    const capture = await TaskCapture.create({ user, source, sourceId: dedupeId, title: cleanedTitle, content: cleanedContent });
    return { capture, duplicate: false };
  } catch (error) {
    if (error.code !== 11000 || !dedupeId) throw error;
    const existing = await TaskCapture.findOne({ sourceId: dedupeId }).lean();
    if (!existing) throw error;
    return { capture: existing, duplicate: true };
  }
}

module.exports = { create, clean, digest, taskTitle };
