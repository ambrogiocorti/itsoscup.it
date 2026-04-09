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
import { debounce, escapeHtml, formatDuration, getEl, showToast } from './utils.js';

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
  quarter: 1,
  duration: 0,
  timerInterval: null,
  lockRefreshInterval: null,
  lockVersion: 0,
  hasLock: false,
  editable: false,
  unsubscribe: null,
};

const autosaveSnapshot = debounce(() => {
  saveSnapshot().catch((error) => showToast(error.message, 'error'));
}, APP_CONFIG.liveAutosaveDebounceMs);

function getMatchIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return Number(params.get('match') || 0);
}

function setEditable(enabled) {
  state.editable = enabled;
  document.querySelectorAll('[data-requires-edit]').forEach((el) => {
    el.disabled = !enabled;
    el.classList.toggle('hidden', !enabled && el.dataset.hideWhenReadonly === 'true');
  });

  // Rerender rosters so checkbox/star/foul buttons reflect current editable state.
  if (state.match) {
    renderRosters();
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

function renderHeader() {
  getEl('live-home-name').textContent = state.match.home?.name ?? 'Casa';
  getEl('live-away-name').textContent = state.match.away?.name ?? 'Ospite';
  getEl('live-home-score').textContent = String(state.homeScore);
  getEl('live-away-score').textContent = String(state.awayScore);
  getEl('live-timer').textContent = formatDuration(state.duration);
  getEl('live-quarter').textContent = `Q${state.quarter}`;
  getEl('live-match-title').textContent = `${state.match.home?.name ?? 'Casa'} vs ${state.match.away?.name ?? 'Ospite'}`;
  getEl('live-match-meta').textContent = `${state.match.round_name ?? '-'} · ${state.match.sport?.name ?? '-'}`;
}

function renderRosterTable(tableId, players) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;

  tbody.innerHTML = players
    .map((player) => {
      const rowState = ensurePlayer(player.id);
      const foulClass = rowState.fouls >= Number(state.config.max_fouls ?? 3) ? 'foul-pill max' : 'foul-pill';
      const mvpEnabled = Boolean(state.config?.allow_mvp ?? true);
      const mvpActive = rowState.is_mvp_vote && mvpEnabled ? 'mvp-star active' : 'mvp-star';
      const mvpDisabled = !state.editable || !mvpEnabled;

      return `
      <tr data-player-id="${player.id}">
        <td class="text-center"><input type="checkbox" data-action="toggle-played" ${rowState.played ? 'checked' : ''} ${state.editable ? '' : 'disabled'}></td>
        <td><strong>${escapeHtml(player.full_name)}</strong></td>
        <td class="text-center"><span class="${foulClass}" id="foul-${player.id}">${rowState.fouls}</span></td>
        <td class="text-center"><button class="${mvpActive}" data-action="toggle-mvp" title="${mvpEnabled ? 'Vota MVP' : 'MVP disabilitato nelle impostazioni torneo'}" ${mvpDisabled ? 'disabled' : ''}><i class="fa-solid fa-star"></i></button></td>
        <td class="text-center"><button class="btn btn-ghost" data-action="add-foul" ${state.editable ? '' : 'disabled'}>+F</button></td>
      </tr>
      `;
    })
    .join('');
}

function renderRosters() {
  renderRosterTable('table-live-home', state.homePlayers);
  renderRosterTable('table-live-away', state.awayPlayers);
}


function applySportSpecificControls() {
  const isBasket = state.match?.sport?.sport_type === 'basket';
  document.querySelectorAll('[data-score-delta="2"], [data-score-delta="3"]').forEach((btn) => {
    btn.classList.toggle('hidden', !isBasket);
  });

  const isFinished = Boolean(state.match?.is_finished);
  if (isFinished) {
    setEditable(false);
    getEl('live-lock-status').className = 'lock-banner locked';
    getEl('live-lock-status').textContent = 'Match già finalizzato: modalità sola lettura.';
  }
}
function buildLivePayload() {
  return {
    home_score: state.homeScore,
    away_score: state.awayScore,
    duration: state.duration,
    quarter: state.quarter,
    updated_at: new Date().toISOString(),
  };
}

function buildStatsPayload() {
  return [...state.playerState.values()]
    .filter((entry) => entry.played || entry.fouls > 0 || entry.is_mvp_vote || entry.points_scored > 0)
    .map((entry) => ({ ...entry }));
}
async function saveSnapshot() {
  if (!state.editable) return;

  const result = await commitLiveUpdate({
    matchId: state.matchId,
    payload: buildLivePayload(),
    expectedVersion: state.lockVersion,
  });

  if (result?.success === false) {
    setEditable(false);
    showToast(result?.message || 'Lock perso durante il salvataggio.', 'error');
    return;
  }

  state.lockVersion = Number(result?.new_version ?? state.lockVersion + 1);
}

function applyRemoteMatchUpdate(nextMatch) {
  if (!nextMatch) return;

  const payload = nextMatch.live_payload ?? {};
  state.homeScore = Number(payload.home_score ?? nextMatch.home_score ?? state.homeScore);
  state.awayScore = Number(payload.away_score ?? nextMatch.away_score ?? state.awayScore);
  state.duration = Number(payload.duration ?? nextMatch.duration ?? state.duration);
  state.quarter = Number(payload.quarter ?? nextMatch.quarter ?? state.quarter);
  state.lockVersion = Number(nextMatch.lock_version ?? state.lockVersion);

  renderHeader();
  renderRosters();
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
  if (!state.editable) return;
  state.quarter = Math.min(Number(state.config.quarters_count ?? 4), state.quarter + 1);
  renderHeader();
  autosaveSnapshot();
}

function prevQuarter() {
  if (!state.editable) return;
  state.quarter = Math.max(1, state.quarter - 1);
  renderHeader();
  autosaveSnapshot();
}

function startTimer() {
  if (!state.editable || state.timerInterval) return;
  state.timerInterval = window.setInterval(() => {
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
  entry.played = checked;
  autosaveSnapshot();
}

function toggleMvp(playerId) {
  if (!state.editable || !Boolean(state.config?.allow_mvp ?? true)) return;

  const currentEntry = ensurePlayer(playerId);
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

  const entry = ensurePlayer(playerId);
  const maxFouls = Number(state.config.max_fouls ?? 3);
  if (entry.fouls >= maxFouls) return;

  entry.fouls += 1;
  renderRosters();

  if (entry.fouls >= maxFouls) {
    showToast('Giocatore espulso per limite falli.', 'error');
  }

  autosaveSnapshot();
}

async function finalizeMatch() {
  if (!state.editable) return;

  if (!confirm('Confermi chiusura e salvataggio definitivo del match?')) {
    return;
  }

  stopTimer();

  const result = await finalizeLiveMatch({
    matchId: state.matchId,
    payload: {
      ...buildLivePayload(),
      home_score: state.homeScore,
      away_score: state.awayScore,
    },
    statsPayload: buildStatsPayload(),
    expectedVersion: state.lockVersion,
  });

  if (result?.success === false) {
    showToast(result?.message || 'Errore finalizzazione match.', 'error');
    return;
  }

  state.lockVersion = Number(result?.new_version ?? state.lockVersion + 1);
  showToast('Match finalizzato con successo.', 'success');
  setTimeout(() => {
    window.location.href = 'admin.html';
  }, 900);
}

function bindLiveControls() {
  getEl('btn-back-admin')?.addEventListener('click', () => {
    window.location.href = 'admin.html';
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
  getEl('btn-finalize-match')?.addEventListener('click', () => {
    finalizeMatch().catch((error) => showToast(error.message, 'error'));
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
  const { match, config, homePlayers, awayPlayers } = await loadLiveMatch(state.matchId);
  state.match = match;
  state.config = config;
  state.homePlayers = homePlayers;
  state.awayPlayers = awayPlayers;
  state.homeScore = Number(match.home_score ?? 0);
  state.awayScore = Number(match.away_score ?? 0);
  state.duration = Number(match.duration ?? 0);
  state.quarter = Number(match.quarter ?? 1);
  state.lockVersion = Number(match.lock_version ?? 0);

  const { data: stats } = await run(
    db.from('match_stats').select('*').eq('match_id', state.matchId),
    'Caricamento statistiche esistenti'
  );

  (stats ?? []).forEach((entry) => {
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

  if (!Boolean(state.config?.allow_mvp ?? true)) {
    for (const value of state.playerState.values()) {
      value.is_mvp_vote = false;
    }
  }

  renderHeader();
  renderRosters();
  applySportSpecificControls();
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

async function init() {
  const guard = await requireAdmin({ redirectTo: 'index.html' });
  if (!guard.allowed) return;

  state.user = guard.user;
  state.admin = guard.admin;

  state.matchId = getMatchIdFromQuery();
  if (!state.matchId) {
    throw new Error('ID match mancante. Apri live da Dashboard Admin.');
  }

  bindLiveControls();
  await hydrateFromDatabase();
  await startLockFlow();
  setupRealtime();
  setupUnloadRelease();
}

init().catch((error) => {
  showToast(error.message, 'error');
});



