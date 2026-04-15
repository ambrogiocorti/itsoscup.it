import { signInAdmin } from './auth.js';
import {
  computeStandings,
  loadMatchesBySport,
  loadSportById,
  loadSportConfig,
  loadSports,
  loadTeamsBySport,
} from './matches.js';
import {
  computeAthleticsRanking,
  loadAthleticsEvents,
  loadAthleticsLeaderboard,
  loadEventResults,
} from './events.js';
import { db, run, subscribeTable } from './db.js';
import {
  escapeHtml,
  formatDateTime,
  medalByRank,
  setHidden,
  showToast,
} from './utils.js';

const DEFAULT_SUBTITLE =
  'Risultati e classifica in tempo reale';

const SPORT_TYPE_LABELS = {
  calcio: 'Calcio',
  basket: 'Basket',
  pallavolo: 'Pallavolo',
  atletica: 'Atletica',
};

const FORMAT_LABELS = {
  gironi: 'Gironi',
  eliminazione: 'Eliminazione diretta',
};

const state = {
  selectedSportId: null,
  selectedSport: null,
  unsubscribe: null,
};

function getSportSelect() {
  return document.getElementById('sport-select');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function getSportTypeLabel(type) {
  return SPORT_TYPE_LABELS[type] ?? 'Torneo';
}

function getFormatLabel(format) {
  return FORMAT_LABELS[format] ?? 'Formato libero';
}

function resetPublicTournamentUi() {
  const subtitle = document.getElementById('public-subtitle');
  const standingTitle = document.getElementById('standing-title');
  const matchesTitle = document.getElementById('matches-title');
  const contextCard = document.getElementById('sport-context-card');
  const contextContent = document.getElementById('sport-context-content');

  if (subtitle) subtitle.textContent = DEFAULT_SUBTITLE;
  if (standingTitle) {
    standingTitle.innerHTML = '<i class="fa-solid fa-list-ol"></i> Classifica';
  }
  if (matchesTitle) {
    matchesTitle.innerHTML = '<i class="fa-solid fa-calendar-check"></i> Partite Giocate';
  }
  if (contextContent) contextContent.innerHTML = '';
  setHidden(contextCard, true);
}

function updatePublicTournamentUi(sport) {
  const subtitle = document.getElementById('public-subtitle');
  const standingTitle = document.getElementById('standing-title');
  const matchesTitle = document.getElementById('matches-title');
  const contextCard = document.getElementById('sport-context-card');
  const contextContent = document.getElementById('sport-context-content');

  if (!sport) {
    resetPublicTournamentUi();
    return;
  }

  const typeLabel = getSportTypeLabel(sport.sport_type);
  const formatLabel = getFormatLabel(sport.format);

  if (contextContent) {
    contextContent.innerHTML = `
      <div class="sport-context">
        <span class="badge badge-info">${escapeHtml(typeLabel)}</span>
        <span class="badge badge-warning">${escapeHtml(formatLabel)}</span>
        <span class="badge badge-success">${escapeHtml(sport.year)}° anno</span>
      </div>
    `;
  }
  setHidden(contextCard, false);

  if (sport.sport_type === 'atletica') {
    if (standingTitle) {
      standingTitle.innerHTML = '<i class="fa-solid fa-medal"></i> Eventi Atletica';
    }
    if (matchesTitle) {
      matchesTitle.innerHTML = '<i class="fa-solid fa-person-running"></i> Risultati Individuali';
    }
    return;
  }

  if (sport.format === 'eliminazione') {
    if (standingTitle) {
      standingTitle.innerHTML = '<i class="fa-solid fa-sitemap"></i> Quadro Eliminazione';
    }
    if (matchesTitle) {
      matchesTitle.innerHTML = '<i class="fa-solid fa-calendar-check"></i> Match Conclusi';
    }
    return;
  }

  if (standingTitle) {
    standingTitle.innerHTML = '<i class="fa-solid fa-list-ol"></i> Classifica';
  }
  if (matchesTitle) {
    matchesTitle.innerHTML = `<i class="fa-solid fa-calendar-check"></i> Partite ${escapeHtml(
      typeLabel
    )}`;
  }
}

function renderSports(sports) {
  const select = getSportSelect();
  if (!select) return;

  select.innerHTML = [
    '<option value="">-- Seleziona torneo --</option>',
    ...sports.map(
      (sport) =>
        `<option value="${sport.id}" data-sport-type="${escapeHtml(
          sport.sport_type
        )}" data-format="${escapeHtml(sport.format)}">${escapeHtml(sport.name)}</option>`
    ),
  ].join('');
}

function renderStandingsTable(standings) {
  const container = document.getElementById('standings-container');

  if (!standings.length) {
    container.innerHTML = '<div class="empty-state">Nessuna classifica disponibile.</div>';
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="standings-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th class="team-td">Squadra</th>
            <th class="text-center">G</th>
            <th class="text-center">V</th>
            <th class="text-center">N</th>
            <th class="text-center">P</th>
            <th class="text-center">DR</th>
            <th class="text-center points-col">PT</th>
          </tr>
        </thead>
        <tbody>
          ${standings
            .map(
              (row, index) => `
            <tr>
              <td>${medalByRank(index)}</td>
              <td class="team-td"><strong>${escapeHtml(row.name)}</strong></td>
              <td class="text-center">${row.played}</td>
              <td class="text-center">${row.wins}</td>
              <td class="text-center">${row.draws}</td>
              <td class="text-center">${row.losses}</td>
              <td class="text-center">${row.goalDiff}</td>
              <td class="text-center points-col"><strong>${row.points}</strong></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderKnockoutOverview(matches) {
  const container = document.getElementById('standings-container');
  const rows = [...(matches ?? [])].sort((a, b) => {
    const byRound = String(a.round_name ?? '').localeCompare(String(b.round_name ?? ''), 'it', {
      sensitivity: 'base',
    });
    if (byRound !== 0) return byRound;
    return Number(a.id) - Number(b.id);
  });

  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">Nessun match presente nel tabellone.</div>';
    return;
  }

  const finishedCount = rows.filter((match) => Boolean(match.is_finished)).length;
  const roundsCount = new Set(rows.map((match) => String(match.round_name ?? '-'))).size;

  container.innerHTML = `
    <div class="sport-context" style="margin-bottom: 12px;">
      <span class="badge badge-info">Round: ${roundsCount}</span>
      <span class="badge badge-success">Conclusi: ${finishedCount}</span>
      <span class="badge badge-warning">Da giocare: ${rows.length - finishedCount}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fase</th>
            <th>Incontro</th>
            <th class="text-center">Esito</th>
            <th class="text-center">Stato</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (match) => `
            <tr>
              <td>${escapeHtml(match.round_name ?? '-')}</td>
              <td><strong>${escapeHtml(match.home?.name ?? 'TBD')} vs ${escapeHtml(match.away?.name ?? 'TBD')}</strong></td>
              <td class="text-center">${match.is_finished ? `${match.home_score ?? 0} - ${match.away_score ?? 0}` : '- -'}</td>
              <td class="text-center">${match.is_finished ? 'Finale' : 'Da giocare'}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderPlayedMatches(matches, emptyMessage = 'Nessuna partita giocata.') {
  const container = document.getElementById('matches-container');
  const finished = (matches ?? []).filter((match) => Boolean(match.is_finished));

  if (!finished.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = finished
    .map(
      (match) => `
      <button class="match-item" data-match-id="${match.id}">
        <div class="team-label text-right">${escapeHtml(match.home?.name ?? 'TBD')}</div>
        <div class="score-badge">${match.home_score ?? 0} - ${match.away_score ?? 0}</div>
        <div class="team-label">${escapeHtml(match.away?.name ?? 'TBD')}</div>
      </button>
    `
    )
    .join('');

  container.querySelectorAll('[data-match-id]').forEach((button) => {
    button.addEventListener('click', () => {
      openMatchDetails(button.dataset.matchId);
    });
  });
}

async function renderAthletics(sportId) {
  const eventsContainer = document.getElementById('athletics-events-container');
  const rankingContainer = document.getElementById('athletics-ranking-container');

  const [events, leaderboard] = await Promise.all([
    loadAthleticsEvents(sportId),
    loadAthleticsLeaderboard(sportId),
  ]);

  if (!events.length) {
    eventsContainer.innerHTML = '<div class="empty-state">Nessun evento atletica configurato.</div>';
  } else {
    const eventRows = await Promise.all(
      events.map(async (event) => {
        const results = await loadEventResults(event.id);
        const ranked = computeAthleticsRanking(results, event.sort_order);

        const topThree = ranked.slice(0, 3);
        return `
          <div style="padding:14px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;">
            <strong>${escapeHtml(event.name)}</strong>
            <div class="muted" style="font-size:0.8rem;margin-top:2px;">Unità: ${escapeHtml(
              event.unit
            )} · Ordinamento: ${event.sort_order === 'asc' ? 'minore è migliore' : 'maggiore è migliore'}</div>
            <div style="margin-top:10px;display:grid;gap:6px;">
              ${
                topThree.length
                  ? topThree
                      .map(
                        (row) =>
                          `<div>${row.medal} ${escapeHtml(
                            row.player?.full_name ?? '-'
                          )} <span class="muted">(${Number(row.value).toFixed(2)})</span></div>`
                      )
                      .join('')
                  : '<div class="muted">Nessun risultato inserito.</div>'
              }
            </div>
          </div>
        `;
      })
    );

    eventsContainer.innerHTML = `<div class="inline-grid cols-2">${eventRows.join('')}</div>`;
  }

  if (!leaderboard.length) {
    rankingContainer.innerHTML = '<div class="empty-state">Leaderboard non disponibile.</div>';
    return;
  }

  rankingContainer.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pos</th>
            <th>Studente</th>
            <th>Classe</th>
            <th class="text-center">Eventi</th>
            <th class="text-center">Medaglie</th>
            <th class="text-center">Punti</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboard
            .map(
              (row, index) => `
            <tr>
              <td>${medalByRank(index)}</td>
              <td><strong>${escapeHtml(row.playerName)}</strong></td>
              <td>${escapeHtml(row.teamName)}</td>
              <td class="text-center">${row.events}</td>
              <td class="text-center">O ${row.medals.gold} · A ${row.medals.silver} · B ${row.medals.bronze}</td>
              <td class="text-center"><strong>${row.score}</strong></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function openMatchDetails(matchId) {
  const content = document.getElementById('match-details-content');

  openModal('match-details-modal');
  content.innerHTML = '<div class="empty-state">Caricamento dettagli...</div>';

  try {
    const [matchResult, statsResult] = await Promise.all([
      run(
        db
          .from('matches')
          .select('*, home:teams!home_team_id(name), away:teams!away_team_id(name)')
          .eq('id', Number(matchId))
          .single(),
        'Dettaglio match'
      ),
      run(
        db
          .from('match_stats')
          .select('player_id, played, fouls, is_mvp_vote, points_scored, yellow_cards, red_cards')
          .eq('match_id', Number(matchId)),
        'Dettaglio statistiche match'
      ),
    ]);

    const match = matchResult.data;
    let maxFouls = 3;
    if (Number(match?.sport_id) > 0) {
      try {
        const config = await loadSportConfig(Number(match.sport_id));
        maxFouls = Number(config?.max_fouls ?? 3);
      } catch (_error) {
        maxFouls = 3;
      }
    }
    maxFouls = Math.max(1, Math.min(12, Math.round(maxFouls)));

    const dbStats = statsResult.data ?? [];
    const payloadStats = Array.isArray(match?.live_payload?.stats_snapshot)
      ? match.live_payload.stats_snapshot
      : [];
    const stats = dbStats.length ? dbStats : payloadStats;

    const playerIds = [...new Set(stats.map((row) => Number(row.player_id)).filter((id) => Number.isFinite(id) && id > 0))];
    let players = [];
    if (playerIds.length) {
      try {
        const playersResult = await run(
          db.from('players').select('id, full_name, team_id').in('id', playerIds),
          'Dettaglio giocatori match'
        );
        players = playersResult.data ?? [];
      } catch (_error) {
        players = [];
      }
    }

    const playerById = new Map(
      players.map((player) => [
        Number(player.id),
        {
          full_name: player.full_name,
          team_id: Number(player.team_id),
        },
      ])
    );

    const byTeam = (teamId) =>
      stats
        .filter((row) => {
          const resolvedTeamId =
            Number(playerById.get(Number(row.player_id))?.team_id) ||
            Number(row.team_id ?? 0);
          return resolvedTeamId === Number(teamId);
        })
        .map((row) => {
          const fouls = Math.max(0, Number(row.fouls ?? 0));
          const yellowCards = Math.max(0, Number(row.yellow_cards ?? 0));
          const redCards = Math.max(0, Number(row.red_cards ?? 0));
          const foulDots = Array.from({ length: maxFouls })
            .map(
              (_, index) =>
                `<span class="match-foul-dot ${index < fouls ? 'active' : ''}" aria-hidden="true"></span>`
            )
            .join('');

          const playerLabel =
            playerById.get(Number(row.player_id))?.full_name ??
            row.player_name ??
            `Giocatore #${Number(row.player_id)}`;

          return `<div class="match-player-row">
          <span class="match-player-left">
            <span class="match-player-name">${escapeHtml(playerLabel)}</span>
            ${
              row.is_mvp_vote
                ? '<i class="fa-solid fa-star match-player-mvp" title="MVP"></i>'
                : ''
            }
            ${
              yellowCards > 0 || redCards > 0
                ? `<span class="match-card-pills">
                    <span class="match-card-pill yellow">Y ${yellowCards}</span>
                    <span class="match-card-pill red">R ${redCards}</span>
                  </span>`
                : ''
            }
          </span>
          <span class="match-player-fouls" title="Falli ${fouls}/${maxFouls}">
            ${foulDots}
          </span>
        </div>`;
        });

    content.innerHTML = `
      <div style="text-align:center;margin-bottom:16px;">
        <h2 style="margin:0;">${match.home_score ?? 0} - ${match.away_score ?? 0}</h2>
        <div class="muted">${escapeHtml(match.home?.name ?? 'TBD')} vs ${escapeHtml(
      match.away?.name ?? 'TBD'
    )}</div>
        <div class="muted" style="font-size:0.8rem;">Aggiornato: ${formatDateTime(match.updated_at)}</div>
      </div>
      <div class="inline-grid cols-2">
        <div>
          <div class="badge badge-info">${escapeHtml(match.home?.name ?? 'Casa')}</div>
          <div style="margin-top:8px;">${
            byTeam(match.home_team_id).join('') || '<div class="muted">Nessuna statistica.</div>'
          }</div>
        </div>
        <div>
          <div class="badge badge-warning">${escapeHtml(match.away?.name ?? 'Ospite')}</div>
          <div style="margin-top:8px;">${
            byTeam(match.away_team_id).join('') || '<div class="muted">Nessuna statistica.</div>'
          }</div>
        </div>
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function loadTournamentData() {
  const sportId = Number(getSportSelect()?.value || 0);
  state.selectedSportId = sportId || null;

  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }

  const athleticsCard = document.getElementById('athletics-card');
  const standingsCard = document.getElementById('standings-card');
  const matchesCard = document.getElementById('matches-card');

  if (!sportId) {
    resetPublicTournamentUi();
    document.getElementById('standings-container').innerHTML =
      '<div class="empty-state">Seleziona un torneo.</div>';
    document.getElementById('matches-container').innerHTML =
      '<div class="empty-state">In attesa di selezione torneo.</div>';
    setHidden(athleticsCard, true);
    setHidden(standingsCard, false);
    setHidden(matchesCard, false);
    return;
  }

  const [sport, teams, matches, config] = await Promise.all([
    loadSportById(sportId),
    loadTeamsBySport(sportId),
    loadMatchesBySport(sportId, { includeUnfinished: true }),
    loadSportConfig(sportId),
  ]);

  state.selectedSport = sport;
  updatePublicTournamentUi(sport);

  const isAthletics = sport?.sport_type === 'atletica';
  const isKnockout = sport?.format === 'eliminazione';
  setHidden(athleticsCard, !isAthletics);
  setHidden(standingsCard, isAthletics);
  setHidden(matchesCard, isAthletics);

  if (isAthletics) {
    await renderAthletics(sportId);
  } else if (isKnockout) {
    renderKnockoutOverview(matches);
    renderPlayedMatches(matches, 'Nessun risultato disponibile nel tabellone.');
  } else {
    const standings = computeStandings(teams, matches, config);
    renderStandingsTable(standings);
    renderPlayedMatches(matches);
  }

  state.unsubscribe = subscribeTable({
    channelName: `public-sport-${sportId}`,
    table: isAthletics ? 'event_results' : 'matches',
    event: '*',
    onChange: () => {
      loadTournamentData().catch((error) => showToast(error.message, 'error'));
    },
  });
}

function bindLogin() {
  document.getElementById('admin-access-btn')?.addEventListener('click', () => {
    openModal('modal-login');
  });

  document.getElementById('login-cancel-btn')?.addEventListener('click', () => {
    closeModal('modal-login');
  });

  document.getElementById('login-cancel-btn-2')?.addEventListener('click', () => {
    closeModal('modal-login');
  });

  document.getElementById('login-submit-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('login-email')?.value?.trim();
    const password = document.getElementById('login-pass')?.value;

    if (!email || !password) {
      showToast('Inserisci email e password.', 'error');
      return;
    }

    try {
      await signInAdmin(email, password);
      window.location.href = 'admin.html';
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

async function init() {
  bindLogin();

  const sports = await loadSports();
  renderSports(sports);

  getSportSelect()?.addEventListener('change', () => {
    loadTournamentData().catch((error) => showToast(error.message, 'error'));
  });

  document.getElementById('match-details-close-btn')?.addEventListener('click', () => {
    closeModal('match-details-modal');
  });

  document.getElementById('match-details-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'match-details-modal') {
      closeModal('match-details-modal');
    }
  });

  await loadTournamentData();
}

init().catch((error) => {
  showToast(error.message, 'error');
});
