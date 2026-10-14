import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { canonicalJson, createKeyOperator, decryptKeyPackage, encryptKeyPackage, hashText, validateKeyPackage } from '../js/key-transfer.js';
const require = createRequire(import.meta.url);
const desktop = require('../desktop/key/crypto.cjs');
const password = 'PasswordSinteticaUSB12345';
function prepared() {
  return { schema: desktop.FORMAT, version: 2, kind: 'prepared', preparation_id: randomUUID(), station_id: randomUUID(),
    authorization_secret: randomBytes(32).toString('base64'), matches: [{ match_id: 1, match: { id: 1, lock_version: 3,
      home_team_id: 10, away_team_id: 20 }, homePlayers: [{ id: 100, team_id: 10, full_name: 'Capitano Sintetico A', is_captain: true }],
      awayPlayers: [{ id: 200, team_id: 20, full_name: 'Capitano Sintetico B', is_captain: true }] }], operations: [] };
}
test('WebCrypto and desktop decrypt each other without plaintext roster or PIN storage', async () => {
  const payload = prepared();
  const operator = await createKeyOperator({ name: 'Operatore test', role: 'supervisor', pin: '12345678', matchIds: [1] });
  payload.operators = [operator];
  assert(desktop.verifyPin('12345678', operator));
  assert(!JSON.stringify(operator).includes('12345678'));
  const web = await encryptKeyPackage(payload, password);
  assert(!web.includes('Capitano Sintetico'));
  assert.deepEqual(desktop.decryptPackage(web, password), payload);
  assert.deepEqual(await decryptKeyPackage(desktop.encryptPackage(payload, password), password), payload);
});
test('wrong passwords and tampered authenticated ciphertext are rejected', async () => {
  const encrypted = await encryptKeyPackage(prepared(), password);
  await assert.rejects(decryptKeyPackage(encrypted, 'PasswordSbagliata12345'), /Password errata/);
  const envelope = JSON.parse(encrypted), cipher = Buffer.from(envelope.ciphertext, 'base64');
  cipher[12] ^= 1; envelope.ciphertext = cipher.toString('base64');
  await assert.rejects(decryptKeyPackage(JSON.stringify(envelope), password), /pacchetto danneggiato/);
  await assert.rejects(decryptKeyPackage('{', password), /JSON valido/);
});
test('canonical report content and digest agree across runtimes; ambiguous numbers fail', async () => {
  const value = { z: [null, true, 'È una firma 💙\n'], a: { y: 42, a: -3 } };
  assert.equal(canonicalJson(value), desktop.canonical(value));
  assert.equal(await hashText(canonicalJson(value)), desktop.hash(value));
  assert.throws(() => canonicalJson({ n: 0.5 }));
  assert.throws(() => canonicalJson({ n: Number.MAX_SAFE_INTEGER + 1 }));
  assert.throws(() => canonicalJson({ missing: undefined }));
});
test('duplicate and mismatched match identities are rejected before encryption', () => {
  const p = prepared(); p.matches.push(p.matches[0]);
  assert.throws(() => validateKeyPackage(p), /non valide/);
  p.matches.pop(); p.matches[0].match.id = 2;
  assert.throws(() => validateKeyPackage(p), /non valide/);
});
