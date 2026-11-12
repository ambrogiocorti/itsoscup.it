'use strict';

const crypto = require('node:crypto');
const MANAGERS = ['super_admin', 'match_manager'];
const READERS = [...MANAGERS, 'report_viewer'];
const OPERATIONAL_STATUSES = new Set(['unscheduled', 'scheduled', 'check_in', 'ready', 'live', 'paused', 'ended', 'awaiting_signatures', 'official', 'cancelled', 'postponed']);
const VENUE_STATUSES = new Set(['available', 'busy', 'temporarily_closed', 'maintenance', 'unavailable']);
const SNAPSHOT_TABLES = [
  'sports', 'sport_config', 'teams', 'players', 'matches', 'match_stats', 'live_match_events',
  'match_staff_assignments', 'match_captain_signatures', 'match_checkins', 'match_status_history',
  'match_reschedule_history', 'venues', 'honor_roll_entries', 'events', 'event_results',
  'athletics_heats', 'athletics_lane_assignments', 'athletics_school_records',
  'athletics_relay_teams', 'athletics_relay_members', 'platform_settings',
  'urgent_announcements', 'communication_templates', 'class_invites', 'class_registrations',
  'class_notices', 'class_notice_recipients', 'team_favorites',
];
const FOREIGN_REFERENCES = {
  sport_id: 'sports', team_id: 'teams', player_id: 'players', home_team_id: 'teams', away_team_id: 'teams',
  venue_id: 'venues', match_id: 'matches', event_id: 'events', heat_id: 'athletics_heats',
  invite_id: 'class_invites', notice_id: 'class_notices', relay_team_id: 'athletics_relay_teams',
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => left != null && right != null && String(left) === String(right);
const text = (value) => String(value ?? '').trim();
const lower = (value) => text(value).toLocaleLowerCase('it-IT');
const number = (value) => Number(value) || 0;
const finished = (match) => Boolean(match.is_finished || match.status === 'finished');
const active = (match) => match.status !== 'cancelled' && match.operational_status !== 'cancelled';
const dateKey = (value) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : null;
function bounded(value, min, max, message) {
  const clean = text(value);
  if (clean.length < min || clean.length > max) throw new Error(message);
  return clean;
}
function inviteForCode(tables, code, now) {
  const invite = (tables.class_invites || []).find((row) => lower(row.access_code) === lower(code)
    && row.is_active !== false && (!row.expires_at || Date.parse(row.expires_at) > Date.parse(now)));
  if (!invite || !text(code)) throw new Error('Codice classe non valido o scaduto');
  return invite;
}
function matchLabel(tables, match) {
  return {
    id: match.id, sport: (tables.sports || []).find((row) => same(row.id, match.sport_id))?.name || '-',
    home: (tables.teams || []).find((row) => same(row.id, match.home_team_id))?.name || 'Da definire',
    away: (tables.teams || []).find((row) => same(row.id, match.away_team_id))?.name || 'Da definire',
    venue: (tables.venues || []).find((row) => same(row.id, match.venue_id))?.name || 'Campo da definire',
    scheduled_start: match.scheduled_start,
  };
}
function checkPreparation(tables, sportId) {
  const checks = [];
  const add = (severity, code, message, entity_type, entity_id) => checks.push({ severity, code, message, entity_type, entity_id });
  const sports = (tables.sports || []).filter((row) => row.is_active !== false && (!sportId || same(row.id, sportId)));
  for (const sport of sports) {
    const teams = (tables.teams || []).filter((row) => same(row.sport_id, sport.id));
    if (!(tables.sport_config || []).some((row) => same(row.sport_id, sport.id))) add('warning', 'sport_config', `Completa le impostazioni di ${sport.name}`, 'sport', sport.id);
    if (sport.sport_type !== 'atletica' && teams.length < 2) add('error', 'teams_missing', `${sport.name}: servono almeno due squadre`, 'sport', sport.id);
    for (const team of teams) {
      const players = (tables.players || []).filter((row) => same(row.team_id, team.id));
      if (!players.length) add('warning', 'roster_missing', `Completa la rosa di ${team.name}`, 'team', team.id);
      else if (players.filter((row) => row.is_captain).length !== 1) add('warning', 'captain_missing', `${team.name}: scegli un solo capitano`, 'team', team.id);
    }
  }
  const matches = (tables.matches || []).filter((row) => active(row) && !finished(row) && (!sportId || same(row.sport_id, sportId)));
  for (const match of matches) {
    if (!match.venue_id) add('warning', 'venue_missing', `Partita #${match.id}: assegna il campo`, 'match', match.id);
    if (!match.scheduled_start || !match.scheduled_end) add('warning', 'time_missing', `Partita #${match.id}: completa l’orario`, 'match', match.id);
    else if (!Number.isFinite(Date.parse(match.scheduled_start)) || !Number.isFinite(Date.parse(match.scheduled_end)) || Date.parse(match.scheduled_end) <= Date.parse(match.scheduled_start)) add('error', 'time_invalid', `Partita #${match.id}: correggi l’intervallo orario`, 'match', match.id);
    if (!match.assigned_device_id) add('warning', 'device_missing', `Partita #${match.id}: assegna una postazione`, 'match', match.id);
    else {
      const device = (tables.registered_devices || []).find((row) => same(row.device_id, match.assigned_device_id));
      if (!device || device.is_blocked || device.is_revoked) add('error', 'device_unavailable', `Partita #${match.id}: la postazione non è disponibile`, 'match', match.id);
    }
    if (same(match.home_team_id, match.away_team_id)) add('error', 'same_team', `Partita #${match.id}: le due squadre devono essere diverse`, 'match', match.id);
  }
  for (let index = 0; index < matches.length; index++) for (let other = index + 1; other < matches.length; other++) {
    const a = matches[index], b = matches[other];
    if (same(a.venue_id, b.venue_id) && Date.parse(a.scheduled_start) < Date.parse(b.scheduled_end) && Date.parse(b.scheduled_start) < Date.parse(a.scheduled_end)) add('error', 'venue_overlap', `Partite #${a.id} e #${b.id}: stesso campo e orari sovrapposti`, 'match', b.id);
  }
  return checks;
}
function operationalSnapshot(tables, now, tolerance = 10) {
  const matches = (tables.matches || []).filter(active);
  const delayed = matches.filter((match) => !finished(match) && match.status !== 'live'
    && !['live', 'paused', 'postponed'].includes(match.operational_status)
    && Date.parse(match.scheduled_start) + Math.max(1, number(tolerance)) * 60000 < Date.parse(now));
  const ready = matches.filter((match) => match.venue_id && match.scheduled_start && match.scheduled_end && match.assigned_device_id);
  return {
    readiness_percent: matches.length ? Math.round(ready.length / matches.length * 100) : 0,
    matches: {
      total: matches.length, finished: matches.filter(finished).length,
      live: matches.filter((row) => !finished(row) && (row.status === 'live' || row.operational_status === 'live')).length,
      scheduled: matches.filter((row) => !finished(row) && row.status !== 'live' && row.operational_status !== 'live' && row.scheduled_start).length,
      unscheduled: matches.filter((row) => !finished(row) && !row.scheduled_start).length,
      delayed: delayed.length, paused: matches.filter((row) => row.operational_status === 'paused').length,
      official: matches.filter((row) => row.operational_status === 'official').length,
    },
    venues: (tables.venues || []).map((venue) => ({ ...venue, status: venue.operational_status || (venue.is_active === false ? 'unavailable' : 'available'),
      reason: venue.operational_reason || '', active: venue.is_active !== false,
      matches_today: matches.filter((match) => same(match.venue_id, venue.id) && dateKey(match.scheduled_start) === dateKey(now)).length })),
    devices: clone(tables.registered_devices || []),
    issues: clone((tables.issue_reports || []).filter((issue) => !['resolved', 'closed'].includes(issue.status))),
    delayed_matches: delayed.map((match) => ({ ...matchLabel(tables, match), delay_minutes: Math.max(0, Math.floor((Date.parse(now) - Date.parse(match.scheduled_start)) / 60000)) })),
    source: 'local',
  };
}
function scopePredicate(tables, sportId) {
  const ids = (table, predicate) => new Set((tables[table] || []).filter(predicate).map((row) => String(row.id)));
  const teams = ids('teams', (row) => same(row.sport_id, sportId));
  const matches = ids('matches', (row) => same(row.sport_id, sportId));
  const events = ids('events', (row) => same(row.sport_id, sportId));
  const heats = ids('athletics_heats', (row) => same(row.sport_id, sportId) || events.has(String(row.event_id)));
  const relays = ids('athletics_relay_teams', (row) => same(row.sport_id, sportId) || events.has(String(row.event_id)));
  const invites = ids('class_invites', (row) => same(row.sport_id, sportId));
  const notices = ids('class_notices', (row) => same(row.sport_id, sportId));
  return (table, row) => {
    if (table === 'sports') return same(row.id, sportId);
    if (table === 'players' || table === 'team_favorites') return teams.has(String(row.team_id));
    if (['match_stats', 'live_match_events', 'match_staff_assignments', 'match_captain_signatures', 'match_checkins', 'match_status_history', 'match_reschedule_history'].includes(table)) return matches.has(String(row.match_id));
    if (table === 'event_results') return events.has(String(row.event_id));
    if (table === 'athletics_lane_assignments') return heats.has(String(row.heat_id));
    if (table === 'athletics_relay_members') return relays.has(String(row.relay_team_id));
    if (table === 'class_notice_recipients') return notices.has(String(row.notice_id)) || invites.has(String(row.invite_id));
    if (row.sport_id != null) return same(row.sport_id, sportId);
    if (table === 'athletics_heats' || table === 'athletics_school_records' || table === 'athletics_relay_teams') return events.has(String(row.event_id));
    return false;
  };
}
function createBackup(state, api, sportId, reason, { allowMissing = false } = {}) {
  const tables = api.tables(state);
  if (sportId && !allowMissing) api.row(state, 'sports', sportId);
  const sportExists = !sportId || (tables.sports || []).some((row) => same(row.id, sportId));
  const belongs = sportId ? scopePredicate(tables, sportId) : () => true;
  const snapshot = {};
  for (const table of SNAPSHOT_TABLES) {
    if (sportId && ['venues', 'platform_settings', 'urgent_announcements', 'communication_templates'].includes(table)) continue;
    snapshot[table] = clone((tables[table] || []).filter((row) => belongs(table, row)));
  }
  const row = api.insert(state, 'platform_backups', { scope: sportId ? 'sport' : 'platform', sport_id: sportExists ? sportId || null : null,
    ...(!sportExists ? { deleted_sport_id: sportId } : {}),
    reason: reason || 'Backup manuale', created_at: api.now(), created_by: api.user.id, restored_at: null, restore_reason: null });
  state.central.backups ||= [];
  state.central.backups.push({ id: row.id, scope: row.scope, sport_id: sportId || null, tables: snapshot, created_at: row.created_at });
  api.audit(state, 'create_platform_backup', { backup_id: row.id, sport_id: sportId || null });
  return { success: true, backup_id: row.id, id: row.id, message: 'Backup locale creato' };
}

function assertRemovalReferences(tables, plan, nullable = new Set()) {
  const selected = new Map([...plan].map(([table, rows]) => [table, new Set(rows)]));
  const removedIds = new Map([...plan].map(([table, rows]) => [table, new Set(rows.filter((row) => row.id != null).map((row) => String(row.id)))]));
  for (const [table, rows] of Object.entries(tables)) for (const row of rows) {
    if (selected.get(table)?.has(row)) continue;
    for (const [field, target] of Object.entries(FOREIGN_REFERENCES)) {
      if (row[field] == null || nullable.has(`${table}.${field}`)) continue;
      if (removedIds.get(target)?.has(String(row[field]))) throw new Error('Eliminazione bloccata: esistono partecipazioni o dati collegati a un’altra gara. Nessun dato è stato rimosso.');
    }
  }
}
function applyRemovalPlan(tables, plan) {
  const counts = {};
  for (const [table, rows] of plan) {
    const selected = new Set(rows);
    tables[table] = (tables[table] || []).filter((row) => !selected.has(row));
    counts[table] = rows.length;
  }
  return counts;
}
function revokeDeletedPreparations(state, api, { sportId = null, matchIds = [] }, reason) {
  const removedMatches = new Set(matchIds.map(String));
  const stations = new Set();
  for (const preparation of state.central.keyPreparations || []) {
    if (!(sportId && same(preparation.sport_id, sportId)) && !preparation.match_versions?.some((row) => removedMatches.has(String(row.match_id)))) continue;
    Object.assign(preparation, { is_revoked: true, revoked_at: api.now(), revoked_by: api.user.id, revocation_reason: reason });
    stations.add(String(preparation.station_id));
  }
  const tables = api.tables(state);
  for (const device of tables.registered_devices || []) {
    if (!stations.has(String(device.device_id))) continue;
    device.is_offline_ready = false;
    device.offline_match_count = (tables.matches || []).filter((match) => active(match) && !finished(match) && same(match.assigned_device_id, device.device_id)).length;
  }
  return stations.size;
}

function notifyClassScheduleChange({ state, api, match, previous = null }) {
  const keys = ['scheduled_start', 'scheduled_end', 'venue_id', 'operational_status', 'status'];
  if (previous && keys.every((key) => String(previous[key] ?? '') === String(match[key] ?? ''))) return null;
  const cancelled = match.status === 'cancelled' || ['cancelled', 'postponed'].includes(match.operational_status);
  if (previous && ['scheduled_start', 'scheduled_end', 'venue_id'].every((key) => String(previous[key] ?? '') === String(match[key] ?? '')) && !cancelled) return null;
  const tables = api.tables(state), now = api.now();
  const recipients = (tables.class_registrations || []).filter((row) => same(row.sport_id, match.sport_id) && row.status === 'approved'
    && (same(row.team_id, match.home_team_id) || same(row.team_id, match.away_team_id))).map((row) => row.invite_id)
    .filter((id) => (tables.class_invites || []).some((invite) => same(invite.id, id) && invite.is_active !== false && (!invite.expires_at || Date.parse(invite.expires_at) > Date.parse(now))));
  if (!recipients.length) return null;
  const labels = matchLabel(tables, match);
  const when = match.scheduled_start ? new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }).format(new Date(match.scheduled_start)) : 'orario da definire';
  const notice = api.insert(state, 'class_notices', { sport_id: match.sport_id,
    title: cancelled ? 'Partita annullata o rinviata' : previous ? 'Variazione calendario' : 'Nuova partita in calendario',
    body: cancelled ? `La partita ${labels.home} - ${labels.away} richiede un aggiornamento del calendario. Consultare il programma ufficiale.`
      : `${labels.home} - ${labels.away}: ${when}. Consultare il campo e gli aggiornamenti nel calendario ufficiale.`,
    published_to_team: true, created_at: now, created_by: api.user?.id || null });
  for (const inviteId of new Set(recipients)) api.insert(state, 'class_notice_recipients', { notice_id: notice.id, invite_id: inviteId, read_at: null });
  return notice.id;
}

function handlePlatformRpc({ name, args = {}, state, api }) {
  const tables = api.tables(state), now = api.now();
  const rows = (table) => tables[table] || [];
  const audit = (action, details) => api.audit(state, action, details);
  switch (name) {
    case 'register_device': {
      api.requireRole(...READERS);
      const deviceId = bounded(args.p_device_id, 1, 160, 'Identificativo dispositivo non valido');
      const existing = rows('registered_devices').find((row) => same(row.device_id, deviceId));
      const row = api.upsert(state, 'registered_devices', { ...existing, device_id: deviceId,
        label: existing?.label || bounded(args.p_label || 'Dispositivo', 1, 80, 'Nome postazione non valido'),
        user_agent: text(args.p_user_agent).slice(0, 1000), last_seen_at: now,
        last_sync_at: args.p_is_offline_ready ? now : existing?.last_sync_at || null,
        offline_match_count: Math.max(0, number(args.p_offline_match_count)), is_offline_ready: Boolean(args.p_is_offline_ready),
        created_at: existing?.created_at || now, is_revoked: Boolean(existing?.is_revoked), is_blocked: Boolean(existing?.is_blocked) }, 'device_id');
      return clone(row);
    }
    case 'get_regia_operational_snapshot':
      api.requireRole('super_admin');
      return operationalSnapshot(tables, now, args.p_tolerance_minutes);
    case 'validate_pre_event':
      api.requireRole(...MANAGERS);
      return checkPreparation(tables, args.p_sport_id);
    case 'get_event_statistics': {
      api.requireRole(...READERS);
      const matches = rows('matches').filter((row) => !args.p_sport_id || same(row.sport_id, args.p_sport_id));
      const measured = matches.filter((row) => row.started_at && row.scheduled_start);
      const durations = matches.filter((row) => row.started_at && row.finished_at).map((row) => (Date.parse(row.finished_at) - Date.parse(row.started_at)) / 60000).filter((value) => Number.isFinite(value) && value >= 0);
      const delays = measured.map((row) => Math.max(0, (Date.parse(row.started_at) - Date.parse(row.scheduled_start)) / 60000)).filter(Number.isFinite);
      return { total: matches.length, total_matches: matches.length, finished: matches.filter(finished).length,
        finished_matches: matches.filter(finished).length, live: matches.filter((row) => row.status === 'live').length,
        teams: rows('teams').filter((row) => !args.p_sport_id || same(row.sport_id, args.p_sport_id)).length,
        late_starts: delays.filter((value) => value > 0).length, measured_starts: delays.length,
        average_delay_minutes: delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null,
        average_duration_minutes: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null };
    }
    case 'get_admin_today_overview': {
      api.requireRole(...READERS);
      const matches = rows('matches').filter(active);
      const today = matches.filter((row) => dateKey(row.scheduled_start) === dateKey(now));
      const next = matches.filter((row) => !finished(row) && Date.parse(row.scheduled_start) >= Date.parse(now)).sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start))[0];
      return { matches_today: today.length, live: today.filter((row) => row.status === 'live').length,
        finished_today: today.filter(finished).length, missing_venue: matches.filter((row) => !finished(row) && !row.venue_id).length,
        missing_time: matches.filter((row) => !finished(row) && !row.scheduled_start).length, next_match: next ? matchLabel(tables, next) : null };
    }
    case 'set_registered_device_admin': {
      api.requireRole('super_admin');
      const device = api.row(state, 'registered_devices', args.p_device_id, 'device_id');
      if (args.p_assigned_venue_id) api.row(state, 'venues', args.p_assigned_venue_id);
      if (args.p_assigned_admin_id) api.row(state, 'admins', args.p_assigned_admin_id);
      Object.assign(device, { assigned_venue_id: args.p_assigned_venue_id || null, assigned_admin_id: args.p_assigned_admin_id || null,
        operator_name: text(args.p_operator_name).slice(0, 120) || null, is_revoked: Boolean(args.p_is_revoked),
        is_blocked: Boolean(args.p_is_blocked), anomaly_note: text(args.p_anomaly_note).slice(0, 500) || null,
        revoked_at: args.p_is_revoked ? device.revoked_at || now : null, updated_at: now });
      audit(name, { device_id: device.device_id, is_revoked: device.is_revoked, is_blocked: device.is_blocked });
      return clone(device);
    }
    case 'set_venue_operational_status': {
      api.requireRole('super_admin');
      if (!VENUE_STATUSES.has(args.p_status)) throw new Error('Stato campo non valido');
      const venue = api.row(state, 'venues', args.p_venue_id);
      Object.assign(venue, { operational_status: args.p_status, operational_reason: text(args.p_reason).slice(0, 500) || null, updated_at: now });
      audit(name, { venue_id: venue.id, status: args.p_status, reason: venue.operational_reason });
      return clone(venue);
    }
    case 'assign_match_device_admin': {
      api.requireRole('super_admin');
      const match = api.row(state, 'matches', args.p_match_id);
      if (args.p_device_id) {
        const device = api.row(state, 'registered_devices', args.p_device_id, 'device_id');
        if (device.is_blocked || device.is_revoked) throw new Error('La postazione selezionata non è autorizzata');
      }
      match.assigned_device_id = args.p_device_id || null;
      match.updated_at = now; match.lock_version = number(match.lock_version) + 1;
      audit(name, { match_id: match.id, device_id: match.assigned_device_id, reason: text(args.p_reason) });
      return { success: true, ...clone(match), message: 'Postazione assegnata' };
    }
    case 'approve_match_official_admin': {
      api.requireRole('super_admin');
      const match = api.row(state, 'matches', args.p_match_id);
      if (!finished(match)) throw new Error('Concludi la partita prima di rendere ufficiale il risultato');
      if (!['home', 'away'].every((side) => rows('match_captain_signatures').some((signature) => same(signature.match_id, match.id) && signature.team_side === side && signature.signature_data_url))) throw new Error('Sono necessarie entrambe le firme dei capitani');
      const previous = match.operational_status;
      Object.assign(match, { operational_status: 'official', official_at: now, official_by: api.user.id, updated_at: now, lock_version: number(match.lock_version) + 1 });
      api.insert(state, 'match_status_history', { match_id: match.id, previous_status: previous, new_status: 'official', reason: text(args.p_reason) || 'Referto verificato', changed_by: api.user.id, changed_at: now });
      audit(name, { match_id: match.id, reason: text(args.p_reason) });
      return { success: true, match_id: match.id, message: 'Risultato ufficiale' };
    }
    case 'upsert_match_checkin': {
      api.requireRole(...MANAGERS);
      const match = api.row(state, 'matches', args.p_match_id);
      const role = text(args.p_role);
      if (!['team', 'home_team', 'away_team', 'referee', 'scorekeeper', 'field_manager', 'supervisor'].includes(role)) throw new Error('Ruolo del check-in non valido');
      const teamRole = ['team', 'home_team', 'away_team'].includes(role);
      const allowedTeams = role === 'home_team' ? [match.home_team_id] : role === 'away_team' ? [match.away_team_id] : [match.home_team_id, match.away_team_id];
      if (teamRole && !allowedTeams.some((id) => same(id, args.p_team_id))) throw new Error('La squadra non appartiene alla partita');
      const teamId = teamRole ? args.p_team_id : null;
      const existing = rows('match_checkins').find((row) => same(row.match_id, match.id) && row.role === role && String(row.team_id || '') === String(teamId || ''));
      const payload = { ...existing, match_id: match.id, role, team_id: teamId, checked_in: Boolean(args.p_checked_in), checked_by: api.user.id,
        checked_at: args.p_checked_in ? now : null, notes: text(args.p_notes).slice(0, 500) || null, updated_at: now };
      const row = existing ? api.upsert(state, 'match_checkins', payload) : api.insert(state, 'match_checkins', payload);
      audit(name, { match_id: match.id, role, team_id: teamId, checked_in: row.checked_in });
      return clone(row);
    }
    case 'set_match_operational_status': {
      api.requireRole('super_admin');
      if (!OPERATIONAL_STATUSES.has(args.p_status)) throw new Error('Stato partita non valido');
      if (args.p_status === 'official') return handlePlatformRpc({ name: 'approve_match_official_admin', args, state, api });
      const match = api.row(state, 'matches', args.p_match_id), previous = clone(match);
      if (finished(match) && !['ended', 'awaiting_signatures', 'cancelled'].includes(args.p_status)) throw new Error('Riapri il referto prima di modificare una partita conclusa');
      Object.assign(match, { operational_status: args.p_status, updated_at: now, lock_version: number(match.lock_version) + 1 });
      if (args.p_status === 'cancelled') match.status = 'cancelled';
      api.insert(state, 'match_status_history', { match_id: match.id, previous_status: previous.operational_status || previous.status, new_status: args.p_status,
        reason: text(args.p_reason).slice(0, 500) || null, changed_by: api.user.id, device_id: args.p_device_id || null, changed_at: now });
      notifyClassScheduleChange({ state, api, match, previous });
      audit(name, { match_id: match.id, status: args.p_status, reason: text(args.p_reason) });
      return { success: true, match_id: match.id, operational_status: args.p_status, message: 'Stato partita aggiornato' };
    }
    case 'create_issue_report': {
      const message = bounded(args.p_message, 8, 5000, 'Descrivi il problema con almeno 8 caratteri (massimo 5000)');
      const row = api.insert(state, 'issue_reports', { reporter: text(args.p_reporter).slice(0, 120) || null, message,
        page_url: text(args.p_page_url).slice(0, 2000), user_agent: text(args.p_user_agent).slice(0, 1000), status: 'open', created_at: now, resolved_at: null });
      return { success: true, id: row.id, message: 'Segnalazione registrata nella centrale locale' };
    }
    case 'list_issue_reports':
      api.requireRole(...MANAGERS);
      return clone(rows('issue_reports').slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, Math.min(100, Math.max(1, number(args.p_limit) || 20))));
    case 'log_client_error':
      return clone(api.insert(state, 'client_error_logs', { page_url: text(args.p_page_url).slice(0, 2000), action: text(args.p_action).slice(0, 120), message: text(args.p_message).slice(0, 5000),
        stack: text(args.p_stack).slice(0, 12000), device_id: args.p_device_id || null, device_label: text(args.p_device_label).slice(0, 80), user_agent: text(args.p_user_agent).slice(0, 1000),
        severity: ['error', 'warning', 'info'].includes(args.p_severity) ? args.p_severity : 'error', created_at: now, resolved_at: null }));
    case 'log_sensitive_data_access':
      api.requireRole(...READERS);
      return clone(api.insert(state, 'sensitive_data_access_log', { access_type: text(args.p_access_type).slice(0, 80), entity_type: text(args.p_entity_type).slice(0, 80), entity_id: args.p_entity_id || null,
        page_url: text(args.p_page_url).slice(0, 2000), device_id: args.p_device_id || null, device_label: text(args.p_device_label).slice(0, 80), admin_id: api.user.id, created_at: now }));
    case 'set_platform_setting_admin': {
      api.requireRole('super_admin');
      const key = bounded(args.p_key, 1, 120, 'Impostazione non valida');
      if (args.p_value === undefined || JSON.stringify(args.p_value).length > 100000) throw new Error('Valore impostazione non valido');
      const row = api.upsert(state, 'platform_settings', { key, value: clone(args.p_value), updated_at: now, updated_by: api.user.id }, 'key');
      audit(name, { key });
      return clone(row);
    }
    case 'generate_internal_notifications': {
      api.requireRole(...MANAGERS);
      let created = 0;
      for (const check of checkPreparation(tables)) {
        if (rows('internal_notifications').some((row) => row.code === check.code && same(row.entity_id, check.entity_id) && !row.is_read)) continue;
        api.insert(state, 'internal_notifications', { audience: 'admin', severity: check.severity, code: check.code, title: 'Controllo giornata', message: check.message,
          entity_type: check.entity_type, entity_id: check.entity_id, is_read: false, created_at: now, resolved_at: null });
        created++;
      }
      return created;
    }
    case 'create_platform_backup':
      api.requireRole('super_admin');
      return createBackup(state, api, args.p_sport_id || null, text(args.p_reason));
    case 'delete_sport_admin': {
      api.requireRole('super_admin');
      const sport = api.row(state, 'sports', args.p_sport_id);
      const belongs = scopePredicate(tables, sport.id);
      const plan = new Map(SNAPSHOT_TABLES.filter((table) => !['venues', 'platform_settings', 'urgent_announcements', 'communication_templates'].includes(table))
        .map((table) => [table, rows(table).filter((row) => belongs(table, row))]));
      const matchIds = (plan.get('matches') || []).map((match) => match.id);
      const teamIds = new Set((plan.get('teams') || []).map((team) => String(team.id)));
      const matchIdSet = new Set(matchIds.map(String));
      plan.set('internal_notifications', rows('internal_notifications').filter((row) => same(row.sport_id, sport.id)
        || matchIdSet.has(String(row.match_id)) || row.entity_type === 'match' && matchIdSet.has(String(row.entity_id))
        || row.entity_type === 'team' && teamIds.has(String(row.entity_id)) || row.entity_type === 'sport' && same(row.entity_id, sport.id)));
      assertRemovalReferences(tables, plan, new Set(['platform_backups.sport_id']));
      const backup = createBackup(state, api, sport.id, `Prima dell’eliminazione confermata di ${sport.name}`);
      const counts = applyRemovalPlan(tables, plan);
      for (const metadata of rows('platform_backups')) if (same(metadata.sport_id, sport.id)) Object.assign(metadata, { sport_id: null, deleted_sport_id: sport.id });
      const revokedStations = revokeDeletedPreparations(state, api, { sportId: sport.id, matchIds }, 'sport_deleted');
      audit(name, { sport_id: sport.id, sport_name: sport.name, safety_backup_id: backup.backup_id, removed: counts, revoked_stations: revokedStations });
      return { success: true, deleted_sport_id: sport.id, safety_backup_id: backup.backup_id, message: 'Torneo eliminato. Il backup completo rimane disponibile.' };
    }
    case 'delete_team_admin': {
      api.requireRole('super_admin');
      const team = api.row(state, 'teams', args.p_team_id);
      const players = rows('players').filter((player) => same(player.team_id, team.id));
      const plan = new Map([['teams', [team]], ['players', players], ['team_favorites', rows('team_favorites').filter((row) => same(row.team_id, team.id))]]);
      assertRemovalReferences(tables, plan, new Set(['class_registrations.team_id']));
      const backup = createBackup(state, api, team.sport_id, `Prima dell’eliminazione confermata di ${team.name}`);
      const counts = applyRemovalPlan(tables, plan);
      for (const registration of rows('class_registrations')) if (same(registration.team_id, team.id)) registration.team_id = null;
      audit(name, { team_id: team.id, sport_id: team.sport_id, safety_backup_id: backup.backup_id, removed: counts });
      return { success: true, deleted_team_id: team.id, safety_backup_id: backup.backup_id, message: 'Squadra e rosa senza riferimenti eliminate' };
    }
    case 'delete_match_admin': {
      api.requireRole(...MANAGERS);
      const match = api.row(state, 'matches', args.p_match_id);
      const locked = match.lock_owner && (!match.lock_expires_at || Date.parse(match.lock_expires_at) > Date.parse(now));
      if (finished(match) || match.status === 'live' || ['live', 'paused', 'ended', 'awaiting_signatures', 'official'].includes(match.operational_status) || locked) throw new Error('La partita è in corso o conclusa: conserva il referto e usa gli strumenti di correzione. Nessun dato è stato rimosso.');
      const childTables = ['match_stats', 'live_match_events', 'match_staff_assignments', 'match_captain_signatures', 'match_checkins', 'match_status_history', 'match_reschedule_history'];
      const plan = new Map([['matches', [match]], ...childTables.map((table) => [table, rows(table).filter((row) => same(row.match_id, match.id))]),
        ['internal_notifications', rows('internal_notifications').filter((row) => same(row.match_id, match.id) || row.entity_type === 'match' && same(row.entity_id, match.id))]]);
      assertRemovalReferences(tables, plan);
      const backup = createBackup(state, api, match.sport_id, `Prima dell’eliminazione confermata della partita #${match.id}`);
      notifyClassScheduleChange({ state, api, match: { ...match, status: 'cancelled', operational_status: 'cancelled' }, previous: match });
      const counts = applyRemovalPlan(tables, plan);
      const revokedStations = revokeDeletedPreparations(state, api, { matchIds: [match.id] }, 'match_deleted');
      audit(name, { match_id: match.id, sport_id: match.sport_id, safety_backup_id: backup.backup_id, removed: counts, revoked_stations: revokedStations });
      return { success: true, deleted_match_id: match.id, safety_backup_id: backup.backup_id, message: 'Partita eliminata e preparazioni offline revocate' };
    }
    case 'restore_platform_backup': {
      api.requireRole('super_admin');
      const reason = bounded(args.p_reason, 3, 1000, 'Indica il motivo del ripristino (almeno 3 caratteri)');
      const backup = (state.central.backups || []).find((row) => same(row.id, args.p_backup_id));
      if (!backup?.tables) throw new Error('Backup locale non trovato o contenuto non disponibile');
      const metadata = api.row(state, 'platform_backups', backup.id);
      const belongs = backup.sport_id ? scopePredicate(tables, backup.sport_id) : () => true;
      const currentVersions = new Map(rows('matches').filter((match) => belongs('matches', match)).map((match) => [String(match.id), number(match.lock_version)]));
      for (const [table, snapshot] of Object.entries(backup.tables)) {
        if (!SNAPSHOT_TABLES.includes(table) || !Array.isArray(snapshot)) throw new Error('Contenuto del backup non valido');
        if (backup.sport_id && snapshot.some((row) => row.id != null && rows(table).some((existing) => same(existing.id, row.id) && !belongs(table, existing)))) throw new Error('Il ripristino entrerebbe in conflitto con un altro torneo');
      }
      const safety = createBackup(state, api, backup.sport_id, `Prima del ripristino #${backup.id}: ${reason}`, { allowMissing: true });
      for (const [table, snapshot] of Object.entries(backup.tables)) tables[table] = backup.sport_id ? [...rows(table).filter((row) => !belongs(table, row)), ...clone(snapshot)] : clone(snapshot);
      const restoredMatchIds = new Set((backup.tables.matches || []).map((match) => String(match.id)));
      for (const match of rows('matches')) {
        if (!restoredMatchIds.has(String(match.id))) continue;
        Object.assign(match, { lock_version: Math.max(number(match.lock_version), currentVersions.get(String(match.id)) || 0) + 1,
          lock_owner: null, lock_expires_at: null, assigned_device_id: null, updated_at: now, restored_at: now });
        if (!finished(match) && ['live', 'paused'].includes(match.status)) match.status = 'scheduled';
        if (!finished(match) && ['live', 'paused', 'ready', 'check_in'].includes(match.operational_status)) match.operational_status = match.scheduled_start ? 'scheduled' : 'unscheduled';
      }
      for (const preparation of state.central.keyPreparations || []) {
        if (backup.sport_id && !same(preparation.sport_id, backup.sport_id)) continue;
        Object.assign(preparation, { is_revoked: true, revoked_at: now, revoked_by: api.user.id, revocation_reason: 'platform_backup_restore' });
      }
      Object.assign(metadata, { restored_at: now, restore_reason: reason });
      audit(name, { backup_id: backup.id, safety_backup_id: safety.backup_id, reason, restored_match_ids: [...restoredMatchIds], key_preparations_revoked: true });
      return { success: true, backup_id: backup.id, safety_backup_id: safety.backup_id, message: 'Backup ripristinato nella centrale locale' };
    }
    case 'class_portal': {
      const invite = inviteForCode(tables, args.p_code, now);
      const registration = rows('class_registrations').find((row) => same(row.invite_id, invite.id));
      const notices = rows('class_notice_recipients').filter((row) => same(row.invite_id, invite.id)).map((recipient) => {
        const notice = rows('class_notices').find((row) => same(row.id, recipient.notice_id));
        return notice ? { id: notice.id, title: notice.title, body: notice.body, created_at: notice.created_at, read_at: recipient.read_at || null } : null;
      }).filter(Boolean).sort((a, b) => Number(Boolean(a.read_at)) - Number(Boolean(b.read_at)) || Date.parse(b.created_at) - Date.parse(a.created_at) || number(b.id) - number(a.id));
      return { class_name: invite.class_name, sport_id: invite.sport_id, registration: registration ? {
        status: registration.status, roster: clone(registration.roster), captain: registration.captain_name, decision_note: registration.decision_note || null } : null, notices };
    }
    case 'submit_class_registration': {
      const invite = inviteForCode(tables, args.p_code, now);
      if (!Array.isArray(args.p_roster) || args.p_roster.length < 1 || args.p_roster.length > 40) throw new Error('La squadra deve avere da 1 a 40 componenti');
      const roster = args.p_roster.map((name) => { if (typeof name !== 'string') throw new Error('Nomi dei componenti non validi'); return bounded(name, 2, 100, 'Nomi dei componenti non validi'); });
      if (new Set(roster.map(lower)).size !== roster.length) throw new Error('Non sono ammessi nominativi duplicati');
      const captain = text(args.p_captain);
      if (!roster.some((name) => lower(name) === lower(captain))) throw new Error('Seleziona come capitano un componente della squadra');
      const existing = rows('class_registrations').find((row) => same(row.invite_id, invite.id));
      if (existing?.status === 'approved') throw new Error('Iscrizione già confermata dai docenti');
      if (existing && Date.parse(now) - Date.parse(existing.submitted_at) < 20000) throw new Error('Attendi qualche secondo prima di inviare nuovamente');
      const payload = { ...existing, invite_id: invite.id, sport_id: invite.sport_id, class_name: invite.class_name, roster, captain_name: captain,
        status: 'pending', submitted_at: now, decided_by: null, decided_at: null, decision_note: null, team_id: existing?.team_id || null };
      if (existing) api.upsert(state, 'class_registrations', payload); else api.insert(state, 'class_registrations', payload);
      return 'pending';
    }
    case 'decide_class_registration': {
      api.requireRole(...MANAGERS);
      const registration = api.row(state, 'class_registrations', args.p_registration_id);
      if (registration.status !== 'pending') throw new Error('Iscrizione non in attesa');
      let teamId = null;
      if (args.p_approve) {
        if (rows('teams').some((row) => same(row.sport_id, registration.sport_id) && lower(row.name) === lower(registration.class_name))) throw new Error('Esiste già una squadra per questa classe: evitare duplicati');
        const team = api.insert(state, 'teams', { sport_id: registration.sport_id, name: registration.class_name, created_at: now });
        teamId = team.id;
        for (const name of registration.roster) api.insert(state, 'players', { team_id: teamId, full_name: name, is_captain: lower(name) === lower(registration.captain_name), created_at: now });
      }
      Object.assign(registration, { status: args.p_approve ? 'approved' : 'rejected', team_id: teamId, decided_by: api.user.id, decided_at: now, decision_note: text(args.p_reason).slice(0, 500) || null });
      audit(name, { registration_id: registration.id, approved: Boolean(args.p_approve), team_id: teamId });
      return teamId;
    }
    case 'send_class_notice':
    case 'send_team_class_notice': {
      api.requireRole(...MANAGERS);
      api.row(state, 'sports', args.p_sport_id);
      const title = bounded(args.p_title, 3, 120, 'Titolo non valido (da 3 a 120 caratteri)');
      const body = bounded(args.p_body, 3, 3000, 'Testo non valido (da 3 a 3000 caratteri)');
      if (!Array.isArray(args.p_invite_ids) || !args.p_invite_ids.length) throw new Error('Seleziona almeno una classe');
      const ids = [...new Set(args.p_invite_ids.map(String))];
      const invites = ids.map((id) => rows('class_invites').find((invite) => same(invite.id, id) && same(invite.sport_id, args.p_sport_id) && invite.is_active !== false));
      if (invites.some((invite) => !invite)) throw new Error('Seleziona soltanto classi valide del torneo');
      const notice = api.insert(state, 'class_notices', { sport_id: args.p_sport_id, title, body, published_to_team: name === 'send_team_class_notice' && Boolean(args.p_publish_to_team), created_at: now, created_by: api.user.id });
      for (const invite of invites) api.insert(state, 'class_notice_recipients', { notice_id: notice.id, invite_id: invite.id, read_at: null });
      audit(name, { notice_id: notice.id, invite_ids: invites.map((invite) => invite.id), published_to_team: notice.published_to_team });
      return notice.id;
    }
    case 'acknowledge_class_notice': {
      const invite = inviteForCode(tables, args.p_code, now);
      const recipient = rows('class_notice_recipients').find((row) => same(row.invite_id, invite.id) && same(row.notice_id, args.p_notice_id));
      if (!recipient) return false;
      recipient.read_at ||= now;
      return true;
    }
    case 'rotate_class_invite': {
      api.requireRole(...MANAGERS);
      const inviteId = rows('class_invites').find((row) => same(row.id, args.p_invite_id))?.id;
      const invite = api.row(state, 'class_invites', inviteId);
      invite.access_code = crypto.randomBytes(24).toString('hex'); invite.is_active = true;
      audit(name, { invite_id: invite.id });
      return invite.access_code;
    }
    case 'import_existing_teams_as_classes': {
      api.requireRole('super_admin');
      api.row(state, 'sports', args.p_sport_id);
      let count = 0;
      const processed = new Set();
      for (const team of rows('teams').filter((row) => same(row.sport_id, args.p_sport_id)).sort((a, b) => number(a.id) - number(b.id))) {
        const className = text(team.name);
        if (className.length < 2 || className.length > 48 || processed.has(lower(className))) continue;
        processed.add(lower(className));
        let invite = rows('class_invites').find((row) => same(row.sport_id, args.p_sport_id) && lower(row.class_name) === lower(className));
        if (!invite) {
          invite = api.insert(state, 'class_invites', { id: crypto.randomUUID(), sport_id: args.p_sport_id, class_name: className,
            access_code: crypto.randomBytes(24).toString('hex'), is_active: true, expires_at: null, created_at: now, created_by: api.user.id });
          count++;
        }
        if (!rows('class_registrations').some((row) => same(row.invite_id, invite.id))) {
          const players = rows('players').filter((row) => same(row.team_id, team.id)).sort((a, b) => number(a.id) - number(b.id));
          api.insert(state, 'class_registrations', { invite_id: invite.id, sport_id: args.p_sport_id, class_name: className,
            roster: players.map((row) => row.full_name), captain_name: players.find((row) => row.is_captain)?.full_name || players[0]?.full_name || 'Da indicare',
            status: 'approved', team_id: team.id, submitted_at: now, decided_at: now, decided_by: api.user.id, decision_note: null });
        }
      }
      audit(name, { sport_id: args.p_sport_id, added: count });
      return count;
    }
    case 'public_team_notices': {
      if (!rows('teams').some((team) => same(team.id, args.p_team_id) && same(team.sport_id, args.p_sport_id))) return [];
      const invites = new Set(rows('class_registrations').filter((row) => same(row.team_id, args.p_team_id) && same(row.sport_id, args.p_sport_id) && row.status === 'approved').map((row) => String(row.invite_id)));
      const noticeIds = new Set(rows('class_notice_recipients').filter((row) => invites.has(String(row.invite_id))).map((row) => String(row.notice_id)));
      return rows('class_notices').filter((row) => same(row.sport_id, args.p_sport_id) && row.published_to_team === true && noticeIds.has(String(row.id)))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || number(b.id) - number(a.id)).slice(0, 30)
        .map((row) => ({ id: row.id, title: row.title, body: row.body, created_at: row.created_at }));
    }
    default: return undefined;
  }
}

module.exports = { handlePlatformRpc, notifyClassScheduleChange, operationalSnapshot, checkPreparation };
