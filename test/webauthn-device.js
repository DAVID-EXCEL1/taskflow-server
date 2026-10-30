// A software "phone fingerprint sensor" for tests: it makes real WebAuthn registrations and assertions (real ECDSA signatures),
// and can be told to misbehave so we can prove the server rejects the bad cases.
const crypto = require('crypto');
const head = (major, n) => { if (n < 24) return Buffer.from([(major << 5) | n]); if (n < 256) return Buffer.from([(major << 5) | 24, n]); if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; } const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b; };
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor type');
}
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const b64 = (b) => Buffer.from(b).toString('base64url');

function makeDevice({ origin = 'https://setyourtask.com', rpID = 'setyourtask.com' } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }); const credId = crypto.randomBytes(32); let counter = 0;
  return {
    id: b64(credId),
    // opts: challenge (override), origin, rpID, uv (default true), key (sign with another private key), id, counter
    create(options, opts = {}) {
      const flags = 0x01 | ((opts.uv ?? true) ? 0x04 : 0) | 0x40;
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([sha(opts.rpID ?? rpID), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), len, credId, cose]);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge ?? options.challenge, origin: opts.origin ?? origin, crossOrigin: false }));
      return { id: b64(credId), rawId: b64(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform', response: { clientDataJSON: b64(clientData), attestationObject: b64(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), transports: ['internal'] } };
    },
    get(options, opts = {}) {
      counter = opts.counter ?? counter + 1;
      const flags = 0x01 | ((opts.uv ?? true) ? 0x04 : 0); const c = Buffer.alloc(4); c.writeUInt32BE(counter);
      const authData = Buffer.concat([sha(opts.rpID ?? rpID), Buffer.from([flags]), c]);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: opts.challenge ?? options.challenge, origin: opts.origin ?? origin, crossOrigin: false }));
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientData)]), opts.key ?? privateKey);
      return { id: opts.id ?? b64(credId), rawId: opts.id ?? b64(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform', response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) } };
    },
    privateKey,
  };
}
module.exports = { makeDevice };
