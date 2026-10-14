import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const codec = require('../../desktop/key/crypto.cjs');
const pass = 'PasswordUSBTestCentrale123';
const secret = randomBytes(32).toString('base64');
const preparationId = '10000000-0000-4000-8000-000000000001';
const stationId = '20000000-0000-4000-8000-000000000001';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5n8AAAAASUVORK5CYII=';
async function mockCentral(page) {
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await page.addInitScript(({ secret, preparationId, stationId }) => {
    const userId = '30000000-0000-4000-8000-000000000001';
    const teams = [{ id: 10, name: 'Squadra sintetica A' }, { id: 20, name: 'Squadra sintetica B' }];
    const sport = { id: 1, name: 'Torneo sintetico', sport_type: 'basket', is_active: true };
    const tables = { admins: [{ id: userId, nome: 'Responsabile test', ruolo: 'super_admin' }], sports: [sport],
      venues: [{ id: 1, name: 'Campo di prova' }], registered_devices: [],
      sport_config: [{ sport_id: 1, quarters_count: 4, timeouts_per_team: 2 }],
      players: [{ id: 101, team_id: 10, full_name: 'Capitano Test A', is_captain: true }, { id: 201, team_id: 20, full_name: 'Capitano Test B', is_captain: true }],
      matches: [{ id: 1, sport_id: 1, venue_id: 1, home_team_id: 10, away_team_id: 20, home: teams[0], away: teams[1], sport,
        venue: { id: 1, name: 'Campo di prova' }, lock_version: 0, status: 'scheduled', is_finished: false,
        scheduled_start: '2026-10-14T12:00:00Z', home_score: 0, away_score: 0, duration: 0, live_payload: {} }] };
    function from(table) {
      return { filters: [], select() { return this; }, eq(k, v) { this.filters.push([k, v]); return this; }, order() { return this; },
        rows() { return (tables[table] || []).filter(row => this.filters.every(([k, v]) => row[k] === v)); },
        single() { return Promise.resolve({ data: this.rows()[0] || null, error: null }); }, maybeSingle() { return this.single(); },
        then(ok, bad) { return Promise.resolve({ data: this.rows(), error: null }).then(ok, bad); } };
    }
    const imported = new Map();
    window.supabase = { createClient: () => ({ from, auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
      rpc: async (name, args) => {
        if (name === 'prepare_key_station') {
          window.__preparationArgs = args;
          return { error: null, data: { preparation_id: preparationId, station_id: args.p_station_id, authorization_secret: secret,
            created_at: '2026-10-14T10:00:00Z', expires_at: '2026-11-14T10:00:00Z', match_versions: [{ match_id: 1, base_version: 0 }] } };
        }
        if (name === 'import_key_operation') {
          const op = args.p_operation; const duplicate = imported.has(op.id); imported.set(op.id, op);
          return { error: null, data: { operation_id: op.id, report_hash: op.report_hash, status: duplicate ? 'duplicate' : 'imported', remote_version: 1, message: 'Referto test importato' } };
        }
        if (name === 'create_key_receipt') {
          const receipt = { schema: 'itsoscup-offline-transfer', version: 2, kind: 'receipt', preparation_id: preparationId, station_id: stationId,
            receipt_id: crypto.randomUUID(), package_id: args.p_results_package_id, created_at: '2026-10-14T10:00:00.000Z',
            results: args.p_operation_ids.map(id => ({ operation_id: id, report_hash: imported.get(id).report_hash, status: 'imported', remote_version: 1, message: 'Referto test importato' })) };
          const { canonicalJson, base64 } = await import('/js/key-transfer.js');
          for (const result of receipt.results) {
            const { auth_tag, ...body } = imported.get(result.operation_id);
            result.content_hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(body)))), b => b.toString(16).padStart(2, '0')).join('');
          }
          const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
          receipt.auth_tag = base64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalJson(receipt)))));
          return { data: receipt, error: null };
        }
        return { data: null, error: null };
      } }) };
  }, { secret, preparationId, stationId });
}
function results() {
  const op = { id: randomUUID(), type: 'key_report', match_id: 1, base_version: 0, preparation_id: preparationId, station_id: stationId,
    payload: { home_score: 2, away_score: 1, duration: 600, quarter: 4, stats_snapshot: [], event_log: [], is_finished: true }, report_revision: 1, audit_log: [] };
  op.report_hash = codec.hash({ match_id: op.match_id, payload: op.payload, report_revision: op.report_revision });
  op.signatures_payload = ['home', 'away'].map(side => ({ team_side: side, player_id: side === 'home' ? 101 : 201, signature_data_url: png, report_hash: op.report_hash }));
  op.auth_tag = codec.tag(op, secret);
  return { schema: codec.FORMAT, version: 2, kind: 'results', preparation_id: preparationId, station_id: stationId, package_id: randomUUID(), operations: [op], matches: [] };
}
test('calendar preparation exports assigned matches and hashed operator credentials in an encrypted desktop-compatible file', async ({ page }) => {
  await mockCentral(page); await page.goto('/offline-workspace.html');
  await page.locator('#key-password').fill(pass); await page.locator('#key-connect').click();
  await expect(page.locator('#key-central-status')).toContainText('Sessione verificata');
  await page.locator('#key-central-panel summary').click();
  await page.locator('#key-label').fill('Campo sintetico 1');
  await page.locator('#key-operator-name').fill('Operatore Test'); await page.locator('#key-operator-pin').fill('12345678');
  await page.locator('#key-supervisor-name').fill('Supervisore Test'); await page.locator('#key-supervisor-pin').fill('87654321');
  const fileEvent = page.waitForEvent('download'); await page.locator('#key-prepare').click();
  const file = await fileEvent, text = readFileSync(await file.path(), 'utf8');
  expect(text).not.toContain('Capitano Test');
  const payload = codec.decryptPackage(text, pass);
  expect(payload.matches).toHaveLength(1); expect(payload.operators).toHaveLength(2);
  expect(codec.verifyPin('12345678', payload.operators[0])).toBe(true);
  expect(payload.matches[0].match.lock_version).toBe(0);
  expect(await page.locator('#key-operator-pin').inputValue()).toBe('');
  expect(await page.evaluate(() => window.__preparationArgs.p_match_ids)).toEqual([1]);
});
test('encrypted results survive a disconnected central restart, deduplicate files and return a verifiable receipt', async ({ page, context }) => {
  await mockCentral(page); await page.goto('/offline-workspace.html');
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null);
  const payload = results(), encrypted = codec.encryptPackage(payload, pass);
  await page.locator('#key-password').fill(pass);
  const file = { name: 'resultats.keypack', mimeType: 'application/json', buffer: Buffer.from(encrypted) };
  await page.locator('#key-result-file').setInputFiles(file); await page.locator('#key-stage').click();
  await expect(page.locator('#key-central-status')).toContainText('Risultati conservati cifrati');
  await page.locator('#key-result-file').setInputFiles(file); await page.locator('#key-stage').click();
  await expect(page.locator('#key-central-status')).toContainText('già nell’archivio');
  await context.setOffline(true); await page.reload();
  await expect(page.locator('#key-inbox')).toContainText('1 referti');
  expect(await page.locator('#key-password').inputValue()).toBe('');
  const stored = await page.evaluate(async () => (await import('/js/offline-db.js')).getMeta('itsoscup_key_encrypted_inbox_v2'));
  expect(stored).toHaveLength(1); expect(stored[0].encrypted).toBe(encrypted); expect(JSON.stringify(stored)).not.toContain('signature_data_url');
  await context.setOffline(false); await page.locator('#key-password').fill(pass);
  page.on('dialog', dialog => dialog.accept());
  const downloadEvent = page.waitForEvent('download'); await page.locator('[data-key-sync]').click();
  const receipt = codec.decryptPackage(readFileSync(await (await downloadEvent).path(), 'utf8'), pass);
  expect(codec.verifyTag(receipt, secret)).toBe(true);
  expect(receipt.results[0].operation_id).toBe(payload.operations[0].id);
  expect(receipt.results[0].report_hash).toBe(payload.operations[0].report_hash);
  const { auth_tag, ...body } = payload.operations[0];
  expect(receipt.results[0].content_hash).toBe(codec.hash(body));
  await expect(page.locator('#key-central-status')).toContainText('1 importati');
  await expect(page.locator('#key-inbox')).toContainText('Ricevuta disponibile');
});
