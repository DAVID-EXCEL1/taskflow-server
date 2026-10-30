const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  accessTokenEnc: { type: String, required: true, select: false },
  refreshTokenEnc: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  scope: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('GoogleCalendarConnection', schema);
