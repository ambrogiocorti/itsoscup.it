'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PlatformApi } = require('../platform-api.cjs');
const { notifyClassScheduleChange } = require('../platform-ops.cjs');
const { PASSWORD } = require('./fixtures.cjs');
const { hash, tag } = require('../crypto.cjs');
const NOW = Date.parse('2026-10-14T10:00:00Z');
async function ok(api, request) { const result = await api.call(request); assert.equal(result.error, null, JSON.stringify(result.error)); return result.data; }
const rpc = (api, name, args = {}) => ok(api, { type: 'rpc', name, args });
const select = (api, table) => ok(api, { type: 'query', table, calls: [{ method: 'select', args: ['*'] }] });
const insert = (api, table, value) => ok(api, { type: 'query', table, calls: [{ method: 'insert', args: [value] }, { method: 'select', args: ['*'] }, { method: 'single', args: [] }] });
async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itsoscup-ops-'));
  const api = new PlatformApi({ directory, now: () => NOW });
  t.after(() => { if (api.vault.db) { api.vault.dirty = false; api.vault.lock(); } fs.rmSync(directory, { recursive: true, force: true }); });
  await ok(api, { type: 'unlock', create: true, password: PASSWORD, name: 'Responsabile sintetico', email: 'ops@example.invalid', pin: '11223344' });
  return api;
}
async function competition(api, suffix = 'A') {
  const sport = await rpc(api, 'save_sport_admin', { p_name: 'Basket sintetico ' + suffix, p_year: 3, p_sport_type: 'basket', p_format: 'gironi', p_gender: 'misto' });
  const sportId = sport.saved_sport_id;
  const home = await rpc(api, 'save_team_admin', { p_sport_id: sportId, p_name: 'Classe Alfa ' + suffix, p_players: ['Capitano Alfa ' + suffix], p_captain_name: 'Capitano Alfa ' + suffix });
  const away = await rpc(api, 'save_team_admin', { p_sport_id: sportId, p_name: 'Classe Beta ' + suffix, p_players: ['Capitano Beta ' + suffix], p_captain_name: 'Capitano Beta ' + suffix });
  const match = await rpc(api, 'save_manual_match_admin', { p_sport_id: sportId, p_home_team_id: home.saved_team_id, p_away_team_id: away.saved_team_id });
  return { sportId, home: home.saved_team_id, away: away.saved_team_id, matchId: match.saved_match_id };
}

test('control-center actions persist venue/device/check-in data and reject blocked assignments and wrong-side teams', async (t) => {
  const api = await setup(t), game = await competition(api);
  const venue = await insert(api, 'venues', { name: 'Campo sintetico', slug: 'sintetico' });
  await rpc(api, 'register_device', { p_device_id: 'test-device', p_label: 'Postazione sintetica', p_is_offline_ready: true, p_offline_match_count: 1 });
  await rpc(api, 'save_manual_match_admin', { p_match_id: game.matchId, p_sport_id: game.sportId, p_home_team_id: game.home, p_away_team_id: game.away,
    p_venue_id: venue.id, p_scheduled_start: '2026-10-14T09:00:00Z', p_scheduled_end: '2026-10-14T09:30:00Z' });
  await rpc(api, 'assign_match_device_admin', { p_match_id: game.matchId, p_device_id: 'test-device' });
  await rpc(api, 'upsert_match_checkin', { p_match_id: game.matchId, p_role: 'home_team', p_team_id: game.home, p_checked_in: true });
  const invalid = await api.call({ type: 'rpc', name: 'upsert_match_checkin', args: { p_match_id: game.matchId, p_role: 'home_team', p_team_id: game.away, p_checked_in: true } });
  assert.match(invalid.error.message, /non appartiene/);
  assert.equal((await select(api, 'match_checkins')).length, 1);
  await rpc(api, 'set_venue_operational_status', { p_venue_id: venue.id, p_status: 'maintenance', p_reason: 'Verifica di prova' });
  const snapshot = await rpc(api, 'get_regia_operational_snapshot');
  assert.equal(snapshot.readiness_percent, 100);
  assert.equal(snapshot.matches.delayed, 1);
  assert.equal(snapshot.venues[0].status, 'maintenance');
  assert.equal(snapshot.delayed_matches[0].delay_minutes, 60);
  await rpc(api, 'set_registered_device_admin', { p_device_id: 'test-device', p_is_blocked: true, p_operator_name: 'Operatore', p_assigned_venue_id: venue.id });
  assert.match((await api.call({ type: 'rpc', name: 'assign_match_device_admin', args: { p_match_id: game.matchId, p_device_id: 'test-device' } })).error.message, /non è autorizzata/);
  assert.ok((await rpc(api, 'validate_pre_event')).some((row) => row.code === 'device_unavailable'));
});

test('whole-platform restore keeps authentication and Key secrets private and creates a safety snapshot', async (t) => {
  const api = await setup(t), game = await competition(api);
  const authorization = await rpc(api, 'prepare_key_station', { p_station_id: randomUUID(), p_sport_id: game.sportId, p_match_ids: [game.matchId], p_label: 'Campo sintetico' });
  const before = api.vault.read().central;
  const credentials = JSON.parse(JSON.stringify(before.credentials)), preparations = JSON.parse(JSON.stringify(before.keyPreparations));
  const backup = await rpc(api, 'create_platform_backup', { p_reason: 'Punto di ripristino sintetico' });
  await competition(api, 'B');
  assert.equal((await select(api, 'sports')).length, 2);
  const restored = await rpc(api, 'restore_platform_backup', { p_backup_id: backup.backup_id, p_reason: 'Ripristino di prova' });
  assert.ok(restored.safety_backup_id);
  assert.equal((await select(api, 'sports')).length, 1);
  assert.deepEqual(api.vault.read().central.credentials, credentials);
  assert.equal(api.vault.read().central.keyPreparations.length, preparations.length);
  assert.equal(api.vault.read().central.keyPreparations[0].authorization_secret, preparations[0].authorization_secret);
  assert.equal(api.vault.read().central.keyPreparations[0].is_revoked, true);
  const match = (await select(api, 'matches'))[0];
  assert.ok(match.lock_version > authorization.match_versions[0].base_version);
  assert.equal(match.assigned_device_id, null); assert.equal(match.lock_owner, null);
  const operation = { id: randomUUID(), type: 'key_report', preparation_id: authorization.preparation_id, station_id: authorization.station_id,
    match_id: game.matchId, base_version: authorization.match_versions[0].base_version, report_revision: 1,
    payload: { home_score: 2, away_score: 1, duration: 600, quarter: 4, stats_snapshot: [], event_log: [], is_finished: true }, signatures_payload: [] };
  operation.report_hash = hash({ match_id: operation.match_id, payload: operation.payload, report_revision: operation.report_revision });
  operation.auth_tag = tag(operation, authorization.authorization_secret);
  assert.match((await api.call({ type: 'rpc', name: 'import_key_operation', args: { p_operation: operation } })).error.message, /revocata|ripristinato/);
  const metadata = await select(api, 'platform_backups');
  assert.equal(metadata.length, 2);
  assert.equal(JSON.stringify(metadata).includes('authorization_secret'), false);
  assert.equal(JSON.stringify(metadata).includes('Capitano Alfa'), false);
});

test('a tournament restore preserves another tournament and validation failures commit no partial changes', async (t) => {
  const api = await setup(t), first = await competition(api), second = await competition(api, 'B');
  const firstAuthorization = await rpc(api, 'prepare_key_station', { p_station_id: randomUUID(), p_sport_id: first.sportId, p_match_ids: [first.matchId], p_label: 'Prima postazione' });
  const secondAuthorization = await rpc(api, 'prepare_key_station', { p_station_id: randomUUID(), p_sport_id: second.sportId, p_match_ids: [second.matchId], p_label: 'Seconda postazione' });
  const backup = await rpc(api, 'create_platform_backup', { p_sport_id: first.sportId, p_reason: 'Backup torneo A' });
  await rpc(api, 'save_team_admin', { p_team_id: first.home, p_sport_id: first.sportId, p_name: 'Classe modificata', p_players: ['Capitano modificato'], p_captain_name: 'Capitano modificato' });
  const state = JSON.stringify(api.vault.read().central);
  assert.match((await api.call({ type: 'rpc', name: 'restore_platform_backup', args: { p_backup_id: backup.backup_id, p_reason: '' } })).error.message, /motivo/);
  assert.equal(JSON.stringify(api.vault.read().central), state);
  await rpc(api, 'restore_platform_backup', { p_backup_id: backup.backup_id, p_reason: 'Ripristino torneo A' });
  const teams = await select(api, 'teams');
  assert.equal(teams.find((row) => row.id === first.home).name, 'Classe Alfa A');
  assert.equal(teams.find((row) => row.id === second.home).name, 'Classe Alfa B');
  assert.equal((await select(api, 'matches')).length, 2);
  const preparations = api.vault.read().central.keyPreparations;
  assert.equal(preparations.find((row) => row.preparation_id === firstAuthorization.preparation_id).is_revoked, true);
  assert.equal(preparations.find((row) => row.preparation_id === secondAuthorization.preparation_id).is_revoked, false);
  assert.equal((await select(api, 'matches')).find((row) => row.id === second.matchId).assigned_device_id, secondAuthorization.station_id);
});

test('class registration, targeted notices, public opt-in and code rotation remain scoped to the correct class', async (t) => {
  const api = await setup(t), game = await competition(api);
  const invite = await insert(api, 'class_invites', { id: randomUUID(), sport_id: game.sportId, class_name: 'Classe Gamma', access_code: 'a'.repeat(48), is_active: true });
  assert.equal(await rpc(api, 'submit_class_registration', { p_code: invite.access_code, p_roster: ['Capitano Gamma', 'Riserva Gamma'], p_captain: 'Capitano Gamma' }), 'pending');
  const registration = (await select(api, 'class_registrations'))[0];
  const teamId = await rpc(api, 'decide_class_registration', { p_registration_id: registration.id, p_approve: true, p_reason: 'Rosa controllata' });
  assert.equal((await select(api, 'players')).filter((row) => row.team_id === teamId).length, 2);
  const privateId = await rpc(api, 'send_team_class_notice', { p_sport_id: game.sportId, p_title: 'Avviso privato', p_body: 'Solo per la classe Gamma', p_invite_ids: [invite.id], p_publish_to_team: false });
  assert.deepEqual(await rpc(api, 'public_team_notices', { p_sport_id: game.sportId, p_team_id: teamId }), []);
  const publicId = await rpc(api, 'send_team_class_notice', { p_sport_id: game.sportId, p_title: 'Avviso pubblico', p_body: 'Nuovo orario della partita', p_invite_ids: [invite.id], p_publish_to_team: true });
  assert.equal((await rpc(api, 'public_team_notices', { p_sport_id: game.sportId, p_team_id: teamId }))[0].id, publicId);
  assert.deepEqual(await rpc(api, 'public_team_notices', { p_sport_id: game.sportId, p_team_id: game.home }), []);
  await rpc(api, 'acknowledge_class_notice', { p_code: invite.access_code, p_notice_id: privateId });
  const portal = await rpc(api, 'class_portal', { p_code: invite.access_code });
  assert.equal(portal.registration.status, 'approved');
  assert.ok(portal.notices.find((row) => row.id === privateId).read_at);
  const rotated = await rpc(api, 'rotate_class_invite', { p_invite_id: invite.id });
  assert.match(rotated, /^[a-f0-9]{48}$/);
  assert.match((await api.call({ type: 'rpc', name: 'class_portal', args: { p_code: invite.access_code } })).error.message, /non valido/);
  assert.equal((await rpc(api, 'class_portal', { p_code: rotated })).class_name, 'Classe Gamma');
});

test('existing teams import idempotently and schedule cancellation produces only their public team notices', async (t) => {
  const api = await setup(t), game = await competition(api);
  assert.equal(await rpc(api, 'import_existing_teams_as_classes', { p_sport_id: game.sportId }), 2);
  assert.equal(await rpc(api, 'import_existing_teams_as_classes', { p_sport_id: game.sportId }), 0);
  assert.equal((await select(api, 'class_registrations')).length, 2);
  await rpc(api, 'set_match_operational_status', { p_match_id: game.matchId, p_status: 'cancelled', p_reason: 'Prova di rinvio' });
  const home = await rpc(api, 'public_team_notices', { p_sport_id: game.sportId, p_team_id: game.home });
  const away = await rpc(api, 'public_team_notices', { p_sport_id: game.sportId, p_team_id: game.away });
  assert.equal(home.length, 1); assert.equal(away.length, 1); assert.equal(home[0].id, away[0].id);
  assert.match(home[0].title, /annullata o rinviata/);
  const state = api.vault.read(), match = state.central.tables.matches[0];
  assert.equal(notifyClassScheduleChange({ state, api, match, previous: { ...match } }), null);
});

test('numeric local class identifiers survive browser string options when sending notices and rotating codes', async (t) => {
  const api = await setup(t), game = await competition(api);
  const invite = await insert(api, 'class_invites', { sport_id: game.sportId, class_name: 'Classe numerica' });
  const noticeId = await rpc(api, 'send_team_class_notice', { p_sport_id: game.sportId, p_title: 'Avviso di prova', p_body: 'Destinatario locale verificato', p_invite_ids: [String(invite.id)], p_publish_to_team: false });
  const recipient = (await select(api, 'class_notice_recipients')).find((row) => row.notice_id === noticeId);
  assert.equal(recipient.invite_id, invite.id);
  const code = await rpc(api, 'rotate_class_invite', { p_invite_id: String(invite.id) });
  assert.equal((await rpc(api, 'class_portal', { p_code: code })).class_name, 'Classe numerica');
});

test('read-only users can see aggregate reports but cannot change operational state, settings or restore backups', async (t) => {
  const api = await setup(t); await competition(api);
  await ok(api, { type: 'function', name: 'manage-admin-user', body: { action: 'save', email: 'viewer@example.invalid', nome: 'Lettore', ruolo: 'report_viewer', password: '55667788' } });
  await ok(api, { type: 'auth', method: 'signOut' });
  await ok(api, { type: 'auth', method: 'signInWithPassword', args: [{ email: 'viewer@example.invalid', password: '55667788' }] });
  assert.equal((await rpc(api, 'get_event_statistics')).total, 1);
  for (const name of ['get_regia_operational_snapshot', 'create_platform_backup', 'restore_platform_backup', 'set_platform_setting_admin', 'set_venue_operational_status', 'import_existing_teams_as_classes', 'set_match_operational_status']) {
    assert.match((await api.call({ type: 'rpc', name, args: {} })).error.message, /autorizzato/, name);
  }
});

test('official approval requires a finished match with both signatures and unknown commands fail explicitly', async (t) => {
  const api = await setup(t), game = await competition(api);
  assert.match((await api.call({ type: 'rpc', name: 'approve_match_official_admin', args: { p_match_id: game.matchId } })).error.message, /Concludi/);
  // A synthetic legacy archive may contain a finished record without signatures;
  // the normal live workflow prevents this incomplete state from being created.
  const legacy = api.vault.read();
  Object.assign(legacy.central.tables.matches.find((row) => row.id === game.matchId), { is_finished: true, status: 'finished' });
  api.vault.write(legacy);
  assert.match((await api.call({ type: 'rpc', name: 'approve_match_official_admin', args: { p_match_id: game.matchId } })).error.message, /entrambe le firme/);
  assert.ok((await api.call({ type: 'rpc', name: 'unknown_command', args: {} })).error);
});
