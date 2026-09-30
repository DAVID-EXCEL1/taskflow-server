const mongoose = require('mongoose');
// Owned by either a user (Individual) or an organization (Business).
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    color: { type: String, default: '#0F6B4F' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
  },
  { timestamps: true }
);
module.exports = mongoose.model('Category', schema);
