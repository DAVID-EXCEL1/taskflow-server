const mongoose = require('mongoose');
const { INVITE_STATUS } = require('../config/constants');
const schema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    token: { type: String, required: true, unique: true },
    status: { type: String, enum: Object.values(INVITE_STATUS), default: INVITE_STATUS.PENDING },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    respondedAt: Date,
  },
  { timestamps: true }
);
module.exports = mongoose.model('Invitation', schema);
