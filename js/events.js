import { db, run } from './db.js';
import { medalByRank } from './utils.js';

function uniqueNumericIds(values = []) {
  return [...new Set(values.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))];
}

async function loadPlayersDirectory(playerIds, context = 'Caricamento anagrafica atleti') {
  const ids = uniqueNumericIds(playerIds);
  if (!ids.length) return new Map();

  const { data: players } = await run(
    db.from('players').select('id, full_name, team_id').in('id', ids),
    `${context} - giocatori`
  );

  const playerRows = players ?? [];
  const teamIds = uniqueNumericIds(playerRows.map((row) => row.team_id));
  const teamMap = new Map();

  if (teamIds.length) {
    const { data: teams } = await run(
      db.from('teams').select('id, name').in('id', teamIds),
      `${context} - squadre`
    );
    (teams ?? []).forEach((team) => {
      teamMap.set(Number(team.id), team.name);
    });
  }

  const playerMap = new Map();
  playerRows.forEach((player) => {
    playerMap.set(Number(player.id), {
      id: Number(player.id),
      full_name: player.full_name,
      team_id: Number(player.team_id),
      teams: {
        name: teamMap.get(Number(player.team_id)) ?? '-',
      },
    });
  });

  return playerMap;
}

export async function loadAthleticsSports() {
  const { data } = await run(
    db
      .from('sports')
      .select('*')
      .eq('sport_type', 'atletica')
      .eq('is_active', true)
      .order('year', { ascending: true })
      .order('name', { ascending: true }),
    'Caricamento tornei atletica'
  );
  return data ?? [];
}

export async function loadAthleticsEvents(sportId) {
  const { data } = await run(
    db
      .from('events')
      .select('*')
      .eq('sport_id', Number(sportId))
      .eq('is_active', true)
      .order('name', { ascending: true }),
    'Caricamento eventi atletica'
  );

  return data ?? [];
}

export async function saveAthleticsEvent(payload) {
  const eventPayload = {
    sport_id: Number(payload.sport_id),
    name: String(payload.name).trim(),
    unit: payload.unit,
    sort_order: payload.sort_order,
    is_active: payload.is_active !== false,
  };

  if (payload.id) {
    const { data } = await run(
      db.from('events').update(eventPayload).eq('id', Number(payload.id)).select().single(),
      'Aggiornamento evento atletica'
    );
    return data;
  }

  const { data } = await run(
    db.from('events').insert(eventPayload).select().single(),
    'Creazione evento atletica'
  );
  return data;
}

export async function deleteAthleticsEvent(eventId) {
  await run(
    db.from('events').update({ is_active: false }).eq('id', Number(eventId)),
    'Disattivazione evento atletica'
  );
}

export async function loadEventResults(eventId) {
  const { data } = await run(
    db
      .from('event_results')
      .select('*')
      .eq('event_id', Number(eventId)),
    'Caricamento risultati evento'
  );

  const rows = data ?? [];
  if (!rows.length) return [];

  const playersMap = await loadPlayersDirectory(
    rows.map((row) => row.player_id),
    'Caricamento risultati evento'
  );

  return rows.map((row) => ({
    ...row,
    player: playersMap.get(Number(row.player_id)) ?? null,
  }));
}

export async function upsertEventResult({ event_id, player_id, value, notes }) {
  const { data } = await run(
    db
      .from('event_results')
      .upsert(
        {
          event_id: Number(event_id),
          player_id: Number(player_id),
          value: Number(value),
          notes: notes ? String(notes) : null,
        },
        { onConflict: 'event_id,player_id' }
      )
      .select()
      .single(),
    'Salvataggio risultato atletica'
  );

  return data;
}

export function computeAthleticsRanking(results, orderRule = 'desc') {
  const normalized = [...(results ?? [])].map((item) => ({
    ...item,
    value: Number(item.value ?? 0),
  }));

  normalized.sort((a, b) => {
    if (orderRule === 'asc') {
      return a.value - b.value;
    }
    return b.value - a.value;
  });

  return normalized.map((item, index) => ({
    ...item,
    rank: index + 1,
    medal: medalByRank(index),
  }));
}

export async function loadAthleticsLeaderboard(sportId) {
  const numericSportId = Number(sportId);
  const { data: events } = await run(
    db
      .from('events')
      .select('id, name, sort_order')
      .eq('sport_id', numericSportId)
      .eq('is_active', true),
    'Caricamento leaderboard atletica - eventi'
  );

  const eventRows = events ?? [];
  if (!eventRows.length) return [];

  const eventIds = uniqueNumericIds(eventRows.map((event) => event.id));
  const eventsMap = new Map(
    eventRows.map((event) => [
      Number(event.id),
      { id: Number(event.id), name: event.name, sort_order: event.sort_order },
    ])
  );

  const { data: eventResults } = await run(
    db
      .from('event_results')
      .select('event_id, player_id, value')
      .in('event_id', eventIds),
    'Caricamento leaderboard atletica - risultati'
  );

  const rows = eventResults ?? [];
  if (!rows.length) return [];

  const playersMap = await loadPlayersDirectory(
    rows.map((row) => row.player_id),
    'Caricamento leaderboard atletica'
  );

  const data = rows
    .map((row) => ({
      value: Number(row.value ?? 0),
      event: eventsMap.get(Number(row.event_id)) ?? null,
      player: playersMap.get(Number(row.player_id)) ?? null,
    }))
    .filter((row) => row.event && row.player);

  const byPlayer = new Map();

  for (const row of data) {
    const playerId = row.player?.id;
    if (!playerId) continue;

    const current = byPlayer.get(playerId) ?? {
      playerId,
      playerName: row.player.full_name,
      teamName: row.player.teams?.name ?? '-',
      score: 0,
      events: 0,
      medals: { gold: 0, silver: 0, bronze: 0 },
    };

    current.events += 1;
    byPlayer.set(playerId, current);
  }

  const groupedByEvent = new Map();
  for (const row of data) {
    const eventId = row.event?.id;
    if (!eventId) continue;
    const list = groupedByEvent.get(eventId) ?? [];
    list.push(row);
    groupedByEvent.set(eventId, list);
  }

  for (const rowsPerEvent of groupedByEvent.values()) {
    const orderRule = rowsPerEvent[0]?.event?.sort_order ?? 'desc';
    const ranked = computeAthleticsRanking(rowsPerEvent, orderRule);
    ranked.forEach((result, idx) => {
      const key = result.player.id;
      const summary = byPlayer.get(key);
      if (!summary) return;

      if (idx === 0) {
        summary.score += 3;
        summary.medals.gold += 1;
      } else if (idx === 1) {
        summary.score += 2;
        summary.medals.silver += 1;
      } else if (idx === 2) {
        summary.score += 1;
        summary.medals.bronze += 1;
      }
    });
  }

  return [...byPlayer.values()].sort(
    (a, b) =>
      b.score - a.score ||
      b.medals.gold - a.medals.gold ||
      b.medals.silver - a.medals.silver ||
      b.medals.bronze - a.medals.bronze ||
      a.playerName.localeCompare(b.playerName, 'it', { sensitivity: 'base' })
  );
}
