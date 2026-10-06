const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: String,
    link: String,
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);
schema.index({ createdAt: 1 }); // lets the automatic cleanup find old notifications quickly
module.exports = mongoose.model('Notification', schema);
