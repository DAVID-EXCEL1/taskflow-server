// Emergency recovery for someone who lost BOTH their authenticator and recovery codes.
// Run on a machine that has your .env:   npm run reset-2fa -- person@example.com
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
(async () => {
  const email = (process.argv[2] || '').toLowerCase();
  if (!email) { console.error('Usage: npm run reset-2fa -- email@example.com'); process.exit(1); }
  await connectDB();
  const r = await User.updateOne({ email }, { $set: { 'twoFactor.enabled': false }, $unset: { 'twoFactor.secretEnc': 1, 'twoFactor.recoveryHashes': 1, 'twoFactor.lastStep': 1, 'twoFactor.pendingSecretEnc': 1, 'twoFactor.lockedUntil': 1 } });
  console.log(r.matchedCount ? `2FA turned off for ${email}. They should set it up again after logging in.` : `No user found with email ${email}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
