import {
  loadTeamsBySport,
  loadMatchesBySport,
  loadPlayersBySport,
  loadMatchStatsBySport,
  loadSportConfig,
  computeStandings,
} from './matches.js';

export async function loadReportDataset(sportId) {
  const [teams, matches, players, stats, config] = await Promise.all([
    loadTeamsBySport(sportId),
    loadMatchesBySport(sportId, { includeUnfinished: true }),
    loadPlayersBySport(sportId),
    loadMatchStatsBySport(sportId),
    loadSportConfig(sportId),
  ]);

  return {
    teams,
    matches,
    players,
    stats,
    config,
  };
}

export function computePlayerRanking({ players, stats, matches, config }) {
  const finishedMatches = (matches ?? []).filter((match) => match.is_finished);
  const totalFinished = Math.max(finishedMatches.length, 1);
  const weightPresence = Number(config.ranking_weight_presence ?? 70);
  const weightFairplay = Number(config.ranking_weight_fairplay ?? 30);
  const mvpEnabled = Boolean(config.allow_mvp ?? true);

  const ranking = (players ?? []).map((player) => {
    const playerLogs = (stats ?? []).filter((entry) => Number(entry.player_id) === Number(player.id));
    const fouls = playerLogs.reduce((sum, row) => sum + Number(row.fouls ?? 0), 0);
    const presences = playerLogs.filter((row) => Boolean(row.played)).length;
    const mvpVotes = mvpEnabled
      ? playerLogs.filter((row) => Boolean(row.is_mvp_vote)).length
      : 0;

    const presencePct = Math.round((presences / totalFinished) * 100);
    const fairplayScore = Math.max(0, 100 - fouls * 12);
    const weightedScore = Math.round(
      (presencePct * weightPresence + fairplayScore * weightFairplay) / 100 + mvpVotes * 8
    );

    return {
      playerId: player.id,
      name: player.full_name,
      team: player.teams?.name ?? '-',
      presences,
      presencePct,
      fouls,
      mvpVotes,
      score: Math.max(0, weightedScore),
    };
  });

  return ranking.sort(
    (a, b) =>
      b.score - a.score ||
      b.mvpVotes - a.mvpVotes ||
      a.fouls - b.fouls ||
      a.name.localeCompare(b.name, 'it', { sensitivity: 'base' })
  );
}

export function pickMvpWinner(playersRanking) {
  if (!playersRanking?.length) {
    return null;
  }

  const byVotes = [...playersRanking].sort(
    (a, b) =>
      b.mvpVotes - a.mvpVotes ||
      b.score - a.score ||
      a.name.localeCompare(b.name, 'it', { sensitivity: 'base' })
  );

  const winner = byVotes[0];
  if (!winner || winner.mvpVotes <= 0) {
    return null;
  }

  return winner;
}

export function computeTeamStandingsForReport(teams, matches, config) {
  const standings = computeStandings(teams, matches, config);
  return standings.map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}

