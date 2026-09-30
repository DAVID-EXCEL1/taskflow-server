const ActivityLog = require('../models/ActivityLog');

// Never let logging break a request.
async function log({ actor, action, message, organization, entityType, entityId, metadata }) {
  try {
    await ActivityLog.create({
      actor: actor?._id || actor?.id || actor,
      actorName: actor?.name,
      action,
      message,
      organization: organization?._id || organization,
      entityType,
      entityId,
      metadata,
    });
  } catch (e) {
    console.error('Activity log failed:', e.message);
  }
}
module.exports = { log };
