const crypto = require('crypto');
// AES-256-GCM encryption for secrets stored in the database (2FA secrets).
// Set TWO_FA_ENCRYPTION_KEY to a dedicated random value; falls back to JWT_SECRET.
const key = () => crypto.createHash('sha256').update(String(process.env.TWO_FA_ENCRYPTION_KEY || process.env.JWT_SECRET)).digest();
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decrypt(payload) {
  const [iv, tag, enc] = String(payload).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
module.exports = { encrypt, decrypt, sha256 };
