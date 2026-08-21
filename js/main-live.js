import { APP_CONFIG } from './app-config.js';
import { canEditMatches, requireAdmin } from './auth.js';
import { db, run } from './db.js';
import {
  commitLiveUpdate,
  finalizeLiveMatch,
  loadLiveMatch,
  refreshLiveLock,
  releaseLiveSession,
  startLiveSession,
  subscribeLiveMatch,
} from './live.js';
import { loadMatchStaff, saveMatchStaff } from './matches.js';
import { registerOfflineSupport } from './offline.js';
import { registerClientErrorLogger } from './error-logger.js';
import {
  loadLiveMatchCacheAsync,
  markQueuedLiveOperationsForMatch,
  queueLiveSnapshotOperation,
  saveLiveMatchCacheAsync,
} from './offline-store.js';
import { getDeviceInfo, promptDeviceLabel } from './device.js';
import { createLiveMatchEvent, loadLiveMatchEvents } from './platform-ops.js';
import { startTourIfNeeded } from './onboarding.js';
import { debounce, escapeHtml, formatDuration, getEl, showAppConfirm, showToast } from './utils.js';

const state = {
  user: null,
  admin: null,
  matchId: null,
  match: null,
  config: null,
  homePlayers: [],
  awayPlayers: [],
  playerState: new Map(),
  homeScore: 0,
  awayScore: 0,
  timeouts: { home: 0, away: 0 },
  quarter: 1,
  duration: 0,
  timerInterval: null,
  lockRefreshInterval: null,
  lockVersion: 0,
  hasLock: false,
  editable: false,
  unsubscribe: null,
  offlineMode: false,
  pendingConflict: null,
  signatures: {
    home: null,
    away: null,
  },
  eventLog: [],
  signaturePadsBound: false,
  emergencyNoticeShown: false,
};

registerOfflineSupport();
registerClientErrorLogger('live');

const autosaveRemoteSnapshot = debounce(() => {
  saveSnapshot().catch((error) => showToast(error.message, 'error'));
}, APP_CONFIG.liveAutosaveDebounceMs);

function autosaveSnapshot() {
  saveEmergencyDraft();
  autosaveRemoteSnapshot();
}

function getMatchIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return Number(params.get('match') || 0);
}

function openModal(id) {
  getEl(id)?.classList.add('open');
}

function closeModal(id) {
  getEl(id)?.classList.remove('open');
}

function setSyncStatus(status, message) {
  const target = getEl('live-sync-status');
  if (!target) return;
  const icons = {
    online: 'fa-cloud',
    local: 'fa-mobile-screen',
    pending: 'fa-cloud-arrow-up',
    conflict: 'fa-triangle-exclamation',
    offline: 'fa-wifi',
  };
  target.className = `sync-status ${status}`;
  target.innerHTML = `<i class="fa-solid ${icons[status] ?? 'fa-cloud'}"></i> ${escapeHtml(message)}`;
}

function setEditable(enabled) {
  state.editable = enabled;
  document.querySelectorAll('[data-requires-edit]').forEach((el) => {
    el.disabled = !enabled;
    el.classList.toggle('hidden', !enabled && el.dataset.hideWhenReadonly === 'true');
  });

  // Rerender rosters so checkbox/star/foul buttons reflect current editable state.
  if (state.match) {
    renderHeader();
    renderRosters();
    renderLiveEvents();
  }

  const lockStatus = getEl('live-lock-status');
  if (!lockStatus) return;

  if (enabled) {
    lockStatus.className = 'lock-banner editable';
    lockStatus.textContent = 'Sessione editabile: lock acquisito.';
  } else {
    lockStatus.className = 'lock-banner locked';
    lockStatus.textContent = 'Solo lettura: lock attivo su un altro admin.';
  }
}

function ensurePlayer(playerId) {
  if (!state.playerState.has(playerId)) {
    state.playerState.set(playerId, {
      player_id: playerId,
      played: false,
      fouls: 0,
      is_mvp_vote: false,
      points_scored: 0,
      yellow_cards: 0,
      red_cards: 0,
    });
  }
  return state.playerState.get(playerId);
}

function getSportType() {
  return String(state.match?.sport?.sport_type ?? '').trim().toLowerCase();
}

function isBasketMatch() {
  return getSportType() === 'basket';
}

function isVolleyMatch() {
  return getSportType() === 'pallavolo';
}

function isSoccerMatch() {
  return getSportType() === 'calcio';
}

function getMaxFouls() {
  return Math.max(1, Number(state.config?.max_fouls ?? 3));
}

function getMaxYellowCards() {
  return Math.max(1, Number(state.config?.max_yellow_cards ?? 2));
}

function getMaxRedCards() {
  return Math.max(1, Number(state.config?.max_red_cards ?? 1));
}

function isPlayerExpelled(entry) {
  const fouls = Number(entry?.fouls ?? 0);
  const yellowCards = Number(entry?.yellow_cards ?? 0);
  const redCards = Number(entry?.red_cards ?? 0);
  if (isSoccerMatch()) {
    return redCards >= getMaxRedCards() || yellowCards >= getMaxYellowCards();
  }
  return fouls >= getMaxFouls();
}

function getTimeoutLimit() {
  return Math.max(0, Number(state.config?.timeouts_per_team ?? 2));
}

function getCaptain(side) {
  const players = side === 'home' ? state.homePlayers : state.awayPlayers;
  return players.find((player) => Boolean(player.is_captain)) ?? null;
}

function getScheduleLabel() {
  const start = state.match?.scheduled_start ? new Date(state.match.scheduled_start) : null;
  if (!start || Number.isNaN(start.getTime())) return 'Orario da definire';

  const startLabel = new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(start);
  const end = state.match?.scheduled_end ? new Date(state.match.scheduled_end) : null;
  if (!end || Number.isNaN(end.getTime())) return startLabel;

  const endLabel = new Intl.DateTimeFormat('it-IT', {
    timeStyle: 'short',
  }).format(end);
  return `${startLabel} - ${endLabel}`;
}

function renderHeader() {
  getEl('live-home-name').textContent = state.match.home?.name ?? 'Casa';
  getEl('live-away-name').textContent = state.match.away?.name ?? 'Ospite';
  getEl('live-home-score').textContent = String(state.homeScore);
  getEl('live-away-score').textContent = String(state.awayScore);
  getEl('live-timer').textContent = formatDuration(state.duration);
  getEl('live-quarter').textContent = `Q${state.quarter}`;
  getEl('live-match-title').textContent = `${state.match.home?.name ?? 'Casa'} vs ${state.match.away?.name ?? 'Ospite'}`;
  getEl('live-match-meta').textContent = `${state.match.round_name ?? '-'} · ${state.match.sport?.name ?? '-'} · ${state.match.venue?.name ?? 'Campo da definire'} · ${getScheduleLabel()}`;
  const timeoutLimit = getTimeoutLimit();
  getEl('timeout-home-count').textContent = String(state.timeouts.home);
  getEl('timeout-away-count').textContent = String(state.timeouts.away);
  getEl('timeout-limit-label').textContent = `Limite timeout per squadra: ${timeoutLimit}`;
  const disableTimeoutHome = !state.editable || timeoutLimit <= 0 || Number(state.timeouts.home) >= timeoutLimit;
  const disableTimeoutAway = !state.editable || timeoutLimit <= 0 || Number(state.timeouts.away) >= timeoutLimit;
  const homeBtn = getEl('btn-timeout-home');
  const awayBtn = getEl('btn-timeout-away');
  if (homeBtn) homeBtn.disabled = disableTimeoutHome;
  if (awayBtn) awayBtn.disabled = disableTimeoutAway;
}

function openEmergencyPaperReport() {
  if (!state.match) {
    showToast('Match non caricato.', 'error');
    return;
  }

  const reportWindow = window.open('', '_blank');
  if (!reportWindow) {
    throw new Error('Popup bloccato dal browser. Consenti i popup per stampare il referto di emergenza.');
  }

  const renderRoster = (title, players) => `
    <section class="roster-panel">
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead><tr><th>Pres.</th><th>Studente</th><th>Falli</th><th>Gialli</th><th>Rossi</th><th>Punti/Reti</th><th>MVP</th></tr></thead>
        <tbody>
          ${players.map((player) => `<tr><td></td><td>${escapeHtml(player.full_name)}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')}
        </tbody>
      </table>
    </section>
  `;

  reportWindow.document.open();
  reportWindow.document.write(`
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="UTF-8" />
        <title>Referto emergenza</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, sans-serif; color: #0f172a; font-size: 11px; }
          .paper { display: grid; gap: 12px; }
          header { display: flex; justify-content: space-between; gap: 18px; border-bottom: 2px solid #0f172a; padding-bottom: 10px; break-inside: avoid; }
          h1 { margin: 0; font-size: 24px; line-height: 1.08; }
          h2 { margin: 0 0 6px; font-size: 13px; }
          .kicker { margin-top: 4px; color: #475569; font-weight: 700; }
          .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; break-inside: avoid; }
          .box { border: 1px solid #94a3b8; border-radius: 6px; min-height: 40px; padding: 7px; font-size: 10px; }
          .score { min-width: 108px; border: 2px solid #0f172a; display: grid; place-items: center; font-size: 28px; font-weight: 800; }
          .rosters-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          th, td { border: 1px solid #94a3b8; padding: 5px 6px; height: 24px; line-height: 1.2; }
          th { background: #f1f5f9; text-transform: uppercase; font-size: 8.5px; }
          th:not(:nth-child(2)), td:not(:nth-child(2)) { text-align: center; }
          .event-log td { height: 26px; }
          .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px 12px; break-inside: avoid; }
          .signature { border-top: 1px solid #0f172a; padding-top: 7px; font-size: 10px; min-height: 48px; }
          @media print {
            body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <main class="paper">
          <header>
            <div>
              <h1>${escapeHtml(state.match.home?.name ?? 'Casa')} vs ${escapeHtml(state.match.away?.name ?? 'Ospite')}</h1>
              <div class="kicker">${escapeHtml(state.match.sport?.name ?? '-')} · ${escapeHtml(state.match.round_name ?? '-')} · Referto emergenza</div>
            </div>
            <div class="score">____ - ____</div>
          </header>
          <section class="meta">
            <div class="box"><strong>Campo</strong><br>${escapeHtml(state.match.venue?.name ?? 'Da definire')}</div>
            <div class="box"><strong>Orario</strong><br>${escapeHtml(getScheduleLabel())}</div>
            <div class="box"><strong>Arbitro</strong><br>&nbsp;</div>
            <div class="box"><strong>Segnapunti</strong><br>&nbsp;</div>
            <div class="box"><strong>Responsabile campo</strong><br>&nbsp;</div>
            <div class="box"><strong>Docente supervisore</strong><br>&nbsp;</div>
          </section>
          <section class="rosters-grid">
            ${renderRoster(state.match.home?.name ?? 'Casa', state.homePlayers)}
            ${renderRoster(state.match.away?.name ?? 'Ospite', state.awayPlayers)}
          </section>
          <section>
            <h2>Cronologia evento opzionale</h2>
            <table class="event-log">
              <thead><tr><th>Minuto</th><th>Squadra</th><th>Studente</th><th>Evento</th><th>Parziale</th><th>Note</th></tr></thead>
              <tbody>${Array.from({ length: 8 }).map(() => '<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('')}</tbody>
            </table>
          </section>
          <section class="signatures">
            <div class="signature">Arbitro</div>
            <div class="signature">Segnapunti</div>
            <div class="signature">Responsabile campo</div>
            <div class="signature">Docente supervisore</div>
            <div class="signature">Capitano casa</div>
            <div class="signature">Capitano ospite</div>
          </section>
        </main>
      </body>
    </html>
  `);
  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(() => reportWindow.print(), 250);
}

function renderRosterTable(tableId, players) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
  const useFouls = !isSoccerMatch();
  const useCards = isSoccerMatch();

  tbody.innerHTML = players
    .map((player) => {
      const rowState = ensurePlayer(player.id);
      const foulClass = rowState.fouls >= getMaxFouls() ? 'foul-pill max' : 'foul-pill';
      const mvpEnabled = Boolean(state.config?.allow_mvp ?? true);
      const allowYellow = Boolean(state.config?.allow_yellow_cards);
      const allowRed = Boolean(state.config?.allow_red_cards);
      const maxYellowCards = getMaxYellowCards();
      const maxRedCards = getMaxRedCards();
      const mvpActive = rowState.is_mvp_vote && mvpEnabled ? 'mvp-star active' : 'mvp-star';
      const expelled = isPlayerExpelled(rowState);
      const mvpDisabled = !state.editable || !mvpEnabled || expelled;
      const playedDisabled = !state.editable || expelled;
      const foulDisabled = !state.editable || expelled || rowState.fouls >= getMaxFouls();
      const yellowDisabled = !state.editable || expelled || !allowYellow || Number(rowState.yellow_cards ?? 0) >= maxYellowCards;
      const redDisabled = !state.editable || expelled || !allowRed || Number(rowState.red_cards ?? 0) >= maxRedCards;

      return `
      <tr data-player-id="${player.id}" class="${expelled ? 'live-player-expelled' : ''}">
        <td class="text-center"><input type="checkbox" data-action="toggle-played" ${rowState.played ? 'checked' : ''} ${playedDisabled ? 'disabled' : ''}></td>
        <td><strong>${escapeHtml(player.full_name)}</strong>${player.is_captain ? ' <span class="badge badge-warning">Capitano</span>' : ''}</td>
        <td class="text-center ${useFouls ? '' : 'hidden'}" data-col="fouls"><span class="${foulClass}" id="foul-${player.id}">${rowState.fouls}</span></td>
        <td class="text-center"><button class="${mvpActive}" data-action="toggle-mvp" title="${mvpEnabled ? 'Vota MVP' : 'MVP disabilitato nelle impostazioni torneo'}" ${mvpDisabled ? 'disabled' : ''}><i class="fa-solid fa-star"></i></button></td>
        <td class="text-center ${useCards ? '' : 'hidden'}" data-col="cards">
          <div class="live-player-cards">
            <span class="card-pill yellow">Y ${rowState.yellow_cards}/${maxYellowCards}</span>
            <span class="card-pill red">R ${rowState.red_cards}/${maxRedCards}</span>
          </div>
        </td>
        <td class="text-center">
          <div class="live-row-actions">
            ${useFouls ? `<button class="btn btn-ghost btn-compact" data-action="add-foul" ${foulDisabled ? 'disabled' : ''}>+F</button>` : ''}
            ${useCards && allowYellow ? `<button class="btn btn-ghost btn-compact" data-action="add-yellow" ${yellowDisabled ? 'disabled' : ''}>+Y</button>` : ''}
            ${useCards && allowRed ? `<button class="btn btn-ghost btn-compact" data-action="add-red" ${redDisabled ? 'disabled' : ''}>+R</button>` : ''}
          </div>
        </td>
      </tr>
      `;
    })
    .join('');
}

function renderRosters() {
  renderRosterTable('table-live-home', state.homePlayers);
  renderRosterTable('table-live-away', state.awayPlayers);
}

function isAdvancedLiveEventsEnabled() {
  return Boolean(state.config?.advanced_live_events_enabled);
}

function getPlayerById(playerId) {
  return [...state.homePlayers, ...state.awayPlayers].find((player) => Number(player.id) === Number(playerId)) ?? null;
}

function renderLiveEventControls() {
  const enabled = isAdvancedLiveEventsEnabled();
  getEl('live-events-card')?.classList.toggle('hidden', !enabled);
  if (!enabled) return;

  const teamSelect = getEl('live-event-team');
  const playerSelect = getEl('live-event-player');
  if (!teamSelect || !playerSelect) return;

  const selectedTeamId = Number(teamSelect.value || state.match?.home_team_id || 0);
  teamSelect.innerHTML = [
    `<option value="${state.match.home_team_id}">${escapeHtml(state.match.home?.name ?? 'Casa')}</option>`,
    `<option value="${state.match.away_team_id}">${escapeHtml(state.match.away?.name ?? 'Ospite')}</option>`,
  ].join('');
  teamSelect.value = String(selectedTeamId || state.match.home_team_id);

  const players = Number(teamSelect.value) === Number(state.match.away_team_id)
    ? state.awayPlayers
    : state.homePlayers;
  playerSelect.innerHTML =
    '<option value="">-- Nessuno --</option>' +
    players.map((player) => `<option value="${player.id}">${escapeHtml(player.full_name)}</option>`).join('');
}

function formatLiveEventType(type) {
  const labels = {
    score: 'Punto/Rete',
    substitution: 'Sostituzione',
    foul: 'Fallo',
    yellow_card: 'Giallo',
    red_card: 'Rosso',
    timeout: 'Timeout',
    note: 'Nota',
  };
  return labels[type] ?? type;
}

function getTeamNameById(teamId) {
  if (Number(teamId) === Number(state.match?.home_team_id)) return state.match?.home?.name ?? 'Casa';
  if (Number(teamId) === Number(state.match?.away_team_id)) return state.match?.away?.name ?? 'Ospite';
  return null;
}

function normalizePersistedLiveEvent(event) {
  const player = getPlayerById(event.player_id);
  return {
    event_type: event.event_type,
    team_id: event.team_id,
    team_name: getTeamNameById(event.team_id),
    player_id: event.player_id,
    player_name: player?.full_name ?? null,
    minute: event.minute,
    home_score: event.home_score,
    away_score: event.away_score,
    notes: event.notes,
    created_at: event.created_at,
  };
}

async function hydratePersistedLiveEvents() {
  if (!isAdvancedLiveEventsEnabled() || state.offlineMode) return;
  try {
    const rows = await loadLiveMatchEvents(state.matchId);
    if (rows.length) {
      state.eventLog = rows.map(normalizePersistedLiveEvent);
    }
  } catch (_error) {
    // The payload event log remains available if the optional table is unreachable.
  }
}

function renderLiveEvents() {
  renderLiveEventControls();
  const tbody = document.querySelector('#table-live-events tbody');
  if (!tbody) return;

  tbody.innerHTML = state.eventLog.length
    ? state.eventLog
        .slice()
        .reverse()
        .map((event) => {
          const player = getPlayerById(event.player_id);
          return `
            <tr>
              <td>${event.minute ?? '-'}</td>
              <td>${escapeHtml(event.team_name ?? '-')}</td>
              <td>${escapeHtml(player?.full_name ?? event.player_name ?? '-')}</td>
              <td>${escapeHtml(formatLiveEventType(event.event_type))}</td>
              <td>${event.home_score ?? state.homeScore} - ${event.away_score ?? state.awayScore}</td>
              <td>${escapeHtml(event.notes ?? '')}</td>
            </tr>
          `;
        })
        .join('')
    : '<tr><td colspan="6" class="empty-state">Nessun evento registrato.</td></tr>';
}

async function addLiveEventFromForm() {
  if (!state.editable || !isAdvancedLiveEventsEnabled()) return;
  const teamId = Number(getEl('live-event-team')?.value || 0) || null;
  const playerId = Number(getEl('live-event-player')?.value || 0) || null;
  const teamName =
    teamId === Number(state.match.home_team_id)
      ? state.match.home?.name ?? 'Casa'
      : teamId === Number(state.match.away_team_id)
        ? state.match.away?.name ?? 'Ospite'
        : null;
  const player = getPlayerById(playerId);
  const minuteValue = Number(getEl('live-event-minute')?.value || 0);

  const eventPayload = {
    event_type: getEl('live-event-type')?.value ?? 'note',
    team_id: teamId,
    team_name: teamName,
    player_id: playerId,
    player_name: player?.full_name ?? null,
    minute: Number.isFinite(minuteValue) ? minuteValue : null,
    home_score: state.homeScore,
    away_score: state.awayScore,
    notes: getEl('live-event-notes')?.value ?? '',
    created_at: new Date().toISOString(),
  };

  state.eventLog.push(eventPayload);
  if (!state.offlineMode && navigator.onLine) {
    createLiveMatchEvent({
      matchId: state.matchId,
      eventType: eventPayload.event_type,
      teamId,
      playerId,
      minute: eventPayload.minute,
      homeScore: state.homeScore,
      awayScore: state.awayScore,
      notes: eventPayload.notes,
    }).catch(() => undefined);
  }

  getEl('live-event-notes').value = '';
  renderLiveEvents();
  autosaveSnapshot();
}

function applySportSpecificControls() {
  const isBasket = isBasketMatch();
  const isVolley = isVolleyMatch();
  const isSoccer = isSoccerMatch();

  const quarterVisible = isBasket;
  getEl('live-quarter')?.classList.toggle('hidden', !quarterVisible);
  getEl('quarter-controls')?.classList.toggle('hidden', !quarterVisible);
  getEl('timeouts-controls')?.classList.toggle('hidden', !isBasket);
  getEl('timeout-limit-label')?.classList.toggle('hidden', !isBasket);

  document.querySelectorAll('[data-score-delta="2"], [data-score-delta="3"]').forEach((btn) => {
    btn.classList.toggle('hidden', !isBasket);
  });
  document.querySelectorAll('[data-score-delta="-1"]').forEach((btn) => {
    btn.classList.toggle('hidden', false);
  });

  if (isVolley) {
    getEl('live-match-meta').textContent = `${state.match.round_name ?? '-'} · ${state.match.sport?.name ?? '-'} · ${state.match.venue?.name ?? 'Campo da definire'} · Set`;
  } else if (isSoccer) {
    getEl('live-match-meta').textContent = `${state.match.round_name ?? '-'} · ${state.match.sport?.name ?? '-'} · ${state.match.venue?.name ?? 'Campo da definire'} · Goal`;
  }

  const showFouls = !isSoccer;
  const showCards = isSoccer;
  document.querySelectorAll('[data-col="fouls"]').forEach((el) => el.classList.toggle('hidden', !showFouls));
  document.querySelectorAll('[data-col="cards"]').forEach((el) => el.classList.toggle('hidden', !showCards));

  const isFinished = Boolean(state.match?.is_finished);
  if (isFinished) {
    setEditable(false);
    getEl('live-lock-status').className = 'lock-banner locked';
    getEl('live-lock-status').textContent = 'Match già finalizzato: modalità sola lettura.';
  }
  renderLiveEvents();
}
function buildLivePayload() {
  return {
    home_score: state.homeScore,
    away_score: state.awayScore,
    timeouts: {
      home: Number(state.timeouts.home ?? 0),
      away: Number(state.timeouts.away ?? 0),
    },
    duration: state.duration,
    quarter: state.quarter,
    stats_snapshot: buildStatsPayload(),
    event_log: state.eventLog,
    device: getDeviceInfo(),
    updated_at: new Date().toISOString(),
  };
}

function getEmergencyDraftKey() {
  return `tornei_live_emergency_${state.matchId}`;
}

function saveEmergencyDraft(payload = buildLivePayload()) {
  if (!state.matchId || !state.match || state.match.is_finished) return;
  try {
    localStorage.setItem(
      getEmergencyDraftKey(),
      JSON.stringify({
        match_id: state.matchId,
        lock_version: state.lockVersion,
        saved_at: new Date().toISOString(),
        match_snapshot: state.match,
        config_snapshot: state.config,
        home_players: state.homePlayers,
        away_players: state.awayPlayers,
        payload,
      })
    );
  } catch (_error) {
    // Local storage can be disabled by the browser; remote autosave remains active.
  }
  if (!navigator.onLine || state.offlineMode) {
    setSyncStatus('local', 'Bozza salvata su questo dispositivo');
  }
}

function loadEmergencyDraft() {
  try {
    const raw = localStorage.getItem(getEmergencyDraftKey());
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function clearEmergencyDraft() {
  try {
    localStorage.removeItem(getEmergencyDraftKey());
  } catch (_error) {
    // Ignore local cleanup failures.
  }
}

function isNetworkLikeError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return !navigator.onLine || /failed to fetch|networkerror|load failed|non raggiungibile|fetch failed/.test(message);
}

function applyEmergencyDraft(draft) {
  const payload = draft?.payload ?? {};
  state.homeScore = Number(payload.home_score ?? state.homeScore);
  state.awayScore = Number(payload.away_score ?? state.awayScore);
  state.timeouts = {
    home: Number(payload?.timeouts?.home ?? state.timeouts.home ?? 0),
    away: Number(payload?.timeouts?.away ?? state.timeouts.away ?? 0),
  };
  state.duration = Number(payload.duration ?? state.duration);
  state.quarter = Number(payload.quarter ?? state.quarter);
  state.eventLog = Array.isArray(payload?.event_log) ? payload.event_log : state.eventLog;

  const snapshotStats = Array.isArray(payload?.stats_snapshot) ? payload.stats_snapshot : [];
  snapshotStats.forEach((entry) => {
    state.playerState.set(Number(entry.player_id), {
      player_id: Number(entry.player_id),
      played: Boolean(entry.played),
      fouls: Number(entry.fouls ?? 0),
      is_mvp_vote: Boolean(entry.is_mvp_vote),
      points_scored: Number(entry.points_scored ?? 0),
      yellow_cards: Number(entry.yellow_cards ?? 0),
      red_cards: Number(entry.red_cards ?? 0),
    });
  });

  renderHeader();
  renderRosters();
  renderLiveEvents();
}

function hydrateFromEmergencyDraft(draft) {
  state.match = draft?.match_snapshot ?? state.match;
  state.config = draft?.config_snapshot ?? state.config ?? {};
  state.homePlayers = Array.isArray(draft?.home_players) ? draft.home_players : state.homePlayers;
  state.awayPlayers = Array.isArray(draft?.away_players) ? draft.away_players : state.awayPlayers;
  state.lockVersion = Number(draft?.lock_version ?? state.match?.lock_version ?? state.lockVersion ?? 0);
  applyEmergencyDraft(draft);
  applySportSpecificControls();
}

function hydrateFromLiveCache(cacheEntry) {
  state.match = cacheEntry?.match ?? state.match;
  state.config = cacheEntry?.config ?? state.config ?? {};
  state.homePlayers = Array.isArray(cacheEntry?.homePlayers) ? cacheEntry.homePlayers : [];
  state.awayPlayers = Array.isArray(cacheEntry?.awayPlayers) ? cacheEntry.awayPlayers : [];
  state.lockVersion = Number(state.match?.lock_version ?? 0);

  const payload = state.match?.live_payload ?? {};
  state.homeScore = Number(payload.home_score ?? state.match?.home_score ?? 0);
  state.awayScore = Number(payload.away_score ?? state.match?.away_score ?? 0);
  state.duration = Number(payload.duration ?? state.match?.duration ?? 0);
  state.quarter = Number(payload.quarter ?? state.match?.quarter ?? 1);
  state.timeouts = {
    home: Number(payload?.timeouts?.home ?? 0),
    away: Number(payload?.timeouts?.away ?? 0),
  };
  state.eventLog = Array.isArray(payload?.event_log) ? payload.event_log : [];

  const cachedStats = Array.isArray(cacheEntry?.stats) ? cacheEntry.stats : [];
  const snapshotStats = Array.isArray(payload?.stats_snapshot) ? payload.stats_snapshot : [];
  [...snapshotStats, ...cachedStats].forEach((entry) => {
    state.playerState.set(Number(entry.player_id), {
      player_id: Number(entry.player_id),
      played: Boolean(entry.played),
      fouls: Number(entry.fouls ?? 0),
      is_mvp_vote: Boolean(entry.is_mvp_vote),
      points_scored: Number(entry.points_scored ?? 0),
      yellow_cards: Number(entry.yellow_cards ?? 0),
      red_cards: Number(entry.red_cards ?? 0),
    });
  });

  renderHeader();
  renderRosters();
  renderLiveEvents();
  applySportSpecificControls();
}

async function syncEmergencyDraft() {
  const draft = loadEmergencyDraft();
  if (!draft || !state.editable || !navigator.onLine) return;

  if (state.offlineMode) {
    await startLockFlow();
    state.offlineMode = false;
    if (!state.unsubscribe) setupRealtime();
  }

  const result = await commitLiveUpdate({
    matchId: state.matchId,
    payload: draft.payload,
    expectedVersion: state.lockVersion,
  });

  if (result?.success === false) {
    await markQueuedLiveOperationsForMatch(state.matchId, 'conflict', result?.message || 'Conflitto versione online');
    await openOfflineConflict(draft, result?.message || 'La versione online e cambiata.');
    return;
  }

  state.lockVersion = Number(result?.new_version ?? state.lockVersion + 1);
  clearEmergencyDraft();
  await markQueuedLiveOperationsForMatch(state.matchId, 'synced');
  setSyncStatus('online', 'Tutto salvato online');
  showToast('Bozza locale sincronizzata.', 'success');
}

async function openOfflineConflict(draft, message = '') {
  let remote = null;
  try {
    remote = await loadLiveMatch(state.matchId);
  } catch (_error) {
    showToast('Conflitto rilevato, ma non riesco a caricare la versione online.', 'error');
    return;
  }

  state.pendingConflict = { draft, remote };
  const remoteMatch = remote.match;
  const localPayload = draft?.payload ?? {};
  const remotePayload = remoteMatch?.live_payload ?? {};
  setSyncStatus('conflict', 'Conflitto da risolvere');
  getEl('offline-conflict-content').innerHTML = `
    <p class="muted">${escapeHtml(message)}</p>
    <div class="offline-conflict-grid">
      <article>
        <h3>Bozza locale</h3>
        <strong>${Number(localPayload.home_score ?? 0)} - ${Number(localPayload.away_score ?? 0)}</strong>
        <span>Salvata: ${escapeHtml(localPayload.updated_at ? new Date(localPayload.updated_at).toLocaleString('it-IT') : '-')}</span>
        <span>Dispositivo: ${escapeHtml(draft?.match_snapshot?.updated_device_label ?? localPayload.device?.label ?? 'Questo dispositivo')}</span>
      </article>
      <article>
        <h3>Versione online</h3>
        <strong>${Number(remotePayload.home_score ?? remoteMatch.home_score ?? 0)} - ${Number(remotePayload.away_score ?? remoteMatch.away_score ?? 0)}</strong>
        <span>Aggiornata: ${escapeHtml((remotePayload.updated_at ?? remoteMatch.updated_at) ? new Date(remotePayload.updated_at ?? remoteMatch.updated_at).toLocaleString('it-IT') : '-')}</span>
        <span>Dispositivo: ${escapeHtml(remoteMatch.updated_device_label ?? remotePayload.device?.label ?? 'Non registrato')}</span>
      </article>
    </div>
  `;
  openModal('modal-offline-conflict');
}

async function resolveOfflineConflict(choice) {
  const conflict = state.pendingConflict;
  if (!conflict) return;

  if (choice === 'online') {
    clearEmergencyDraft();
    await markQueuedLiveOperationsForMatch(state.matchId, 'conflict', 'Mantenuta versione online');
    applyRemoteMatchUpdate(conflict.remote.match);
    closeModal('modal-offline-conflict');
    setSyncStatus('online', 'Versione online mantenuta');
    state.pendingConflict = null;
    return;
  }

  const remoteVersion = Number(conflict.remote.match.lock_version ?? state.lockVersion ?? 0);
  state.lockVersion = remoteVersion;
  if (!state.hasLock) await startLockFlow();
  const result = await commitLiveUpdate({
    matchId: state.matchId,
    payload: conflict.draft.payload,
    expectedVersion: state.lockVersion,
  });
  if (result?.success === false) {
    showToast(result.message || 'Non riesco a salvare la bozza locale sopra la versione online.', 'error');
    return;
  }
  state.lockVersion = Number(result?.new_version ?? state.lockVersion + 1);
  clearEmergencyDraft();
  await markQueuedLiveOperationsForMatch(state.matchId, 'synced');
  closeModal('modal-offline-conflict');
  setSyncStatus('online', 'Bozza locale salvata online');
  showToast('Bozza locale applicata online.', 'success');
  state.pendingConflict = null;
}

function buildStatsPayload() {
  const playersDirectory = new Map(
    [...state.homePlayers, ...state.awayPlayers].map((player) => [
      Number(player.id),
      {
        player_name: player.full_name ?? null,
        team_id: Number(player.team_id ?? 0) || null,
      },
    ])
  );

  return [...state.playerState.values()]
    .filter(
      (entry) =>
        entry.played ||
        entry.fouls > 0 ||
        entry.is_mvp_vote ||
        entry.points_scored > 0 ||
        Number(entry.yellow_cards ?? 0) > 0 ||
        Number(entry.red_cards ?? 0) > 0
    )
    .map((entry) => ({
      ...entry,
      ...(playersDirectory.get(Number(entry.player_id)) ?? {}),
    }));
}
async function saveSnapshot() {
  if (!state.editable) return;
  const payload = buildLivePayload();
  saveEmergencyDraft(payload);

  let result;
  try {
    result = await commitLiveUpdate({
      matchId: state.matchId,
      payload,
      expectedVersion: state.lockVersion,
    });
  } catch (error) {
    if (isNetworkLikeError(error)) {
      if (!state.emergencyNoticeShown) {
        showToast('Connessione instabile: referto salvato localmente e sincronizzato appena possibile.', 'error');
        state.emergencyNoticeShown = true;
      }
      await queueLiveSnapshotOperation(state.matchId, payload, {
        reason: 'Snapshot live salvato offline',
      });
      setSyncStatus('local', 'Bozza salvata solo su questo dispositivo');
      return;
    }
    throw error;
  }

  if (result?.success === false) {
    await openOfflineConflict(
      { payload, match_snapshot: state.match, saved_at: new Date().toISOString() },
      result?.message || 'La versione online e cambiata.'
    );
    return;
  }

  state.lockVersion = Number(result?.new_version ?? state.lockVersion + 1);
  state.emergencyNoticeShown = false;
  clearEmergencyDraft();
  setSyncStatus('online', 'Tutto salvato online');
}

function applyRemoteMatchUpdate(nextMatch) {
  if (!nextMatch) return;

  const payload = nextMatch.live_payload ?? {};
  state.homeScore = Number(payload.home_score ?? nextMatch.home_score ?? state.homeScore);
  state.awayScore = Number(payload.away_score ?? nextMatch.away_score ?? state.awayScore);
  state.timeouts = {
    home: Number(payload?.timeouts?.home ?? state.timeouts.home ?? 0),
    away: Number(payload?.timeouts?.away ?? state.timeouts.away ?? 0),
  };
  state.duration = Number(payload.duration ?? nextMatch.duration ?? state.duration);
  state.quarter = Number(payload.quarter ?? nextMatch.quarter ?? state.quarter);
  state.eventLog = Array.isArray(payload?.event_log) ? payload.event_log : state.eventLog;
  state.lockVersion = Number(nextMatch.lock_version ?? state.lockVersion);
  const snapshotStats = Array.isArray(payload?.stats_snapshot) ? payload.stats_snapshot : [];
  snapshotStats.forEach((entry) => {
    state.playerState.set(Number(entry.player_id), {
      player_id: Number(entry.player_id),
      played: Boolean(entry.played),
      fouls: Number(entry.fouls ?? 0),
      is_mvp_vote: Boolean(entry.is_mvp_vote),
      points_scored: Number(entry.points_scored ?? 0),
      yellow_cards: Number(entry.yellow_cards ?? 0),
      red_cards: Number(entry.red_cards ?? 0),
    });
  });

  renderHeader();
  renderRosters();
  renderLiveEvents();
}

function updateScore(team, delta) {
  if (!state.editable) return;

  if (team === 'home') {
    state.homeScore = Math.max(0, state.homeScore + delta);
  } else {
    state.awayScore = Math.max(0, state.awayScore + delta);
  }

  renderHeader();
  autosaveSnapshot();
}

function nextQuarter() {
  if (!state.editable || !isBasketMatch()) return;
  state.quarter = Math.min(Number(state.config.quarters_count ?? 4), state.quarter + 1);
  renderHeader();
  autosaveSnapshot();
}

function prevQuarter() {
  if (!state.editable || !isBasketMatch()) return;
  state.quarter = Math.max(1, state.quarter - 1);
  renderHeader();
  autosaveSnapshot();
}

function startTimer() {
  if (!state.editable || state.timerInterval) return;
  const quarterLimit = Math.max(0, Number(state.config?.quarter_duration_sec ?? 0));
  state.timerInterval = window.setInterval(() => {
    if (isBasketMatch() && quarterLimit > 0 && state.duration >= quarterLimit) {
      stopTimer();
      showToast('Tempo del quarto terminato.', 'success');
      return;
    }
    state.duration += 1;
    getEl('live-timer').textContent = formatDuration(state.duration);
    autosaveSnapshot();
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function resetTimer() {
  if (!state.editable) return;
  stopTimer();
  state.duration = 0;
  getEl('live-timer').textContent = formatDuration(0);
  autosaveSnapshot();
}

function togglePlayed(playerId, checked) {
  if (!state.editable) return;
  const entry = ensurePlayer(playerId);
  if (isPlayerExpelled(entry)) return;
  entry.played = checked;
  autosaveSnapshot();
}

function toggleMvp(playerId) {
  if (!state.editable || !Boolean(state.config?.allow_mvp ?? true)) return;

  const currentEntry = ensurePlayer(playerId);
  if (isPlayerExpelled(currentEntry)) return;
  const shouldUnset = currentEntry.is_mvp_vote === true;

  for (const value of state.playerState.values()) {
    value.is_mvp_vote = false;
  }

  if (!shouldUnset) {
    currentEntry.is_mvp_vote = true;
  }

  renderRosters();
  autosaveSnapshot();
}

function addFoul(playerId) {
  if (!state.editable) return;
  if (!(isBasketMatch() || isVolleyMatch())) return;

  const entry = ensurePlayer(playerId);
  const maxFouls = getMaxFouls();
  if (isPlayerExpelled(entry) || entry.fouls >= maxFouls) return;

  entry.fouls += 1;
  if (entry.fouls >= maxFouls) {
    entry.played = false;
    entry.is_mvp_vote = false;
  }
  renderRosters();

  if (entry.fouls >= maxFouls) {
    showToast('Giocatore espulso per limite falli.', 'error');
  }

  autosaveSnapshot();
}

function addYellowCard(playerId) {
  if (!isSoccerMatch()) return;
  if (!state.editable || !Boolean(state.config?.allow_yellow_cards)) return;
  const entry = ensurePlayer(playerId);
  if (isPlayerExpelled(entry)) return;
  const maxYellowCards = getMaxYellowCards();
  entry.yellow_cards = Math.min(maxYellowCards, Number(entry.yellow_cards ?? 0) + 1);
  if (entry.yellow_cards >= maxYellowCards) {
    entry.played = false;
    entry.is_mvp_vote = false;
    showToast('Giocatore espulso per limite cartellini gialli.', 'error');
  }
  renderRosters();
  autosaveSnapshot();
}

function addRedCard(playerId) {
  if (!isSoccerMatch()) return;
  if (!state.editable || !Boolean(state.config?.allow_red_cards)) return;
  const entry = ensurePlayer(playerId);
  if (isPlayerExpelled(entry)) return;
  const maxRedCards = getMaxRedCards();
  entry.red_cards = Math.min(maxRedCards, Number(entry.red_cards ?? 0) + 1);
  entry.played = false;
  entry.is_mvp_vote = false;
  renderRosters();
  showToast('Giocatore espulso per cartellino rosso.', 'error');
  autosaveSnapshot();
}

function useTimeout(team) {
  if (!state.editable || !isBasketMatch()) return;
  const limit = getTimeoutLimit();
  if (limit <= 0) return;
  const current = Number(state.timeouts?.[team] ?? 0);
  if (current >= limit) {
    showToast('Timeout esauriti per questa squadra.', 'error');
    return;
  }
  state.timeouts[team] = current + 1;
  renderHeader();
  autosaveSnapshot();
}

function validateBeforeFinalization() {
  if (['calcio', 'basket', 'pallavolo'].includes(getSportType())) {
    const minPlayers = Math.max(1, Number(state.config?.min_players ?? 1));
    const homePresences = state.homePlayers.filter((player) => Boolean(ensurePlayer(player.id).played)).length;
    const awayPresences = state.awayPlayers.filter((player) => Boolean(ensurePlayer(player.id).played)).length;
    if (homePresences < minPlayers || awayPresences < minPlayers) {
      throw new Error(`Servono almeno ${minPlayers} presenze per squadra (${homePresences}-${awayPresences}).`);
    }
  }

  const homeCaptain = getCaptain('home');
  const awayCaptain = getCaptain('away');
  if (!homeCaptain || !awayCaptain) {
    throw new Error('Imposta un capitano per entrambe le squadre dalla gestione squadre.');
  }

  return { homeCaptain, awayCaptain };
}

async function openFinalizeModal() {
  const { homeCaptain, awayCaptain } = validateBeforeFinalization();

  state.signatures = { home: null, away: null };
  getEl('signature-home-captain').textContent = homeCaptain.full_name;
  getEl('signature-away-captain').textContent = awayCaptain.full_name;
  getEl('signature-report-summary').innerHTML = `
    <div class="signature-score-line">
      <strong>${escapeHtml(state.match.home?.name ?? 'Casa')}</strong>
      <span class="score-chip">${state.homeScore} - ${state.awayScore}</span>
      <strong>${escapeHtml(state.match.away?.name ?? 'Ospite')}</strong>
    </div>
    <div class="muted">${escapeHtml(state.match.sport?.name ?? '-')} · ${escapeHtml(state.match.round_name ?? '-')} · ${escapeHtml(state.match.venue?.name ?? 'Campo da definire')} · ${escapeHtml(getScheduleLabel())}</div>
  `;
  try {
    const staff = await loadMatchStaff(state.matchId);
    getEl('final-referee-name').value = staff.referee?.name ?? '';
    getEl('final-scorekeeper-name').value = staff.scorekeeper?.name ?? '';
    getEl('final-field-manager-name').value = staff.field_manager?.name ?? '';
    getEl('final-supervisor-name').value = staff.supervisor?.name ?? '';
  } catch (_error) {
    getEl('final-referee-name').value = '';
    getEl('final-scorekeeper-name').value = '';
    getEl('final-field-manager-name').value = '';
    getEl('final-supervisor-name').value = '';
  }

  document.querySelectorAll('.signature-canvas').forEach((canvas) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
  updateSignatureStatus('home');
  updateSignatureStatus('away');
  openModal('modal-finalize-signatures');
}

function closeFinalizeModal() {
  closeModal('modal-finalize-signatures');
}

function updateSignatureStatus(side) {
  const status = getEl(`signature-${side}-status`);
  if (!status) return;
  status.textContent = state.signatures[side] ? 'Firma acquisita' : 'Firma richiesta';
  status.className = `signature-status ${state.signatures[side] ? 'ready' : ''}`;
}

function resizeSignatureCanvas(canvas) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvas.getBoundingClientRect();
  const nextWidth = Math.max(320, Math.round(rect.width * ratio));
  const nextHeight = Math.max(150, Math.round(rect.height * ratio));
  if (canvas.width === nextWidth && canvas.height === nextHeight) return;
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
}

function bindSignaturePads() {
  if (state.signaturePadsBound) return;
  state.signaturePadsBound = true;

  document.querySelectorAll('.signature-canvas').forEach((canvas) => {
    const side = canvas.dataset.signatureSide;
    let drawing = false;
    let hasInk = false;

    const getPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const startDrawing = (event) => {
      if (!state.editable) return;
      resizeSignatureCanvas(canvas);
      drawing = true;
      hasInk = true;
      canvas.setPointerCapture?.(event.pointerId);
      const point = getPoint(event);
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      event.preventDefault();
    };

    const draw = (event) => {
      if (!drawing) return;
      const point = getPoint(event);
      const ctx = canvas.getContext('2d');
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      event.preventDefault();
    };

    const stopDrawing = () => {
      if (!drawing) return;
      drawing = false;
      if (hasInk) {
        state.signatures[side] = canvas.toDataURL('image/png');
        updateSignatureStatus(side);
      }
    };

    canvas.addEventListener('pointerdown', startDrawing);
    canvas.addEventListener('pointermove', draw);
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);
    canvas.addEventListener('pointerleave', stopDrawing);
  });

  document.querySelectorAll('[data-clear-signature]').forEach((button) => {
    button.addEventListener('click', () => {
      const side = button.dataset.clearSignature;
      const canvas = document.querySelector(`.signature-canvas[data-signature-side="${side}"]`);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      state.signatures[side] = null;
      updateSignatureStatus(side);
    });
  });
}

function buildSignaturesPayload() {
  const homeCaptain = getCaptain('home');
  const awayCaptain = getCaptain('away');
  const now = new Date().toISOString();

  return [
    {
      team_side: 'home',
      team_id: Number(state.match.home_team_id),
      player_id: Number(homeCaptain?.id ?? 0),
      captain_name: homeCaptain?.full_name ?? '',
      signature_data_url: state.signatures.home,
      signed_at: now,
      user_agent: navigator.userAgent,
    },
    {
      team_side: 'away',
      team_id: Number(state.match.away_team_id),
      player_id: Number(awayCaptain?.id ?? 0),
      captain_name: awayCaptain?.full_name ?? '',
      signature_data_url: state.signatures.away,
      signed_at: now,
      user_agent: navigator.userAgent,
    },
  ];
}

function getFinalStaffFormPayload() {
  return {
    referee: getEl('final-referee-name')?.value ?? '',
    scorekeeper: getEl('final-scorekeeper-name')?.value ?? '',
    field_manager: getEl('final-field-manager-name')?.value ?? '',
    supervisor: getEl('final-supervisor-name')?.value ?? '',
  };
}

async function submitFinalizationWithSignatures() {
  if (!state.editable) return;
  if (!state.signatures.home || !state.signatures.away) {
    showToast('Servono entrambe le firme dei capitani.', 'error');
    return;
  }

  stopTimer();
  await saveMatchStaff(state.matchId, getFinalStaffFormPayload());

  const result = await finalizeLiveMatch({
    matchId: state.matchId,
    payload: {
      ...buildLivePayload(),
      home_score: state.homeScore,
      away_score: state.awayScore,
    },
    statsPayload: buildStatsPayload(),
    signaturesPayload: buildSignaturesPayload(),
    expectedVersion: state.lockVersion,
  });

  if (result?.success === false) {
    showToast(result?.message || 'Errore finalizzazione match.', 'error');
    return;
  }

  state.lockVersion = Number(result?.new_version ?? state.lockVersion + 1);
  clearEmergencyDraft();
  showToast('Match finalizzato con firme capitani.', 'success');
  closeFinalizeModal();
  setTimeout(() => {
    window.location.href = 'admin';
  }, 900);
}

async function finalizeMatch() {
  if (!state.editable) return;

  try {
    await openFinalizeModal();
  } catch (error) {
    showToast(error.message, 'error');
    return;
  }
}

function bindLiveControls() {
  bindSignaturePads();

  getEl('btn-back-admin')?.addEventListener('click', () => {
    window.location.href = 'admin';
  });
  getEl('btn-print-emergency-report')?.addEventListener('click', () => {
    try {
      openEmergencyPaperReport();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  document.querySelectorAll('[data-score-team]').forEach((button) => {
    button.addEventListener('click', () => {
      updateScore(button.dataset.scoreTeam, Number(button.dataset.scoreDelta || 0));
    });
  });

  getEl('btn-quarter-next')?.addEventListener('click', nextQuarter);
  getEl('btn-quarter-prev')?.addEventListener('click', prevQuarter);
  getEl('btn-timer-start')?.addEventListener('click', startTimer);
  getEl('btn-timer-stop')?.addEventListener('click', stopTimer);
  getEl('btn-timer-reset')?.addEventListener('click', resetTimer);
  getEl('btn-save-snapshot')?.addEventListener('click', () => {
    saveSnapshot().catch((error) => showToast(error.message, 'error'));
  });
  getEl('live-event-team')?.addEventListener('change', renderLiveEventControls);
  getEl('btn-add-live-event')?.addEventListener('click', () => {
    addLiveEventFromForm().catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-finalize-match')?.addEventListener('click', () => {
    finalizeMatch().catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-timeout-home')?.addEventListener('click', () => useTimeout('home'));
  getEl('btn-timeout-away')?.addEventListener('click', () => useTimeout('away'));
  getEl('btn-cancel-finalize-signatures')?.addEventListener('click', closeFinalizeModal);
  getEl('btn-cancel-finalize-signatures-secondary')?.addEventListener('click', closeFinalizeModal);
  getEl('btn-confirm-finalize-signatures')?.addEventListener('click', () => {
    submitFinalizationWithSignatures().catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-close-offline-conflict')?.addEventListener('click', () => closeModal('modal-offline-conflict'));
  getEl('btn-conflict-keep-online')?.addEventListener('click', () => {
    resolveOfflineConflict('online').catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-conflict-keep-local')?.addEventListener('click', () => {
    resolveOfflineConflict('local').catch((error) => showToast(error.message, 'error'));
  });
  getEl('modal-finalize-signatures')?.addEventListener('click', (event) => {
    if (event.target.id === 'modal-finalize-signatures') closeFinalizeModal();
  });
  getEl('modal-offline-conflict')?.addEventListener('click', (event) => {
    if (event.target.id === 'modal-offline-conflict') closeModal('modal-offline-conflict');
  });

  ['table-live-home', 'table-live-away'].forEach((tableId) => {
    getEl(tableId)?.addEventListener('change', (event) => {
      const row = event.target.closest('tr[data-player-id]');
      if (!row) return;

      const playerId = Number(row.dataset.playerId);
      if (event.target.matches('[data-action="toggle-played"]')) {
        togglePlayed(playerId, event.target.checked);
      }
    });

    getEl(tableId)?.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      const row = event.target.closest('tr[data-player-id]');
      if (!actionEl || !row) return;

      const playerId = Number(row.dataset.playerId);
      const action = actionEl.dataset.action;

      if (action === 'toggle-mvp') toggleMvp(playerId);
      if (action === 'add-foul') addFoul(playerId);
      if (action === 'add-yellow') addYellowCard(playerId);
      if (action === 'add-red') addRedCard(playerId);
    });
  });
}
async function startLockFlow() {
  const lockResult = await startLiveSession(state.matchId, APP_CONFIG.lockTtlSeconds);
  const lockOwner = lockResult?.lock_owner;
  const currentUserId = state.user?.id;
  const isFinished = Boolean(state.match?.is_finished);

  state.hasLock = Boolean(lockResult?.success) && lockOwner === currentUserId && !isFinished;
  state.lockVersion = Number(lockResult?.lock_version ?? state.match.lock_version ?? 0);

  setEditable(state.hasLock && canEditMatches(state.admin?.ruolo));

  if (isFinished) {
    setEditable(false);
    getEl('live-lock-status').className = 'lock-banner locked';
    getEl('live-lock-status').textContent = 'Match già finalizzato: modalità sola lettura.';
    if (lockOwner === currentUserId) {
      releaseLiveSession(state.matchId).catch(() => undefined);
    }
    return;
  }

  if (!state.editable && lockResult?.message) {
    showToast(lockResult.message, 'error');
  }

  if (state.editable) {
    state.lockRefreshInterval = window.setInterval(() => {
      refreshLiveLock(state.matchId)
        .then((result) => {
          if (result?.success === false) {
            setEditable(false);
          }
        })
        .catch((error) => {
          setEditable(false);
          showToast(error.message, 'error');
        });
    }, APP_CONFIG.lockRefreshSeconds * 1000);
  }
}

async function hydrateFromDatabase() {
  let liveData;
  try {
    liveData = await loadLiveMatch(state.matchId);
  } catch (error) {
    const emergencyDraft = loadEmergencyDraft();
    if (isNetworkLikeError(error) && emergencyDraft?.match_snapshot) {
      state.offlineMode = true;
      hydrateFromEmergencyDraft(emergencyDraft);
      setEditable(canEditMatches(state.admin?.ruolo));
      getEl('live-lock-status').className = 'lock-banner unlocked';
      getEl('live-lock-status').textContent = 'Modalita emergenza locale: salvataggio su questo dispositivo, sincronizzazione al ritorno della rete.';
      showToast('Database non raggiungibile: aperta la bozza locale di emergenza.', 'error');
      return;
    }
    const cachedLive = await loadLiveMatchCacheAsync(state.matchId);
    if (isNetworkLikeError(error) && cachedLive?.match) {
      state.offlineMode = true;
      hydrateFromLiveCache(cachedLive);
      setEditable(canEditMatches(state.admin?.ruolo));
      getEl('live-lock-status').className = 'lock-banner unlocked';
      getEl('live-lock-status').textContent = 'Modalita offline preparata: dati caricati dalla cache locale del dispositivo.';
      setSyncStatus('offline', 'Offline: cache locale attiva');
      showToast('Match aperto dalla cache offline preparata.', 'success');
      return;
    }
    throw error;
  }

  const { match, config, homePlayers, awayPlayers } = liveData;
  const payload = match.live_payload ?? {};
  state.match = match;
  state.config = config;
  state.homePlayers = homePlayers;
  state.awayPlayers = awayPlayers;
  state.homeScore = Number(payload.home_score ?? match.home_score ?? 0);
  state.awayScore = Number(payload.away_score ?? match.away_score ?? 0);
  state.duration = Number(payload.duration ?? match.duration ?? 0);
  state.quarter = Number(payload.quarter ?? match.quarter ?? 1);
  state.timeouts = {
    home: Number(payload?.timeouts?.home ?? 0),
    away: Number(payload?.timeouts?.away ?? 0),
  };
  state.eventLog = Array.isArray(payload?.event_log) ? payload.event_log : [];
  state.lockVersion = Number(match.lock_version ?? 0);

  const snapshotStats = Array.isArray(payload?.stats_snapshot) ? payload.stats_snapshot : [];
  snapshotStats.forEach((entry) => {
    state.playerState.set(Number(entry.player_id), {
      player_id: Number(entry.player_id),
      played: Boolean(entry.played),
      fouls: Number(entry.fouls ?? 0),
      is_mvp_vote: Boolean(entry.is_mvp_vote),
      points_scored: Number(entry.points_scored ?? 0),
      yellow_cards: Number(entry.yellow_cards ?? 0),
      red_cards: Number(entry.red_cards ?? 0),
    });
  });

  let stats = [];
  try {
    const statsResult = await run(
      db.from('match_stats').select('*').eq('match_id', state.matchId),
      'Caricamento statistiche esistenti'
    );
    stats = statsResult.data ?? [];
  } catch (error) {
    if (!isNetworkLikeError(error)) throw error;
    showToast('Statistiche remote non disponibili: uso snapshot live locale.', 'error');
  }

  stats.forEach((entry) => {
    state.playerState.set(Number(entry.player_id), {
      player_id: Number(entry.player_id),
      played: Boolean(entry.played),
      fouls: Number(entry.fouls ?? 0),
      is_mvp_vote: Boolean(entry.is_mvp_vote),
      points_scored: Number(entry.points_scored ?? 0),
      yellow_cards: Number(entry.yellow_cards ?? 0),
      red_cards: Number(entry.red_cards ?? 0),
    });
  });

  const emergencyDraft = loadEmergencyDraft();
  if (emergencyDraft && !match.is_finished) {
    const draftTime = new Date(emergencyDraft.saved_at ?? 0).getTime();
    const remoteTime = new Date(payload.updated_at ?? match.updated_at ?? 0).getTime();
    if (Number.isFinite(draftTime) && draftTime > remoteTime) {
      const shouldRestore = await showAppConfirm('Trovato un referto locale non sincronizzato per questo match. Vuoi ripristinarlo?', {
        title: 'Bozza locale trovata',
        confirmLabel: 'Ripristina',
        cancelLabel: 'Ignora',
      });
      if (shouldRestore) {
        applyEmergencyDraft(emergencyDraft);
        showToast('Referto locale ripristinato. Verra sincronizzato appena possibile.', 'success');
      }
    }
  }

  for (const value of state.playerState.values()) {
    if (isPlayerExpelled(value)) {
      value.played = false;
      value.is_mvp_vote = false;
    }
  }

  if (!Boolean(state.config?.allow_mvp ?? true)) {
    for (const value of state.playerState.values()) {
      value.is_mvp_vote = false;
    }
  }

  await hydratePersistedLiveEvents();
  renderHeader();
  renderRosters();
  applySportSpecificControls();
  await saveLiveMatchCacheAsync(state.matchId, { match, config, homePlayers, awayPlayers }, { stats, source: 'live-hydrate' });
  saveEmergencyDraft();
  setSyncStatus(navigator.onLine ? 'online' : 'offline', navigator.onLine ? 'Tutto salvato online' : 'Offline: bozza locale attiva');
}

function setupRealtime() {
  state.unsubscribe = subscribeLiveMatch(state.matchId, (payload) => {
    if (payload?.new?.id && Number(payload.new.id) === Number(state.matchId)) {
      applyRemoteMatchUpdate(payload.new);
    }
  });
}

function setupUnloadRelease() {
  window.addEventListener('beforeunload', () => {
    if (state.hasLock) {
      releaseLiveSession(state.matchId).catch(() => undefined);
    }
  });
}

function setupEmergencyConnectivity() {
  window.addEventListener('offline', () => {
    showToast('Connessione assente: le modifiche verranno salvate localmente.', 'error');
    setSyncStatus('offline', 'Offline: salvataggio locale');
  });

  window.addEventListener('online', () => {
    showToast('Connessione ripristinata: sincronizzazione bozza locale...', 'success');
    setSyncStatus('pending', 'Sincronizzazione bozza locale...');
    syncEmergencyDraft().catch((error) => showToast(error.message, 'error'));
  });
}

function startLiveTour() {
  startTourIfNeeded('live', [
    {
      selector: '.live-top-actions',
      title: 'Azioni rapide',
      text: 'In alto trovi ritorno al pannello, stampa del referto cartaceo, salvataggio manuale e chiusura del match.',
    },
    {
      selector: '.live-scoreboard',
      title: 'Punteggio e timer',
      text: 'Gestisci punti, timer, quarti o set direttamente dal campo.',
    },
    {
      selector: '#live-sync-status',
      title: 'Stato salvataggio',
      text: 'Qui vedi se il referto e online, salvato solo sul dispositivo o in conflitto.',
    },
    {
      selector: '#live-lock-status',
      title: 'Controllo modifica',
      text: 'Il lock evita che due postazioni modifichino lo stesso match nello stesso momento quando la rete e disponibile.',
    },
    {
      selector: '.roster-grid',
      title: 'Roster e statistiche',
      text: 'Segna presenze, falli, cartellini, punti e MVP dai roster delle squadre.',
    },
    {
      selector: '#live-events-card',
      title: 'Cronologia opzionale',
      text: 'Se attivata dalle impostazioni, qui registri eventi minuto per minuto, sostituzioni e andamento progressivo.',
    },
    {
      selector: '#btn-finalize-match',
      title: 'Chiusura match',
      text: 'A fine partita apri il referto, inserisci staff e raccogli le firme dei capitani.',
    },
    {
      selector: null,
      title: 'Uso offline',
      text: 'Se manca Internet, continua a lavorare: la bozza resta su questo dispositivo e verra sincronizzata quando la connessione torna disponibile.',
    },
  ]);
}

async function init() {
  const guard = await requireAdmin({ redirectTo: './' });
  if (!guard.allowed) return;

  state.user = guard.user;
  state.admin = guard.admin;
  await promptDeviceLabel();

  state.matchId = getMatchIdFromQuery();
  if (!state.matchId) {
    throw new Error('ID match mancante. Apri live da Dashboard Admin.');
  }

  bindLiveControls();
  await hydrateFromDatabase();
  if (!state.offlineMode) {
    await startLockFlow();
    setupRealtime();
  }
  setupUnloadRelease();
  setupEmergencyConnectivity();
  syncEmergencyDraft().catch(() => undefined);
  startLiveTour();
}

init().catch((error) => {
  showToast(error.message, 'error');
});




