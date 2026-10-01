// RFC 6238 time-based one-time passwords (what Google Authenticator / Authy / Microsoft Authenticator use). No external library.
const crypto = require('crypto');
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of str.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; value &= (1 << bits) - 1; }
  }
  return Buffer.from(out);
}
const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(key, counter, digits = 6) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[19] & 0xf;
  const n = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 10 ** digits;
  return String(n).padStart(digits, '0');
}
/**
 * Returns the matched time-step (number) or null. Accepts +/- `window` steps of clock drift.
 * Steps <= lastStep are rejected so a code can never be used twice (replay protection).
 */
function verifyTotp(secretB32, code, { window = 1, lastStep = null, now = Date.now(), period = 30 } = {}) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const key = base32Decode(secretB32);
  const step = Math.floor(now / 1000 / period);
  for (let w = -window; w <= window; w++) {
    const s = step + w;
    if (lastStep != null && s <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(String(code)))) return s;
  }
  return null;
}
const otpauthUri = ({ secret, account, issuer }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

module.exports = { generateSecret, verifyTotp, otpauthUri, base32Encode, base32Decode, hotp };
