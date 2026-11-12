// Synthetic examples only: no student data or live database connection.
const firstNames = ['Alessandro', 'Giulia', 'Matteo', 'Beatrice', 'Francesco', 'Sofia', 'Lorenzo', 'Alice', 'Tommaso', 'Vittoria'];
const lastNames = ['De Santis', 'Rossi', 'Della Francesca', 'Bianchi', 'Esposito', 'Colombo', 'Fontana', 'Marchetti', 'Costa', 'Romano'];

export function matchReportFixture(sport = 'calcio', options = {}) {
  const playerCount = options.playersPerTeam || 20;
  const players = ['home', 'away'].flatMap((side, teamIndex) => Array.from({ length: playerCount }, (_, index) => ({
    id: teamIndex * 100 + index + 1,
    team_id: teamIndex + 1,
    full_name: `${firstNames[index % firstNames.length]} ${lastNames[(index + teamIndex) % lastNames.length]}${index === 0 ? ' della Torre' : ''}`,
    is_captain: index === 0,
  })));
  const stats = players.map((player, index) => ({
    player_id: player.id, team_id: player.team_id, player_name: player.full_name,
    played: index % 5 !== 4, points_scored: index % 4, fouls: sport === 'basket' ? index % 3 : 0,
    yellow_cards: sport === 'basket' ? 0 : index % 13 === 0 ? 1 : 0,
    red_cards: sport === 'basket' ? 0 : index === 9 ? 1 : 0,
    is_mvp_vote: index === 2,
  }));
  const eventCount = options.eventCount ?? (sport === 'basket' ? 75 : sport === 'pallavolo' ? 26 : 18);
  const homeScore = sport === 'pallavolo' ? 3 : sport === 'basket' ? 67 : 5;
  const awayScore = sport === 'pallavolo' ? 1 : sport === 'basket' ? 61 : 3;
  const events = Array.from({ length: eventCount }, (_, index) => ({
    event_type: index % 7 === 0 ? 'note' : index % 11 === 0 ? 'substitution' : 'score',
    minute: Math.floor(index / 2), team_side: index % 2 === 0 ? 'home' : 'away', player_id: players[index % players.length].id,
    home_score: Math.round((index + 1) / eventCount * homeScore), away_score: Math.round((index + 1) / eventCount * awayScore),
    notes: index % 7 === 0 ? `Verifica regolare al minuto ${Math.floor(index / 2)}; ripresa autorizzata dall'arbitro.` : '',
  }));
  return {
    match: { id: 900001, home_team_id: 1, away_team_id: 2, home: { name: '4A - Squadra Aurora' }, away: { name: '5B - Squadra Orizzonte' },
      sport: { name: sport === 'basket' ? 'Basket' : sport === 'pallavolo' ? 'Pallavolo' : 'Calcio a 5', sport_type: sport },
      venue: { name: 'Palestra centrale - Campo 1' }, round_name: 'Semifinale', is_finished: true,
      scheduled_start: '2026-10-14T08:30:00Z', scheduled_end: '2026-10-14T09:30:00Z', finished_at: '2026-10-14T09:27:00Z',
      home_score: homeScore, away_score: awayScore,
      live_payload: { duration: 3420, quarter: sport === 'pallavolo' ? 4 : 2, timeouts: { home: 1, away: 2 } } },
    config: { allow_yellow_cards: true, allow_red_cards: true }, players, stats, eventLog: events,
    staff: { referee: 'Arbitro di prova', scorekeeper: 'Segnapunti di prova', field_manager: 'Responsabile di prova', supervisor: 'Docente di prova' },
    signatures: [ { team_side: 'home', player_id: 1, captain_name: players[0].full_name, signed_at: '2026-10-14T09:28:00Z' },
      { team_side: 'away', player_id: 101, captain_name: players[playerCount].full_name, signed_at: '2026-10-14T09:29:00Z' } ],
    notes: 'Entrambe le squadre hanno verificato le presenze. Nessun reclamo. Referto sintetico per il collaudo della stampa.',
    reportHash: 'af24bdc829537891497b2ae115a8718533d596424241abb54cd1331e30e8d4aad', reportRevision: 2,
    deviceLabel: 'Postazione campo 1', mode: options.mode || 'final',
  };
}
