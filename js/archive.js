import { db, run } from './db.js';
import {
  computeStandings,
  loadMatchesBySport,
  loadSportById,
  loadSportConfig,
  loadTeamsBySport,
} from './matches.js';
import { loadAthleticsLeaderboard } from './events.js';
import { TEAM_SPORTS } from './app-config.js';

export async function loadHonorRoll({ sportId = null } = {}) {
  let query = db
    .from('honor_roll_entries')
    .select('*, sport:sports(id, name, sport_type, format, year)')
    .order('edition_year', { ascending: false })
    .order('year', { ascending: true })
    .order('archived_at', { ascending: false });

  if (sportId) {
    query = query.eq('sport_id', Number(sportId));
  }

  const { data } = await run(query, 'Caricamento Albo d Oro');
  return data ?? [];
}

function inferEditionYear(sport) {
  const fromName = String(sport?.name ?? '').match(/\b(20\d{2}|19\d{2})\b/);
  if (fromName) return Number(fromName[1]);
  return new Date().getFullYear();
}

function buildTeamSportArchivePayload({ sport, teams, matches, config, notes }) {
  const finishedMatches = (matches ?? []).filter((match) => Boolean(match.is_finished));
  const standings = computeStandings(teams, matches, config);
  const finalMatch = finishedMatches
    .filter((match) => String(match.round_name ?? '').toLowerCase().includes('finale'))
    .sort((a, b) => Number(b.id) - Number(a.id))[0];

  let winner = standings[0] ?? null;
  let runnerUp = standings[1] ?? null;

  if (finalMatch) {
    const homeWon = Number(finalMatch.home_score ?? 0) > Number(finalMatch.away_score ?? 0);
    const awayWon = Number(finalMatch.away_score ?? 0) > Number(finalMatch.home_score ?? 0);
    if (homeWon || awayWon) {
      winner = {
        id: homeWon ? finalMatch.home_team_id : finalMatch.away_team_id,
        name: homeWon ? finalMatch.home?.name : finalMatch.away?.name,
      };
      runnerUp = {
        id: homeWon ? finalMatch.away_team_id : finalMatch.home_team_id,
        name: homeWon ? finalMatch.away?.name : finalMatch.home?.name,
      };
    }
  }

  if (!winner?.name) {
    throw new Error('Classifica insufficiente per archiviare il torneo.');
  }

  return {
    sport_id: sport.id,
    sport_name: sport.name,
    sport_type: sport.sport_type,
    format: sport.format,
    edition_year: inferEditionYear(sport),
    year: sport.year,
    winner_team_id: Number(winner.id ?? 0) || null,
    winner_team_name: winner.name,
    runner_up_team_name: runnerUp?.name ?? null,
    third_place_team_name: standings[2]?.name ?? null,
    archived_snapshot: {
      school_year: sport.year,
      standings,
      finished_matches: finishedMatches.map((match) => ({
        id: match.id,
        round_name: match.round_name,
        home: match.home?.name ?? null,
        away: match.away?.name ?? null,
        home_score: match.home_score,
        away_score: match.away_score,
        finished_at: match.finished_at,
      })),
    },
    notes: String(notes ?? '').trim() || null,
    archived_at: new Date().toISOString(),
  };
}

async function buildAthleticsArchivePayload({ sport, notes }) {
  const leaderboard = await loadAthleticsLeaderboard(sport.id);
  const winner = leaderboard[0];

  if (!winner) {
    throw new Error('Leaderboard atletica insufficiente per archiviare il torneo.');
  }

  return {
    sport_id: sport.id,
    sport_name: sport.name,
    sport_type: sport.sport_type,
    format: sport.format,
    edition_year: inferEditionYear(sport),
    year: sport.year,
    winner_team_id: null,
    winner_team_name: `${winner.playerName} (${winner.teamName})`,
    runner_up_team_name: leaderboard[1] ? `${leaderboard[1].playerName} (${leaderboard[1].teamName})` : null,
    third_place_team_name: leaderboard[2] ? `${leaderboard[2].playerName} (${leaderboard[2].teamName})` : null,
    archived_snapshot: {
      school_year: sport.year,
      leaderboard,
    },
    notes: String(notes ?? '').trim() || null,
    archived_at: new Date().toISOString(),
  };
}

export async function archiveTournament(sportId, { notes = '' } = {}) {
  const sport = await loadSportById(sportId);
  if (!sport) {
    throw new Error('Torneo non trovato.');
  }

  let payload;
  if (TEAM_SPORTS.includes(String(sport.sport_type ?? '').trim().toLowerCase())) {
    const [teams, matches, config] = await Promise.all([
      loadTeamsBySport(sport.id),
      loadMatchesBySport(sport.id, { includeUnfinished: true }),
      loadSportConfig(sport.id),
    ]);
    payload = buildTeamSportArchivePayload({ sport, teams, matches, config, notes });
  } else {
    payload = await buildAthleticsArchivePayload({ sport, notes });
  }

  const { data } = await run(
    db
      .from('honor_roll_entries')
      .upsert(payload, { onConflict: 'sport_id' })
      .select()
      .single(),
    'Archiviazione torneo'
  );
  return data;
}

export async function unarchiveTournament(entryId) {
  const numericId = Number(entryId);
  if (!numericId) {
    throw new Error('Voce archivio non valida.');
  }

  await run(
    db.from('honor_roll_entries').delete().eq('id', numericId),
    'Disarchiviazione torneo'
  );
}
