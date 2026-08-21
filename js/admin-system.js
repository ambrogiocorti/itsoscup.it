import { APP_CONFIG } from './app-config.js';
import { db, run, runRpc } from './db.js';
import { getDeviceInfo } from './device.js';
import { getOfflineStorageSummary } from './offline-store.js';

const DEFAULT_PLATFORM_SETTINGS = {
  official_mode: false,
  public_anonymous_mode: false,
  require_audit_reason: true,
  signature_retention_days: 365,
};

export const REQUIRED_PLATFORM_MIGRATIONS = [
  '001',
  '002',
  '003',
  '004',
  '005',
  '006',
  '007',
  '008',
  '009',
  '010',
  '011',
  '012',
  '015',
  '016',
  '017',
  '018',
  '019',
  '020',
  '021',
  '022',
  '023',
  '024',
  '025',
  '026',
  '027',
  '028',
  '029',
  '030',
  '031',
  '032',
];

const EXPORT_TABLES = [
  'sports',
  'sport_config',
  'teams',
  'players',
  'matches',
  'match_stats',
  'live_match_events',
  'match_staff_assignments',
  'match_captain_signatures',
  'venues',
  'honor_roll_entries',
  'events',
  'event_results',
  'athletics_heats',
  'athletics_lane_assignments',
  'athletics_school_records',
  'athletics_relay_teams',
  'athletics_relay_members',
  'platform_backups',
  'registered_devices',
  'audit_log',
  'client_error_logs',
  'sensitive_data_access_log',
];

function isMissingSchema(error) {
  const message = String(error?.cause?.message ?? error?.message ?? error ?? '').toLowerCase();
  return /does not exist|not found|schema cache|could not find|relation|function/.test(message);
}

function normalizePlatformSetting(row) {
  const value = row?.value;
  if (row?.key === 'official_mode') return Boolean(value?.enabled ?? value);
  if (row?.key === 'public_anonymous_mode') return Boolean(value?.enabled ?? value);
  if (row?.key === 'require_audit_reason') return Boolean(value?.enabled ?? value ?? true);
  if (row?.key === 'sensitive_data_retention') {
    return Number(value?.signature_retention_days ?? DEFAULT_PLATFORM_SETTINGS.signature_retention_days);
  }
  return value;
}

export function serializePlatformSetting(key, value) {
  if (key === 'official_mode' || key === 'public_anonymous_mode' || key === 'require_audit_reason') {
    return { enabled: Boolean(value) };
  }
  if (key === 'sensitive_data_retention') {
    return {
      signature_retention_days: Math.max(1, Number(value || DEFAULT_PLATFORM_SETTINGS.signature_retention_days)),
      audit_retention_days: 730,
    };
  }
  return value;
}

export async function registerCurrentDevice({ offlineMatchCount = 0, isOfflineReady = false } = {}) {
  const device = getDeviceInfo();
  try {
    return await runRpc(
      'register_device',
      {
        p_device_id: device.id,
        p_label: device.label,
        p_user_agent: navigator.userAgent,
        p_offline_match_count: Number(offlineMatchCount || 0),
        p_is_offline_ready: Boolean(isOfflineReady),
      },
      'Registrazione dispositivo'
    );
  } catch (error) {
    if (isMissingSchema(error)) return { skipped: true, reason: 'migration_missing' };
    throw error;
  }
}

export async function loadRegisteredDevices() {
  try {
    const { data } = await run(
      db
        .from('registered_devices')
        .select('device_id, label, user_agent, assigned_venue_id, assigned_admin_id, last_seen_at, last_sync_at, offline_match_count, is_offline_ready, is_revoked, revoked_at, created_at')
        .order('last_seen_at', { ascending: false })
        .limit(100),
      'Caricamento dispositivi'
    );
    return data ?? [];
  } catch (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

export async function logClientError({
  pageUrl = window.location.href,
  action = 'runtime',
  message = '',
  stack = '',
  severity = 'error',
} = {}) {
  const device = getDeviceInfo();
  try {
    return await runRpc(
      'log_client_error',
      {
        p_page_url: pageUrl,
        p_action: action,
        p_message: String(message || 'Errore JavaScript'),
        p_stack: stack || null,
        p_device_id: device.id,
        p_device_label: device.label,
        p_user_agent: navigator.userAgent,
        p_severity: severity,
      },
      'Log errore client'
    );
  } catch (_error) {
    return null;
  }
}

export async function loadClientErrors() {
  try {
    const { data } = await run(
      db
        .from('client_error_logs')
        .select('id, page_url, action, message, severity, device_id, device_label, created_at, resolved_at')
        .order('created_at', { ascending: false })
        .limit(50),
      'Caricamento errori client'
    );
    return data ?? [];
  } catch (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

export async function loadSensitiveDataAccessLogs() {
  try {
    const { data } = await run(
      db
        .from('sensitive_data_access_log')
        .select('id, access_type, entity_type, entity_id, page_url, device_id, device_label, admin_id, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
      'Caricamento accessi dati sensibili'
    );
    return data ?? [];
  } catch (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

export async function loadPlatformSettingsMap() {
  try {
    const { data } = await run(
      db.from('platform_settings').select('key, value, updated_at').order('key', { ascending: true }),
      'Caricamento impostazioni piattaforma'
    );
    const map = { ...DEFAULT_PLATFORM_SETTINGS };
    (data ?? []).forEach((row) => {
      if (row.key === 'sensitive_data_retention') {
        map.signature_retention_days = normalizePlatformSetting(row);
      } else {
        map[row.key] = normalizePlatformSetting(row);
      }
    });
    return map;
  } catch (error) {
    if (isMissingSchema(error)) return { ...DEFAULT_PLATFORM_SETTINGS, __migrationMissing: true };
    throw error;
  }
}

export async function savePlatformSetting(key, value) {
  return runRpc(
    'set_platform_setting_admin',
    {
      p_key: key,
      p_value: serializePlatformSetting(key, value),
    },
    'Salvataggio impostazione piattaforma'
  );
}

export async function loadPlatformMigrations() {
  try {
    const { data } = await run(
      db
        .from('platform_migrations')
        .select('version, description, applied_at')
        .order('applied_at', { ascending: false })
        .limit(30),
      'Caricamento migrazioni'
    );
    return data ?? [];
  } catch (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

export async function verifyPlatformMigrations() {
  const rows = await loadPlatformMigrations();
  const applied = new Set((rows ?? []).map((row) => String(row.version).padStart(3, '0')));
  const missing = REQUIRED_PLATFORM_MIGRATIONS.filter((version) => !applied.has(version));
  return {
    rows,
    applied: [...applied],
    missing,
    ok: missing.length === 0,
  };
}

export async function validatePreEvent(sportId = null) {
  try {
    return await runRpc(
      'validate_pre_event',
      { p_sport_id: sportId ? Number(sportId) : null },
      'Controllo giornata torneo'
    );
  } catch (error) {
    if (isMissingSchema(error)) {
      return [
        {
          severity: 'error',
          code: 'migration_missing',
          message: 'Applica la migrazione 025 per usare il validatore pre-evento.',
          entity_type: 'system',
          entity_id: null,
        },
      ];
    }
    throw error;
  }
}

export async function logSensitiveDataAccess({
  accessType = 'read',
  entityType = 'unknown',
  entityId = null,
} = {}) {
  const device = getDeviceInfo();
  try {
    return await runRpc(
      'log_sensitive_data_access',
      {
        p_access_type: accessType,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_page_url: window.location.href,
        p_device_id: device.id,
        p_device_label: device.label,
      },
      'Log accesso dati sensibili'
    );
  } catch (_error) {
    return null;
  }
}

export async function exportPlatformData() {
  await logSensitiveDataAccess({ accessType: 'export', entityType: 'platform' });
  const exported = {
    exported_at: new Date().toISOString(),
    app: 'ITSOS Cup',
    tables: {},
    errors: [],
  };

  for (const table of EXPORT_TABLES) {
    try {
      const { data } = await run(db.from(table).select('*').limit(5000), `Export ${table}`);
      exported.tables[table] = data ?? [];
    } catch (error) {
      exported.errors.push({ table, message: error.message });
    }
  }

  return exported;
}

export async function deleteStudentData(playerId) {
  const id = Number(playerId || 0);
  if (!id) throw new Error('Studente non valido.');
  await logSensitiveDataAccess({ accessType: 'delete', entityType: 'player', entityId: id });

  const attempts = [
    db.from('match_stats').delete().eq('player_id', id),
    db.from('event_results').delete().eq('player_id', id),
    db.from('players').delete().eq('id', id),
  ];

  for (const query of attempts) {
    try {
      await run(query, 'Cancellazione dati studente');
    } catch (error) {
      if (!isMissingSchema(error)) throw error;
    }
  }
  return true;
}

export async function runSignatureRetentionCleanup(days) {
  const retentionDays = Math.max(1, Number(days || DEFAULT_PLATFORM_SETTINGS.signature_retention_days));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  await logSensitiveDataAccess({ accessType: 'retention_cleanup', entityType: 'match_captain_signatures' });

  try {
    const { data } = await run(
      db
        .from('match_captain_signatures')
        .delete()
        .lt('signed_at', cutoff.toISOString())
        .select('id'),
      'Pulizia retention firme'
    );
    return data ?? [];
  } catch (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

export async function loadSystemHealth() {
  const offline = await getOfflineStorageSummary().catch(() => ({
    liveCacheCount: 0,
    queuedOperationsCount: 0,
  }));

  const [supabase, devices, errors, migrations, settings, backups] = await Promise.allSettled([
    run(db.from('sports').select('id').limit(1), 'Ping Supabase'),
    loadRegisteredDevices(),
    loadClientErrors(),
    loadPlatformMigrations(),
    loadPlatformSettingsMap(),
    run(
      db
        .from('platform_backups')
        .select('id, created_at, reason')
        .order('created_at', { ascending: false })
        .limit(1),
      'Caricamento ultimo backup'
    ),
  ]);

  return {
    supabase: supabase.status === 'fulfilled',
    telegram: Boolean(APP_CONFIG.telegramChannelUrl),
    pwa: offline.liveCacheCount >= 0,
    offline,
    devices: devices.status === 'fulfilled' ? devices.value : [],
    errors: errors.status === 'fulfilled' ? errors.value : [],
    migrations: migrations.status === 'fulfilled' ? migrations.value : [],
    settings: settings.status === 'fulfilled' ? settings.value : { ...DEFAULT_PLATFORM_SETTINGS },
    lastBackup: backups.status === 'fulfilled' ? backups.value.data?.[0] ?? null : null,
  };
}

export function buildSimulationDataset() {
  const teams = ['3A', '3B', '3C', '3D'].map((name, index) => ({
    id: index + 1,
    name,
    captain: `${name} Capitano`,
    players: 8 + index,
  }));
  const matches = [
    { home: teams[0], away: teams[1], home_score: 2, away_score: 1, venue: 'Palestra Grande' },
    { home: teams[2], away: teams[3], home_score: 0, away_score: 0, venue: 'Campo Esterno' },
    { home: teams[0], away: teams[2], home_score: 1, away_score: 3, venue: 'Palestra Grande' },
    { home: teams[1], away: teams[3], home_score: 4, away_score: 2, venue: 'Campo Esterno' },
  ];
  const standings = teams
    .map((team) => {
      const played = matches.filter((match) => match.home.id === team.id || match.away.id === team.id);
      let points = 0;
      let goalDiff = 0;
      played.forEach((match) => {
        const isHome = match.home.id === team.id;
        const own = isHome ? match.home_score : match.away_score;
        const opp = isHome ? match.away_score : match.home_score;
        goalDiff += own - opp;
        if (own > opp) points += 3;
        else if (own === opp) points += 1;
      });
      return { ...team, played: played.length, points, goalDiff };
    })
    .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || a.name.localeCompare(b.name));

  return {
    generated_at: new Date().toISOString(),
    teams,
    matches,
    standings,
    conflicts: [
      'Simulazione: 3A ha due match nello stesso giorno con meno di 30 minuti di riposo.',
      'Simulazione: Palestra Grande occupata da due match se gli slot si sovrappongono.',
    ],
  };
}
