// Shared test helpers: environment + a tiny in-memory stand-in for MongoDB models (no database is needed to run the tests).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-'.padEnd(40, 'x');
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/none';
process.env.NODE_ENV = 'test';
process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_ABCDEFGHIJKLMNOP';
process.env.CLIENT_URL = 'https://taxkflow.com,https://example.vercel.app';

// A Mongoose-like query: works with .select().lean(), .sort(), .limit() AND with a plain `await`.
// Like Mongoose: .select('a b') keeps only those fields (and _id); .select('-a') drops fields; '+a' (e.g. +password) changes nothing here.
const project = (val, fields) => {
  const toks = String(fields).split(/\s+/).filter(Boolean); const inc = toks.filter((t) => !t.startsWith('-') && !t.startsWith('+')); const exc = toks.filter((t) => t.startsWith('-')).map((t) => t.slice(1));
  const cut = (r) => { if (!r || typeof r !== 'object' || Array.isArray(r)) return r; if (inc.length) { const o = { _id: r._id }; for (const k of inc) if (k in r) o[k] = r[k]; return o; } if (exc.length) { const o = { ...r }; for (const k of exc) delete o[k]; return o; } return r; };
  return Array.isArray(val) ? val.map(cut) : cut(val);
};
const query = (val) => { let cur = val; const q = { select: (f) => { cur = project(cur, f); return q; }, limit: () => q, skip: () => q, sort: () => q, populate: () => q, lean: async () => cur, then: (res, rej) => Promise.resolve(cur).then(res, rej) }; return q; };
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const set = (o, p, v) => { const ks = p.split('.'); let t = o; ks.slice(0, -1).forEach((k) => { t[k] = t[k] || {}; t = t[k]; }); t[ks.at(-1)] = v; };
function matches(doc, f) {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((c) => matches(doc, c));
    if (k === '$and') return v.every((c) => matches(doc, c));
    const c = k === '_id' ? doc._id : get(doc, k);
    if (v === null) return c === undefined || c === null;
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      return Object.entries(v).every(([op, x]) => {
        if (op === '$in') return x.map(String).includes(String(c));
        if (op === '$ne') return x === null ? c !== undefined && c !== null : String(c) !== String(x);
        if (op === '$lt') return c !== undefined && c < x;
        if (op === '$lte') return c !== undefined && c <= x;
        if (op === '$gt') return c !== undefined && c > x;
        if (op === '$gte') return c !== undefined && c >= x;
        if (op === '$exists') return (c !== undefined) === x;
        return true;
      });
    }
    return String(c) === String(v);
  });
}
function applyUpdate(doc, u) {
  for (const [k, v] of Object.entries(u.$set || (Object.keys(u).some((x) => x.startsWith('$')) ? {} : u))) set(doc, k, v);
  for (const [k, v] of Object.entries(u.$inc || {})) set(doc, k, (get(doc, k) || 0) + v);
  for (const k of Object.keys(u.$unset || {})) set(doc, k, undefined);
}
let seq = 0;
// Replaces the common query methods of a Mongoose model with in-memory versions. Returns { rows } to inspect/seed.
function fakeModel(Model) {
  const rows = [];
  const withSave = (d) => Object.assign(d, { save: async () => d });
  Object.assign(Model, {
    create: async (d) => { const r = withSave({ _id: String(++seq).padStart(24, '0'), createdAt: new Date(), ...d }); rows.push(r); return r; },
    find: (f = {}) => query(rows.filter((r) => matches(r, f))),
    findOne: (f = {}) => query(rows.find((r) => matches(r, f)) || null),
    findById: (id) => query(rows.find((r) => String(r._id) === String(id)) || null),
    exists: async (f) => (rows.some((r) => matches(r, f)) ? { _id: 1 } : null),
    countDocuments: async (f = {}) => rows.filter((r) => matches(r, f)).length,
    updateOne: async (f, u) => { const r = rows.find((x) => matches(x, f)); if (r) applyUpdate(r, u); return { matchedCount: r ? 1 : 0, modifiedCount: r ? 1 : 0 }; },
    updateMany: async (f, u) => { const hit = rows.filter((x) => matches(x, f)); hit.forEach((r) => applyUpdate(r, u)); return { modifiedCount: hit.length }; },
    findOneAndUpdate: (f, u) => { const r = rows.find((x) => matches(x, f)); if (r) applyUpdate(r, u); return query(r || null); },
    findOneAndDelete: (f) => { const i = rows.findIndex((x) => matches(x, f)); const r = i >= 0 ? rows.splice(i, 1)[0] : null; return query(r); },
    deleteOne: async (f) => { const i = rows.findIndex((x) => matches(x, f)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
    deleteMany: async (f) => { let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], f)) { rows.splice(i, 1); n++; } return { deletedCount: n }; },
  });
  return { rows, clear: () => { rows.length = 0; } };
}
// Settings storage (prices, payment methods, company details)
function fakeSettings() {
  const Setting = require('../models/Setting'); const store = {};
  Setting.findOne = (f) => query(store[f.key] ? { value: store[f.key] } : null);
  Setting.findOneAndUpdate = async (f, u) => { store[f.key] = u.value; return {}; };
  return { store, clear: () => Object.keys(store).forEach((k) => delete store[k]) };
}
const thrown = async (p) => { try { await p; return null; } catch (e) { return e; } };
module.exports = { query, matches, fakeModel, fakeSettings, thrown, applyUpdate };

// In-memory stand-in for the small counters collection (AI and email limits). Same "limit reached" behaviour as the real one.
function fakeUsage() {
  const AiUsage = require('../models/AiUsage'); const map = new Map();
  AiUsage.findOneAndUpdate = async (f, u) => { const id = `${f.key}|${f.day}`; const x = map.get(id); if (x) { if (!(x.count < f.count.$lt)) { const e = new Error('dup'); e.code = 11000; throw e; } x.count += u.$inc.count; return x; } const n = { key: f.key, day: f.day, count: u.$inc.count }; map.set(id, n); return n; };
  AiUsage.updateOne = async (f, u) => { const x = map.get(`${f.key}|${f.day}`); if (x && x.count > 0) x.count += u.$inc.count; return {}; };
  AiUsage.findOne = (f) => ({ lean: async () => map.get(`${f.key}|${f.day}`) || null });
  const day = () => new Date().toISOString().slice(0, 10);
  return { map, clear: () => map.clear(), n: (key, period) => map.get(`${key}|${period || day()}`)?.count || 0, day, month: () => new Date().toISOString().slice(0, 7) };
}
module.exports.fakeUsage = fakeUsage;
