'use strict';
const { randomUUID, randomBytes } = require('node:crypto');
const { pinCredential, hash, tag } = require('../crypto.cjs');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII=';
const PASSWORD = 'synthetic-vault-password-42';
function prepared({ sport = 'basket', matchId = 17, stationId = randomUUID(), operator = false } = {}) {
  return { schema: 'itsoscup-offline-transfer', version: 2, kind: 'prepared', package_id: randomUUID(), preparation_id: randomUUID(), station_id: stationId,
    station_label: 'Campo di prova', authorization_secret: randomBytes(32).toString('base64'), device_id: stationId, created_at: '2026-10-14T10:00:00.000Z', operations: [],
    operators: [{ id: randomUUID(), name: 'Supervisore sintetico', role: 'supervisor', ...pinCredential('12345678'), assigned_match_ids: [matchId] },
      ...(operator ? [{ id: randomUUID(), name: 'Operatore sintetico', role: 'operator', ...pinCredential('87654321'), assigned_match_ids: [matchId] }] : [])],
    matches: [{ match_id: matchId, cached_at: '2026-10-14T10:00:00.000Z', match: { id: matchId, lock_version: 3, home_team_id: 101, away_team_id: 102,
      sport: { id: 1, name: sport, sport_type: sport }, home: { name: 'Squadra Alfa' }, away: { name: 'Squadra Beta' }, scheduled_start: '2026-10-14T10:00:00.000Z', venue: { name: 'Campo test' } },
      config: { allow_yellow_cards: sport === 'calcio', allow_red_cards: sport === 'calcio', max_yellow_cards: 2, max_red_cards: 1, max_fouls: 3, timeouts_per_team: 2 },
      homePlayers: [{ id: 201, team_id: 101, full_name: 'Capitano Test Alfa', is_captain: true }, { id: 203, team_id: 101, full_name: 'Riserva Test Alfa' }],
      awayPlayers: [{ id: 202, team_id: 102, full_name: 'Capitano Test Beta', is_captain: true }], stats: [] }] };
}
function receipt(op, preparation, packageId) {
  const { auth_tag, ...body } = op;
  const value = { schema: 'itsoscup-offline-transfer', version: 2, kind: 'receipt', station_id: preparation.station_id, preparation_id: preparation.preparation_id,
    package_id: packageId, receipt_id: randomUUID(), created_at: '2026-10-14T10:30:00.000Z', results: [{ operation_id: op.id, status: 'imported', remote_version: 4,
      report_hash: op.report_hash, content_hash: hash(body) }] };
  value.auth_tag = tag(value, preparation.authorization_secret); return value;
}
module.exports = { PNG, PASSWORD, prepared, receipt };
