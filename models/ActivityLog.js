const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: String,
    action: { type: String, required: true, index: true },
    message: String,
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ createdAt: -1 });
module.exports = mongoose.model('ActivityLog', schema);
