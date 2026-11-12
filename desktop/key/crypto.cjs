'use strict';
const { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } = require('node:crypto');
const FORMAT = 'itsoscup-offline-transfer';
const ITERATIONS = 260000;
const LIMIT = 12 * 1024 * 1024;
const VAULT_LIMIT = 256 * 1024 * 1024;
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    if (Object.keys(value).some(key => !/^[\x20-\x7e]+$/.test(key))) throw new Error('Chiave non canonica nel pacchetto');
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  throw new Error('Valore non canonico nel pacchetto');
}
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function untag(value) { const { auth_tag, ...body } = value; return body; }
function tag(value, secret) { return createHmac('sha256', decode64(secret, 32)).update(canonical(untag(value))).digest('base64'); }
function equal(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
function verifyTag(value, secret) { return typeof value?.auth_tag === 'string' && equal(tag(value, secret), value.auth_tag); }
function decode64(value, length, maxChars = LIMIT * 2) {
  if (typeof value !== 'string' || value.length > maxChars || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Parametro cifrato non valido');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || length != null && bytes.length !== length) throw new Error('Parametro cifrato non valido');
  return bytes;
}
function passwordKey(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('La password deve avere da 12 a 1024 caratteri');
  return pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
}
function encryptBytes(plain, key, salt, format = FORMAT) {
  const limit = format === 'itsoscup-key-vault' ? VAULT_LIMIT : LIMIT;
  if (plain.length > limit) throw new Error('Archivio troppo grande');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ format, version: 1, encrypted: true, kdf: 'PBKDF2-SHA256-260000', salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: encrypted.toString('base64') }, null, 2);
}
function decryptBytes(text, password, format = FORMAT) {
  const limit = format === 'itsoscup-key-vault' ? VAULT_LIMIT : LIMIT;
  if (typeof text !== 'string' || Buffer.byteLength(text) > limit * 2.1) throw new Error('File troppo grande');
  let e;
  try { e = JSON.parse(text); } catch { throw new Error('Il file non contiene JSON valido'); }
  if (e?.format !== format || e.version !== 1 || e.encrypted !== true || e.kdf !== 'PBKDF2-SHA256-260000') throw new Error('Formato cifrato non riconosciuto');
  const salt = decode64(e.salt, 16), iv = decode64(e.iv, 12), bytes = decode64(e.ciphertext, null, limit * 2);
  if (bytes.length < 16) throw new Error('Pacchetto danneggiato');
  const key = passwordKey(password, salt);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(bytes.subarray(-16));
    const plain = Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]);
    if (plain.length > limit) throw new Error('File troppo grande');
    return { plain, key, salt };
  } catch { key.fill(0); throw new Error('Password errata o pacchetto danneggiato'); }
}
function encryptPackage(value, password) {
  const salt = randomBytes(16), key = passwordKey(password, salt);
  try { return encryptBytes(Buffer.from(JSON.stringify(value)), key, salt); } finally { key.fill(0); }
}
function decryptPackage(text, password) {
  const result = decryptBytes(text, password);
  try { return JSON.parse(result.plain.toString('utf8')); } finally { result.key.fill(0); result.plain.fill(0); }
}
function pinCredential(pin) {
  if (typeof pin !== 'string' || !/^\d{8,20}$/.test(pin)) throw new Error('Il PIN deve contenere da 8 a 20 cifre');
  const salt = randomBytes(16);
  return { pin_salt: salt.toString('base64'), pin_hash: pbkdf2Sync(pin, salt, ITERATIONS, 32, 'sha256').toString('base64') };
}
function verifyPin(pin, operator) {
  if (typeof pin !== 'string' || !/^\d{8,20}$/.test(pin)) return false;
  return equal(pbkdf2Sync(pin, decode64(operator.pin_salt, 16), ITERATIONS, 32, 'sha256').toString('base64'), operator.pin_hash);
}
module.exports = { FORMAT, LIMIT, VAULT_LIMIT, canonical, hash, tag, verifyTag, equal, decode64, passwordKey, encryptBytes, decryptBytes, encryptPackage, decryptPackage, pinCredential, verifyPin };
