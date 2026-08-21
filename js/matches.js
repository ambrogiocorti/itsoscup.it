import { db, run, runRpc } from './db.js';
import { APP_CONFIG, TEAM_SPORTS } from './app-config.js';
import { buildDeviceAuditFields } from './device.js';

const DEFAULT_CONFIG = {
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  max_fouls: 3,
  quarters_count: 4,
  quarter_duration_sec: 600,
  timeouts_per_team: 2,
  min_players: 5,
  allow_mvp: true,
  allow_yellow_cards: true,
  allow_red_cards: true,
  max_yellow_cards: 2,
  max_red_cards: 1,
  ranking_weight_presence: 70,
  ranking_weight_fairplay: 30,
  athletics_attempts_per_event: 1,
  athletics_min_events_per_player: 1,
  athletics_max_events_per_player: 99,
  ranking_tiebreakers: ['points', 'head_to_head', 'goal_diff', 'goals_for', 'fair_play', 'draw'],
  min_rest_minutes: 0,
  privacy_settings: {
    player_name: 'full',
    show_class: true,
    show_personal_stats: true,
    show_mvp: true,
    show_disciplinary: true,
  },
  advanced_live_events_enabled: false,
};

const CONFIG_COLUMNS_WITH_SCHEMA_FALLBACK = [
  'allow_mvp',
  'athletics_attempts_per_event',
  'athletics_min_events_per_player',
  'athletics_max_events_per_player',
  'max_yellow_cards',
  'max_red_cards',
  'ranking_tiebreakers',
  'min_rest_minutes',
  'privacy_settings',
  'advanced_live_events_enabled',
];

function isMissingSchemaColumn(error, columnName) {
  const message = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
  return (
    message.includes(`'${String(columnName).toLowerCase()}'`) &&
    (message.includes('schema cache') || message.includes('column'))
  );
}

function isScheduleSchemaMissing(error) {
  const message = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
  return ['venue_id', 'scheduled_start', 'scheduled_end', 'schedule_notes'].some((column) =>
    message.includes(column)
  );
}

function isDeviceSchemaMissing(error) {
  const message = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
  return ['updated_device_id', 'updated_device_label'].some((column) => message.includes(column));
}

function stripDeviceFields(payload) {
  const { updated_device_id, updated_device_label, ...rest } = payload;
  return rest;
}

function isCaptainSchemaMissing(error) {
  const message = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
  return message.includes('is_captain');
}

function isNetworkFetchError(error) {
  const message = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
  return /failed to fetch|networkerror|load failed/.test(message);
}

function normalizeTeamSaveError(error) {
  if (isCaptainSchemaMissing(error)) {
    return new Error('Aggiornamento squadra: applica la migrazione 009 e ricarica lo schema Supabase prima di impostare capitani.');
  }
  if (isNetworkFetchError(error)) {
    return new Error('Aggiornamento squadra: richiesta Supabase non raggiunta. Controlla connessione, URL/API key in app-config.js e ricarica la pagina senza cache. Se stai impostando capitani, verifica anche che le migrazioni 009 e 011 siano applicate.');
  }
  return error;
}

export async function loadSports({ includeInactive = false } = {}) {
  let query = db
    .from('sports')
    .select('*')
    .order('year', { ascending: true })
    .order('name', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data } = await run(query, 'Caricamento tornei');
  return data ?? [];
}

export async function loadSportById(sportId) {
  const { data } = await run(
    db.from('sports').select('*').eq('id', sportId).maybeSingle(),
    'Caricamento torneo'
  );
  return data;
}

export async function loadSportConfig(sportId) {
  const { data } = await run(
    db
      .from('sport_config')
      .select('*')
      .eq('sport_id', sportId)
      .maybeSingle(),
    'Caricamento configurazione sport'
  );

  return {
    ...DEFAULT_CONFIG,
    ...(data ?? {}),
  };
}

export async function upsertSportConfig(sportId, payload) {
  const basePayload = {
    sport_id: sportId,
    ...payload,
    updated_at: new Date().toISOString(),
  };

  const unsupportedColumns = new Set();
  let payloadToSave = { ...basePayload };

  while (true) {
    try {
      const { data } = await run(
        db
          .from('sport_config')
          .upsert(payloadToSave, { onConflict: 'sport_id' })
          .select()
          .single(),
        'Salvataggio configurazione sport'
      );

      if (!unsupportedColumns.size) {
        return data;
      }

      return {
        ...DEFAULT_CONFIG,
        ...(data ?? {}),
        ...Object.fromEntries(
          [...unsupportedColumns].map((column) => [column, DEFAULT_CONFIG[column]])
        ),
        __allowMvpUnsupported: unsupportedColumns.has('allow_mvp'),
        __unsupportedConfigColumns: [...unsupportedColumns],
      };
    } catch (error) {
      const missingColumns = CONFIG_COLUMNS_WITH_SCHEMA_FALLBACK.filter(
        (column) =>
          Object.prototype.hasOwnProperty.call(payloadToSave, column) &&
          isMissingSchemaColumn(error, column)
      );

      if (!missingColumns.length) {
        throw error;
      }

      missingColumns.forEach((column) => {
        unsupportedColumns.add(column);
        delete payloadToSave[column];
      });
    }
  }
}

export async function loadTeamsBySport(sportId) {
  const { data } = await run(
    db.from('teams').select('*').eq('sport_id', sportId).order('name', { ascending: true }),
    'Caricamento squadre'
  );
  return data ?? [];
}

export async function loadPlayersByTeam(teamId) {
  const { data } = await run(
    db.from('players').select('*').eq('team_id', teamId).order('full_name', { ascending: true }),
    'Caricamento giocatori'
  );
  return data ?? [];
}

export async function loadMatchesBySport(sportId, { includeUnfinished = true } = {}) {
  let query = db
    .from('matches')
    .select('*, home:teams!home_team_id(name), away:teams!away_team_id(name), sport:sports(*), venue:venues(id, name, slug)')
    .eq('sport_id', sportId)
    .order('scheduled_start', { ascending: true })
    .order('id', { ascending: true });

  if (!includeUnfinished) {
    query = query.eq('is_finished', true);
  }

  const { data } = await run(query, 'Caricamento partite');
  return data ?? [];
}

export async function listMatchesForAdmin(filters = {}) {
  let query = db
    .from('matches')
    .select('*, sport:sports(name, sport_type), home:teams!home_team_id(name), away:teams!away_team_id(name), venue:venues(id, name, slug)')
    .order('scheduled_start', { ascending: true })
    .order('id', { ascending: false });

  if (filters.sportId && filters.sportId !== 'all') {
    query = query.eq('sport_id', Number(filters.sportId));
  }
  if (filters.venueId && filters.venueId !== 'all') {
    query = query.eq('venue_id', Number(filters.venueId));
  }

  const { data } = await run(query, 'Caricamento calendario admin');
  const needle = String(filters.teamSearch ?? '').trim().toLowerCase();
  const phase = String(filters.phase ?? 'all');

  return (data ?? []).filter((match) => {
    if (!TEAM_SPORTS.includes(String(match?.sport?.sport_type ?? '').trim().toLowerCase())) {
      return false;
    }

    const homeName = String(match.home?.name ?? '').toLowerCase();
    const awayName = String(match.away?.name ?? '').toLowerCase();

    if (needle && !homeName.includes(needle) && !awayName.includes(needle)) {
      return false;
    }
    if (phase !== 'all' && String(match.round_name ?? '') !== phase) {
      return false;
    }
    return true;
  });
}

export function generateRoundRobinMatches(teams, hasReturnMatch = false) {
  const normalizedTeams = (teams ?? []).map((team) => ({
    id: Number(team.id),
    name: team.name,
  }));

  const matches = [];
  for (let i = 0; i < normalizedTeams.length; i += 1) {
    for (let j = i + 1; j < normalizedTeams.length; j += 1) {
      matches.push({
        home_team_id: normalizedTeams[i].id,
        away_team_id: normalizedTeams[j].id,
        round_name: 'Girone (Andata)',
      });
      if (hasReturnMatch) {
        matches.push({
          home_team_id: normalizedTeams[j].id,
          away_team_id: normalizedTeams[i].id,
          round_name: 'Girone (Ritorno)',
        });
      }
    }
  }

  return matches;
}

function sortTeamsForSeeding(teams = []) {
  return [...teams].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'it', {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

function splitTeamsIntoGroups(teams = [], groupCount = 2) {
  const groups = Array.from({ length: Math.max(1, groupCount) }, () => []);
  sortTeamsForSeeding(teams).forEach((team, index) => {
    groups[index % groups.length].push(team);
  });
  return groups.filter((group) => group.length);
}

function groupLabel(index) {
  return String.fromCharCode(65 + index);
}

function generateGroupedRoundRobinMatches(teams, { groupCount = 2, hasReturnMatch = false, prefix = 'Girone' } = {}) {
  return splitTeamsIntoGroups(teams, groupCount).flatMap((group, index) => {
    const label = groupLabel(index);
    return generateRoundRobinMatches(group, hasReturnMatch).map((match) => ({
      ...match,
      round_name: `${prefix} ${label} - ${match.round_name}`,
    }));
  });
}

function getFirstEliminationRoundLabel(teamCount) {
  if (teamCount > 8) return 'Ottavi di finale';
  if (teamCount > 4) return 'Quarti di finale';
  if (teamCount > 2) return 'Semifinale';
  return 'Finale';
}

function getNextEliminationLabels(firstLabel) {
  if (firstLabel === 'Ottavi di finale') return ['Quarti di finale', 'Semifinale', 'Finale'];
  if (firstLabel === 'Quarti di finale') return ['Semifinale', 'Finale'];
  if (firstLabel === 'Semifinale') return ['Finale'];
  return [];
}

function createSeededPairs(teams = []) {
  const seeded = sortTeamsForSeeding(teams);
  const pairs = [];
  for (let left = 0, right = seeded.length - 1; left < right; left += 1, right -= 1) {
    pairs.push([seeded[left], seeded[right]]);
  }
  return pairs;
}

function createPlaceholderMatches(roundName, count) {
  return Array.from({ length: Math.max(0, count) }, (_item, index) => ({
    home_team_id: null,
    away_team_id: null,
    round_name: count > 1 ? `${roundName} ${index + 1}` : roundName,
    _seed_key: `${count > 1 ? `${roundName} ${index + 1}` : roundName}:home-null:away-null`,
  }));
}

function generateEliminationMatches(teams, { includeThirdPlace = false } = {}) {
  const pairs = createSeededPairs(teams);
  const firstLabel = getFirstEliminationRoundLabel(teams.length);
  const firstRound = pairs.map(([home, away], index) => ({
    home_team_id: home.id,
    away_team_id: away.id,
    round_name: pairs.length > 1 ? `${firstLabel} ${index + 1}` : firstLabel,
  }));

  let nextCount = Math.ceil(pairs.length / 2);
  const placeholders = [];
  for (const label of getNextEliminationLabels(firstLabel)) {
    placeholders.push(...createPlaceholderMatches(label, nextCount));
    nextCount = Math.ceil(nextCount / 2);
  }

  if (includeThirdPlace && teams.length >= 4) {
    placeholders.push({
      home_team_id: null,
      away_team_id: null,
      round_name: 'Finale 3o posto',
      _seed_key: 'Finale 3o posto:home-null:away-null',
    });
  }

  return [...firstRound, ...placeholders];
}

function generateDoubleEliminationMatches(teams) {
  const pairs = createSeededPairs(teams);
  const winnerRound = pairs.map(([home, away], index) => ({
    home_team_id: home.id,
    away_team_id: away.id,
    round_name: `Winner Bracket - Turno 1.${index + 1}`,
  }));
  const loserCount = Math.max(1, Math.floor(pairs.length / 2));
  return [
    ...winnerRound,
    ...createPlaceholderMatches('Loser Bracket - Turno 1', loserCount),
    ...createPlaceholderMatches('Finale Winner Bracket', 1),
    ...createPlaceholderMatches('Finale Loser Bracket', 1),
    ...createPlaceholderMatches('Grand Final', 1),
    ...createPlaceholderMatches('Grand Final Reset', 1),
  ];
}

function getGeneratedEntryKey(entry) {
  if (entry._seed_key) return entry._seed_key;
  if (entry.home_team_id && entry.away_team_id) {
    return buildUniquePairKey(Number(entry.home_team_id), Number(entry.away_team_id), String(entry.round_name));
  }
  const home = entry.home_team_id ? String(entry.home_team_id) : 'home-null';
  const away = entry.away_team_id ? String(entry.away_team_id) : 'away-null';
  return `${entry.round_name}:${home}:${away}`;
}

function generateSwissRoundMatches(teams, existingMatches, config) {
  const previousRounds = (existingMatches ?? [])
    .map((match) => String(match.round_name ?? ''))
    .filter((name) => name.startsWith('Svizzero - Turno '))
    .map((name) => Number(name.replace(/\D+/g, '')))
    .filter((value) => Number.isFinite(value));
  const nextRound = (previousRounds.length ? Math.max(...previousRounds) : 0) + 1;
  const standings = computeStandings(teams, existingMatches, config);
  const ordered = standings.length ? standings : sortTeamsForSeeding(teams);
  const previousPairs = new Set(
    (existingMatches ?? [])
      .filter((match) => match.home_team_id && match.away_team_id)
      .map((match) => buildUniquePairKey(Number(match.home_team_id), Number(match.away_team_id), 'pair'))
  );
  const remaining = [...ordered];
  const matches = [];

  while (remaining.length > 1) {
    const home = remaining.shift();
    let opponentIndex = remaining.findIndex(
      (team) => !previousPairs.has(buildUniquePairKey(Number(home.id), Number(team.id), 'pair'))
    );
    if (opponentIndex < 0) opponentIndex = 0;
    const [away] = remaining.splice(opponentIndex, 1);
    matches.push({
      home_team_id: Number(home.id),
      away_team_id: Number(away.id),
      round_name: `Svizzero - Turno ${nextRound}`,
    });
  }

  return matches;
}

function generateMatchesByFormat(sport, teams, existingMatches, config, hasReturnMatch = false) {
  const format = String(sport?.format ?? 'gironi');
  if (format === 'eliminazione') {
    return {
      entries: generateEliminationMatches(teams),
      message: 'Tabellone a eliminazione diretta generato.',
    };
  }

  return {
    entries: generateRoundRobinMatches(teams, hasReturnMatch),
    message: 'Calendario gironi generato.',
  };
}

export function getRankingTiebreakers(config = DEFAULT_CONFIG) {
  const allowed = new Set(['points', 'head_to_head', 'goal_diff', 'goals_for', 'fair_play', 'draw']);
  const raw = config?.ranking_tiebreakers;
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : DEFAULT_CONFIG.ranking_tiebreakers;
  const normalized = values
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter((item) => allowed.has(item));
  return normalized.length ? [...new Set(normalized)] : [...DEFAULT_CONFIG.ranking_tiebreakers];
}

function getStatTeamId(stat) {
  return Number(stat?.team_id ?? stat?.teamId ?? 0) || null;
}

function getMatchStatsSnapshot(match) {
  const snapshot = match?.live_payload?.stats_snapshot;
  return Array.isArray(snapshot) ? snapshot : [];
}

function addFairPlayPenalty(table, match, homeScore, awayScore) {
  const homeId = Number(match.home_team_id);
  const awayId = Number(match.away_team_id);
  const stats = getMatchStatsSnapshot(match);

  if (!stats.length) {
    table[homeId].fairPlayPenalty += Math.max(0, awayScore - homeScore) * 0;
    table[awayId].fairPlayPenalty += Math.max(0, homeScore - awayScore) * 0;
    return;
  }

  for (const stat of stats) {
    const teamId = getStatTeamId(stat);
    if (!teamId || !table[teamId]) continue;
    table[teamId].fairPlayPenalty += Number(stat.fouls ?? 0);
    table[teamId].fairPlayPenalty += Number(stat.yellow_cards ?? 0) * 2;
    table[teamId].fairPlayPenalty += Number(stat.red_cards ?? 0) * 5;
  }
}

function buildHeadToHeadRows(teamA, teamB, matches, config) {
  const table = {
    [teamA.id]: { points: 0, goalsFor: 0, goalsAgainst: 0 },
    [teamB.id]: { points: 0, goalsFor: 0, goalsAgainst: 0 },
  };

  for (const match of matches ?? []) {
    if (!match?.is_finished) continue;
    const homeId = Number(match.home_team_id);
    const awayId = Number(match.away_team_id);
    const isPair =
      (homeId === Number(teamA.id) && awayId === Number(teamB.id)) ||
      (homeId === Number(teamB.id) && awayId === Number(teamA.id));
    if (!isPair) continue;

    const homeScore = Number(match.home_score ?? 0);
    const awayScore = Number(match.away_score ?? 0);
    table[homeId].goalsFor += homeScore;
    table[homeId].goalsAgainst += awayScore;
    table[awayId].goalsFor += awayScore;
    table[awayId].goalsAgainst += homeScore;

    if (homeScore > awayScore) {
      table[homeId].points += Number(config.points_win ?? 3);
      table[awayId].points += Number(config.points_loss ?? 0);
    } else if (awayScore > homeScore) {
      table[awayId].points += Number(config.points_win ?? 3);
      table[homeId].points += Number(config.points_loss ?? 0);
    } else {
      table[homeId].points += Number(config.points_draw ?? 1);
      table[awayId].points += Number(config.points_draw ?? 1);
    }
  }

  return {
    a: {
      ...table[teamA.id],
      goalDiff: table[teamA.id].goalsFor - table[teamA.id].goalsAgainst,
    },
    b: {
      ...table[teamB.id],
      goalDiff: table[teamB.id].goalsFor - table[teamB.id].goalsAgainst,
    },
  };
}

function compareHeadToHead(teamA, teamB, matches, config) {
  const { a, b } = buildHeadToHeadRows(teamA, teamB, matches, config);
  return (
    b.points - a.points ||
    b.goalDiff - a.goalDiff ||
    b.goalsFor - a.goalsFor
  );
}

export function computeStandings(teams, matches, config = DEFAULT_CONFIG) {
  const table = {};

  for (const team of teams ?? []) {
    table[team.id] = {
      id: team.id,
      name: team.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      fairPlayPenalty: 0,
    };
  }

  for (const match of matches ?? []) {
    if (!match?.is_finished) continue;
    const home = table[match.home_team_id];
    const away = table[match.away_team_id];
    if (!home || !away) continue;

    const homeScore = Number(match.home_score ?? 0);
    const awayScore = Number(match.away_score ?? 0);

    home.played += 1;
    away.played += 1;
    home.goalsFor += homeScore;
    home.goalsAgainst += awayScore;
    away.goalsFor += awayScore;
    away.goalsAgainst += homeScore;

    if (homeScore > awayScore) {
      home.wins += 1;
      away.losses += 1;
      home.points += Number(config.points_win ?? 3);
      away.points += Number(config.points_loss ?? 0);
    } else if (awayScore > homeScore) {
      away.wins += 1;
      home.losses += 1;
      away.points += Number(config.points_win ?? 3);
      home.points += Number(config.points_loss ?? 0);
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += Number(config.points_draw ?? 1);
      away.points += Number(config.points_draw ?? 1);
    }

    addFairPlayPenalty(table, match, homeScore, awayScore);
  }

  const tiebreakers = getRankingTiebreakers(config);

  return Object.values(table)
    .map((row) => ({
      ...row,
      goalDiff: row.goalsFor - row.goalsAgainst,
    }))
    .sort((a, b) => {
      for (const rule of tiebreakers) {
        let result = 0;
        if (rule === 'points') result = b.points - a.points;
        if (rule === 'head_to_head') result = compareHeadToHead(a, b, matches, config);
        if (rule === 'goal_diff') result = b.goalDiff - a.goalDiff;
        if (rule === 'goals_for') result = b.goalsFor - a.goalsFor;
        if (rule === 'fair_play') result = a.fairPlayPenalty - b.fairPlayPenalty;
        if (rule === 'draw') result = Number(a.id) - Number(b.id);
        if (result !== 0) return result;
      }
      return a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
    });
}

export function getPrivacySettings(config = DEFAULT_CONFIG) {
  const raw = config?.privacy_settings;
  const settings = typeof raw === 'string'
    ? (() => {
        try {
          return JSON.parse(raw);
        } catch (_error) {
          return {};
        }
      })()
    : raw ?? {};

  const playerName = ['full', 'abbreviated', 'hidden'].includes(settings?.player_name)
    ? settings.player_name
    : DEFAULT_CONFIG.privacy_settings.player_name;
  const hideSensitiveIdentity = playerName === 'hidden';

  return {
    ...DEFAULT_CONFIG.privacy_settings,
    ...(settings ?? {}),
    player_name: playerName,
    show_class: hideSensitiveIdentity ? false : settings?.show_class !== false,
    show_personal_stats: hideSensitiveIdentity ? false : settings?.show_personal_stats !== false,
    show_mvp: hideSensitiveIdentity ? false : settings?.show_mvp !== false,
    show_disciplinary: hideSensitiveIdentity ? false : settings?.show_disciplinary !== false,
  };
}

export function formatPublicPlayerName(name, privacySettings = DEFAULT_CONFIG.privacy_settings) {
  const clean = String(name ?? '').trim();
  if (!clean) return 'Studente';
  if (privacySettings.player_name === 'hidden') return 'Studente';
  if (privacySettings.player_name !== 'abbreviated') return clean;

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return `${parts[0][0] ?? ''}.`;
  const first = parts[0];
  const lastInitial = parts.slice(1).map((part) => `${part[0] ?? ''}.`).join(' ');
  return `${first} ${lastInitial}`.trim();
}

function buildUniquePairKey(homeTeamId, awayTeamId, roundName) {
  const [a, b] = [homeTeamId, awayTeamId].sort((x, y) => x - y);
  return `${a}:${b}:${roundName}`;
}

function isMissingRpcError(error) {
  return /function .* does not exist|Could not find the function|schema cache/i.test(
    String(error?.message ?? '')
  );
}

function requireDirectTableFallback(context) {
  if (APP_CONFIG.allowDirectTableFallbacks === true) return;
  throw new Error(
    `${context}: schema Supabase non aggiornato. Applica le migrazioni SQL richieste invece di usare fallback diretti sulle tabelle.`
  );
}

function buildScheduleFields({
  venueId = null,
  scheduledStart = null,
  scheduledEnd = null,
  scheduleNotes = '',
} = {}) {
  const start = scheduledStart || null;
  const end = scheduledEnd || null;
  if ((start && !end) || (!start && end)) {
    throw new Error('Compila sia inizio sia fine dello slot orario.');
  }
  if (start && end && new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error('La fine dello slot deve essere successiva all inizio.');
  }

  return {
    venue_id: venueId ? Number(venueId) : null,
    scheduled_start: start,
    scheduled_end: end,
    schedule_notes: String(scheduleNotes ?? '').trim() || null,
  };
}

function stripScheduleFields(payload) {
  const {
    venue_id: _venueId,
    scheduled_start: _scheduledStart,
    scheduled_end: _scheduledEnd,
    schedule_notes: _scheduleNotes,
    ...legacyPayload
  } = payload;
  return legacyPayload;
}

async function saveManualMatchViaRpc(payload) {
  const result = await runRpc(
    'save_manual_match_admin',
    {
      p_match_id: Number(payload.matchId || 0) || null,
      p_sport_id: Number(payload.sportId),
      p_home_team_id: Number(payload.homeTeamId),
      p_away_team_id: Number(payload.awayTeamId),
      p_round_name: payload.roundName || 'Girone (Andata)',
      p_venue_id: payload.venueId ? Number(payload.venueId) : null,
      p_scheduled_start: payload.scheduledStart || null,
      p_scheduled_end: payload.scheduledEnd || null,
      p_schedule_notes: String(payload.scheduleNotes ?? '').trim() || null,
    },
    'Salvataggio partita RPC'
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (row?.success === false) {
    throw new Error(row.message || 'Salvataggio partita fallito');
  }
  return {
    id: row?.saved_match_id ?? payload.matchId,
    __savedViaRpc: true,
  };
}

async function saveTeamViaRpc({ id, sportId, name, players, captainName = '' }) {
  const result = await runRpc(
    'save_team_admin',
    {
      p_team_id: Number(id || 0) || null,
      p_sport_id: Number(sportId),
      p_name: String(name ?? '').trim(),
      p_players: Array.isArray(players) ? players : [],
      p_captain_name: String(captainName ?? '').trim() || null,
    },
    'Salvataggio squadra RPC'
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || row.success === false) {
    throw new Error(row?.message || 'Salvataggio squadra fallito');
  }
  return Number(row?.saved_team_id ?? id);
}

async function saveSportViaRpc(payload) {
  const result = await runRpc(
    'save_sport_admin',
    {
      p_sport_id: Number(payload.id || 0) || null,
      p_name: String(payload.name ?? '').trim(),
      p_year: Number(payload.year),
      p_sport_type: payload.sport_type,
      p_format: payload.format,
      p_gender: payload.gender,
      p_has_return_match: Boolean(payload.has_return_match),
      p_is_active: payload.is_active !== false,
    },
    'Salvataggio torneo RPC'
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || row.success === false) {
    throw new Error(row?.message || 'Salvataggio torneo fallito');
  }
  return Number(row.saved_sport_id ?? payload.id);
}

export async function createManualMatch({
  sportId,
  homeTeamId,
  awayTeamId,
  roundName = 'Girone (Andata)',
  venueId = null,
  scheduledStart = null,
  scheduledEnd = null,
  scheduleNotes = '',
}) {
  const sport = await loadSportById(sportId);
  if (!sport) {
    throw new Error('Torneo non trovato');
  }
  if (!TEAM_SPORTS.includes(String(sport.sport_type ?? '').trim().toLowerCase())) {
    throw new Error('Le partite sono disponibili solo per sport di squadra');
  }

  const homeId = Number(homeTeamId);
  const awayId = Number(awayTeamId);

  if (!homeId || !awayId || homeId === awayId) {
    throw new Error('Seleziona due squadre differenti');
  }

  const existing = await loadMatchesBySport(sportId, { includeUnfinished: true });
  const uniqueKey = buildUniquePairKey(homeId, awayId, roundName);
  const duplicated = existing.some(
    (item) =>
      buildUniquePairKey(Number(item.home_team_id), Number(item.away_team_id), item.round_name) ===
      uniqueKey
  );

  if (duplicated) {
    throw new Error('Partita duplicata per la stessa fase');
  }

  const payload = {
    sport_id: Number(sportId),
    home_team_id: homeId,
    away_team_id: awayId,
    round_name: roundName,
    status: 'scheduled',
    is_finished: false,
    ...buildScheduleFields({ venueId, scheduledStart, scheduledEnd, scheduleNotes }),
    ...buildDeviceAuditFields(),
  };

  const { data } = await run(
    db.from('matches').insert(payload).select().single(),
    'Creazione partita'
  ).catch(async (error) => {
    if (isScheduleSchemaMissing(error) || isDeviceSchemaMissing(error)) {
      requireDirectTableFallback('Creazione partita');
      let fallbackPayload = { ...payload };
      if (isScheduleSchemaMissing(error)) fallbackPayload = stripScheduleFields(fallbackPayload);
      if (isDeviceSchemaMissing(error)) fallbackPayload = stripDeviceFields(fallbackPayload);
      return run(
        db.from('matches').insert(fallbackPayload).select().single(),
        'Creazione partita senza campi/orari'
      ).then((result) => {
        result.data.__scheduleUnsupported = isScheduleSchemaMissing(error);
        result.data.__deviceUnsupported = isDeviceSchemaMissing(error);
        return result;
      });
    }
    if (isNetworkFetchError(error)) {
      try {
        return { data: await saveManualMatchViaRpc({ sportId, homeTeamId, awayTeamId, roundName, venueId, scheduledStart, scheduledEnd, scheduleNotes }) };
      } catch (rpcError) {
        if (isMissingRpcError(rpcError)) {
          throw new Error('Creazione partita: richiesta REST bloccata dal browser/proxy. Applica la migrazione 010 per abilitare il fallback RPC.');
        }
        throw rpcError;
      }
    }
    throw error;
  });

  return data;
}

export async function updateManualMatch({
  matchId,
  sportId,
  homeTeamId,
  awayTeamId,
  roundName = 'Girone (Andata)',
  venueId = null,
  scheduledStart = null,
  scheduledEnd = null,
  scheduleNotes = '',
}) {
  const sport = await loadSportById(sportId);
  if (!sport) {
    throw new Error('Torneo non trovato');
  }
  if (!TEAM_SPORTS.includes(String(sport.sport_type ?? '').trim().toLowerCase())) {
    throw new Error('Le partite sono disponibili solo per sport di squadra');
  }

  const homeId = Number(homeTeamId);
  const awayId = Number(awayTeamId);

  if (!Number(matchId)) {
    throw new Error('Match non valido');
  }
  if (!homeId || !awayId || homeId === awayId) {
    throw new Error('Seleziona due squadre differenti');
  }

  const payload = {
    sport_id: Number(sportId),
    home_team_id: homeId,
    away_team_id: awayId,
    round_name: roundName,
    ...buildScheduleFields({ venueId, scheduledStart, scheduledEnd, scheduleNotes }),
    ...buildDeviceAuditFields(),
  };

  const { data } = await run(
    db.from('matches').update(payload).eq('id', Number(matchId)).select().single(),
    'Aggiornamento partita'
  ).catch(async (error) => {
    if (isScheduleSchemaMissing(error) || isDeviceSchemaMissing(error)) {
      requireDirectTableFallback('Aggiornamento partita');
      let fallbackPayload = { ...payload };
      if (isScheduleSchemaMissing(error)) fallbackPayload = stripScheduleFields(fallbackPayload);
      if (isDeviceSchemaMissing(error)) fallbackPayload = stripDeviceFields(fallbackPayload);
      return run(
        db.from('matches').update(fallbackPayload).eq('id', Number(matchId)).select().single(),
        'Aggiornamento partita senza campi/orari'
      ).then((result) => {
        result.data.__scheduleUnsupported = isScheduleSchemaMissing(error);
        result.data.__deviceUnsupported = isDeviceSchemaMissing(error);
        return result;
      });
    }
    if (isNetworkFetchError(error)) {
      try {
        return { data: await saveManualMatchViaRpc({ matchId, sportId, homeTeamId, awayTeamId, roundName, venueId, scheduledStart, scheduledEnd, scheduleNotes }) };
      } catch (rpcError) {
        if (isMissingRpcError(rpcError)) {
          throw new Error('Aggiornamento partita: richiesta REST bloccata dal browser/proxy. Applica la migrazione 010 per abilitare il fallback RPC.');
        }
        throw rpcError;
      }
    }
    throw error;
  });

  return data;
}

export async function loadMatchStaff(matchId) {
  if (!Number(matchId)) return {};

  const { data } = await run(
    db
      .from('match_staff_assignments')
      .select('*')
      .eq('match_id', Number(matchId)),
    'Caricamento staff match'
  );

  return (data ?? []).reduce((acc, row) => {
    acc[row.role] = row;
    return acc;
  }, {});
}

export async function saveMatchStaff(matchId, staffPayload = {}) {
  if (!Number(matchId)) throw new Error('Match non valido per salvare lo staff.');

  const roleNames = {
    referee: 'Arbitro',
    scorekeeper: 'Segnapunti',
    field_manager: 'Responsabile campo',
    supervisor: 'Docente supervisore',
  };

  const rows = Object.entries(roleNames)
    .map(([role, label]) => ({
      match_id: Number(matchId),
      role,
      name: String(staffPayload[role] ?? '').trim() || null,
      notes: label,
    }))
    .filter((row) => row.name);

  await run(
    db.from('match_staff_assignments').delete().eq('match_id', Number(matchId)),
    'Pulizia staff match'
  );

  if (!rows.length) return [];

  const { data } = await run(
    db.from('match_staff_assignments').insert(rows).select(),
    'Salvataggio staff match'
  );
  return data ?? [];
}

export async function createPlatformBackup({ sportId = null, reason = '' } = {}) {
  const result = await runRpc(
    'create_platform_backup',
    {
      p_sport_id: sportId ? Number(sportId) : null,
      p_reason: String(reason ?? '').trim() || null,
    },
    'Creazione backup'
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || row.success === false) {
    throw new Error(row?.message || 'Creazione backup fallita');
  }
  return row;
}

export async function restorePlatformBackup({ backupId, reason }) {
  const result = await runRpc(
    'restore_platform_backup',
    {
      p_backup_id: Number(backupId),
      p_reason: String(reason ?? '').trim(),
    },
    'Ripristino backup'
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || row.success === false) {
    throw new Error(row?.message || 'Ripristino backup fallito');
  }
  return row;
}

export async function loadPlatformBackups({ limit = 10 } = {}) {
  const { data } = await run(
    db
      .from('platform_backups')
      .select('id, scope, sport_id, reason, created_at, restored_at, restore_reason')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(50, Number(limit) || 10))),
    'Caricamento backup'
  );
  return data ?? [];
}

export async function deletePlatformBackup(backupId) {
  await run(
    db
      .from('platform_backups')
      .delete()
      .eq('id', Number(backupId)),
    'Eliminazione backup'
  );
}

export async function loadActiveAnnouncements() {
  const nowIso = new Date().toISOString();
  const { data } = await run(
    db
      .from('urgent_announcements')
      .select('*')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(20),
    'Caricamento comunicazioni'
  );
  return data ?? [];
}

export async function reportIssue({ reporter = '', message = '', pageUrl = window.location.href } = {}) {
  const cleanMessage = String(message ?? '').trim();
  if (cleanMessage.length < 8) {
    throw new Error('Descrivi il problema con almeno 8 caratteri.');
  }

  try {
    const result = await runRpc(
      'create_issue_report',
      {
        p_reporter: String(reporter ?? '').trim() || null,
        p_message: cleanMessage,
        p_page_url: pageUrl,
        p_user_agent: navigator.userAgent,
      },
      'Segnalazione problema'
    );
    const row = Array.isArray(result) ? result[0] : result;
    if (row && row.success === false) {
      throw new Error(row.message || 'Segnalazione non salvata.');
    }
    return true;
  } catch (error) {
    const messageText = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
    if (!/function .*create_issue_report|could not find|schema cache|does not exist/.test(messageText)) {
      throw error;
    }
  }

  await run(
    db
      .from('issue_reports')
      .insert({
        reporter: String(reporter ?? '').trim() || null,
        message: cleanMessage,
        page_url: pageUrl,
        user_agent: navigator.userAgent,
      }),
    'Segnalazione problema'
  );
  return true;
}

export async function reopenMatchForCorrection(matchId, reason) {
  const cleanReason = String(reason ?? '').trim();
  if (!Number(matchId)) {
    throw new Error('Match non valido');
  }
  if (cleanReason.length < 8) {
    throw new Error('Motivazione obbligatoria: inserisci almeno 8 caratteri.');
  }

  const result = await runRpc(
    'reopen_match_for_correction',
    {
      p_match_id: Number(matchId),
      p_reason: cleanReason,
    },
    'Riapertura match'
  );

  const row = Array.isArray(result) ? result[0] : result;
  if (!row || row.success === false) {
    throw new Error(row?.message || 'Riapertura match non riuscita');
  }
  return row;
}

export async function generateMatchesForSport(sportId, hasReturnMatch = false) {
  const sport = await loadSportById(sportId);
  if (!sport) {
    throw new Error('Torneo non trovato');
  }
  if (!TEAM_SPORTS.includes(String(sport.sport_type ?? '').trim().toLowerCase())) {
    throw new Error('Generazione calendario disponibile solo per sport di squadra');
  }

  const teams = await loadTeamsBySport(sportId);
  if (teams.length < 2) {
    throw new Error('Servono almeno 2 squadre per generare il calendario');
  }

  const existingMatches = await loadMatchesBySport(sportId, { includeUnfinished: true });
  const config = await loadSportConfig(sportId);
  const { entries: generated, message } = generateMatchesByFormat(
    sport,
    teams,
    existingMatches,
    config,
    hasReturnMatch
  );
  const existingKeys = new Set(
    existingMatches.map((item) => getGeneratedEntryKey({
      home_team_id: item.home_team_id,
      away_team_id: item.away_team_id,
      round_name: item.round_name,
    }))
  );

  const payload = generated
    .filter((entry) => !existingKeys.has(getGeneratedEntryKey(entry)))
    .map((entry) => ({
      home_team_id: entry.home_team_id ? Number(entry.home_team_id) : null,
      away_team_id: entry.away_team_id ? Number(entry.away_team_id) : null,
      round_name: entry.round_name,
      sport_id: Number(sportId),
      status: 'scheduled',
      is_finished: false,
    }));

  if (!payload.length) {
    return { inserted: 0, message };
  }

  await run(db.from('matches').insert(payload), 'Generazione calendario');
  return { inserted: payload.length, message };
}

export async function generateSemifinals(sportId) {
  const sport = await loadSportById(sportId);
  if (!sport) {
    throw new Error('Torneo non trovato');
  }
  if (!TEAM_SPORTS.includes(String(sport.sport_type ?? '').trim().toLowerCase())) {
    throw new Error('Semifinali disponibili solo per sport di squadra');
  }

  const teams = await loadTeamsBySport(sportId);
  if (teams.length < 4) {
    throw new Error('Servono almeno 4 squadre per le semifinali');
  }

  const matches = await loadMatchesBySport(sportId, { includeUnfinished: true });
  const hasSemifinals = matches.some((match) =>
    String(match.round_name ?? '').toLowerCase().includes('semifinale')
  );

  if (hasSemifinals) {
    throw new Error('Semifinali già presenti per questo torneo');
  }

  const config = await loadSportConfig(sportId);
  const standings = computeStandings(teams, matches, config);
  if (standings.length < 4) {
    throw new Error('Classifica insufficiente per generare semifinali');
  }

  const payload = [
    {
      sport_id: Number(sportId),
      home_team_id: standings[0].id,
      away_team_id: standings[3].id,
      round_name: 'Semifinale 1',
      status: 'scheduled',
      is_finished: false,
    },
    {
      sport_id: Number(sportId),
      home_team_id: standings[1].id,
      away_team_id: standings[2].id,
      round_name: 'Semifinale 2',
      status: 'scheduled',
      is_finished: false,
    },
  ];

  await run(db.from('matches').insert(payload), 'Generazione semifinali');
  return payload.length;
}

export async function deleteMatch(matchId) {
  await run(db.from('matches').delete().eq('id', Number(matchId)), 'Eliminazione match');
}

export async function saveSport(payload) {
  const dataPayload = {
    name: payload.name,
    year: Number(payload.year),
    sport_type: payload.sport_type,
    format: payload.format,
    gender: payload.gender,
    has_return_match: Boolean(payload.has_return_match),
    is_active: payload.is_active !== false,
  };

  try {
    const sportId = await saveSportViaRpc(payload);
    return await loadSportById(sportId);
  } catch (error) {
    if (!isMissingRpcError(error)) {
      if (isNetworkFetchError(error)) {
        throw new Error('Aggiornamento torneo: richiesta Supabase non raggiunta. Applica la migrazione 012 e ricarica la pagina senza cache.');
      }
      throw error;
    }
  }

  requireDirectTableFallback('Salvataggio torneo');

  if (payload.id) {
    const { data } = await run(
      db.from('sports').update(dataPayload).eq('id', Number(payload.id)).select().single(),
      'Aggiornamento torneo'
    ).catch((error) => {
      if (isNetworkFetchError(error)) {
        throw new Error('Aggiornamento torneo: richiesta Supabase non raggiunta. Applica la migrazione 012 e ricarica la pagina senza cache.');
      }
      throw error;
    });
    return data;
  }

  const { data } = await run(
    db.from('sports').insert(dataPayload).select().single(),
    'Creazione torneo'
  ).catch((error) => {
    if (isNetworkFetchError(error)) {
      throw new Error('Creazione torneo: richiesta Supabase non raggiunta. Applica la migrazione 012 e ricarica la pagina senza cache.');
    }
    throw error;
  });
  return data;
}

export async function deleteSport(sportId) {
  const numericSportId = Number(sportId);

  const { data: matches } = await run(
    db.from('matches').select('id').eq('sport_id', numericSportId),
    'Eliminazione torneo - caricamento match collegati'
  );
  const matchIds = (matches ?? []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

  if (matchIds.length) {
    await run(
      db.from('match_stats').delete().in('match_id', matchIds),
      'Eliminazione torneo - cancellazione statistiche match'
    );
  }

  await run(
    db.from('matches').delete().eq('sport_id', numericSportId),
    'Eliminazione torneo - cancellazione match'
  );

  const { data: events } = await run(
    db.from('events').select('id').eq('sport_id', numericSportId),
    'Eliminazione torneo - caricamento eventi atletica'
  );
  const eventIds = (events ?? []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

  if (eventIds.length) {
    await run(
      db.from('event_results').delete().in('event_id', eventIds),
      'Eliminazione torneo - cancellazione risultati atletica'
    );
  }

  await run(
    db.from('events').delete().eq('sport_id', numericSportId),
    'Eliminazione torneo - cancellazione eventi atletica'
  );

  const { data: teams } = await run(
    db.from('teams').select('id').eq('sport_id', numericSportId),
    'Eliminazione torneo - caricamento squadre'
  );
  const teamIds = (teams ?? []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

  if (teamIds.length) {
    await run(
      db.from('players').delete().in('team_id', teamIds),
      'Eliminazione torneo - cancellazione giocatori'
    );
  }

  await run(
    db.from('teams').delete().eq('sport_id', numericSportId),
    'Eliminazione torneo - cancellazione squadre'
  );

  await run(
    db.from('sport_config').delete().eq('sport_id', numericSportId),
    'Eliminazione torneo - cancellazione configurazione'
  );

  await run(
    db.from('sports').delete().eq('id', numericSportId),
    'Eliminazione torneo'
  );
}

export async function saveTeam({ id, name, sport_id, players, captainName = '' }) {
  if (!name || !sport_id) {
    throw new Error('Nome squadra e torneo sono obbligatori');
  }

  const teamPayload = {
    name: String(name).trim(),
    sport_id: Number(sport_id),
  };

  const normalizePlayerNameKey = (value) =>
    String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();

  const requestedPlayerNames = [...new Set(
    (players ?? [])
      .map((nameValue) => String(nameValue ?? '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
  )];
  const requestedByKey = new Map(
    requestedPlayerNames.map((fullName) => [normalizePlayerNameKey(fullName), fullName])
  );
  const captainKey = normalizePlayerNameKey(captainName);
  const effectiveCaptainKey =
    captainKey && requestedByKey.has(captainKey)
      ? captainKey
      : requestedPlayerNames.length === 1
        ? normalizePlayerNameKey(requestedPlayerNames[0])
        : '';

  try {
    return await saveTeamViaRpc({
      id,
      sportId: sport_id,
      name: teamPayload.name,
      players: requestedPlayerNames,
      captainName,
    });
  } catch (error) {
    if (!isMissingRpcError(error)) {
      throw normalizeTeamSaveError(error);
    }
  }

  requireDirectTableFallback('Salvataggio squadra');

  let teamId = Number(id);
  if (teamId) {
    await run(
      db.from('teams').update(teamPayload).eq('id', teamId),
      'Aggiornamento squadra'
    ).catch((error) => {
      throw normalizeTeamSaveError(error);
    });
  } else {
    const { data } = await run(
      db.from('teams').insert(teamPayload).select().single(),
      'Creazione squadra'
    ).catch((error) => {
      throw normalizeTeamSaveError(error);
    });
    teamId = Number(data.id);
  }

  const { data: existingPlayers } = await run(
    db
      .from('players')
      .select('id, full_name, is_captain')
      .eq('team_id', teamId),
    'Caricamento giocatori squadra'
  ).catch((error) => {
    throw normalizeTeamSaveError(error);
  });

  const existingRows = existingPlayers ?? [];
  const existingByKey = new Map();
  existingRows.forEach((row) => {
    const key = normalizePlayerNameKey(row.full_name);
    if (!existingByKey.has(key)) {
      existingByKey.set(key, row);
    }
  });

  const playersToInsert = [];
  const playersToRename = [];
  requestedByKey.forEach((displayName, key) => {
    const existing = existingByKey.get(key);
    if (!existing) {
      playersToInsert.push({ team_id: teamId, full_name: displayName });
      return;
    }
    if (String(existing.full_name) !== displayName) {
      playersToRename.push({ id: Number(existing.id), full_name: displayName });
    }
  });

  for (const row of playersToRename) {
    await run(
      db.from('players').update({ full_name: row.full_name }).eq('id', row.id),
      'Aggiornamento nome studente'
    );
  }

  if (playersToInsert.length) {
    await run(
      db.from('players').insert(playersToInsert.map((row) => ({ ...row, is_captain: false }))),
      'Inserimento nuovi studenti squadra'
    ).catch((error) => {
      throw normalizeTeamSaveError(error);
    });
  }

  const { data: refreshedPlayers } = await run(
    db.from('players').select('id, full_name, is_captain').eq('team_id', teamId),
    'Ricaricamento capitani squadra'
  ).catch((error) => {
    throw normalizeTeamSaveError(error);
  });

  const currentCaptainIds = (refreshedPlayers ?? [])
    .filter((row) => Boolean(row.is_captain))
    .map((row) => Number(row.id))
    .filter((playerId) => Number.isFinite(playerId) && playerId > 0);
  if (currentCaptainIds.length) {
    await run(
      db.from('players').update({ is_captain: false }).in('id', currentCaptainIds),
      'Reset capitani squadra'
    ).catch((error) => {
      throw normalizeTeamSaveError(error);
    });
  }

  const nextCaptain = (refreshedPlayers ?? []).find(
    (row) => Boolean(effectiveCaptainKey) && normalizePlayerNameKey(row.full_name) === effectiveCaptainKey
  );
  if (nextCaptain) {
    await run(
      db.from('players').update({ is_captain: true }).eq('id', Number(nextCaptain.id)),
      'Aggiornamento capitano squadra'
    ).catch((error) => {
      throw normalizeTeamSaveError(error);
    });
  }

  const removablePlayers = existingRows.filter(
    (row) => !requestedByKey.has(normalizePlayerNameKey(row.full_name))
  );
  const removableIds = removablePlayers
    .map((row) => Number(row.id))
    .filter((playerId) => Number.isFinite(playerId) && playerId > 0);

  if (removableIds.length) {
    const [{ data: athleticsRefs }, { data: matchRefs }] = await Promise.all([
      run(
        db.from('event_results').select('player_id').in('player_id', removableIds),
        'Verifica riferimenti atletica studenti'
      ),
      run(
        db.from('match_stats').select('player_id').in('player_id', removableIds),
        'Verifica riferimenti match studenti'
      ),
    ]);

    const referencedIds = new Set(
      [...(athleticsRefs ?? []), ...(matchRefs ?? [])]
        .map((row) => Number(row.player_id))
        .filter((playerId) => Number.isFinite(playerId) && playerId > 0)
    );

    const deletableIds = removableIds.filter((playerId) => !referencedIds.has(playerId));
    if (deletableIds.length) {
      await run(
        db.from('players').delete().in('id', deletableIds),
        'Rimozione studenti non referenziati'
      );
    }
  }

  return teamId;
}

export async function deleteTeam(teamId) {
  await run(db.from('teams').delete().eq('id', Number(teamId)), 'Eliminazione squadra');
}

export async function loadPlayersBySport(sportId) {
  const { data } = await run(
    db
      .from('players')
      .select('*, teams!inner(id, name, sport_id)')
      .eq('teams.sport_id', Number(sportId))
      .order('full_name', { ascending: true }),
    'Caricamento giocatori per sport'
  );
  return data ?? [];
}

export async function loadMatchStatsBySport(sportId) {
  const { data } = await run(
    db
      .from('match_stats')
      .select('*, matches!inner(sport_id)')
      .eq('matches.sport_id', Number(sportId)),
    'Caricamento statistiche match'
  );
  return data ?? [];
}

