import { db, run, runRpc } from './db.js';
import { TEAM_SPORTS } from './app-config.js';

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
};

const CONFIG_COLUMNS_WITH_SCHEMA_FALLBACK = [
  'allow_mvp',
  'athletics_attempts_per_event',
  'athletics_min_events_per_player',
  'athletics_max_events_per_player',
  'max_yellow_cards',
  'max_red_cards',
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
        ...(data ?? {}),
        allow_mvp: unsupportedColumns.has('allow_mvp')
          ? DEFAULT_CONFIG.allow_mvp
          : Boolean((data ?? {}).allow_mvp ?? DEFAULT_CONFIG.allow_mvp),
        __allowMvpUnsupported: unsupportedColumns.has('allow_mvp'),
        __unsupportedConfigColumns: [...unsupportedColumns],
        max_yellow_cards: unsupportedColumns.has('max_yellow_cards')
          ? DEFAULT_CONFIG.max_yellow_cards
          : Number((data ?? {}).max_yellow_cards ?? DEFAULT_CONFIG.max_yellow_cards),
        max_red_cards: unsupportedColumns.has('max_red_cards')
          ? DEFAULT_CONFIG.max_red_cards
          : Number((data ?? {}).max_red_cards ?? DEFAULT_CONFIG.max_red_cards),
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
  }

  return Object.values(table)
    .map((row) => ({
      ...row,
      goalDiff: row.goalsFor - row.goalsAgainst,
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor ||
        a.name.localeCompare(b.name, 'it', { sensitivity: 'base' })
    );
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
  };

  const { data } = await run(
    db.from('matches').insert(payload).select().single(),
    'Creazione partita'
  ).catch(async (error) => {
    if (isScheduleSchemaMissing(error)) {
      return run(
        db.from('matches').insert(stripScheduleFields(payload)).select().single(),
        'Creazione partita senza campi/orari'
      ).then((result) => {
        result.data.__scheduleUnsupported = true;
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
  };

  const { data } = await run(
    db.from('matches').update(payload).eq('id', Number(matchId)).select().single(),
    'Aggiornamento partita'
  ).catch(async (error) => {
    if (isScheduleSchemaMissing(error)) {
      return run(
        db.from('matches').update(stripScheduleFields(payload)).eq('id', Number(matchId)).select().single(),
        'Aggiornamento partita senza campi/orari'
      ).then((result) => {
        result.data.__scheduleUnsupported = true;
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

  const generated = generateRoundRobinMatches(teams, hasReturnMatch);
  const existingMatches = await loadMatchesBySport(sportId, { includeUnfinished: true });
  const existingKeys = new Set(
    existingMatches.map((item) =>
      buildUniquePairKey(
        Number(item.home_team_id),
        Number(item.away_team_id),
        String(item.round_name)
      )
    )
  );

  const payload = generated
    .filter(
      (entry) =>
        !existingKeys.has(
          buildUniquePairKey(entry.home_team_id, entry.away_team_id, entry.round_name)
        )
    )
    .map((entry) => ({
      ...entry,
      sport_id: Number(sportId),
      status: 'scheduled',
      is_finished: false,
    }));

  if (!payload.length) {
    return { inserted: 0 };
  }

  await run(db.from('matches').insert(payload), 'Generazione calendario');
  return { inserted: payload.length };
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

