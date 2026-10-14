// Shared wire contract with desktop/key/core/crypto.cjs. No cloud credentials.
export const KEY_FORMAT = 'itsoscup-offline-transfer';
export const KEY_LIMIT = 12 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    if (Object.keys(value).some(key => !/^[ -~]+$/.test(key))) throw new Error('Chiavi del protocollo non valide');
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  throw new Error('Il pacchetto contiene un valore non supportato');
}
export function base64(bytes) {
  let output = '';
  for (let i = 0; i < bytes.length; i += 32768) output += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(output);
}
function bytes(text) {
  if (typeof text !== 'string' || text.length > KEY_LIMIT * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Codifica del pacchetto non valida');
  return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}
async function passwordKey(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Usa una password da 12 a 1024 caratteri');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 260000, salt }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function validateKeyPackage(value) {
  if (!value || value.schema !== KEY_FORMAT || value.version !== 2 || !['prepared', 'results', 'receipt'].includes(value.kind)
    || !uuid.test(value.preparation_id) || !uuid.test(value.station_id)) throw new Error('Pacchetto ITSOSCup Key non valido');
  if (value.kind === 'prepared') {
    if (!Array.isArray(value.matches) || !value.matches.length || value.matches.length > 250 || bytes(value.authorization_secret).length !== 32)
      throw new Error('Preparazione incompleta');
    const seen = new Set();
    for (const entry of value.matches) {
      if (!Number.isSafeInteger(entry.match_id) || entry.match_id < 1 || entry.match?.id !== entry.match_id || seen.has(entry.match_id)
        || !Number.isSafeInteger(entry.match.lock_version) || entry.match.lock_version < 0) throw new Error('Partite della preparazione non valide');
      seen.add(entry.match_id);
    }
  }
  if (value.kind === 'results') {
    if (!uuid.test(value.package_id) || !Array.isArray(value.operations) || !value.operations.length || value.operations.length > 2500)
      throw new Error('Pacchetto risultati incompleto');
    const seen = new Set();
    for (const op of value.operations) {
      if (!uuid.test(op.id) || op.type !== 'key_report' || seen.has(op.id) || op.preparation_id !== value.preparation_id
        || op.station_id !== value.station_id || !Number.isSafeInteger(op.match_id) || op.match_id < 1
        || !Number.isSafeInteger(op.base_version) || op.base_version < 0 || !Number.isSafeInteger(op.report_revision) || op.report_revision < 1
        || !/^[0-9a-f]{64}$/.test(op.report_hash) || bytes(op.auth_tag).length !== 32 || !op.payload || !Array.isArray(op.audit_log)
        || !Array.isArray(op.signatures_payload)) throw new Error('Referto del pacchetto non valido');
      seen.add(op.id);
      canonicalJson(op);
    }
  }
  if (value.kind === 'receipt' && (!uuid.test(value.receipt_id) || !Array.isArray(value.results) || bytes(value.auth_tag).length !== 32))
    throw new Error('Ricevuta non valida');
  return value;
}
export async function encryptKeyPackage(payload, password) {
  validateKeyPackage(payload);
  const plain = encoder.encode(JSON.stringify(payload));
  if (plain.byteLength > KEY_LIMIT) throw new Error('Pacchetto troppo grande');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return JSON.stringify({ format: KEY_FORMAT, version: 1, encrypted: true, kdf: 'PBKDF2-SHA256-260000',
    salt: base64(salt), iv: base64(iv), ciphertext: base64(ciphertext) });
}
export async function decryptKeyPackage(text, password) {
  if (typeof text !== 'string' || text.length > KEY_LIMIT * 2) throw new Error('File troppo grande');
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error('Il file non è un pacchetto JSON valido'); }
  if (envelope?.format !== KEY_FORMAT || envelope.version !== 1 || envelope.encrypted !== true || envelope.kdf !== 'PBKDF2-SHA256-260000')
    throw new Error('Formato cifrato non riconosciuto');
  const salt = bytes(envelope.salt), iv = bytes(envelope.iv), ciphertext = bytes(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('Parametri cifratura non validi');
  const key = await passwordKey(password, salt);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext); }
  catch { throw new Error('Password errata o pacchetto danneggiato'); }
  if (plain.byteLength > KEY_LIMIT) throw new Error('File troppo grande');
  return validateKeyPackage(JSON.parse(decoder.decode(plain)));
}
export async function hashText(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function createKeyOperator({ name, role, pin, matchIds }) {
  if (!String(name).trim() || !['operator', 'supervisor'].includes(role) || !/^\d{8,20}$/.test(pin))
    throw new Error('Inserisci nome operatore e un PIN di almeno 8 cifre');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 260000, salt }, material, 256);
  return { id: crypto.randomUUID(), name: name.trim().slice(0, 80), role, pin_salt: base64(salt), pin_hash: base64(new Uint8Array(hash)), assigned_match_ids: matchIds };
}
