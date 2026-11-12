import { db, run, runRpc } from './db.js';
import { getDeviceInfo } from './device.js';

function isMissingSchemaError(error) {
  const message = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
  return /schema cache|could not find|does not exist|relation .* does not exist|column .* does not exist/.test(message);
}

async function optionalQuery(operation, fallback) {
  try {
    return await operation();
  } catch (error) {
    if (isMissingSchemaError(error)) return fallback;
    throw error;
  }
}

export async function generateInternalNotifications() {
  return optionalQuery(
    () => runRpc('generate_internal_notifications', {}, 'Generazione notifiche interne'),
    0
  );
}

export async function loadInternalNotifications({ limit = 12, includeRead = false } = {}) {
  return optionalQuery(async () => {
    let query = db
      .from('internal_notifications')
      .select('id, audience, severity, title, message, entity_type, entity_id, sport_id, match_id, is_read, created_at, resolved_at')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(50, Number(limit) || 12)));

    if (!includeRead) query = query.eq('is_read', false);

    const { data } = await run(query, 'Caricamento notifiche interne');
    return data ?? [];
  }, []);
}

export async function markInternalNotificationRead(notificationId) {
  return optionalQuery(async () => {
    const { data } = await run(
      db
        .from('internal_notifications')
        .update({ is_read: true, resolved_at: new Date().toISOString() })
        .eq('id', Number(notificationId))
        .select()
        .maybeSingle(),
      'Chiusura notifica interna'
    );
    return data;
  }, null);
}

export async function loadAdminTodayOverview() {
  return optionalQuery(
    () => runRpc('get_admin_today_overview', {}, 'Dashboard giornata'),
    {}
  );
}

export async function loadEventStatistics(sportId = null) {
  return optionalQuery(
    () =>
      runRpc(
        'get_event_statistics',
        { p_sport_id: sportId ? Number(sportId) : null },
        'Statistiche evento'
      ),
    {}
  );
}

export async function loadSystemHealthChecks() {
  return optionalQuery(async () => {
    const { data } = await run(
      db.from('system_health_checks').select('*').order('check_key', { ascending: true }),
      'Caricamento salute sistema'
    );
    return data ?? [];
  }, []);
}

export async function saveSystemHealthCheck({ checkKey, status, message = '' }) {
  return optionalQuery(async () => {
    const { data } = await run(
      db
        .from('system_health_checks')
        .upsert(
          {
            check_key: String(checkKey ?? '').trim(),
            status,
            message: String(message ?? '').trim() || null,
            checked_at: new Date().toISOString(),
          },
          { onConflict: 'check_key' }
        )
        .select()
        .single(),
      'Aggiornamento salute sistema'
    );
    return data;
  }, null);
}

export async function loadCommunicationTemplates() {
  return optionalQuery(async () => {
    const { data } = await run(
      db
        .from('communication_templates')
        .select('*')
        .order('template_key', { ascending: true }),
      'Caricamento template comunicazioni'
    );
    return data ?? [];
  }, []);
}

export async function saveCommunicationTemplate(template) {
  return optionalQuery(async () => {
    const payload = {
      template_key: String(template.template_key ?? '').trim(),
      title: String(template.title ?? '').trim(),
      body: String(template.body ?? '').trim(),
      channel: String(template.channel ?? 'telegram').trim() || 'telegram',
      is_active: template.is_active !== false,
      updated_at: new Date().toISOString(),
    };
    const { data } = await run(
      db
        .from('communication_templates')
        .upsert(payload, { onConflict: 'template_key' })
        .select()
        .single(),
      'Salvataggio template comunicazione'
    );
    return data;
  }, null);
}

export async function loadPublicNotifications({ includeInactive = true, limit = 20 } = {}) {
  return optionalQuery(async () => {
    let query = db
      .from('urgent_announcements')
      .select('id, title, body, severity, is_active, expires_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, Number(limit) || 20)));

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data } = await run(query, 'Caricamento notifiche pubbliche');
    return data ?? [];
  }, []);
}

export async function savePublicNotification(notification) {
  const title = String(notification?.title ?? '').trim();
  const body = String(notification?.body ?? '').trim();
  const severity = String(notification?.severity ?? 'info').trim() || 'info';
  const validSeverities = new Set(['info', 'warning', 'danger', 'success']);

  if (title.length < 3) {
    throw new Error('Titolo notifica obbligatorio: inserisci almeno 3 caratteri.');
  }
  if (!validSeverities.has(severity)) {
    throw new Error('Tipo notifica non valido.');
  }

  return optionalQuery(async () => {
    const payload = {
      title,
      body: body || null,
      severity,
      is_active: notification?.isActive !== false,
      expires_at: notification?.expiresAt || null,
      updated_at: new Date().toISOString(),
    };
    const id = Number(notification?.id || 0);
    const query = id
      ? db.from('urgent_announcements').update(payload).eq('id', id)
      : db.from('urgent_announcements').insert(payload);

    const { data } = await run(
      query.select('id, title, body, severity, is_active, expires_at, created_at, updated_at').single(),
      id ? 'Aggiornamento notifica pubblica' : 'Creazione notifica pubblica'
    );
    return data;
  }, null);
}

export async function loadRegiaOperationalSnapshot({ toleranceMinutes = 10 } = {}) {
  try {
    return await runRpc(
      'get_regia_operational_snapshot',
      { p_tolerance_minutes: Math.max(1, Number(toleranceMinutes) || 10) },
      'Centro di controllo'
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }

  const now = Date.now();
  const toleranceMs = Math.max(1, Number(toleranceMinutes) || 10) * 60000;
  const [matchesResult, venuesResult, devicesResult, issuesResult] = await Promise.allSettled([
    run(
      db
        .from('matches')
        .select('id, status, is_finished, scheduled_start, scheduled_end, venue_id, assigned_device_id, delayed_detected_at, operational_status, sport:sports(name), home:teams!home_team_id(name), away:teams!away_team_id(name), venue:venues(name)')
        .order('scheduled_start', { ascending: true, nullsFirst: false }),
      'Fallback Centro Operativo - match'
    ),
    run(
      db.from('venues').select('id, name, slug, is_active, operational_status, operational_reason').order('name', { ascending: true }),
      'Fallback Centro Operativo - campi'
    ),
    run(
      db
        .from('registered_devices')
        .select('device_id, label, assigned_venue_id, assigned_admin_id, last_seen_at, last_sync_at, offline_match_count, is_offline_ready, is_revoked, is_blocked, operator_name, anomaly_note')
        .order('last_seen_at', { ascending: false }),
      'Fallback Centro Operativo - dispositivi'
    ),
    loadIssueReports({ limit: 20 }),
  ]);

  const matches = matchesResult.status === 'fulfilled' ? matchesResult.value.data ?? [] : [];
  const venues = venuesResult.status === 'fulfilled' ? venuesResult.value.data ?? [] : [];
  const devices = devicesResult.status === 'fulfilled' ? devicesResult.value.data ?? [] : [];
  const issues = issuesResult.status === 'fulfilled' ? issuesResult.value ?? [] : [];
  const activeMatches = matches.filter((match) => match.status !== 'cancelled');
  const readyMatches = activeMatches.filter(
    (match) => match.venue_id && match.scheduled_start && match.scheduled_end && match.assigned_device_id
  );
  const delayedMatches = activeMatches.filter((match) => {
    if (match.is_finished || match.status === 'live' || !match.scheduled_start) return false;
    return new Date(match.scheduled_start).getTime() + toleranceMs < now;
  });

  return {
    readiness_percent: activeMatches.length ? Math.round((readyMatches.length / activeMatches.length) * 100) : 0,
    matches: {
      total: activeMatches.length,
      finished: activeMatches.filter((match) => match.is_finished).length,
      live: activeMatches.filter((match) => match.status === 'live').length,
      scheduled: activeMatches.filter((match) => !match.is_finished && match.scheduled_start).length,
      unscheduled: activeMatches.filter((match) => !match.is_finished && !match.scheduled_start).length,
      delayed: delayedMatches.length,
      paused: activeMatches.filter((match) => match.operational_status === 'paused').length,
      official: activeMatches.filter((match) => match.operational_status === 'official').length,
    },
    venues: venues.map((venue) => ({
      ...venue,
      status: venue.operational_status ?? (venue.is_active === false ? 'unavailable' : 'available'),
      reason: venue.operational_reason ?? '',
      active: venue.is_active !== false,
    })),
    devices,
    issues,
    delayed_matches: delayedMatches.map((match) => ({
      id: match.id,
      sport: match.sport?.name ?? '-',
      home: match.home?.name ?? 'Da definire',
      away: match.away?.name ?? 'Da definire',
      venue: match.venue?.name ?? 'Campo da definire',
      scheduled_start: match.scheduled_start,
      delay_minutes: Math.max(0, Math.floor((now - new Date(match.scheduled_start).getTime()) / 60000)),
    })),
    fallback: true,
  };
}

export async function updateRegisteredDeviceAdmin({
  deviceId,
  assignedVenueId = null,
  assignedAdminId = null,
  isRevoked = false,
  isBlocked = false,
  operatorName = '',
  anomalyNote = '',
} = {}) {
  if (!String(deviceId ?? '').trim()) throw new Error('Dispositivo non valido.');
  return runRpc(
    'set_registered_device_admin',
    {
      p_device_id: String(deviceId).trim(),
      p_assigned_venue_id: assignedVenueId ? Number(assignedVenueId) : null,
      p_assigned_admin_id: assignedAdminId || null,
      p_is_revoked: Boolean(isRevoked),
      p_is_blocked: Boolean(isBlocked),
      p_operator_name: String(operatorName ?? '').trim() || null,
      p_anomaly_note: String(anomalyNote ?? '').trim() || null,
    },
    'Aggiornamento dispositivo Centro di controllo'
  );
}

export async function setVenueOperationalStatus(venueId, status, reason = '') {
  if (!Number(venueId)) throw new Error('Campo non valido.');
  return runRpc(
    'set_venue_operational_status',
    {
      p_venue_id: Number(venueId),
      p_status: status,
      p_reason: String(reason ?? '').trim() || null,
    },
    'Aggiornamento stato campo'
  );
}

export async function assignMatchDevice(matchId, deviceId = '', reason = '') {
  if (!Number(matchId)) throw new Error('Match non valido.');
  return runRpc(
    'assign_match_device_admin',
    {
      p_match_id: Number(matchId),
      p_device_id: String(deviceId ?? '').trim() || null,
      p_reason: String(reason ?? '').trim() || null,
    },
    'Assegnazione postazione match'
  );
}

export async function approveMatchOfficial(matchId, reason = '') {
  if (!Number(matchId)) throw new Error('Match non valido.');
  return runRpc(
    'approve_match_official_admin',
    {
      p_match_id: Number(matchId),
      p_reason: String(reason ?? '').trim() || null,
    },
    'Approvazione risultato ufficiale'
  );
}

export async function deletePublicNotification(notificationId) {
  const id = Number(notificationId || 0);
  if (!id) throw new Error('Notifica non valida.');

  return optionalQuery(async () => {
    await run(
      db.from('urgent_announcements').delete().eq('id', id),
      'Eliminazione notifica pubblica'
    );
    return true;
  }, false);
}

export async function loadMatchCheckins(matchId) {
  if (!Number(matchId)) return [];
  return optionalQuery(async () => {
    const { data } = await run(
      db
        .from('match_checkins')
        .select('id, match_id, role, team_id, checked_in, checked_by, checked_at, notes, updated_at')
        .eq('match_id', Number(matchId))
        .order('role', { ascending: true }),
      'Caricamento check-in match'
    );
    return data ?? [];
  }, []);
}

export async function upsertMatchCheckin({ matchId, role, teamId = null, checkedIn = true, notes = '' }) {
  if (!Number(matchId)) throw new Error('Match non valido.');
  const result = await optionalQuery(
    () =>
      runRpc(
        'upsert_match_checkin',
        {
          p_match_id: Number(matchId),
          p_role: String(role ?? '').trim(),
          p_team_id: teamId ? Number(teamId) : null,
          p_checked_in: Boolean(checkedIn),
          p_notes: String(notes ?? '').trim() || null,
        },
        'Aggiornamento check-in match'
      ),
    null
  );
  return Array.isArray(result) ? result[0] : result;
}

export async function setMatchOperationalStatus(matchId, status, reason = '') {
  if (!Number(matchId)) throw new Error('Match non valido.');
  const device = getDeviceInfo();
  const result = await optionalQuery(
    () =>
      runRpc(
        'set_match_operational_status',
        {
          p_match_id: Number(matchId),
          p_status: status,
          p_reason: String(reason ?? '').trim() || null,
          p_device_id: device.id,
        },
        'Aggiornamento stato operativo'
      ),
    null
  );
  return Array.isArray(result) ? result[0] : result;
}

export async function loadMatchStatusHistory(matchId) {
  if (!Number(matchId)) return [];
  return optionalQuery(async () => {
    const { data } = await run(
      db
        .from('match_status_history')
        .select('id, previous_status, new_status, reason, changed_by, device_id, changed_at')
        .eq('match_id', Number(matchId))
        .order('changed_at', { ascending: false })
        .limit(20),
      'Caricamento storico stati match'
    );
    return data ?? [];
  }, []);
}

export async function loadLiveMatchEvents(matchId) {
  if (!Number(matchId)) return [];
  return optionalQuery(async () => {
    const { data } = await run(
      db
        .from('live_match_events')
        .select('id, event_type, team_id, player_id, related_player_id, minute, home_score, away_score, notes, created_at')
        .eq('match_id', Number(matchId))
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      'Caricamento cronologia live'
    );
    return data ?? [];
  }, []);
}

export async function createLiveMatchEvent(payload) {
  if (!Number(payload.matchId)) throw new Error('Match non valido.');
  return optionalQuery(async () => {
    const { data } = await run(
      db
        .from('live_match_events')
        .insert({
          match_id: Number(payload.matchId),
          event_type: String(payload.eventType ?? 'note').trim() || 'note',
          team_id: payload.teamId ? Number(payload.teamId) : null,
          player_id: payload.playerId ? Number(payload.playerId) : null,
          related_player_id: payload.relatedPlayerId ? Number(payload.relatedPlayerId) : null,
          minute: Number.isFinite(Number(payload.minute)) ? Number(payload.minute) : null,
          home_score: Number.isFinite(Number(payload.homeScore)) ? Number(payload.homeScore) : null,
          away_score: Number.isFinite(Number(payload.awayScore)) ? Number(payload.awayScore) : null,
          notes: String(payload.notes ?? '').trim() || null,
        })
        .select()
        .single(),
      'Salvataggio evento live'
    );
    return data;
  }, null);
}

export async function loadIssueReports({ limit = 8 } = {}) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 8));
  try {
    return await runRpc('list_issue_reports', { p_limit: safeLimit }, 'Caricamento problemi segnalati');
  } catch (error) {
    const message = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
    if (!/function .*list_issue_reports|could not find|schema cache|does not exist/.test(message)) {
      throw error;
    }
  }

  const { data } = await run(
    db
      .from('issue_reports')
      .select('id, reporter, message, page_url, user_agent, status, created_at, resolved_at')
      .order('created_at', { ascending: false })
      .limit(safeLimit),
    'Caricamento problemi segnalati'
  );
  return data ?? [];
}

export async function loadTeamFavorite(teamId, deviceId) {
  if (!Number(teamId) || !deviceId) return null;
  return optionalQuery(async () => {
    const { data } = await run(
      db
        .from('team_favorites')
        .select('id, team_id, device_id, created_at')
        .eq('team_id', Number(teamId))
        .eq('device_id', deviceId)
        .maybeSingle(),
      'Caricamento preferito squadra'
    );
    return data;
  }, null);
}

export async function setTeamFavorite(teamId, deviceId, enabled) {
  if (!Number(teamId) || !deviceId) return null;
  return optionalQuery(async () => {
    if (!enabled) {
      await run(
        db
          .from('team_favorites')
          .delete()
          .eq('team_id', Number(teamId))
          .eq('device_id', deviceId),
        'Rimozione preferito squadra'
      );
      return null;
    }

    const { data } = await run(
      db
        .from('team_favorites')
        .upsert(
          { team_id: Number(teamId), device_id: deviceId },
          { onConflict: 'team_id,device_id' }
        )
        .select()
        .single(),
      'Salvataggio preferito squadra'
    );
    return data;
  }, null);
}
