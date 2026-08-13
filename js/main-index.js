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
import { loadHonorRoll } from './archive.js';
import { formatScheduleRange, loadVenueScheduleBySlug } from './schedule.js';
import {
  escapeHtml,
  formatDateTime,
  medalByRank,
  setHidden,
  showToast,
} from './utils.js';
import { buildKnockoutBracket, renderKnockoutBracketHtml } from './knockout-bracket.js';

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
  venueSlug: null,
  venue: null,
  teamIdFromQuery: null,
  audienceFromQuery: 'student',
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
      matchesTitle.innerHTML = '<i class="fa-solid fa-calendar-check"></i> Match Tabellone';
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

function renderHonorRollSportOptions(sports) {
  const select = document.getElementById('honor-roll-sport-select');
  if (!select) return;

  select.innerHTML = [
    '<option value="">-- Seleziona torneo --</option>',
    ...sports.map((sport) => `<option value="${sport.id}">${escapeHtml(sport.name)}</option>`),
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
  const rows = [...(matches ?? [])];

  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">Nessun match presente nel tabellone.</div>';
    return;
  }

  const finishedCount = rows.filter((match) => Boolean(match.is_finished)).length;
  const roundsCount = new Set(rows.map((match) => String(match.round_name ?? '-'))).size;

  // Bracket
  const rounds = buildKnockoutBracket({ matches: rows });
  const bracketHtml = renderKnockoutBracketHtml({ rounds });

  container.innerHTML = `
    <div class="kb-stats-bar">
      <span class="kb-stat-badge kb-stat-rounds"><i class="fa-solid fa-sitemap"></i> ${roundsCount} turni</span>
      <span class="kb-stat-badge kb-stat-done"><i class="fa-solid fa-check-circle"></i> ${finishedCount} conclusi</span>
      <span class="kb-stat-badge kb-stat-pending"><i class="fa-solid fa-clock"></i> ${rows.length - finishedCount} da giocare</span>
    </div>
    <div class="kb-bracket-scroll-wrap">
      ${bracketHtml}
    </div>
  `;
}

function renderPlayedMatches(matches, emptyMessage = 'Nessuna partita giocata.') {
  const container = document.getElementById('matches-container');
  const rows = (matches ?? []).filter(
    (match) => Boolean(match.is_finished) || Boolean(match.scheduled_start) || match.status === 'live'
  );

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = rows
    .map(
      (match) => {
        const isFinished = Boolean(match.is_finished);
        const isLive = match.status === 'live';
        const status = isFinished ? 'Finale' : isLive ? 'Live' : 'Programmata';
        const score = isFinished || isLive ? `${match.home_score ?? 0} - ${match.away_score ?? 0}` : '- -';
        return `
      <button class="match-item" data-match-id="${match.id}">
        <div class="team-label text-right">${escapeHtml(match.home?.name ?? 'TBD')}</div>
        <div class="match-public-center">
          <div class="score-badge">${score}</div>
          <div class="match-public-meta">${escapeHtml(status)} · ${escapeHtml(formatScheduleRange(match))} · ${escapeHtml(match.venue?.name ?? 'Campo da definire')}</div>
        </div>
        <div class="team-label">${escapeHtml(match.away?.name ?? 'TBD')}</div>
      </button>
    `;
      }
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

function getVenueSlugFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('venue') ?? '').trim();
}

function getSportIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return Number(params.get('sport') || 0);
}

function getTeamIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return Number(params.get('team') || 0) || null;
}

function getAudienceFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const audience = String(params.get('audience') ?? 'student').trim().toLowerCase();
  return ['student', 'captain', 'all'].includes(audience) ? audience : 'student';
}

function getCurrentOrNextVenueMatch(matches) {
  const now = Date.now();
  const rows = (matches ?? []).filter((match) => match.status !== 'cancelled');
  const current = rows.find((match) => {
    const start = match.scheduled_start ? new Date(match.scheduled_start).getTime() : NaN;
    const end = match.scheduled_end ? new Date(match.scheduled_end).getTime() : NaN;
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
  });
  if (current) return current;

  return rows.find((match) => {
    const start = match.scheduled_start ? new Date(match.scheduled_start).getTime() : NaN;
    return Number.isFinite(start) && start >= now;
  }) ?? rows[0] ?? null;
}

async function renderVenueRoute() {
  const card = document.getElementById('venue-live-card');
  const content = document.getElementById('venue-live-content');
  if (!state.venueSlug) {
    setHidden(card, true);
    return;
  }

  setHidden(card, false);
  content.innerHTML = '<div class="empty-state">Caricamento campo...</div>';
  const { venue, matches } = await loadVenueScheduleBySlug(state.venueSlug);
  state.venue = venue;

  if (!venue) {
    content.innerHTML = '<div class="empty-state">Campo non trovato.</div>';
    return;
  }

  const selected = getCurrentOrNextVenueMatch(matches);
  if (!selected) {
    content.innerHTML = `
      <div class="venue-now">
        <h2>${escapeHtml(venue.name)}</h2>
        <div class="empty-state">Nessun match programmato per questo campo.</div>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="venue-now">
      <div>
        <div class="badge badge-info">${selected.status === 'live' ? 'Live' : Boolean(selected.is_finished) ? 'Concluso' : 'Prossimo match'}</div>
        <h2>${escapeHtml(selected.home?.name ?? 'TBD')} vs ${escapeHtml(selected.away?.name ?? 'TBD')}</h2>
        <p class="muted">${escapeHtml(selected.sport?.name ?? '-')} · ${escapeHtml(selected.round_name ?? '-')}</p>
      </div>
      <div class="venue-now-side">
        <strong>${escapeHtml(venue.name)}</strong>
        <span>${escapeHtml(formatScheduleRange(selected))}</span>
      </div>
    </div>
  `;

  if (selected.sport_id) {
    const select = getSportSelect();
    if (select) {
      select.value = String(selected.sport_id);
    }
  }
}

async function renderHonorRoll(sportId = null) {
  const container = document.getElementById('honor-roll-modal-content');
  if (!container) return;

  if (!sportId) {
    container.innerHTML = "<div class=\"empty-state\">Seleziona un torneo per consultare l'Albo d'Oro.</div>";
    return;
  }

  const rows = await loadHonorRoll({ sportId });
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">Nessuna edizione archiviata per questo torneo.</div>';
    return;
  }

  container.innerHTML = `
    <div class="honor-grid">
      ${rows
        .map(
          (entry) => `
        <article class="honor-card">
          <div class="honor-year">${escapeHtml(entry.edition_year ?? new Date(entry.archived_at ?? Date.now()).getFullYear())}</div>
          <h3>${escapeHtml(entry.sport_name)}</h3>
          <div class="muted">${escapeHtml(entry.year)}° anno</div>
          <div class="honor-winner">${escapeHtml(entry.winner_team_name)}</div>
          <div class="muted">${escapeHtml([entry.runner_up_team_name, entry.third_place_team_name].filter(Boolean).join(' - ') || 'Podio non disponibile')}</div>
        </article>
      `
        )
        .join('')}
    </div>
  `;
}

function bindHonorRollModal() {
  document.getElementById('public-archive-btn')?.addEventListener('click', () => {
    const select = document.getElementById('honor-roll-sport-select');
    const currentSportId = Number(getSportSelect()?.value || 0);
    if (select && currentSportId) {
      select.value = String(currentSportId);
      renderHonorRoll(currentSportId).catch((error) => showToast(error.message, 'error'));
    } else {
      renderHonorRoll(null).catch((error) => showToast(error.message, 'error'));
    }
    openModal('modal-honor-roll');
  });

  document.getElementById('honor-roll-close-btn')?.addEventListener('click', () => {
    closeModal('modal-honor-roll');
  });

  document.getElementById('modal-honor-roll')?.addEventListener('click', (event) => {
    if (event.target.id === 'modal-honor-roll') {
      closeModal('modal-honor-roll');
    }
  });

  document.getElementById('honor-roll-sport-select')?.addEventListener('change', (event) => {
    renderHonorRoll(Number(event.target.value || 0) || null).catch((error) => showToast(error.message, 'error'));
  });
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
          .select('*, sport:sports(sport_type), home:teams!home_team_id(name), away:teams!away_team_id(name), venue:venues(name, slug)')
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
    const isSoccer = String(match?.sport?.sport_type ?? '').toLowerCase() === 'calcio';
    const showFouls = !isSoccer;
    const showCards = isSoccer;

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
              showCards
                ? `<span class="match-card-pills">
                    <span class="match-card-pill yellow">Y ${yellowCards}</span>
                    <span class="match-card-pill red">R ${redCards}</span>
                  </span>`
                : ''
            }
          </span>
          ${
            showFouls
              ? `<span class="match-player-fouls" title="Falli ${fouls}/${maxFouls}">
                  ${foulDots}
                </span>`
              : ''
          }
        </div>`;
        });

    content.innerHTML = `
      <div class="match-details-summary">
        <h2 class="match-details-score">${match.home_score ?? 0} - ${match.away_score ?? 0}</h2>
        <div class="muted">${escapeHtml(match.home?.name ?? 'TBD')} vs ${escapeHtml(
      match.away?.name ?? 'TBD'
    )}</div>
        <div class="muted">${escapeHtml(formatScheduleRange(match))} · ${escapeHtml(match.venue?.name ?? 'Campo da definire')}</div>
        <div class="match-details-updated muted">Aggiornato: ${formatDateTime(match.updated_at)}</div>
      </div>
      <div class="match-details-stats-grid">
        <section class="match-details-team-panel">
          <div class="badge badge-info">${escapeHtml(match.home?.name ?? 'Casa')}</div>
          <div class="match-details-player-list">${
            byTeam(match.home_team_id).join('') || '<div class="muted match-details-empty">Nessuna statistica.</div>'
          }</div>
        </section>
        <section class="match-details-team-panel">
          <div class="badge badge-warning">${escapeHtml(match.away?.name ?? 'Ospite')}</div>
          <div class="match-details-player-list">${
            byTeam(match.away_team_id).join('') || '<div class="muted match-details-empty">Nessuna statistica.</div>'
          }</div>
        </section>
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

    // Click match boxes in the SVG bracket (if present)
    setTimeout(() => {
      document.querySelectorAll('.kb-bracket-google [data-match-id]').forEach((el) => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          openMatchDetails(el.getAttribute('data-match-id'));
        });
      });
    }, 0);

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
  state.venueSlug = getVenueSlugFromQuery();
  state.teamIdFromQuery = getTeamIdFromQuery();
  state.audienceFromQuery = getAudienceFromQuery();
  bindLogin();
  bindHonorRollModal();

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

  let sports = [];
  try {
    sports = await loadSports();
  } catch (error) {
    renderSports([]);
    renderHonorRollSportOptions([]);
    showToast(error.message, 'error');
    return;
  }

  renderSports(sports);
  renderHonorRollSportOptions(sports);
  const initialSportId = getSportIdFromQuery();
  if (initialSportId) {
    getSportSelect().value = String(initialSportId);
    state.selectedSportId = initialSportId;
  }

  await renderVenueRoute();
  await loadTournamentData();
}

init().catch((error) => {
  showToast(error.message, 'error');
});
