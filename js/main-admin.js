import { requireAdmin, signOutAdmin, canEditMatches, canManageAll, canAccessControlCenter } from './auth.js';
import {
  createManualMatch,
  createPlatformBackup,
  deleteMatch,
  deletePlatformBackup,
  deleteSport,
  deleteTeam,
  generateMatchesForSport,
  generateSemifinals,
  listMatchesForAdmin,
  loadMatchStaff,
  loadPlatformBackups,
  loadPlayersByTeam,
  loadSportConfig,
  loadSports,
  loadTeamsBySport,
  reopenMatchForCorrection,
  restorePlatformBackup,
  saveSport,
  saveTeam,
  updateManualMatch,
  upsertSportConfig,
} from './matches.js';
import {
  computePlayerRanking,
  computeTeamStandingsForReport,
  loadReportDataset,
  pickMvpWinner,
} from './reports.js';
import {
  computeAthleticsRanking,
  deleteAthleticsEvent,
  loadAthleticsConfigBySport,
  loadAthleticsAdvancedData,
  loadAthleticsEvents,
  loadAthleticsLeaderboard,
  loadEventResults,
  saveAthleticsHeat,
  saveAthleticsLaneAssignment,
  saveAthleticsEvent,
  saveAthleticsRelayMember,
  saveAthleticsRelayTeam,
  saveAthleticsSchoolRecord,
  upsertEventResult,
} from './events.js';
import {
  applyCsvImport,
  downloadCsvTemplate,
  getCsvModeInfo,
  previewCsvImport,
} from './csv-import.js';
import { TEAM_SPORTS } from './app-config.js';
import {
  combineLocalDateTime,
  deleteVenue,
  formatScheduleRange,
  getVenueQrUrl,
  loadVenues,
  saveVenue,
  slugifyVenueName,
} from './schedule.js';
import { archiveTournament, loadHonorRoll, unarchiveTournament } from './archive.js';
import { sendTelegramMatchReminder, sendTelegramTeamReminder } from './telegram.js';
import { registerClientErrorLogger } from './error-logger.js';
import { registerOfflineSupport } from './offline.js';
import {
  countCachedMatchesAsync,
  getOfflineManifestAsync,
  getOfflineStorageSummary,
  saveLiveMatchCacheAsync,
} from './offline-store.js';
import { getDeviceInfo, promptDeviceLabel } from './device.js';
import {
  loadPlatformSettingsMap,
  loadRegisteredDevices,
  registerCurrentDevice,
  savePlatformSetting,
  validatePreEvent,
  verifyPlatformMigrations,
} from './admin-system.js';
import { createAdminUsersPanel } from './admin-users-panel.js';
import {
  loadCommunicationTemplates,
  loadEventStatistics,
  loadIssueReports,
  loadMatchCheckins,
  loadMatchStatusHistory,
  loadRegiaOperationalSnapshot,
  loadPublicNotifications,
  loadSystemHealthChecks,
  approveMatchOfficial,
  assignMatchDevice,
  deletePublicNotification,
  saveCommunicationTemplate,
  savePublicNotification,
  saveSystemHealthCheck,
  setVenueOperationalStatus,
  updateRegisteredDeviceAdmin,
  setMatchOperationalStatus,
  upsertMatchCheckin,
} from './platform-ops.js?v=51';
import { startTourIfNeeded } from './onboarding.js';
import { loadLiveMatch } from './live.js';
import { db, run } from './db.js';
import { APP_CONFIG } from './app-config.js';
import { escapeHtml, formatDateTime, formatDuration, getEl, medalByRank, showAppAlert, showAppConfirm, showAppPrompt, showToast } from './utils.js';

const state = {
  admin: null,
  sports: [],
  cachedPlayersRanking: [],
  selectedEventId: null,
  csvPreview: null,
  athleticsReport: null,
  reportColumnPrefs: {},
  venues: [],
  honorRoll: [],
  adminMatches: [],
  matchesViewMode: 'table',
  todayOverview: {},
  internalNotifications: [],
  systemHealth: [],
  communicationTemplates: [],
  publicNotifications: [],
  issueReports: [],
  issueReportsError: null,
  migrationVerification: null,
  registeredDevices: [],
  regiaSnapshot: null,
};
const MOBILE_MENU_BREAKPOINT = 1024;

const adminUsersPanel = createAdminUsersPanel({
  canManageAll: () => canManageAll(state.admin?.ruolo),
});

registerOfflineSupport();
registerClientErrorLogger('admin');

window.__adminBootStarted = true;

function setAdminAuthStatus(message, showActions = false) {
  if (window.__setAdminGuardStatus) {
    window.__setAdminGuardStatus(message, showActions);
    return;
  }
  const status = getEl('admin-auth-status');
  if (status) status.textContent = message;
  const actions = getEl('admin-auth-actions');
  if (actions) actions.hidden = !showActions;
}

function redirectHomeWithAdminError(message) {
  try {
    window.sessionStorage.setItem('tornei_admin_login_error', message);
  } catch (_sessionError) {
    // Session diagnostics are best-effort.
  }
  window.location.href = '../';
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

const CSV_MODE_META = {
  teams_players: {
    successMessage: 'Import CSV squadre/studenti completato.',
    sportType: 'any',
  },
  athletics_events: {
    successMessage: 'Import CSV eventi atletica completato.',
    sportType: 'atletica',
  },
  athletics_results: {
    successMessage: 'Import CSV risultati atletica completato.',
    sportType: 'atletica',
  },
};

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

const RANKING_RULE_LABELS = {
  points: 'Punti in classifica',
  head_to_head: 'Scontri diretti',
  goal_diff: 'Differenza reti / punti',
  goals_for: 'Reti / punti segnati',
  fair_play: 'Fair play',
  draw: 'Sorteggio / ordine casuale',
};

const DEFAULT_RANKING_RULES = ['points', 'head_to_head', 'goal_diff', 'goals_for', 'fair_play', 'draw'];

const COMMUNICATION_TEMPLATE_META = {
  match_30_min: {
    label: 'Promemoria partita',
    purpose: "Messaggio inviato quando ricordi una partita dal calendario o prima dell'inizio.",
    usedBy: 'Icona Telegram nella riga del match',
    variables: ['home', 'away', 'time', 'venue', 'sport'],
  },
  field_change: {
    label: 'Cambio campo / orario',
    purpose: 'Messaggio usato quando cambi campo, orario o dettagli logistici.',
    usedBy: 'Comunicazione preparata dopo una variazione',
    variables: ['home', 'away', 'time', 'venue', 'reason', 'sport'],
  },
  match_postponed: {
    label: 'Partita rinviata',
    purpose: 'Messaggio per comunicare un rinvio con motivazione.',
    usedBy: 'Comunicazione di rinvio partita',
    variables: ['home', 'away', 'reason', 'sport'],
  },
  final_score: {
    label: 'Risultato finale',
    purpose: 'Messaggio per comunicare il risultato dopo la chiusura del match.',
    usedBy: 'Comunicazione risultato finale',
    variables: ['home', 'away', 'home_score', 'away_score', 'sport'],
  },
  qualification: {
    label: 'Qualificazione',
    purpose: 'Messaggio per comunicare il passaggio di una squadra alla fase successiva.',
    usedBy: 'Comunicazione passaggio turno',
    variables: ['team', 'sport'],
  },
  general_notice: {
    label: 'Comunicazione generale',
    purpose: 'Messaggio libero, usato anche per la notifica Telegram di una squadra.',
    usedBy: 'Icona Telegram nella riga della squadra',
    variables: ['message', 'team', 'sport'],
  },
};

const TEMPLATE_VARIABLE_LABELS = {
  home: 'Squadra di casa',
  away: 'Squadra ospite',
  time: 'Orario partita',
  venue: 'Campo / palestra',
  reason: 'Motivo variazione',
  team: 'Squadra / classe',
  sport: 'Torneo',
  message: 'Testo libero',
  home_score: 'Punteggio casa',
  away_score: 'Punteggio ospite',
};

const TEMPLATE_SAMPLE_VALUES = {
  home: '3A',
  away: '3B',
  time: '12/09/26, 10:30',
  venue: 'Palestra Grande',
  reason: 'Cambio campo per sovrapposizione',
  team: '3A',
  sport: 'Calcio M',
  message: 'Presentarsi al tavolo arbitraggio 10 minuti prima.',
  home_score: '2',
  away_score: '1',
};

const REPORT_COLUMNS_STORAGE_PREFIX = 'report_columns_v1_';
const REPORT_COLUMN_GROUPS = {
  team_students: {
    label: 'Ranking Studenti',
    columns: [
      { key: 'rank', label: 'Rank' },
      { key: 'student', label: 'Studente' },
      { key: 'class', label: 'Classe' },
      { key: 'presence', label: 'Presenza' },
      { key: 'fouls', label: 'Falli' },
      { key: 'mvp', label: 'MVP' },
      { key: 'score', label: 'Score' },
    ],
  },
  team_standings: {
    label: 'Classifica Squadre',
    columns: [
      { key: 'position', label: 'Posizione' },
      { key: 'team', label: 'Squadra' },
      { key: 'points', label: 'Punti' },
      { key: 'played', label: 'Giocate' },
      { key: 'wins', label: 'Vittorie' },
      { key: 'draws', label: 'Pareggi' },
      { key: 'losses', label: 'Sconfitte' },
      { key: 'goal_diff', label: 'Differenza reti' },
    ],
  },
  athletics: {
    label: 'Classifica Atletica',
    columns: [
      { key: 'position', label: 'Posizione' },
      { key: 'student', label: 'Studente' },
      { key: 'class', label: 'Classe' },
      { key: 'events', label: 'Eventi' },
      { key: 'medals', label: 'Medaglie' },
      { key: 'points', label: 'Punti' },
    ],
  },
};

function openModal(id) {
  getEl(id)?.classList.add('open');
}

function closeModal(id) {
  getEl(id)?.classList.remove('open');
}

function resetFormValues(form) {
  if (!form) return;
  form.reset();
  form.querySelectorAll('input[type="hidden"]').forEach((input) => {
    input.value = '';
  });
}

function isFilterPanelVisible(filter) {
  return Boolean(filter && !filter.closest('.hidden'));
}

function isFilterPanelOpen(filter) {
  return isFilterPanelVisible(filter) && !filter.classList.contains('is-collapsed');
}

function setFilterToggleState(button, filters) {
  if (!button) return;
  const open = filters.some(isFilterPanelOpen);
  button.classList.toggle('active', open);
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? 'Nascondi filtri' : 'Mostra filtri');
}

function bindFilterToggle(buttonId, filterIds) {
  const button = getEl(buttonId);
  const filters = filterIds.map((id) => getEl(id)).filter(Boolean);
  if (!button || !filters.length) return;

  button.addEventListener('click', () => {
    const shouldOpen = !filters.some(isFilterPanelOpen);
    filters.forEach((filter) => filter.classList.toggle('is-collapsed', !shouldOpen));
    setFilterToggleState(button, filters);
  });

  setFilterToggleState(button, filters);
}

function closeMatchActionMenus(exceptMenu = null) {
  document.querySelectorAll('.match-action-menu.open').forEach((menu) => {
    if (menu !== exceptMenu) menu.classList.remove('open');
  });
}

function getMatchCalendarStatus(match) {
  const operational = String(match?.operational_status ?? '').trim();
  const forcedOperationalMap = {
    cancelled: { key: 'cancelled', label: 'Annullato', badge: 'badge-warning' },
    postponed: { key: 'scheduled', label: 'Rinviato', badge: 'badge-warning' },
  };
  if (forcedOperationalMap[operational]) return forcedOperationalMap[operational];

  if (
    match?.is_finished ||
    ['finished', 'final'].includes(String(match?.status ?? '').trim()) ||
    ['ended', 'awaiting_signatures', 'official'].includes(operational)
  ) {
    if (operational === 'awaiting_signatures') return { key: 'finished', label: 'Firme mancanti', badge: 'badge-warning' };
    if (operational === 'ended') return { key: 'finished', label: 'Terminato', badge: 'badge-info' };
    if (operational === 'official') return { key: 'finished', label: 'Ufficiale', badge: 'badge-success' };
    return { key: 'finished', label: 'Concluso', badge: 'badge-success' };
  }

  if (match?.status === 'live' || ['live', 'paused'].includes(operational)) {
    if (operational === 'paused') return { key: 'in_progress', label: 'Pausa', badge: 'badge-warning' };
    return { key: 'in_progress', label: 'In corso', badge: 'badge-danger' };
  }

  const start = match?.scheduled_start ? new Date(match.scheduled_start) : null;
  const end = match?.scheduled_end ? new Date(match.scheduled_end) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { key: 'unscheduled', label: 'Da programmare', badge: 'badge-warning' };
  }

  const now = new Date();
  if (start <= now && end >= now) {
    return { key: 'in_progress', label: 'In corso', badge: 'badge-danger' };
  }

  if (operational === 'check_in') return { key: 'scheduled', label: 'Check-in', badge: 'badge-info' };
  if (operational === 'ready') return { key: 'scheduled', label: 'Pronto', badge: 'badge-success' };
  if (operational === 'unscheduled') return { key: 'unscheduled', label: 'Da programmare', badge: 'badge-warning' };

  return { key: 'scheduled', label: 'Programmato', badge: 'badge-info' };
}

function getMatchTeamsLabel(match) {
  return `${match?.home?.name ?? 'Da definire'} vs ${match?.away?.name ?? 'Da definire'}`;
}

function getMatchById(matchId) {
  return state.adminMatches.find((item) => Number(item.id) === Number(matchId)) ?? null;
}

const OPERATIONAL_STATUS_LABELS = {
  unscheduled: 'Da programmare',
  scheduled: 'Programmato',
  check_in: 'Check-in',
  ready: 'Pronto',
  live: 'In corso',
  paused: 'In pausa',
  ended: 'Terminato',
  awaiting_signatures: 'In attesa firme',
  official: 'Ufficiale',
  cancelled: 'Annullato',
  postponed: 'Rinviato',
};

function formatOperationalStatusLabel(status) {
  return OPERATIONAL_STATUS_LABELS[String(status ?? '').trim()] ?? 'Programmato';
}

function renderOperationalStatusOptions(currentStatus) {
  const current = String(currentStatus ?? 'scheduled');
  return Object.entries(OPERATIONAL_STATUS_LABELS)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`
    )
    .join('');
}

function getMatchTeamIds(match) {
  return [Number(match?.home_team_id ?? 0), Number(match?.away_team_id ?? 0)]
    .filter((id) => Number.isFinite(id) && id > 0);
}

function getPayloadTeamIds(payload) {
  return [Number(payload?.homeTeamId ?? 0), Number(payload?.awayTeamId ?? 0)]
    .filter((id) => Number.isFinite(id) && id > 0);
}

function getTimeRange(startValue, endValue) {
  const start = startValue ? new Date(startValue).getTime() : NaN;
  const end = endValue ? new Date(endValue).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

function rangesOverlap(a, b) {
  if (!a || !b) return false;
  return a.start < b.end && b.start < a.end;
}

function minutesBetweenRanges(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (rangesOverlap(a, b)) return 0;
  const gapMs = a.end <= b.start ? b.start - a.end : a.start - b.end;
  return Math.max(0, Math.round(gapMs / 60000));
}

function isRelevantScheduleMatch(match, payload) {
  return (
    Number(match.id) !== Number(payload.matchId ?? 0) &&
    Number(match.sport_id) === Number(payload.sportId) &&
    match.status !== 'cancelled'
  );
}

function didMatchVariationChange(originalMatch, payload) {
  if (!originalMatch) return false;
  return didOperationalScheduleChange(originalMatch, payload) ||
    String(originalMatch.schedule_notes ?? '') !== String(payload.scheduleNotes ?? '');
}

function didOperationalScheduleChange(originalMatch, payload) {
  if (!originalMatch) return false;
  const originalStart = originalMatch.scheduled_start ? new Date(originalMatch.scheduled_start).getTime() : null;
  const originalEnd = originalMatch.scheduled_end ? new Date(originalMatch.scheduled_end).getTime() : null;
  const nextStart = payload.scheduledStart ? new Date(payload.scheduledStart).getTime() : null;
  const nextEnd = payload.scheduledEnd ? new Date(payload.scheduledEnd).getTime() : null;
  return (
    Number(originalMatch.home_team_id ?? 0) !== Number(payload.homeTeamId ?? 0) ||
    Number(originalMatch.away_team_id ?? 0) !== Number(payload.awayTeamId ?? 0) ||
    Number(originalMatch.venue_id ?? 0) !== Number(payload.venueId ?? 0) ||
    originalStart !== nextStart ||
    originalEnd !== nextEnd
  );
}


function buildMatchActionItems(match) {
  const actions = [];
  const isFinished = Boolean(match?.is_finished);

  if (!isFinished && canEditMatches(state.admin?.ruolo)) {
    actions.push(`<button class="match-action-item" data-action="start-live" data-id="${match.id}" type="button"><i class="fa-solid fa-play"></i><span>Apri live</span></button>`);
    actions.push(`<button class="match-action-item" data-action="edit-match" data-id="${match.id}" type="button"><i class="fa-solid fa-pen"></i><span>Modifica</span></button>`);
  }
  if (isFinished) {
    actions.push(`<button class="match-action-item" data-action="download-match-report" data-id="${match.id}" type="button"><i class="fa-solid fa-file-pdf"></i><span>Scarica referto</span></button>`);
    if (canManageAll(state.admin?.ruolo)) {
      actions.push(`<button class="match-action-item" data-action="reopen-match" data-id="${match.id}" type="button"><i class="fa-solid fa-unlock-keyhole"></i><span>Riapri correzione</span></button>`);
    }
  }
  actions.push(`<button class="match-action-item" data-action="qr-match" data-id="${match.id}" type="button"><i class="fa-solid fa-qrcode"></i><span>QR match</span></button>`);
  if (canEditMatches(state.admin?.ruolo)) {
    actions.push(`<button class="match-action-item" data-action="telegram-match" data-id="${match.id}" type="button"><i class="fa-brands fa-telegram"></i><span>Promemoria Telegram</span></button>`);
    actions.push(`<button class="match-action-item danger" data-action="delete-match" data-id="${match.id}" type="button"><i class="fa-solid fa-trash"></i><span>Elimina</span></button>`);
  }

  return actions;
}

function renderMatchActionsMenu(match) {
  const actions = buildMatchActionItems(match);
  if (!actions.length) return '<span class="muted">-</span>';

  return `
    <div class="match-action-menu">
      <button class="icon-btn match-action-toggle" data-action="toggle-match-menu" type="button" aria-label="Azioni match" aria-expanded="false">
        <i class="fa-solid fa-ellipsis-vertical"></i>
      </button>
      <div class="match-action-dropdown">
        ${actions.join('')}
      </div>
    </div>
  `;
}

function formatReportDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function boolLabel(value) {
  return value ? 'Si' : 'No';
}

function buildMatchReportFileName(matches) {
  if (matches.length === 1) {
    const match = matches[0];
    const label = `${match.sport?.name ?? 'torneo'}-${match.home?.name ?? 'casa'}-${match.away?.name ?? 'ospite'}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `referto-${label || match.id}.pdf`;
  }
  return `referti-match-conclusi-${new Date().toISOString().slice(0, 10)}.pdf`;
}

function collectMatchReportTeamIds(matches) {
  return [
    ...new Set(
      matches
        .flatMap((match) => [match.home_team_id, match.away_team_id])
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
}

async function loadMatchReportData(matches) {
  const matchIds = matches.map((match) => Number(match.id)).filter((id) => id > 0);
  const teamIds = collectMatchReportTeamIds(matches);
  const signaturePromise = matchIds.length
    ? run(
        db
          .from('match_captain_signatures')
          .select('match_id, team_side, team_id, player_id, captain_name, signature_data_url, signed_at')
          .in('match_id', matchIds),
        'Caricamento firme referto'
      ).catch(() => ({ data: [] }))
    : Promise.resolve({ data: [] });
  const staffPromise = matchIds.length
    ? run(
        db
          .from('match_staff_assignments')
          .select('match_id, role, name')
          .in('match_id', matchIds),
        'Caricamento staff referto'
      ).catch(() => ({ data: [] }))
    : Promise.resolve({ data: [] });

  const [playersResult, statsResult, signaturesResult, staffResult] = await Promise.all([
    teamIds.length
      ? run(
          db.from('players').select('id, team_id, full_name, is_captain').in('team_id', teamIds).order('full_name', { ascending: true }),
          'Caricamento giocatori referto'
        )
      : Promise.resolve({ data: [] }),
    matchIds.length
      ? run(
          db.from('match_stats').select('*').in('match_id', matchIds),
          'Caricamento statistiche referto'
        )
      : Promise.resolve({ data: [] }),
    signaturePromise,
    staffPromise,
  ]);

  const playersByTeam = new Map();
  (playersResult.data ?? []).forEach((player) => {
    const key = Number(player.team_id);
    if (!playersByTeam.has(key)) playersByTeam.set(key, []);
    playersByTeam.get(key).push(player);
  });

  const statsByMatchPlayer = new Map();
  (statsResult.data ?? []).forEach((stat) => {
    statsByMatchPlayer.set(`${Number(stat.match_id)}:${Number(stat.player_id)}`, stat);
  });

  const signaturesByMatchSide = new Map();
  (signaturesResult.data ?? []).forEach((signature) => {
    signaturesByMatchSide.set(`${Number(signature.match_id)}:${signature.team_side}`, signature);
  });

  const staffByMatchRole = new Map();
  (staffResult.data ?? []).forEach((staff) => {
    staffByMatchRole.set(`${Number(staff.match_id)}:${staff.role}`, staff);
  });

  return { playersByTeam, statsByMatchPlayer, signaturesByMatchSide, staffByMatchRole };
}

function getMatchReportSnapshotStat(match, playerId) {
  const snapshot = Array.isArray(match?.live_payload?.stats_snapshot)
    ? match.live_payload.stats_snapshot
    : [];
  return snapshot.find((entry) => Number(entry.player_id) === Number(playerId)) ?? null;
}

function getMatchReportPlayerRows(match, side, reportData) {
  const teamId = Number(side === 'home' ? match.home_team_id : match.away_team_id);
  const players = reportData.playersByTeam.get(teamId) ?? [];

  return players.map((player) => {
    const stat =
      reportData.statsByMatchPlayer.get(`${Number(match.id)}:${Number(player.id)}`) ??
      getMatchReportSnapshotStat(match, player.id) ??
      {};
    return {
      player,
      played: Boolean(stat.played),
      fouls: Number(stat.fouls ?? 0),
      yellowCards: Number(stat.yellow_cards ?? 0),
      redCards: Number(stat.red_cards ?? 0),
      pointsScored: Number(stat.points_scored ?? 0),
      isMvp: Boolean(stat.is_mvp_vote),
    };
  });
}

function renderMatchReportPlayersTable(title, rows) {
  return `
    <section class="match-report-team">
      <h3>${escapeHtml(title)}</h3>
      <table>
        <thead>
          <tr>
            <th>Giocatore</th>
            <th>Cap.</th>
            <th>Pres.</th>
            <th>Falli</th>
            <th>Gialli</th>
            <th>Rossi</th>
            <th>Punti</th>
            <th>MVP</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                      <tr>
                        <td><strong>${escapeHtml(row.player.full_name)}</strong></td>
                        <td>${boolLabel(Boolean(row.player.is_captain))}</td>
                        <td>${boolLabel(row.played)}</td>
                        <td>${row.fouls}</td>
                        <td>${row.yellowCards}</td>
                        <td>${row.redCards}</td>
                        <td>${row.pointsScored}</td>
                        <td>${boolLabel(row.isMvp)}</td>
                      </tr>
                    `
                  )
                  .join('')
              : '<tr><td colspan="8">Nessun giocatore registrato.</td></tr>'
          }
        </tbody>
      </table>
    </section>
  `;
}

function renderMatchReportSignatures(match, reportData) {
  const homeSignature = reportData.signaturesByMatchSide.get(`${Number(match.id)}:home`);
  const awaySignature = reportData.signaturesByMatchSide.get(`${Number(match.id)}:away`);
  const renderSignatureBox = (label, signature) => `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(signature?.captain_name ?? 'Firma non presente')}</strong>
      <small>${escapeHtml(formatReportDateTime(signature?.signed_at))}</small>
      ${
        signature?.signature_data_url
          ? `<img class="match-report-signature-img" src="${escapeHtml(signature.signature_data_url)}" alt="Firma ${escapeHtml(label)}" />`
          : '<em>Immagine firma non disponibile.</em>'
      }
    </div>
  `;

  return `
    <section class="match-report-signatures">
      <h3>Firme capitani</h3>
      <div class="match-report-signature-grid">
        ${renderSignatureBox('Casa', homeSignature)}
        ${renderSignatureBox('Ospite', awaySignature)}
      </div>
    </section>
  `;
}

function renderMatchReportStaff(match, reportData) {
  const getStaffName = (role) =>
    reportData.staffByMatchRole?.get(`${Number(match.id)}:${role}`)?.name ?? 'Non assegnato';

  return `
    <section class="match-report-staff">
      <h3>Staff referto</h3>
      <div class="match-report-meta">
        <div><span>Arbitro</span><strong>${escapeHtml(getStaffName('referee'))}</strong></div>
        <div><span>Segnapunti</span><strong>${escapeHtml(getStaffName('scorekeeper'))}</strong></div>
        <div><span>Responsabile campo</span><strong>${escapeHtml(getStaffName('field_manager'))}</strong></div>
        <div><span>Docente supervisore</span><strong>${escapeHtml(getStaffName('supervisor'))}</strong></div>
      </div>
    </section>
  `;
}

function renderSingleMatchReport(match, reportData) {
  const homeRows = getMatchReportPlayerRows(match, 'home', reportData);
  const awayRows = getMatchReportPlayerRows(match, 'away', reportData);
  const livePayload = match.live_payload ?? {};
  const score = `${Number(match.home_score ?? 0)} - ${Number(match.away_score ?? 0)}`;

  return `
    <article class="match-report-page">
      <header class="match-report-header">
        <div>
          <p>Referto partita</p>
          <h1>${escapeHtml(getMatchTeamsLabel(match))}</h1>
          <div class="match-report-header-meta">
            <span><strong>Torneo</strong> ${escapeHtml(match.sport?.name ?? '-')}</span>
            <span><strong>Fase</strong> ${escapeHtml(match.round_name ?? '-')}</span>
            <span><strong>Campo</strong> ${escapeHtml(match.venue?.name ?? 'Campo da definire')}</span>
            <span><strong>Slot</strong> ${escapeHtml(formatScheduleRange(match))}</span>
            <span><strong>Chiuso il</strong> ${escapeHtml(formatReportDateTime(match.finished_at))}</span>
            <span><strong>Durata live</strong> ${escapeHtml(formatDuration(livePayload.duration ?? match.duration ?? 0))}</span>
          </div>
        </div>
        <div class="match-report-score">${escapeHtml(score)}</div>
      </header>

      ${match.schedule_notes ? `<section class="match-report-notes"><strong>Note:</strong> ${escapeHtml(match.schedule_notes)}</section>` : ''}
      ${renderMatchReportStaff(match, reportData)}
      ${renderMatchReportPlayersTable(match.home?.name ?? 'Casa', homeRows)}
      ${renderMatchReportPlayersTable(match.away?.name ?? 'Ospite', awayRows)}
      ${renderMatchReportSignatures(match, reportData)}
    </article>
  `;
}

function openMatchReportPrintWindow() {
  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    throw new Error('Popup bloccato dal browser. Consenti i popup per scaricare il PDF del referto.');
  }

  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="UTF-8" />
        <title>Preparazione referto</title>
        <style>
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; color: #0f172a; background: #f8fafc; }
          div { padding: 24px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font-weight: 700; }
        </style>
      </head>
      <body><div>Preparazione referto...</div></body>
    </html>
  `);
  printWindow.document.close();
  return printWindow;
}

function openPrintableMatchReports(matches, reportData, printWindow) {
  const pages = matches.map((match) => renderSingleMatchReport(match, reportData)).join('');
  const fileName = buildMatchReportFileName(matches);
  const title = matches.length === 1 ? `Referto ${getMatchTeamsLabel(matches[0])}` : 'Referti match conclusi';

  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #0f172a; font-family: Arial, sans-serif; background: #fff; font-size: 11px; }
          .match-report-page { page-break-after: always; break-after: page; padding: 0; display: flex; flex-direction: column; gap: 12px; }
          .match-report-page:last-child { page-break-after: auto; break-after: auto; }
          .match-report-header { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; break-inside: avoid; }
          .match-report-header p { margin: 0 0 4px; color: #475569; font-size: 10px; font-weight: 700; text-transform: uppercase; }
          .match-report-header h1 { margin: 0; font-size: 24px; line-height: 1.08; }
          .match-report-header-meta { display: flex; flex-wrap: wrap; gap: 5px 14px; margin-top: 8px; color: #334155; font-size: 10px; line-height: 1.25; }
          .match-report-header-meta span { white-space: nowrap; }
          .match-report-header-meta strong { color: #64748b; font-size: 8.5px; text-transform: uppercase; margin-right: 3px; }
          .match-report-score { min-width: 104px; padding: 8px 12px; border: 2px solid #0f172a; text-align: center; font-size: 28px; font-weight: 800; }
          .match-report-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; margin: 0; }
          .match-report-meta div, .match-report-notes, .match-report-signature-grid div { border: 1px solid #cbd5e1; padding: 7px; border-radius: 6px; }
          .match-report-meta span, .match-report-signature-grid span { display: block; color: #64748b; font-size: 9px; font-weight: 700; text-transform: uppercase; margin-bottom: 3px; }
          .match-report-meta strong { font-size: 10.5px; line-height: 1.2; }
          .match-report-notes { margin: 0; font-size: 10.5px; break-inside: avoid; }
          .match-report-staff,
          .match-report-signatures { break-inside: avoid; }
          h3 { margin: 3px 0 6px; font-size: 13px; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; break-inside: auto; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; line-height: 1.2; }
          th { background: #f1f5f9; font-size: 8.5px; text-transform: uppercase; }
          th:not(:first-child), td:not(:first-child) { text-align: center; }
          .match-report-staff .match-report-meta { grid-template-columns: repeat(2, 1fr); }
          .match-report-signature-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
          .match-report-signature-grid strong, .match-report-signature-grid small { display: block; }
          .match-report-signature-grid small { color: #64748b; margin-top: 4px; }
          .match-report-signature-grid em { display: block; margin-top: 10px; color: #64748b; font-size: 10px; }
          .match-report-signature-img { display: block; width: 100%; max-height: 82px; object-fit: contain; margin-top: 8px; border-top: 1px solid #cbd5e1; padding-top: 6px; }
          @media print {
            body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>${pages}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.document.title = fileName.replace(/\.pdf$/i, '');
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

async function downloadMatchReports(matches, printWindow = null) {
  const finishedMatches = (matches ?? []).filter((match) => Boolean(match?.is_finished));
  if (!finishedMatches.length) {
    printWindow?.close();
    showToast('Nessun match concluso da esportare.', 'error');
    return;
  }

  const targetWindow = printWindow ?? openMatchReportPrintWindow();
  try {
    const reportData = await loadMatchReportData(finishedMatches);
    openPrintableMatchReports(finishedMatches, reportData, targetWindow);
  } catch (error) {
    targetWindow.close();
    throw error;
  }
}

async function downloadAllFinishedMatchReports(printWindow) {
  const rows = await listMatchesForAdmin({});
  await downloadMatchReports(rows, printWindow);
}

function renderAthleticsSheetRows(lanes = []) {
  const rows = lanes.length
    ? lanes
    : Array.from({ length: 8 }, (_item, index) => ({
        lane_number: index + 1,
        player: null,
        team: null,
        status: 'scheduled',
      }));

  return rows
    .map(
      (lane) => `
        <tr>
          <td>${escapeHtml(lane.lane_number ?? '-')}</td>
          <td>${escapeHtml(lane.player?.full_name ?? '')}</td>
          <td>${escapeHtml(lane.team?.name ?? '')}</td>
          <td>${escapeHtml(formatAthleticsLaneStatus(lane.status))}</td>
          <td></td>
          <td></td>
        </tr>
      `
    )
    .join('');
}

function openPrintableAthleticsSheets({ sport, events, advanced }, printWindow) {
  const lanesByHeat = new Map();
  (advanced.lanes ?? []).forEach((lane) => {
    const heatId = Number(lane.heat_id);
    lanesByHeat.set(heatId, [...(lanesByHeat.get(heatId) ?? []), lane]);
  });

  const heatRows = advanced.heats?.length
    ? advanced.heats
    : events.map((event, index) => ({
        id: `event-${event.id}`,
        event,
        phase: 'qualification',
        heat_number: index + 1,
        scheduled_start: null,
        notes: 'Foglio senza batteria programmata',
      }));

  const sheets = heatRows
    .map((heat) => {
      const event = heat.event ?? events.find((item) => Number(item.id) === Number(heat.event_id)) ?? {};
      const lanes = lanesByHeat.get(Number(heat.id)) ?? [];
      return `
        <article class="athletics-sheet">
          <header>
            <div>
              <p>Foglio gara atletica</p>
              <h1>${escapeHtml(event.name ?? 'Evento')}</h1>
              <div class="meta">
                <span><strong>Torneo</strong> ${escapeHtml(sport?.name ?? '-')}</span>
                <span><strong>Fase</strong> ${escapeHtml(formatAthleticsPhase(heat.phase))}</span>
                <span><strong>Batteria</strong> ${escapeHtml(heat.heat_number ?? '-')}</span>
                <span><strong>Orario</strong> ${escapeHtml(formatReportDateTime(heat.scheduled_start))}</span>
                <span><strong>Unita</strong> ${escapeHtml(event.unit ?? '-')}</span>
              </div>
            </div>
            <div class="sheet-box">Risultati</div>
          </header>
          ${heat.notes ? `<section class="notes">${escapeHtml(heat.notes)}</section>` : ''}
          <table>
            <thead>
              <tr>
                <th>Corsia</th>
                <th>Studente</th>
                <th>Classe</th>
                <th>Stato</th>
                <th>Risultato</th>
                <th>Note/firma</th>
              </tr>
            </thead>
            <tbody>${renderAthleticsSheetRows(lanes)}</tbody>
          </table>
        </article>
      `;
    })
    .join('');

  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="UTF-8" />
        <title>Fogli gara atletica</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #0f172a; font-family: Arial, sans-serif; background: #fff; font-size: 11px; }
          .athletics-sheet { break-after: page; page-break-after: always; display: flex; flex-direction: column; gap: 12px; }
          .athletics-sheet:last-child { break-after: auto; page-break-after: auto; }
          header { display: flex; justify-content: space-between; gap: 18px; border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
          p { margin: 0 0 4px; color: #475569; font-size: 10px; font-weight: 700; text-transform: uppercase; }
          h1 { margin: 0; font-size: 24px; line-height: 1.08; }
          .meta { display: flex; flex-wrap: wrap; gap: 5px 14px; margin-top: 8px; color: #334155; font-size: 10px; line-height: 1.25; }
          .meta span { white-space: nowrap; }
          .meta strong { color: #64748b; font-size: 8.5px; text-transform: uppercase; margin-right: 3px; }
          .sheet-box { min-width: 104px; padding: 8px 12px; border: 2px solid #0f172a; text-align: center; font-size: 18px; font-weight: 800; align-self: flex-start; }
          .notes { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px; color: #334155; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th, td { border: 1px solid #cbd5e1; padding: 7px 6px; text-align: left; height: 28px; }
          th { background: #f1f5f9; color: #334155; font-size: 8.5px; text-transform: uppercase; }
          th:first-child, td:first-child, th:nth-child(4), td:nth-child(4) { text-align: center; }
          @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
        </style>
      </head>
      <body>${sheets}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

async function printAthleticsRaceSheets() {
  const sportId = Number(getEl('athletics-sport-select')?.value || 0);
  if (!sportId) {
    showToast('Seleziona un torneo atletica.', 'error');
    return;
  }

  const printWindow = openMatchReportPrintWindow();
  try {
    const [events, advanced] = await Promise.all([
      loadAthleticsEvents(sportId),
      loadAthleticsAdvancedData(sportId),
    ]);
    if (advanced.__migrationMissing) {
      printWindow.close();
      showToast('Applica la migrazione 022/026 per stampare i fogli gara avanzati.', 'error');
      return;
    }
    if (!events.length) {
      printWindow.close();
      showToast('Nessun evento atletica da stampare.', 'error');
      return;
    }
    openPrintableAthleticsSheets({
      sport: getSportById(sportId),
      events,
      advanced,
    }, printWindow);
  } catch (error) {
    printWindow.close();
    throw error;
  }
}

async function prepareMatchesForOffline() {
  const rows = state.adminMatches.length ? state.adminMatches : await listMatchesForAdmin({});
  const targets = rows.filter((match) => !match.is_finished && match.status !== 'cancelled');
  if (!targets.length) {
    showToast('Nessun match da preparare offline.', 'error');
    return;
  }

  let cached = 0;
  const failed = [];
  for (const match of targets) {
    try {
      const liveData = await loadLiveMatch(match.id);
      let stats = [];
      try {
        const statsResult = await run(
          db.from('match_stats').select('*').eq('match_id', Number(match.id)),
          'Preparazione statistiche offline'
        );
        stats = statsResult.data ?? [];
      } catch (_error) {
        stats = [];
      }
      if (await saveLiveMatchCacheAsync(match.id, liveData, { stats, source: 'admin-prepare' })) cached += 1;
    } catch (error) {
      failed.push(`${getMatchTeamsLabel(match)}: ${error.message}`);
    }
  }

  const totalCached = await countCachedMatchesAsync();
  if (failed.length) {
    showToast(`Preparati offline ${cached}/${targets.length} match. Cache totale: ${totalCached}. Alcuni match non sono stati salvati.`, 'error');
    return;
  }
  await registerCurrentDevice({ offlineMatchCount: totalCached, isOfflineReady: totalCached > 0 }).catch(() => null);
  showToast(`Modalita offline pronta: ${cached} match salvati su questo dispositivo. Cache totale: ${totalCached}.`, 'success');
}

async function renderOfflineAdminDashboard() {
  const manifest = await getOfflineManifestAsync();
  const rows = Object.values(manifest.matches ?? {}).sort((a, b) =>
    String(a.scheduled_start ?? '').localeCompare(String(b.scheduled_start ?? ''))
  );

  getEl('count-sports').textContent = '-';
  getEl('count-teams').textContent = '-';
  getEl('count-matches').textContent = String(rows.length);
  getEl('count-events').textContent = '-';

  let panel = getEl('offline-admin-panel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'offline-admin-panel';
    panel.className = 'card';
    panel.style.marginTop = '16px';
    getEl('view-dashboard')?.appendChild(panel);
  }

  panel.innerHTML = `
    <div class="card-header"><i class="fa-solid fa-wifi"></i> Modalita offline</div>
    <div class="card-body">
      <div class="empty-state" style="margin-bottom: 12px">
        Supabase non e raggiungibile. Puoi aprire solo i match preparati offline su questo dispositivo.
      </div>
      ${
        rows.length
          ? `<div class="offline-match-list">
              ${rows
                .map(
                  (row) => `
                <a class="offline-match-link" href="live.html?match=${row.match_id}">
                  <strong>${escapeHtml(row.label)}</strong>
                  <span>${escapeHtml(row.sport ?? '-')} · ${escapeHtml(row.scheduled_start ? formatReportDateTime(row.scheduled_start) : 'Senza orario')}</span>
                  <small>Cache: ${escapeHtml(formatReportDateTime(row.cached_at))}</small>
                </a>
              `
                )
                .join('')}
            </div>`
          : '<div class="empty-state">Nessun match preparato offline. Quando torni online usa “Prepara offline” nel calendario.</div>'
      }
    </div>
  `;
}

function startAdminTour() {
  startTourIfNeeded('admin', [
    {
      selector: '#admin-sidebar',
      title: 'Menu principale',
      text: 'Da qui passi tra dashboard, report, calendario, campi, albo, Telegram, tornei, squadre, atletica e impostazioni.',
    },
    {
      selector: '#sidebar-device-card',
      title: 'Nome dispositivo',
      text: 'La postazione viene nominata al primo accesso e poi resta bloccata, cosi il registro modifiche riconosce sempre lo stesso dispositivo.',
    },
    {
      selector: '#link-reports',
      title: 'Report',
      text: 'Consulta ranking, presenze, fair play e dati esportabili. I referti PDF dei match conclusi si scaricano dal calendario.',
    },
    {
      selector: '#link-matches',
      title: 'Calendario',
      text: 'Qui programmi match, apri live, stampi referti e invii promemoria Telegram.',
    },
    {
      selector: '#link-venues',
      title: 'Campi e QR',
      text: 'Gestisci palestre e campi. Ogni campo puo avere un QR da esporre fuori dalla palestra.',
    },
    {
      selector: '#link-teams',
      title: 'Squadre',
      text: 'Gestisci rose, capitani, disponibilita e controlli sul numero minimo di partecipanti.',
    },
    {
      selector: '#link-events',
      title: 'Atletica',
      text: 'Registra eventi, risultati, batterie, classifiche e record scolastici.',
    },
    {
      selector: '#link-telegram',
      title: 'Telegram',
      text: 'Configura e invia comunicazioni al canale della scuola, anche dai pulsanti rapidi di match e squadre.',
    },
    {
      selector: '#link-settings',
      title: 'Impostazioni',
      text: 'Configura criteri di classifica, privacy, limiti cartellini, backup, moduli avanzati e modalita live.',
    },
    {
      selector: null,
      title: 'Prepara offline',
      text: 'Prima dell evento salva su questo dispositivo i dati necessari per usare il live senza connessione.',
    },
    {
      selector: null,
      title: 'Flusso consigliato',
      text: 'Online prepara calendario e dati offline; durante le partite usa il live anche senza rete; quando torna Internet sincronizza le bozze locali.',
    },
  ]);
}

function formatAuditAction(action) {
  const labels = {
    match_updated: 'Match aggiornato',
    match_reopened: 'Match riaperto',
    match_finalized: 'Match finalizzato',
    result_changed: 'Risultato modificato',
    schedule_changed: 'Calendario modificato',
  };
  return labels[action] ?? action ?? 'Modifica';
}

function formatAuditValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Si' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderAuditChangedFields(entry) {
  const fields = Array.isArray(entry.changed_fields) ? entry.changed_fields : [];
  const visibleFields = fields.filter((field) =>
    [
      'home_score',
      'away_score',
      'status',
      'is_finished',
      'scheduled_start',
      'scheduled_end',
      'venue_id',
      'round_name',
      'home_team_id',
      'away_team_id',
      'correction_reason',
    ].includes(field)
  );

  if (!visibleFields.length) {
    return '<div class="audit-fields muted">Campi tecnici aggiornati.</div>';
  }

  return `
    <div class="audit-fields">
      ${visibleFields
        .map((field) => {
          const before = formatAuditValue(entry.before_data?.[field]);
          const after = formatAuditValue(entry.after_data?.[field]);
          return `
            <div class="audit-field-row">
              <strong>${escapeHtml(field)}</strong>
              <span>${escapeHtml(before)} -> ${escapeHtml(after)}</span>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

async function renderMatchAuditLog(matchId) {
  const target = getEl('match-detail-audit-list');
  if (!target) return;

  try {
    let data = [];
    try {
      const result = await run(
        db
          .from('audit_log')
          .select('id, action, actor_label, actor_id, device_id, device_label, changed_at, reason, before_data, after_data, changed_fields')
          .eq('entity_type', 'match')
          .eq('entity_id', Number(matchId))
          .order('changed_at', { ascending: false })
          .limit(12),
        'Caricamento registro modifiche'
      );
      data = result.data ?? [];
    } catch (error) {
      const message = String(error?.message ?? '').toLowerCase();
      if (!message.includes('device_id') && !message.includes('device_label')) throw error;
      const result = await run(
        db
          .from('audit_log')
          .select('id, action, actor_label, actor_id, changed_at, reason, before_data, after_data, changed_fields')
          .eq('entity_type', 'match')
          .eq('entity_id', Number(matchId))
          .order('changed_at', { ascending: false })
          .limit(12),
        'Caricamento registro modifiche'
      );
      data = result.data ?? [];
    }

    if (!data.length) {
      target.innerHTML = '<div class="empty-state">Nessuna modifica registrata. Applica la migrazione 021 per iniziare a tracciare le modifiche.</div>';
      return;
    }

    target.innerHTML = data
      .map(
        (entry) => `
          <article class="audit-log-item">
            <div class="audit-log-head">
              <strong>${escapeHtml(formatAuditAction(entry.action))}</strong>
              <span>${escapeHtml(formatReportDateTime(entry.changed_at))}</span>
            </div>
            <div class="muted">Da: ${escapeHtml(formatAuditActor(entry))}</div>
            ${entry.reason ? `<div class="audit-reason"><strong>Motivo:</strong> ${escapeHtml(entry.reason)}</div>` : ''}
            ${renderAuditChangedFields(entry)}
          </article>
        `
      )
      .join('');
  } catch (error) {
    target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}. Applica la migrazione 021 e ricarica la pagina.</div>`;
  }
}

function formatAuditActor(entry) {
  const actorLabel = String(entry?.actor_label ?? '').trim();
  const deviceLabel = String(entry?.device_label ?? '').trim();
  const isUuid = (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (actorLabel && !isUuid(actorLabel) && deviceLabel) return `${actorLabel} · ${deviceLabel}`;
  if (actorLabel && !isUuid(actorLabel)) return actorLabel;
  if (deviceLabel) return deviceLabel;
  return 'Postazione non registrata';
}

function updateSidebarDeviceLabel() {
  const device = getDeviceInfo();
  const target = getEl('sidebar-device-label');
  if (target) target.textContent = device.label;
  const card = getEl('sidebar-device-card');
  if (card) card.title = `Dispositivo: ${device.label}\nID tecnico: ${device.id}`;
}

function formatCalendarDayKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'unscheduled';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatCalendarDayLabel(key) {
  if (key === 'unscheduled') return 'Da programmare';
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(date);
}

function formatCalendarTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function getCsvMode() {
  return getEl('csv-import-mode')?.value ?? '';
}

function resetCsvImportUi() {
  state.csvPreview = null;

  const fileInput = getEl('input-csv-file');
  if (fileInput) fileInput.value = '';

  getEl('csv-import-file-name').textContent = 'Nessun file selezionato.';
  getEl('csv-import-summary').textContent =
    'Carica un file CSV e clicca Anteprima per vedere validazioni e righe importabili.';
  getEl('csv-import-report').innerHTML = '';
  getEl('btn-csv-confirm-import').disabled = true;
  getEl('btn-csv-preview').disabled = false;

  const previewHead = document.querySelector('#csv-preview-table thead');
  const previewBody = document.querySelector('#csv-preview-table tbody');
  if (previewHead) previewHead.innerHTML = '';
  if (previewBody) previewBody.innerHTML = '';
}

function renderCsvPreviewTable(preview) {
  const previewHead = document.querySelector('#csv-preview-table thead');
  const previewBody = document.querySelector('#csv-preview-table tbody');
  if (!previewHead || !previewBody) return;

  const headerHtml = [
    '<th class="text-center">Riga</th>',
    ...(preview.headers ?? []).map((header) => `<th>${escapeHtml(header)}</th>`),
  ].join('');
  previewHead.innerHTML = `<tr>${headerHtml}</tr>`;

  const rowsHtml = (preview.previewRows ?? [])
    .map((row) => {
      const values = (row.values ?? []).map((value) => `<td>${escapeHtml(value)}</td>`).join('');
      return `<tr><td class="text-center">${row.rowNumber}</td>${values}</tr>`;
    })
    .join('');

  previewBody.innerHTML = rowsHtml || '<tr><td colspan="99" class="empty-state">Nessuna riga disponibile.</td></tr>';
}

function renderCsvValidationReport(validation) {
  const report = getEl('csv-import-report');
  if (!report) return;

  const cards = [];
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];

  if (errors.length) {
    const list = errors
      .slice(0, 12)
      .map((err) => `<div>Riga ${err.row ?? '-'}: ${escapeHtml(err.message)}</div>`)
      .join('');
    cards.push(`<div class="report-card error"><strong>Errori (${errors.length})</strong>${list}</div>`);
  }

  if (warnings.length) {
    const list = warnings
      .slice(0, 8)
      .map((warn) => `<div>${warn.row ? `Riga ${warn.row}: ` : ''}${escapeHtml(warn.message)}</div>`)
      .join('');
    cards.push(`<div class="report-card warning"><strong>Avvisi (${warnings.length})</strong>${list}</div>`);
  }

  if (!cards.length) {
    cards.push('<div class="report-card">Nessun errore bloccante rilevato.</div>');
  }

  report.innerHTML = cards.join('');
}

function renderCsvSummary(preview) {
  const summaryEl = getEl('csv-import-summary');
  if (!summaryEl) return;

  const stats = preview.validation?.stats ?? {};
  const validRows = Number(stats.validRows ?? 0);
  const invalidRows = Number(stats.invalidRows ?? 0);
  const totalRows = Number(preview.totalRows ?? 0);

  summaryEl.innerHTML = `
    File: <strong>${escapeHtml(preview.fileName ?? '-')}</strong> · Delimitatore: <strong>${escapeHtml(preview.delimiter ?? ';')}</strong><br>
    Righe dati: <strong>${totalRows}</strong> · Valide: <strong>${validRows}</strong> · Scartate: <strong>${invalidRows}</strong>
  `;
}

function getCsvSportsForMode(mode) {
  if (CSV_MODE_META[mode]?.sportType === 'atletica') {
    return state.sports.filter((sport) => sport.sport_type === 'atletica');
  }
  return [...state.sports];
}

function getDefaultCsvSportId(mode, sports) {
  if (!sports.length) return '';
  if (mode === 'teams_players') {
    return (
      getEl('select-sport-team')?.value ||
      getEl('settings-sport-select')?.value ||
      getEl('report-sport-select')?.value ||
      String(sports[0].id)
    );
  }
  return (
    getEl('athletics-sport-select')?.value ||
    String(sports[0].id)
  );
}

function openCsvImportModal(mode) {
  const modeMeta = CSV_MODE_META[mode];
  if (!modeMeta) return;
  const modeInfo = getCsvModeInfo(mode);

  const sports = getCsvSportsForMode(mode);
  const sportSelect = getEl('csv-import-sport-select');
  const titleEl = getEl('csv-import-title');

  if (titleEl) titleEl.textContent = modeInfo.title;
  getEl('csv-import-mode').value = mode;

  sportSelect.innerHTML =
    '<option value="">-- Seleziona --</option>' +
    sports.map((sport) => `<option value="${sport.id}">${escapeHtml(sport.name)}</option>`).join('');

  const defaultSportId = getDefaultCsvSportId(mode, sports);
  if (defaultSportId) {
    sportSelect.value = String(defaultSportId);
  }

  resetCsvImportUi();
  getEl('csv-import-summary').textContent = `Formato atteso: ${modeInfo.allFields.join('; ')}. Carica un CSV e clicca Anteprima.`;
  openModal('modal-csv-import');
}

function getCsvImportContext() {
  return {
    mode: getCsvMode(),
    sportId: Number(getEl('csv-import-sport-select')?.value || 0),
  };
}

async function handleCsvPreview() {
  const file = getEl('input-csv-file')?.files?.[0];
  const context = getCsvImportContext();
  const mode = context.mode;

  if (!mode) throw new Error('Modalità import non impostata.');
  if (!context.sportId) throw new Error('Seleziona un torneo prima di proseguire.');

  getEl('btn-csv-preview').disabled = true;
  try {
    const preview = await previewCsvImport(mode, file, context);
    state.csvPreview = { ...preview, sportId: context.sportId, mode };
    renderCsvPreviewTable(preview);
    renderCsvSummary(preview);
    renderCsvValidationReport(preview.validation);

    const canConfirm =
      Number(preview.validation?.stats?.validRows ?? 0) > 0 &&
      Number(preview.validation?.stats?.errors ?? 0) === 0;
    getEl('btn-csv-confirm-import').disabled = !canConfirm;
  } finally {
    getEl('btn-csv-preview').disabled = false;
  }
}

async function handleCsvConfirmImport() {
  const context = getCsvImportContext();
  const mode = context.mode;
  if (!mode) throw new Error('Modalità import non impostata.');
  if (!context.sportId) throw new Error('Seleziona un torneo prima di confermare.');
  if (!state.csvPreview) throw new Error('Esegui prima l\'anteprima del file CSV.');
  if (state.csvPreview.mode !== mode || Number(state.csvPreview.sportId) !== context.sportId) {
    throw new Error('Hai cambiato torneo o tipo import: rifai l\'anteprima prima di confermare.');
  }

  const validRows = state.csvPreview.validation?.validRows ?? [];
  if (!validRows.length) throw new Error('Nessuna riga valida da importare.');

  getEl('btn-csv-confirm-import').disabled = true;
  const result = await applyCsvImport(mode, validRows, context);

  await Promise.all([
    loadDashboardStats(),
    loadTeamsTable(),
    loadEventsSection(),
  ]);

  const msg = CSV_MODE_META[mode]?.successMessage ?? 'Import CSV completato.';
  showToast(
    `${msg} Inseriti: ${result.inserted ?? 0}, aggiornati: ${result.updated ?? 0}, saltati: ${result.skipped ?? 0}.`,
    'success'
  );

  closeModal('modal-csv-import');
}

async function switchView(viewId) {
  if (viewId === 'operations' && !canAccessControlCenter(state.admin?.ruolo)) {
    showToast('Il Centro di controllo e riservato al Super Admin.', 'error');
    viewId = 'dashboard';
  }
  document.querySelectorAll('.view-section').forEach((section) => section.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach((link) => link.classList.remove('active'));
  getEl(`view-${viewId}`)?.classList.add('active');
  document.querySelector(`.sidebar-link[data-view="${viewId}"]`)?.classList.add('active');

  if (viewId === 'dashboard') loadDashboardStats();
  if (viewId === 'operations') await loadRegiaOperations();
  if (viewId === 'sports') loadSportsTable();
  if (viewId === 'teams') loadTeamsTable();
  if (viewId === 'matches') loadMatchesTable();
  if (viewId === 'venues') loadVenuesTable();
  if (viewId === 'archive') loadArchiveTable();
  if (viewId === 'telegram') await renderTelegramView();
  if (viewId === 'reports') loadReportData();
  if (viewId === 'events') loadEventsSection();
  if (viewId === 'settings') loadSettingsForSelectedSport();
}

function formatRoleLabel(role) {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'match_manager') return 'Match Manager';
  if (role === 'report_viewer') return 'Report Manager';
  return 'Ruolo non assegnato';
}

function formatAdminDisplayName(admin) {
  const explicitName = String(admin?.nome ?? '').trim();
  if (explicitName) return explicitName;

  const email = String(admin?.email ?? '').trim();
  if (!email) return 'Amministratore';

  return email.split('@')[0];
}

function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_MENU_BREAKPOINT}px)`).matches;
}

function setSidebarOpen(open) {
  const shell = document.querySelector('.admin-shell');
  const toggle = getEl('btn-mobile-menu');
  if (!shell) return;

  const shouldOpen = Boolean(open) && isMobileLayout();
  shell.classList.toggle('menu-open', shouldOpen);
  document.body.classList.toggle('no-scroll', shouldOpen);

  if (toggle) {
    toggle.setAttribute('aria-expanded', String(shouldOpen));
    const icon = toggle.querySelector('i');
    icon?.classList.toggle('fa-bars', !shouldOpen);
    icon?.classList.toggle('fa-xmark', shouldOpen);
  }
}

function bindMobileSidebar() {
  const shell = document.querySelector('.admin-shell');
  const toggle = getEl('btn-mobile-menu');
  const backdrop = getEl('sidebar-backdrop');
  if (!shell || !toggle || !backdrop) return;

  toggle.addEventListener('click', () => {
    const currentlyOpen = shell.classList.contains('menu-open');
    setSidebarOpen(!currentlyOpen);
  });

  backdrop.addEventListener('click', () => setSidebarOpen(false));

  window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
      setSidebarOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setSidebarOpen(false);
    if (event.key === 'Escape') closeMatchActionMenus();
  });
}

function applyRolePermissions() {
  const role = state.admin?.ruolo;
  const matchWrite = canEditMatches(role);
  const fullWrite = canManageAll(role);
  const controlCenterAccess = canAccessControlCenter(role);

  document.querySelectorAll('[data-requires-match-write]').forEach((el) => {
    el.classList.toggle('hidden', !matchWrite);
  });

  document.querySelectorAll('[data-requires-admin-write]').forEach((el) => {
    el.classList.toggle('hidden', !fullWrite);
  });

  document.querySelectorAll('[data-requires-control-center]').forEach((el) => {
    el.classList.toggle('hidden', !controlCenterAccess);
  });

  if (!fullWrite) {
    ['sports', 'teams', 'settings', 'events'].forEach((view) => {
      document.querySelector(`.sidebar-link[data-view="${view}"]`)?.classList.add('hidden');
    });
  }
  if (!matchWrite) {
    document.querySelector('.sidebar-link[data-view="matches"]')?.classList.add('hidden');
  }
}

function bindSidebar() {
  document.querySelectorAll('.sidebar-link[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      if (view) switchView(view).catch((error) => showToast(error.message, 'error'));
      if (isMobileLayout()) setSidebarOpen(false);
    });
  });
}

function getTeamSports() {
  return state.sports.filter((sport) =>
    TEAM_SPORTS.includes(String(sport?.sport_type ?? '').trim().toLowerCase())
  );
}

function getSportById(sportId) {
  return state.sports.find((sport) => Number(sport.id) === Number(sportId)) ?? null;
}

function getMatchPhaseOptionsForSport(sport) {
  const format = String(sport?.format ?? 'gironi').trim();
  const hasReturn = Boolean(sport?.has_return_match);

  if (format === 'eliminazione') {
    return ['Ottavi di finale', 'Quarti di finale', 'Semifinale 1', 'Semifinale 2', 'Finale'];
  }

  return ['Girone (Andata)', ...(hasReturn ? ['Girone (Ritorno)'] : [])];
}

function renderMatchPhaseOptions(sportId, selectedValue = '') {
  const select = getEl('select-match-phase');
  if (!select) return;
  const options = getMatchPhaseOptionsForSport(getSportById(sportId));
  const normalizedSelected = String(selectedValue || options[0] || '').trim();
  const fullOptions = options.includes(normalizedSelected)
    ? options
    : [normalizedSelected, ...options].filter(Boolean);

  select.innerHTML = fullOptions
    .map((value) => `<option value="${escapeHtml(value)}" ${value === normalizedSelected ? 'selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
}

function renderSportsOptions() {
  const targets = [
    ['report-sport-select', false, false, false],
    ['select-sport-team', false, false, false],
    ['select-sport-match', false, false, true],
    ['playoff-sport-select', false, false, true],
    ['archive-sport-select', false, false, false],
    ['settings-sport-select', false, false, false],
    ['athletics-sport-select', false, true, false],
    ['filter-match-sport', true, false, true],
  ];

  targets.forEach(([id, includeAll, athleticsOnly, teamSportsOnly]) => {
    const el = getEl(id);
    if (!el) return;

    let source = state.sports;
    if (athleticsOnly) {
      source = state.sports.filter((sport) => sport.sport_type === 'atletica');
    } else if (teamSportsOnly) {
      source = getTeamSports();
    }

    const options = source
      .map((sport) => `<option value="${sport.id}">${escapeHtml(sport.name)}</option>`)
      .join('');

    el.innerHTML = `${includeAll ? '<option value="all">Tutti</option>' : '<option value="">-- Seleziona --</option>'}${options}`;
  });
}

function renderVenueOptions() {
  const targets = [
    ['select-match-venue', false],
    ['filter-match-venue', true],
  ];

  targets.forEach(([id, includeAll]) => {
    const el = getEl(id);
    if (!el) return;
    const options = state.venues
      .filter((venue) => includeAll || venue.is_active !== false)
      .map((venue) => `<option value="${venue.id}">${escapeHtml(venue.name)}</option>`)
      .join('');
    el.innerHTML = `${includeAll ? '<option value="all">Tutti</option>' : '<option value="">-- Da definire --</option>'}${options}`;
  });
}

async function refreshSportsState() {
  state.sports = await loadSports({ includeInactive: true });
  renderSportsOptions();
}

async function refreshVenuesState() {
  state.venues = await loadVenues({ includeInactive: true });
  renderVenueOptions();
  renderDeviceOptions();
}

async function refreshDevicesState() {
  state.registeredDevices = await loadRegisteredDevices();
  renderDeviceOptions();
}

function renderDeviceOptions() {
  const select = getEl('select-match-device');
  if (!select) return;
  const options = (state.registeredDevices ?? [])
    .filter((device) => !device.is_revoked && !device.is_blocked)
    .map((device) => {
      const label = device.label || device.device_id;
      const suffix = device.assigned_venue_id
        ? ` · ${state.venues.find((venue) => Number(venue.id) === Number(device.assigned_venue_id))?.name ?? 'campo assegnato'}`
        : '';
      return `<option value="${escapeHtml(device.device_id)}">${escapeHtml(label + suffix)}</option>`;
    })
    .join('');
  select.innerHTML = `<option value="">-- Non assegnata --</option>${options}`;
}

function formatDashboardNumber(value) {
  return Number(value ?? 0).toLocaleString('it-IT');
}

function renderDashboardToday() {
  const target = getEl('dashboard-today-panel');
  if (!target) return;
  const overview = state.todayOverview ?? {};
  const next = overview.next_match ?? null;
  target.innerHTML = `
    <div class="dashboard-metric-list">
      <div><span>Match oggi</span><strong>${formatDashboardNumber(overview.matches_today)}</strong></div>
      <div><span>In corso</span><strong>${formatDashboardNumber(overview.live)}</strong></div>
      <div><span>Conclusi oggi</span><strong>${formatDashboardNumber(overview.finished_today)}</strong></div>
      <div><span>Da programmare</span><strong>${formatDashboardNumber(Number(overview.missing_venue ?? 0) + Number(overview.missing_time ?? 0))}</strong></div>
    </div>
    ${
      next
        ? `<div class="dashboard-next-match">
            <span>Prossimo match</span>
            <strong>${escapeHtml(next.home ?? 'Da definire')} vs ${escapeHtml(next.away ?? 'Da definire')}</strong>
            <small>${escapeHtml(next.sport ?? '-')} · ${escapeHtml(formatReportDateTime(next.scheduled_start))} · ${escapeHtml(next.venue ?? 'Campo da definire')}</small>
          </div>`
        : '<div class="empty-state compact">Nessun prossimo match programmato.</div>'
    }
  `;
}

function renderInternalNotifications() {
  const target = getEl('dashboard-notifications-panel');
  if (!target) return;
  const rows = state.internalNotifications ?? [];
  target.innerHTML = rows.length
    ? `<div class="internal-notification-list">
        ${rows
          .map(
            (row) => `
              <article class="internal-notification ${escapeHtml(row.severity)}">
                <div>
                  <strong>${escapeHtml(row.title)}</strong>
                  <p>${escapeHtml(row.message)}</p>
                  <small>${escapeHtml(formatReportDateTime(row.created_at))}</small>
                </div>
                <button class="icon-btn small-icon" data-action="read-internal-notification" data-id="${row.id}" type="button" title="Segna letta" aria-label="Segna letta">
                  <i class="fa-solid fa-check"></i>
                </button>
              </article>
            `
          )
          .join('')}
      </div>`
    : '<div class="empty-state compact">Nessuna notifica interna aperta.</div>';
}

function renderSystemHealthPanel() {
  const target = getEl('dashboard-health-panel');
  if (!target) return;
  const rows = state.systemHealth ?? [];
  target.innerHTML = rows.length
    ? `<div class="health-check-list">
        ${rows
          .map(
            (row) => `
              <div class="health-check-row ${escapeHtml(row.status)}">
                <span>${escapeHtml(row.check_key)}</span>
                <strong>${escapeHtml(row.status)}</strong>
                <small>${escapeHtml(row.message ?? '')}</small>
              </div>
            `
          )
          .join('')}
      </div>`
    : '<div class="empty-state compact">Nessun controllo disponibile. Applica la migrazione 024.</div>';
}

function renderIssueReportsPanel() {
  const target = getEl('dashboard-issues-panel');
  if (!target) return;
  if (state.issueReportsError) {
    target.innerHTML = `
      <div class="empty-state compact">
        Non riesco a leggere le segnalazioni. ${escapeHtml(state.issueReportsError)}
      </div>
    `;
    return;
  }
  const rows = (state.issueReports ?? []).filter((issue) => issue.status !== 'resolved');
  target.innerHTML = rows.length
    ? `<div class="issue-report-list">
        ${rows
          .slice(0, 5)
          .map(
            (issue) => `
              <article class="issue-report-row">
                <strong>${escapeHtml(issue.reporter ?? 'Segnalazione')}</strong>
                <p>${escapeHtml(issue.message ?? '').slice(0, 160)}</p>
                <small>${escapeHtml(formatReportDateTime(issue.created_at))} · ${escapeHtml(issue.status)}</small>
              </article>
            `
          )
          .join('')}
      </div>`
    : '<div class="empty-state compact">Nessun problema aperto.</div>';
}

function formatRegiaStatusLabel(status) {
  const labels = {
    available: 'Disponibile',
    busy: 'Occupato',
    temporarily_closed: 'Chiuso temporaneamente',
    maintenance: 'Manutenzione',
    unavailable: 'Non disponibile',
  };
  return labels[status] ?? 'Disponibile';
}

function formatDeviceStatus(device) {
  if (device?.is_revoked) return { label: 'Revocato', badge: 'badge-danger' };
  if (device?.is_blocked) return { label: 'Bloccato', badge: 'badge-danger' };
  if (device?.is_offline_ready) return { label: 'Offline pronto', badge: 'badge-success' };
  return { label: 'Attivo', badge: 'badge-info' };
}

function renderRegiaMetric(id, value) {
  const el = getEl(id);
  if (el) el.textContent = formatDashboardNumber(value ?? 0);
}

function isDeviceCritical(device) {
  if (!device) return false;
  if (device.is_revoked || device.is_blocked) return true;
  if (!device.is_offline_ready) return true;
  const lastSeen = device.last_sync_at || device.last_seen_at;
  if (!lastSeen) return true;
  const ageMinutes = (Date.now() - new Date(lastSeen).getTime()) / 60000;
  return Number.isFinite(ageMinutes) && ageMinutes > 30;
}

function getRegiaEventMode(snapshot = {}) {
  const matches = snapshot?.matches ?? {};
  const venues = snapshot?.venues ?? [];
  const devices = snapshot?.devices ?? [];
  const issues = snapshot?.issues ?? [];
  const closedVenue = venues.some((venue) => ['temporarily_closed', 'maintenance', 'unavailable'].includes(venue.status ?? venue.operational_status));
  const criticalDevices = devices.filter(isDeviceCritical).length;
  if (Number(matches.paused ?? 0) > 0) {
    return { label: 'Sospensione attiva', icon: 'fa-pause', tone: 'danger' };
  }
  return { label: 'Operativo', icon: 'fa-circle-check', tone: 'success' };
}

function renderRegiaHeroStatus(snapshot = {}) {
  const mode = getRegiaEventMode(snapshot);
  const badge = getEl('regia-mode-badge');
  if (badge) {
    badge.className = `regia-status-chip ${mode.tone}`;
    badge.innerHTML = `<i class="fa-solid ${mode.icon}"></i> ${escapeHtml(mode.label)}`;
  }
  const refresh = getEl('regia-last-refresh');
  if (refresh) refresh.textContent = `Aggiornato ${formatReportDateTime(new Date().toISOString())}`;
}

function renderRegiaChecklist(rows) {
  const target = getEl('regia-checklist-panel');
  if (!target) return;
  const items = Array.isArray(rows) ? rows : [];
  const okCount = Math.max(0, 8 - items.filter((row) => row.severity === 'error' || row.severity === 'warning').length);
  const percent = Math.round((okCount / 8) * 100);
  const snapshotPercent = Number(state.regiaSnapshot?.readiness_percent ?? percent);
  const readiness = getEl('regia-readiness-value');
  if (readiness) readiness.textContent = `${snapshotPercent}%`;
  target.innerHTML = items.length
    ? `<div class="regia-checklist">
        ${items
          .slice(0, 12)
          .map(
            (row) => `
              <button class="regia-check-item ${escapeHtml(row.severity ?? 'warning')}" data-entity-type="${escapeHtml(row.entity_type ?? '')}" data-entity-id="${escapeHtml(row.entity_id ?? '')}" type="button">
                <i class="fa-solid ${row.severity === 'error' ? 'fa-xmark' : 'fa-triangle-exclamation'}"></i>
                <span>${escapeHtml(row.message ?? 'Controllo senza descrizione')}</span>
              </button>
            `
          )
          .join('')}
      </div>`
    : `<div class="regia-checklist">
        <div class="regia-check-item success"><i class="fa-solid fa-check"></i><span>Tornei configurati</span></div>
        <div class="regia-check-item success"><i class="fa-solid fa-check"></i><span>Calendario senza errori bloccanti</span></div>
        <div class="regia-check-item success"><i class="fa-solid fa-check"></i><span>Backup e controlli pronti</span></div>
      </div>`;
}

function buildRegiaActionQueue(snapshot = {}, checklist = []) {
  const items = [];
  const matches = snapshot?.matches ?? {};
  const devices = snapshot?.devices ?? [];
  const venues = snapshot?.venues ?? [];
  const issues = snapshot?.issues ?? [];
  const delayed = snapshot?.delayed_matches ?? [];

  if (Number(matches.paused ?? 0) > 0) {
    items.push({
      severity: 'danger',
      icon: 'fa-pause',
      title: `${formatDashboardNumber(matches.paused)} match sospesi`,
      detail: 'Verifica se riprendere, rinviare o comunicare una nuova fascia oraria.',
      entityType: 'matches',
    });
  }

  delayed.slice(0, 4).forEach((match) => {
    items.push({
      severity: Number(match.delay_minutes ?? 0) >= 15 ? 'danger' : 'warning',
      icon: 'fa-stopwatch',
      title: `${match.home ?? 'Da definire'} vs ${match.away ?? 'Da definire'} in ritardo`,
      detail: `${match.venue ?? 'Campo da definire'} · +${Number(match.delay_minutes ?? 0)} min`,
      entityType: 'match',
      entityId: match.id,
    });
  });

  checklist
    .filter((row) => ['error', 'warning'].includes(row?.severity))
    .slice(0, 5)
    .forEach((row) => {
      items.push({
        severity: row.severity ?? 'warning',
        icon: row.severity === 'error' ? 'fa-xmark' : 'fa-triangle-exclamation',
        title: row.message ?? 'Controllo da verificare',
        detail: row.code ?? 'validazione',
        entityType: row.entity_type,
        entityId: row.entity_id,
      });
    });

  venues
    .filter((venue) => ['temporarily_closed', 'maintenance', 'unavailable'].includes(venue.status ?? venue.operational_status))
    .slice(0, 4)
    .forEach((venue) => {
      items.push({
        severity: 'danger',
        icon: 'fa-location-dot',
        title: `${venue.name ?? 'Campo'} non disponibile`,
        detail: venue.reason || formatRegiaStatusLabel(venue.status ?? venue.operational_status),
        entityType: 'venue',
        entityId: venue.id,
      });
    });

  devices
    .filter(isDeviceCritical)
    .slice(0, 4)
    .forEach((device) => {
      const status = formatDeviceStatus(device);
      items.push({
        severity: device.is_revoked || device.is_blocked ? 'danger' : 'warning',
        icon: 'fa-laptop',
        title: device.label || 'Postazione senza nome',
        detail: status.label,
        entityType: 'device',
        entityId: device.device_id,
      });
    });

  issues.slice(0, 4).forEach((issue) => {
    items.push({
      severity: 'warning',
      icon: 'fa-message',
      title: issue.reporter || 'Problema segnalato',
      detail: String(issue.message ?? '').slice(0, 120),
      entityType: 'issue',
      entityId: issue.id,
    });
  });

  const severityOrder = { danger: 0, error: 0, warning: 1, info: 2, success: 3 };
  return items.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2)).slice(0, 12);
}

function renderRegiaActionQueue(snapshot = {}, checklist = []) {
  const target = getEl('regia-action-queue-panel');
  if (!target) return;
  const items = buildRegiaActionQueue(snapshot, checklist);
  if (!items.length) {
    target.innerHTML = `
      <div class="regia-action-empty">
        <i class="fa-solid fa-circle-check"></i>
        <div>
          <strong>Nessun intervento urgente</strong>
          <span>Campi, match, postazioni e segnalazioni non richiedono azioni immediate.</span>
        </div>
      </div>
    `;
    return;
  }

  target.innerHTML = `
    <div class="regia-action-queue">
      ${items
        .map(
          (item) => `
            <button class="regia-action-item ${escapeHtml(item.severity)}" type="button" data-entity-type="${escapeHtml(item.entityType ?? '')}" data-entity-id="${escapeHtml(item.entityId ?? '')}">
              <i class="fa-solid ${escapeHtml(item.icon)}"></i>
              <span>
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.detail)}</small>
              </span>
            </button>
          `
        )
        .join('')}
    </div>
  `;
}

function renderRegiaVenues(venues = []) {
  const target = getEl('regia-venues-panel');
  if (!target) return;
  target.innerHTML = venues.length
    ? `<div class="regia-venue-list">
        ${venues
          .map(
            (venue) => `
              <article class="regia-venue-row">
                <div>
                  <strong>${escapeHtml(venue.name)}</strong>
                  <small>${escapeHtml(venue.reason || `${Number(venue.matches_today ?? 0)} match oggi`)}</small>
                </div>
                <div class="regia-venue-actions" data-venue-id="${venue.id}">
                  <select data-action="regia-venue-status">
                    ${['available', 'busy', 'temporarily_closed', 'maintenance', 'unavailable']
                      .map((status) => `<option value="${status}" ${status === (venue.status ?? venue.operational_status) ? 'selected' : ''}>${escapeHtml(formatRegiaStatusLabel(status))}</option>`)
                      .join('')}
                  </select>
                </div>
              </article>
            `
          )
          .join('')}
      </div>`
    : '<div class="empty-state">Nessun campo configurato.</div>';
}

function renderRegiaDevices(devices = []) {
  const target = getEl('regia-devices-panel');
  if (!target) return;
  if (!devices.length) {
    target.innerHTML = '<div class="empty-state">Nessuna postazione registrata. Apri la piattaforma da ogni dispositivo per registrarlo.</div>';
    return;
  }

  target.innerHTML = `
    <table class="regia-device-table">
      <thead><tr><th>Postazione</th><th>Campo</th><th>Operatore</th><th>Offline</th><th>Ultimo sync</th><th>Stato</th><th>Azioni</th></tr></thead>
      <tbody>
        ${devices
          .map((device) => {
            const status = formatDeviceStatus(device);
            const venueOptions = [
              '<option value="">Nessun campo</option>',
              ...state.venues.map((venue) => `<option value="${venue.id}" ${Number(device.assigned_venue_id) === Number(venue.id) ? 'selected' : ''}>${escapeHtml(venue.name)}</option>`),
            ].join('');
            return `
              <tr data-device-id="${escapeHtml(device.device_id)}">
                <td>
                  <strong>${escapeHtml(device.label || 'Dispositivo non nominato')}</strong>
                  <small>${escapeHtml(String(device.device_id).slice(0, 8))}</small>
                </td>
                <td><select data-device-field="venue">${venueOptions}</select></td>
                <td><input data-device-field="operator" type="text" value="${escapeHtml(device.operator_name ?? '')}" placeholder="Operatore" /></td>
                <td>${device.is_offline_ready ? 'Pronto' : 'Da preparare'} · ${Number(device.offline_match_count ?? 0)} match</td>
                <td>${escapeHtml(formatReportDateTime(device.last_sync_at ?? device.last_seen_at))}</td>
                <td><span class="badge ${status.badge}">${escapeHtml(status.label)}</span></td>
                <td>
                  <div class="table-actions">
                    <button class="icon-btn edit" data-action="save-regia-device" title="Salva postazione" aria-label="Salva postazione"><i class="fa-solid fa-floppy-disk"></i></button>
                    <button class="icon-btn ${device.is_blocked ? 'edit' : 'delete'}" data-action="toggle-regia-device-block" title="${device.is_blocked ? 'Sblocca' : 'Blocca'} dispositivo" aria-label="${device.is_blocked ? 'Sblocca' : 'Blocca'} dispositivo"><i class="fa-solid ${device.is_blocked ? 'fa-unlock' : 'fa-ban'}"></i></button>
                    <button class="icon-btn delete" data-action="revoke-regia-device" title="Revoca dispositivo" aria-label="Revoca dispositivo"><i class="fa-solid fa-plug-circle-xmark"></i></button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function renderRegiaDelays(delays = []) {
  const target = getEl('regia-delays-panel');
  if (!target) return;
  target.innerHTML = delays.length
    ? `<div class="regia-automation-note">
        <i class="fa-solid fa-wand-magic-sparkles"></i>
        <span>Ritardi rilevati oltre la tolleranza.</span>
      </div>
      <div class="regia-delay-list">
        ${delays
          .map(
            (match) => `
              <button class="regia-delay-row" data-action="open-match-detail" data-id="${match.id}" type="button">
                <strong>${escapeHtml(match.sport ?? '-')} · ${escapeHtml(match.home ?? 'Da definire')} vs ${escapeHtml(match.away ?? 'Da definire')}</strong>
                <span>${escapeHtml(match.venue ?? 'Campo da definire')} · +${Number(match.delay_minutes ?? 0)} min</span>
              </button>
            `
          )
          .join('')}
      </div>`
    : `<div class="regia-automation-note success">
        <i class="fa-solid fa-circle-check"></i>
        <span>Nessun ritardo oltre la tolleranza. Gli slittamenti automatici si applicano alla chiusura dei live in ritardo.</span>
      </div>`;
}

function renderRegiaIssues(issues = []) {
  const target = getEl('regia-issues-panel');
  if (!target) return;
  target.innerHTML = issues.length
    ? `<div class="issue-report-list">
        ${issues
          .slice(0, 8)
          .map(
            (issue) => `
              <article class="issue-report-row">
                <strong>${escapeHtml(issue.reporter ?? 'Segnalazione')}</strong>
                <p>${escapeHtml(issue.message ?? '').slice(0, 180)}</p>
                <small>${escapeHtml(formatReportDateTime(issue.created_at))} · ${escapeHtml(issue.status ?? 'open')}</small>
              </article>
            `
          )
          .join('')}
      </div>`
    : '<div class="empty-state compact">Nessun problema operativo aperto.</div>';
}

function renderRegiaAnalytics(snapshot) {
  const target = getEl('regia-analytics-panel');
  if (!target) return;
  const matches = snapshot?.matches ?? {};
  const venues = snapshot?.venues ?? [];
  const devices = snapshot?.devices ?? [];
  const finished = Number(matches.finished ?? 0);
  const total = Number(matches.total ?? 0);
  const completion = total ? Math.round((finished / total) * 100) : 0;
  const unavailableVenues = venues.filter((venue) => ['temporarily_closed', 'maintenance', 'unavailable'].includes(venue.status ?? venue.operational_status)).length;
  target.innerHTML = `
    <div class="regia-analytics-grid">
      <div><span>Match totali</span><strong>${formatDashboardNumber(matches.total)}</strong></div>
      <div><span>Ufficiali</span><strong>${formatDashboardNumber(matches.official)}</strong></div>
      <div><span>Campi attivi</span><strong>${formatDashboardNumber(venues.filter((venue) => venue.active !== false).length)}</strong></div>
      <div><span>Dispositivi offline pronti</span><strong>${formatDashboardNumber(devices.filter((device) => device.is_offline_ready && !device.is_revoked && !device.is_blocked).length)}</strong></div>
      <div><span>Problemi aperti</span><strong>${formatDashboardNumber((snapshot?.issues ?? []).length)}</strong></div>
      <div><span>Match sospesi</span><strong>${formatDashboardNumber(matches.paused)}</strong></div>
      <div><span>Avanzamento evento</span><strong>${completion}%</strong></div>
      <div><span>Campi non disponibili</span><strong>${formatDashboardNumber(unavailableVenues)}</strong></div>
    </div>
  `;
}

function handleRegiaActionNavigation(actionEl) {
  const type = actionEl?.dataset?.entityType;
  const rawId = actionEl?.dataset?.entityId;
  const numericId = Number(rawId || 0);

  if (type === 'match' && numericId) {
    switchView('matches')
      .then(() => openMatchDetail(numericId))
      .catch((error) => showToast(error.message, 'error'));
    return;
  }

  if (type === 'team') {
    switchView('teams').catch((error) => showToast(error.message, 'error'));
    return;
  }

  if (type === 'venue') {
    switchView('venues').catch((error) => showToast(error.message, 'error'));
    return;
  }

  if (type === 'device') {
    getEl('regia-devices-panel')?.scrollIntoView({ block: 'center' });
    return;
  }

  if (type === 'issue') {
    getEl('regia-issues-panel')?.scrollIntoView({ block: 'center' });
    return;
  }

  if (type === 'matches') {
    switchView('matches').catch((error) => showToast(error.message, 'error'));
  }
}

async function loadRegiaOperations() {
  if (!canAccessControlCenter(state.admin?.ruolo)) return;
  const [snapshot, checklist] = await Promise.all([
    loadRegiaOperationalSnapshot({ toleranceMinutes: 10 }),
    validatePreEvent(null).catch(() => []),
  ]);
  state.regiaSnapshot = snapshot ?? {};
  state.registeredDevices = snapshot?.devices ?? state.registeredDevices ?? [];
  const matches = snapshot?.matches ?? {};
  const devices = snapshot?.devices ?? [];
  const issues = snapshot?.issues ?? [];
  renderRegiaHeroStatus(snapshot);
  renderRegiaMetric('regia-count-finished', matches.finished);
  renderRegiaMetric('regia-count-live', matches.live);
  renderRegiaMetric('regia-count-scheduled', matches.scheduled);
  renderRegiaMetric('regia-count-delayed', matches.delayed);
  renderRegiaMetric('regia-count-unscheduled', matches.unscheduled);
  renderRegiaMetric('regia-count-paused', matches.paused);
  renderRegiaMetric('regia-count-device-alerts', devices.filter(isDeviceCritical).length);
  renderRegiaMetric('regia-count-issues', issues.length);
  renderRegiaActionQueue(snapshot, checklist);
  renderRegiaChecklist(checklist);
  renderRegiaVenues(snapshot?.venues ?? []);
  renderRegiaDevices(devices);
  renderRegiaDelays(snapshot?.delayed_matches ?? []);
  renderRegiaIssues(issues);
  renderRegiaAnalytics(snapshot);
  renderDeviceOptions();
}

async function handleRegiaVenueStatusChange(select) {
  const row = select.closest('[data-venue-id]');
  const venueId = Number(row?.dataset.venueId || 0);
  if (!venueId) return;
  const reason = await showAppPrompt('Motivo dello stato campo:', {
    title: 'Stato campo',
    inputLabel: 'Motivo',
    placeholder: 'Es. pioggia, manutenzione, campo occupato...',
    confirmLabel: 'Aggiorna',
  });
  if (reason === null) {
    await loadRegiaOperations();
    return;
  }
  await setVenueOperationalStatus(venueId, select.value, reason);
  await Promise.all([refreshVenuesState(), loadRegiaOperations()]);
  showToast('Stato campo aggiornato.', 'success');
}

async function handleSaveRegiaDevice(row) {
  const deviceId = row?.dataset.deviceId;
  if (!deviceId) return;
  const current = (state.regiaSnapshot?.devices ?? []).find((device) => String(device.device_id) === String(deviceId)) ?? {};
  await updateRegisteredDeviceAdmin({
    deviceId,
    assignedVenueId: row.querySelector('[data-device-field="venue"]')?.value || null,
    operatorName: row.querySelector('[data-device-field="operator"]')?.value || '',
    isRevoked: Boolean(current.is_revoked),
    isBlocked: Boolean(current.is_blocked),
    anomalyNote: current.anomaly_note ?? '',
  });
  await loadRegiaOperations();
  showToast('Postazione aggiornata.', 'success');
}

async function handleToggleRegiaDeviceBlock(row) {
  const deviceId = row?.dataset.deviceId;
  if (!deviceId) return;
  const current = (state.regiaSnapshot?.devices ?? []).find((device) => String(device.device_id) === String(deviceId)) ?? {};
  const shouldBlock = !current.is_blocked;
  const reason = shouldBlock
    ? await showAppPrompt('Motivo blocco dispositivo:', {
        title: 'Blocca dispositivo',
        inputLabel: 'Motivo',
        placeholder: 'Es. postazione non autorizzata',
        confirmLabel: 'Blocca',
      })
    : '';
  if (reason === null) return;
  await updateRegisteredDeviceAdmin({
    deviceId,
    assignedVenueId: current.assigned_venue_id ?? null,
    assignedAdminId: current.assigned_admin_id ?? null,
    operatorName: current.operator_name ?? '',
    isRevoked: Boolean(current.is_revoked),
    isBlocked: shouldBlock,
    anomalyNote: reason || current.anomaly_note || '',
  });
  await loadRegiaOperations();
  showToast(shouldBlock ? 'Dispositivo bloccato.' : 'Dispositivo sbloccato.', 'success');
}

async function handleRevokeRegiaDevice(row) {
  const deviceId = row?.dataset.deviceId;
  if (!deviceId) return;
  if (!(await showAppConfirm('Revocare questa postazione? Non verra piu considerata operativa.', {
    title: 'Revoca dispositivo',
    tone: 'danger',
    confirmLabel: 'Revoca',
  }))) return;
  const current = (state.regiaSnapshot?.devices ?? []).find((device) => String(device.device_id) === String(deviceId)) ?? {};
  await updateRegisteredDeviceAdmin({
    deviceId,
    assignedVenueId: current.assigned_venue_id ?? null,
    assignedAdminId: current.assigned_admin_id ?? null,
    operatorName: current.operator_name ?? '',
    isRevoked: true,
    isBlocked: Boolean(current.is_blocked),
    anomalyNote: 'Revocato dal Super Admin',
  });
  await loadRegiaOperations();
  showToast('Dispositivo revocato.', 'success');
}

async function refreshSystemHealth() {
  const offlineSummary = await getOfflineStorageSummary().catch(() => ({
    indexedDbAvailable: false,
    cachedMatches: 0,
    queuedOperations: 0,
    conflictOperations: 0,
  }));
  const checks = [
    {
      checkKey: 'supabase',
      status: 'ok',
      message: 'Connessione e query admin disponibili.',
    },
    {
      checkKey: 'telegram',
      status: APP_CONFIG.telegramChannelUrl ? 'ok' : 'warning',
      message: APP_CONFIG.telegramChannelUrl
        ? `Canale configurato: ${APP_CONFIG.telegramChannelLabel ?? APP_CONFIG.telegramChannelUrl}`
        : 'Canale Telegram non configurato in app-config.js.',
    },
    {
      checkKey: 'pwa_cache',
      status: navigator.serviceWorker ? 'ok' : 'warning',
      message: navigator.serviceWorker ? 'Service Worker disponibile.' : 'Service Worker non disponibile nel browser.',
    },
    {
      checkKey: 'offline_storage',
      status: offlineSummary.indexedDbAvailable ? 'ok' : 'warning',
      message: `${formatDashboardNumber(offlineSummary.cachedMatches ?? offlineSummary.liveCacheCount)} match preparati, ${formatDashboardNumber(offlineSummary.queuedOperations ?? offlineSummary.queuedOperationsCount)} operazioni in coda, ${formatDashboardNumber(offlineSummary.conflictOperations)} conflitti.`,
    },
  ];

  await Promise.all(checks.map((check) => saveSystemHealthCheck(check).catch(() => null)));
  state.systemHealth = await loadSystemHealthChecks();
}

async function refreshOperationalDashboard() {
  const [statistics, issueResult, migrations] = await Promise.all([
    loadEventStatistics(),
    loadIssueReports({ limit: 8 })
      .then((rows) => ({ rows, error: null }))
      .catch((error) => ({ rows: [], error: error.message })),
    verifyPlatformMigrations().catch((error) => ({
      ok: false,
      applied: [],
      missing: ['026'],
      rows: [],
      error: error.message,
    })),
  ]);
  state.eventStatistics = statistics ?? {};
  state.issueReports = issueResult.rows ?? [];
  state.issueReportsError = issueResult.error ?? null;
  state.migrationVerification = migrations;
  await refreshSystemHealth();
  renderSystemHealthPanel();
  renderMigrationVerification();
  renderIssueReportsPanel();
}

function renderMigrationVerification() {
  const target = getEl('dashboard-health-panel');
  const verification = state.migrationVerification;
  if (!target || !verification) return;

  const pills = [
    ...verification.applied
      .filter((version) => Number(version) >= 21)
      .map((version) => `<span class="migration-pill ok"><i class="fa-solid fa-check"></i> ${escapeHtml(version)}</span>`),
    ...verification.missing.map((version) => `<span class="migration-pill missing"><i class="fa-solid fa-xmark"></i> ${escapeHtml(version)}</span>`),
  ].join('');

  target.insertAdjacentHTML(
    'beforeend',
    `<div class="migration-status-list" aria-label="Migrazioni Supabase">${pills || '<span class="migration-pill missing">Migrazioni non lette</span>'}</div>`
  );
}

async function loadDashboardStats() {
  const [sportsCount, teamsCount, matchesCount, eventsCount] = await Promise.all([
    run(db.from('sports').select('*', { count: 'exact', head: true }), 'Conteggio tornei'),
    run(db.from('teams').select('*', { count: 'exact', head: true }), 'Conteggio squadre'),
    run(db.from('matches').select('*', { count: 'exact', head: true }).eq('is_finished', true), 'Conteggio partite concluse'),
    run(db.from('events').select('*', { count: 'exact', head: true }).eq('is_active', true), 'Conteggio eventi atletica'),
  ]);

  getEl('count-sports').textContent = String(sportsCount.count ?? 0);
  getEl('count-teams').textContent = String(teamsCount.count ?? 0);
  getEl('count-matches').textContent = String(matchesCount.count ?? 0);
  getEl('count-events').textContent = String(eventsCount.count ?? 0);
  await refreshOperationalDashboard();
}
function renderSportsTableRows() {
  const body = getEl('table-sports-body');
  if (!body) return;

  body.innerHTML = state.sports
    .map(
      (sport) => `
      <tr>
        <td><strong>${escapeHtml(sport.name)}</strong></td>
        <td>${escapeHtml(sport.sport_type)}</td>
        <td>${escapeHtml(FORMAT_LABELS[sport.format] ?? sport.format)}</td>
        <td>${sport.year ?? '-'}</td>
        <td>${sport.is_active ? '<span class="badge badge-success">Attivo</span>' : '<span class="badge badge-warning">Disattivo</span>'}</td>
        <td>
          <div class="table-actions" ${canManageAll(state.admin?.ruolo) ? '' : 'style="display:none"'}>
            <button class="icon-btn edit" data-action="qr-sport" data-id="${sport.id}" title="QR torneo" aria-label="QR torneo"><i class="fa-solid fa-qrcode"></i></button>
            <button class="icon-btn edit" data-action="edit-sport" data-id="${sport.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn delete" data-action="delete-sport" data-id="${sport.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `
    )
    .join('');
}

async function loadSportsTable() {
  renderSportsTableRows();
}

async function loadTeamsTable() {
  const { data: teams } = await run(
    db.from('teams').select('*, sports(name), players(full_name, is_captain)').order('name', { ascending: true }),
    'Caricamento tabella squadre'
  );

  const body = getEl('table-teams-body');
  if (!body) return;

  body.innerHTML = (teams ?? [])
    .map((team) => {
      const captain = (team.players ?? []).find((player) => Boolean(player.is_captain));
      return `
      <tr>
        <td><strong>${escapeHtml(team.name)}</strong></td>
        <td>${escapeHtml(team.sports?.name ?? '-')}</td>
        <td>${captain ? escapeHtml(captain.full_name) : '<span class="badge badge-warning">Da impostare</span>'}</td>
        <td>
          <div class="table-actions" ${canManageAll(state.admin?.ruolo) ? '' : 'style="display:none"'}>
            <button class="icon-btn telegram" data-action="telegram-team" data-id="${team.id}" data-name="${escapeHtml(team.name)}" title="Notifica Telegram"><i class="fa-brands fa-telegram"></i></button>
            <button class="icon-btn edit" data-action="qr-team" data-id="${team.id}" data-name="${escapeHtml(team.name)}" data-sport-id="${team.sport_id}" title="QR squadra" aria-label="QR squadra"><i class="fa-solid fa-qrcode"></i></button>
            <button class="icon-btn edit" data-action="edit-team" data-id="${team.id}" data-name="${escapeHtml(team.name)}" data-sport-id="${team.sport_id}"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn delete" data-action="delete-team" data-id="${team.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
    })
    .join('');
}

function renderMatchesTableRows(rows) {
  const body = getEl('table-matches-list');
  if (!body) return;

  body.innerHTML = rows
    .map((match) => {
      const isFinished = Boolean(match.is_finished);
      const actionsHtml = renderMatchActionsMenu(match);
      const teamsLabel = getMatchTeamsLabel(match);
      const matchTitle = `${match.round_name ?? '-'} - ${teamsLabel}`;
      const scheduleLabel = formatScheduleRange(match);
      const status = getMatchCalendarStatus(match);

      return `
      <tr data-action="open-match-detail" data-id="${match.id}">
        <td class="match-cell-sport"><span class="match-table-text" title="${escapeHtml(match.sport?.name ?? '-')}">${escapeHtml(match.sport?.name ?? '-')}</span></td>
        <td class="match-cell-teams" title="${escapeHtml(matchTitle)}">
          <strong class="match-teams-line">${escapeHtml(teamsLabel)}</strong>
        </td>
        <td class="match-cell-slot"><span class="match-table-text" title="${escapeHtml(scheduleLabel)}">${escapeHtml(scheduleLabel)}</span></td>
        <td class="match-cell-venue"><span class="match-table-text" title="${escapeHtml(match.venue?.name ?? 'Da definire')}">${escapeHtml(match.venue?.name ?? 'Da definire')}</span></td>
        <td class="match-cell-score"><span class="score-chip">${isFinished ? `${match.home_score ?? 0} - ${match.away_score ?? 0}` : '- -'}</span></td>
        <td class="match-cell-status"><span class="badge ${status.badge}">${escapeHtml(status.label)}</span></td>
        <td class="match-cell-actions">${actionsHtml}</td>
      </tr>`;
    })
    .join('');
}

function renderMatchesCalendar(rows) {
  const board = getEl('matches-calendar-board');
  if (!board) return;

  if (!(rows ?? []).length) {
    board.innerHTML = '<div class="empty-state">Nessun match trovato con i filtri selezionati.</div>';
    return;
  }

  const groups = new Map();
  (rows ?? []).forEach((match) => {
    const key = formatCalendarDayKey(match.scheduled_start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
  });

  const orderedKeys = [...groups.keys()].sort((a, b) => {
    if (a === 'unscheduled') return 1;
    if (b === 'unscheduled') return -1;
    return a.localeCompare(b);
  });

  board.innerHTML = `
    <div class="calendar-board">
      ${orderedKeys
        .map((key) => {
          const dayMatches = groups.get(key) ?? [];
          return `
            <section class="calendar-day-column" data-calendar-day="${escapeHtml(key)}">
              <div class="calendar-day-title">${escapeHtml(formatCalendarDayLabel(key))}</div>
              <div class="calendar-day-list">
                ${dayMatches
                  .map((match) => {
                    const status = getMatchCalendarStatus(match);
                    const start = formatCalendarTime(match.scheduled_start);
                    const end = formatCalendarTime(match.scheduled_end);
                    const timeLabel = match.scheduled_start ? `${start}${match.scheduled_end ? ` - ${end}` : ''}` : 'Da programmare';
                    return `
                      <button
                        class="calendar-match-card status-${status.key}"
                        data-action="open-match-detail"
                        data-id="${match.id}"
                        type="button"
                        ${canEditMatches(state.admin?.ruolo) && match.scheduled_start && match.scheduled_end ? 'draggable="true"' : ''}
                      >
                        <span class="calendar-match-time">${escapeHtml(timeLabel)}</span>
                        <strong>${escapeHtml(getMatchTeamsLabel(match))}</strong>
                        <span>${escapeHtml(match.sport?.name ?? '-')} · ${escapeHtml(match.venue?.name ?? 'Campo da definire')}</span>
                        <span class="badge ${status.badge}">${escapeHtml(status.label)}</span>
                      </button>
                    `;
                  })
                  .join('')}
              </div>
            </section>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderMatchesViews(rows = state.adminMatches) {
  renderMatchesTableRows(rows);
  renderMatchesCalendar(rows);

  const isCalendar = state.matchesViewMode === 'calendar';
  getEl('matches-table-view')?.classList.toggle('hidden', isCalendar);
  getEl('matches-calendar-view')?.classList.toggle('hidden', !isCalendar);

  const toggle = getEl('btn-toggle-matches-view');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(isCalendar));
    toggle.innerHTML = isCalendar
      ? '<i class="fa-solid fa-table-list"></i>'
      : '<i class="fa-solid fa-calendar-days"></i>';
    const label = isCalendar ? 'Vista tabella' : 'Vista calendario';
    toggle.setAttribute('title', label);
    toggle.setAttribute('aria-label', label);
  }
}

async function handleSendTelegramMatchReminder(matchId) {
  const match = state.adminMatches.find((item) => Number(item.id) === Number(matchId));
  if (!match) {
    showToast('Match non trovato.', 'error');
    return;
  }

  const teams = `${match.home?.name ?? 'TBD'} vs ${match.away?.name ?? 'TBD'}`;
  if (!(await showAppConfirm(`Inviare un promemoria Telegram per ${teams}?`, {
    title: 'Promemoria Telegram',
    confirmLabel: 'Invia',
  }))) return;

  const result = await sendTelegramMatchReminder(matchId);
  showToast(`Promemoria Telegram inviato${result?.messageId ? ` (#${result.messageId})` : ''}.`, 'success');
}

async function handleSendTelegramTeamReminder(teamId, teamName = '') {
  const label = String(teamName || 'questa squadra').trim();
  if (!(await showAppConfirm(`Inviare un messaggio Telegram per ${label}?`, {
    title: 'Notifica squadra',
    confirmLabel: 'Invia',
  }))) return;

  const result = await sendTelegramTeamReminder(teamId);
  showToast(`Notifica squadra inviata${result?.messageId ? ` (#${result.messageId})` : ''}.`, 'success');
}

async function loadMatchesTable() {
  const filters = {
    teamSearch: getEl('filter-match-team')?.value ?? '',
    sportId: getEl('filter-match-sport')?.value ?? 'all',
    venueId: getEl('filter-match-venue')?.value ?? 'all',
    phase: getEl('filter-match-phase')?.value ?? 'all',
    status: getEl('filter-match-status')?.value ?? 'all',
  };

  const rows = await listMatchesForAdmin(filters);
  const statusFilter = String(filters.status ?? 'all');
  state.adminMatches = statusFilter === 'all'
    ? rows
    : rows.filter((match) => getMatchCalendarStatus(match).key === statusFilter);
  renderMatchesViews(state.adminMatches);
}

function openMatchDetail(matchId) {
  const match = getMatchById(matchId);
  if (!match) return;

  const status = getMatchCalendarStatus(match);
  const currentOperationalStatus =
    match.operational_status ??
    (status.key === 'finished' ? 'official' : status.key === 'in_progress' ? 'live' : status.key);
  const teams = getMatchTeamsLabel(match);
  const schedule = formatScheduleRange(match);
  const score = match.is_finished ? `${match.home_score ?? 0} - ${match.away_score ?? 0}` : '- -';
  const canOpenLive = !match.is_finished && canEditMatches(state.admin?.ruolo);
  const actions = [
    canOpenLive
      ? `<button class="btn btn-primary" data-action="start-live" data-id="${match.id}" type="button"><i class="fa-solid fa-play"></i> Live</button>`
      : '',
    canEditMatches(state.admin?.ruolo)
      ? `<button class="btn btn-ghost" data-action="edit-match" data-id="${match.id}" type="button"><i class="fa-solid fa-pen"></i> Modifica</button>`
      : '',
    `<button class="btn btn-ghost" data-action="qr-match" data-id="${match.id}" type="button"><i class="fa-solid fa-qrcode"></i> QR Match</button>`,
    canEditMatches(state.admin?.ruolo)
      ? `<button class="btn btn-ghost" data-action="telegram-match" data-id="${match.id}" type="button"><i class="fa-brands fa-telegram"></i> Telegram</button>`
      : '',
    match.is_finished
      ? `<button class="btn btn-primary" data-action="download-match-report" data-id="${match.id}" type="button"><i class="fa-solid fa-file-pdf"></i> Referto PDF</button>`
      : '',
    match.is_finished && canManageAll(state.admin?.ruolo)
      ? `<button class="btn btn-warning" data-action="reopen-match" data-id="${match.id}" type="button"><i class="fa-solid fa-unlock-keyhole"></i> Riapri</button>`
      : '',
    match.is_finished && canAccessControlCenter(state.admin?.ruolo) && currentOperationalStatus !== 'official'
      ? `<button class="btn btn-success" data-action="approve-official-match" data-id="${match.id}" type="button"><i class="fa-solid fa-certificate"></i> Rendi ufficiale</button>`
      : '',
  ].filter(Boolean);

  getEl('match-detail-title').textContent = teams;
  getEl('match-detail-content').innerHTML = `
    <div class="match-detail-grid">
      <div class="match-detail-main">
        <div class="match-detail-score">${escapeHtml(score)}</div>
        <span class="badge ${status.badge}">${escapeHtml(status.label)}</span>
      </div>
      <dl class="match-detail-list">
        <div><dt>Torneo</dt><dd>${escapeHtml(match.sport?.name ?? '-')}</dd></div>
        <div><dt>Fase</dt><dd>${escapeHtml(match.round_name ?? '-')}</dd></div>
        <div><dt>Slot</dt><dd>${escapeHtml(schedule)}</dd></div>
        <div><dt>Campo</dt><dd>${escapeHtml(match.venue?.name ?? 'Campo da definire')}</dd></div>
        <div><dt>Postazione</dt><dd>${escapeHtml(match.assigned_device?.label ?? match.assigned_device_id ?? 'Non assegnata')}</dd></div>
        <div><dt>Note</dt><dd>${escapeHtml(match.schedule_notes || '-')}</dd></div>
      </dl>
      <section class="match-detail-staff">
        <h3>Staff partita</h3>
        <div id="match-detail-staff-list" class="staff-chip-grid"><div class="empty-state">Caricamento staff...</div></div>
      </section>
      <section class="match-detail-operations">
        <div class="match-detail-section-head">
          <h3>Stato e check-in</h3>
          <span class="badge ${status.badge}">${escapeHtml(status.label)}</span>
        </div>
        <div class="match-status-control" ${canEditMatches(state.admin?.ruolo) ? '' : 'hidden'}>
          <select id="match-operational-status-select">
            ${renderOperationalStatusOptions(currentOperationalStatus)}
          </select>
          <input id="match-operational-status-reason" type="text" placeholder="Motivo o nota operativa" />
          <button class="btn btn-ghost btn-compact" data-action="set-match-operational-status" data-id="${match.id}" type="button">
            <i class="fa-solid fa-rotate"></i> Aggiorna stato
          </button>
        </div>
        <div id="match-detail-checkins" class="match-checkin-grid"><div class="empty-state">Caricamento check-in...</div></div>
        <div id="match-detail-status-history" class="status-history-list"></div>
      </section>
      <div class="match-detail-actions">${actions.join('')}</div>
      <section class="match-detail-audit">
        <button class="match-detail-toggle" data-action="toggle-audit-log" data-id="${match.id}" type="button" aria-expanded="false">
          <span>Registro modifiche</span>
          <i class="fa-solid fa-chevron-down"></i>
        </button>
        <div id="match-detail-audit-list" class="audit-log-list hidden" data-loaded="false" hidden></div>
      </section>
    </div>
  `;
  openModal('modal-match-detail');
  renderMatchDetailStaff(match.id).catch(() => undefined);
  renderMatchDetailOperations(match).catch((error) => {
    const target = getEl('match-detail-checkins');
    if (target) target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  });
}

function renderVenuesTableRows(rows) {
  const body = getEl('table-venues-body');
  if (!body) return;

  body.innerHTML = (rows ?? [])
    .map((venue) => {
      const url = getVenueQrUrl(venue, window.location.href);
      const writeActions = canManageAll(state.admin?.ruolo)
        ? `
            <button class="icon-btn edit" data-action="edit-venue" data-id="${venue.id}" title="Modifica"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn delete" data-action="delete-venue" data-id="${venue.id}" title="Elimina"><i class="fa-solid fa-trash"></i></button>
          `
        : '';
      return `
      <tr>
        <td>
          <strong>${escapeHtml(venue.name)}</strong>
          <div class="muted" style="font-size:0.8rem;">/${escapeHtml(venue.slug)}${venue.description ? ` · ${escapeHtml(venue.description)}` : ''}</div>
        </td>
        <td>
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>
        </td>
        <td>${venue.is_active ? '<span class="badge badge-success">Attivo</span>' : '<span class="badge badge-warning">Disattivo</span>'}</td>
        <td>
          <div class="table-actions">
            <button class="icon-btn edit" data-action="qr-venue" data-id="${venue.id}" title="Mostra QR"><i class="fa-solid fa-qrcode"></i></button>
            ${writeActions}
          </div>
        </td>
      </tr>`;
    })
    .join('') || '<tr><td colspan="4" class="empty-state">Nessun campo configurato.</td></tr>';
}

async function loadVenuesTable() {
  renderVenuesTableRows(state.venues);
}

function openVenueModal(venue = null) {
  resetFormValues(getEl('form-venue'));
  getEl('title-modal-venue').textContent = venue ? 'Modifica Campo' : 'Nuovo Campo';
  getEl('edit-venue-id').value = venue?.id ?? '';
  getEl('input-venue-name').value = venue?.name ?? '';
  getEl('input-venue-slug').value = venue?.slug ?? '';
  getEl('input-venue-description').value = venue?.description ?? '';
  getEl('input-venue-active').checked = venue?.is_active !== false;
  openModal('modal-venue');
}

async function saveVenueFromForm(event) {
  event.preventDefault();
  await saveVenue({
    id: getEl('edit-venue-id').value || null,
    name: getEl('input-venue-name').value,
    slug: getEl('input-venue-slug').value || slugifyVenueName(getEl('input-venue-name').value),
    description: getEl('input-venue-description').value,
    is_active: getEl('input-venue-active').checked,
  });
  closeModal('modal-venue');
  await refreshVenuesState();
  await loadVenuesTable();
  await loadMatchesTable();
  showToast('Campo salvato.', 'success');
}

async function handleDeleteVenue(venueId) {
  if (!(await showAppConfirm('Confermi eliminazione campo?', {
    title: 'Elimina campo',
    tone: 'danger',
    confirmLabel: 'Elimina',
  }))) return;
  await deleteVenue(venueId);
  await refreshVenuesState();
  await loadVenuesTable();
  await loadMatchesTable();
  showToast('Campo eliminato.', 'success');
}

function getPublicBaseUrl(baseHref = window.location.href) {
  const url = new URL(baseHref);
  const markers = ['/admin/', '/admin.html', '/admin', '/live.html', '/gym.html', '/index.html'];
  const marker = markers.find((item) => url.pathname.includes(item));
  if (marker) {
    url.pathname = url.pathname.slice(0, url.pathname.indexOf(marker) + 1);
  } else if (!url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/[^/]*$/, '');
  }
  url.search = '';
  url.hash = '';
  return url;
}

function getEntityQrUrl(type, entity) {
  const url = getPublicBaseUrl();
  if (type === 'venue') url.searchParams.set('venue', entity.slug);
  if (type === 'team') {
    url.searchParams.set('sport', String(entity.sport_id));
    url.searchParams.set('team', String(entity.id));
  }
  if (type === 'match') {
    url.searchParams.set('sport', String(entity.sport_id));
    url.searchParams.set('match', String(entity.id));
  }
  if (type === 'sport') url.searchParams.set('sport', String(entity.id));
  return url.toString();
}

function showQrPreview({ title, subtitle = '', url }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}`;
  getEl('qr-modal-title').textContent = title;
  getEl('qr-modal-content').innerHTML = `
    <div class="qr-preview">
      <img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(title)}" />
      <div>
        <h3>${escapeHtml(subtitle || title)}</h3>
        <p class="muted">${escapeHtml(url)}</p>
      </div>
    </div>
  `;
  openModal('modal-venue-qr');
}

function showVenueQr(venue) {
  if (!venue) return;
  showQrPreview({
    title: `QR Campo · ${venue.name}`,
    subtitle: venue.name,
    url: getVenueQrUrl(venue, window.location.href),
  });
}

function showEntityQr(type, entity) {
  if (!entity) return;
  const labels = {
    team: `QR Squadra · ${entity.name ?? 'Squadra'}`,
    match: `QR Match · ${getMatchTeamsLabel(entity)}`,
    sport: `QR Torneo · ${entity.name ?? 'Torneo'}`,
  };
  showQrPreview({
    title: labels[type] ?? 'QR',
    subtitle: labels[type] ?? 'QR',
    url: getEntityQrUrl(type, entity),
  });
}

function getHonorEditionYear(entry) {
  return entry?.edition_year ?? new Date(entry?.archived_at ?? Date.now()).getFullYear();
}

function renderHonorRollRows(rows) {
  const body = getEl('table-honor-roll-body');
  if (!body) return;

  body.innerHTML = (rows ?? [])
    .map(
      (entry) => `
      <tr>
        <td>
          <strong>${escapeHtml(getHonorEditionYear(entry))}</strong>
          <div class="muted" style="font-size:0.8rem;">${escapeHtml(entry.year)}° anno</div>
        </td>
        <td>
          <strong>${escapeHtml(entry.sport_name)}</strong>
          <div class="muted" style="font-size:0.8rem;">${escapeHtml(entry.sport_type)} · ${escapeHtml(entry.format)}</div>
        </td>
        <td><strong>${escapeHtml(entry.winner_team_name)}</strong></td>
        <td>${escapeHtml([entry.runner_up_team_name, entry.third_place_team_name].filter(Boolean).join(' · ') || '-')}</td>
        <td>${escapeHtml(new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.archived_at)))}</td>
        <td>
          <div class="table-actions" ${canManageAll(state.admin?.ruolo) ? '' : 'style="display:none"'}>
            <button class="icon-btn delete" data-action="unarchive-entry" data-id="${entry.id}" title="Disarchivia"><i class="fa-solid fa-box-open"></i></button>
          </div>
        </td>
      </tr>
    `
    )
    .join('') || '<tr><td colspan="6" class="empty-state">Nessun torneo archiviato.</td></tr>';
}

async function loadArchiveTable() {
  state.honorRoll = await loadHonorRoll();
  renderHonorRollRows(state.honorRoll);
}

async function handleArchiveTournament() {
  const sportId = Number(getEl('archive-sport-select')?.value || 0);
  if (!sportId) {
    showToast('Seleziona un torneo da archiviare.', 'error');
    return;
  }
  const notes = await showAppPrompt('Note archivio (opzionale):', {
    title: 'Archivia torneo',
    inputLabel: 'Note',
    multiline: true,
    placeholder: 'Es. edizione conclusa regolarmente',
    confirmLabel: 'Archivia',
  });
  if (notes === null) return;
  await archiveTournament(sportId, { notes });
  await loadArchiveTable();
  showToast('Torneo archiviato nell Albo d Oro.', 'success');
}

async function handleUnarchiveTournament(entryId) {
  if (!(await showAppConfirm('Vuoi rimuovere questa voce dall Albo d Oro?', {
    title: 'Disarchivia torneo',
    tone: 'danger',
    confirmLabel: 'Disarchivia',
  }))) return;
  await unarchiveTournament(entryId);
  await loadArchiveTable();
  showToast('Torneo disarchiviato.', 'success');
}

function getTelegramChannelUrl() {
  return String(APP_CONFIG.telegramChannelUrl ?? '').trim();
}

function printWithBodyClass(className) {
  document.body.classList.add(className);
  const cleanup = () => document.body.classList.remove(className);
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  setTimeout(cleanup, 1500);
}

function printTelegramQr() {
  printWithBodyClass('print-telegram-qr');
}

function getPublicNotificationIcon(severity) {
  if (severity === 'danger') return 'fa-triangle-exclamation';
  if (severity === 'warning') return 'fa-circle-exclamation';
  if (severity === 'success') return 'fa-circle-check';
  return 'fa-bullhorn';
}

function resetPublicNotificationForm() {
  getEl('form-public-notification')?.reset();
  getEl('public-notification-id').value = '';
  const active = getEl('public-notification-active');
  if (active) active.checked = true;
  const severity = getEl('public-notification-severity');
  if (severity) severity.value = 'info';
  const expires = getEl('public-notification-expires');
  if (expires) expires.value = '';
}

function toDateTimeLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function fillPublicNotificationForm(notification) {
  if (!notification) {
    resetPublicNotificationForm();
    return;
  }
  getEl('public-notification-id').value = notification.id ?? '';
  getEl('public-notification-title').value = notification.title ?? '';
  getEl('public-notification-body').value = notification.body ?? '';
  getEl('public-notification-severity').value = notification.severity ?? 'info';
  getEl('public-notification-active').checked = notification.is_active !== false;
  const expires = getEl('public-notification-expires');
  if (expires) expires.value = toDateTimeLocalInput(notification.expires_at);
  getEl('public-notification-title')?.focus();
}

async function renderPublicNotificationsAdmin() {
  const target = getEl('public-notifications-admin-list');
  if (!target) return;

  try {
    state.publicNotifications = await loadPublicNotifications({ includeInactive: true, limit: 50 });
  } catch (error) {
    target.innerHTML = `<div class="empty-state">Notifiche non caricate: ${escapeHtml(error.message)}</div>`;
    return;
  }
  const rows = state.publicNotifications ?? [];
  if (!rows.length) {
    target.innerHTML = '<div class="empty-state">Nessuna notifica pubblica creata.</div>';
    return;
  }

  const canEditPublicNotifications = canManageAll(state.admin?.ruolo);
  target.innerHTML = `
    <div class="public-admin-notification-list">
      ${rows
        .map(
          (item) => `
            <article class="public-admin-notification severity-${escapeHtml(item.severity ?? 'info')}">
              <span class="public-admin-notification-icon"><i class="fa-solid ${escapeHtml(getPublicNotificationIcon(item.severity))}"></i></span>
              <div class="public-admin-notification-copy">
                <strong>${escapeHtml(item.title)}</strong>
                ${item.body ? `<p>${escapeHtml(item.body)}</p>` : ''}
                <small>${item.is_active === false ? 'Non visibile' : 'Visibile'} · Aggiornata ${escapeHtml(formatDateTime(item.updated_at ?? item.created_at))}${item.expires_at ? ` · Scade ${escapeHtml(formatDateTime(item.expires_at))}` : ''}</small>
              </div>
              ${
                canEditPublicNotifications
                  ? `<div class="public-admin-notification-actions">
                      <button class="icon-btn edit" data-action="edit-public-notification" data-id="${item.id}" type="button" title="Modifica notifica" aria-label="Modifica notifica"><i class="fa-solid fa-pen"></i></button>
                      <button class="icon-btn delete" data-action="delete-public-notification" data-id="${item.id}" type="button" title="Elimina notifica" aria-label="Elimina notifica"><i class="fa-solid fa-trash"></i></button>
                    </div>`
                  : ''
              }
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

async function handleSavePublicNotification(event) {
  event.preventDefault();
  if (!canManageAll(state.admin?.ruolo)) {
    throw new Error('Solo il Superadmin puo pubblicare notifiche nella home.');
  }

  const saved = await savePublicNotification({
    id: getEl('public-notification-id')?.value || null,
    title: getEl('public-notification-title')?.value,
    body: getEl('public-notification-body')?.value,
    severity: getEl('public-notification-severity')?.value,
    expiresAt: getEl('public-notification-expires')?.value
      ? new Date(getEl('public-notification-expires').value).toISOString()
      : null,
    isActive: Boolean(getEl('public-notification-active')?.checked),
  });

  if (!saved) {
    throw new Error('Notifiche pubbliche non disponibili: applica la migrazione 028 e ricarica lo schema.');
  }

  resetPublicNotificationForm();
  await renderPublicNotificationsAdmin();
  showToast('Notifica pubblicata nella home.', 'success');
}

async function handleDeletePublicNotification(notificationId) {
  if (!canManageAll(state.admin?.ruolo)) {
    throw new Error('Solo il Superadmin puo eliminare notifiche pubbliche.');
  }
  if (!(await showAppConfirm('Eliminare questa notifica dalla home pubblica?', {
    title: 'Elimina notifica',
    tone: 'danger',
    confirmLabel: 'Elimina',
  }))) return;

  await deletePublicNotification(notificationId);
  await renderPublicNotificationsAdmin();
  showToast('Notifica eliminata.', 'success');
}

function printVenueQr() {
  printWithBodyClass('print-venue-qr');
}

async function renderTelegramView() {
  const panel = getEl('telegram-channel-panel');
  if (!panel) return;

  const channelUrl = getTelegramChannelUrl();
  const label = String(APP_CONFIG.telegramChannelLabel ?? 'Canale Telegram tornei').trim();

  if (!channelUrl) {
    panel.innerHTML = `
      <div class="telegram-panel">
        <div class="empty-state">
          Configura prima <strong>APP_CONFIG.telegramChannelUrl</strong> in <code>js/app-config.js</code>.
          Inserisci il link del canale Telegram, per esempio <code>https://t.me/nome_canale</code>.
        </div>
      </div>
    `;
    await Promise.all([renderPublicNotificationsAdmin(), renderTelegramTemplates()]);
    return;
  }

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(channelUrl)}`;
  panel.innerHTML = `
    <div class="telegram-panel">
      <div class="telegram-info">
        <div class="badge badge-info"><i class="fa-brands fa-telegram"></i> Telegram</div>
        <h2>${escapeHtml(label)}</h2>
        <p class="muted">Usa questo QR fuori dalle palestre o nelle circolari: studenti e capitani entreranno direttamente nel canale Telegram gestito dalla scuola.</p>
        <div class="telegram-actions">
          <a class="btn btn-primary" href="${escapeHtml(channelUrl)}" target="_blank" rel="noopener">
            <i class="fa-brands fa-telegram"></i> Apri canale
          </a>
          <button class="btn btn-ghost" id="btn-print-telegram-qr" type="button">
            <i class="fa-solid fa-print"></i> Stampa QR
          </button>
        </div>
        <div class="telegram-url">${escapeHtml(channelUrl)}</div>
      </div>
      <div class="qr-preview telegram-qr">
        <img src="${escapeHtml(qrUrl)}" alt="QR ${escapeHtml(label)}" />
      </div>
    </div>
  `;

  getEl('btn-print-telegram-qr')?.addEventListener('click', printTelegramQr);
  await Promise.all([renderPublicNotificationsAdmin(), renderTelegramTemplates()]);
}

function formatTemplatePreview(value) {
  return String(value ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    if (Object.prototype.hasOwnProperty.call(TEMPLATE_SAMPLE_VALUES, key)) {
      return TEMPLATE_SAMPLE_VALUES[key];
    }
    return `[${key}]`;
  });
}

function showTemplatePreviewFromCard(card) {
  const title = card?.querySelector('[data-template-field="title"]')?.value ?? 'Template comunicazione';
  const body = card?.querySelector('[data-template-field="body"]')?.value ?? '';
  const preview = [
    `Titolo: ${formatTemplatePreview(title)}`,
    '',
    formatTemplatePreview(body || 'Nessun testo impostato.'),
  ].join('\n');

  return showAppAlert(preview, {
    title: 'Anteprima messaggio',
    confirmLabel: 'Chiudi',
  });
}

async function renderTelegramTemplates() {
  const target = getEl('telegram-template-panel');
  if (!target) return;

  try {
    state.communicationTemplates = await loadCommunicationTemplates();
  } catch (error) {
    target.innerHTML = `<div class="empty-state">Template non caricati: ${escapeHtml(error.message)}</div>`;
    return;
  }
  const rows = state.communicationTemplates ?? [];
  if (!rows.length) {
    target.innerHTML = '<div class="empty-state">Applica la migrazione 024 per gestire i template comunicazione.</div>';
    return;
  }

  target.innerHTML = `
    <div class="communication-template-list">
      ${rows
        .map((template) => {
          const meta = COMMUNICATION_TEMPLATE_META[template.template_key] ?? {
            label: template.title || 'Template comunicazione',
            purpose: 'Modello riutilizzabile per messaggi automatici o manuali.',
            usedBy: 'Invio Telegram manuale o automatico',
            variables: ['home', 'away', 'time', 'venue', 'reason', 'team', 'sport', 'message'],
          };
          const variables = meta.variables ?? [];
          return `
            <article class="communication-template-card">
              <div class="communication-template-head">
                <div>
                  <strong>${escapeHtml(meta.label)}</strong>
                  <p>${escapeHtml(meta.purpose)}</p>
                </div>
                <span>${template.is_active !== false ? 'Attivo' : 'Disattivato'}</span>
              </div>
              <div class="template-info-grid">
                <div>
                  <span>Quando viene usato</span>
                  <strong>${escapeHtml(meta.usedBy)}</strong>
                </div>
                <div>
                  <span>Canale</span>
                  <strong>Telegram</strong>
                </div>
              </div>
              <div class="communication-template-fields">
                <div class="field">
                  <label for="template-title-${template.id}">Titolo visibile</label>
                  <input id="template-title-${template.id}" data-template-field="title" data-key="${escapeHtml(template.template_key)}" value="${escapeHtml(template.title)}" />
                </div>
                <div class="field">
                  <label for="template-body-${template.id}">Testo del messaggio</label>
                  <textarea id="template-body-${template.id}" data-template-field="body" data-key="${escapeHtml(template.template_key)}" rows="4">${escapeHtml(template.body)}</textarea>
                </div>
              </div>
              <details class="template-variable-details">
                <summary>Variabili automatiche disponibili</summary>
                <div class="template-variable-list" aria-label="Variabili disponibili">
                  ${variables
                    .map(
                      (variable) => `
                        <span title="${escapeHtml(TEMPLATE_VARIABLE_LABELS[variable] ?? variable)}">
                          <code>{{${escapeHtml(variable)}}}</code>
                          ${escapeHtml(TEMPLATE_VARIABLE_LABELS[variable] ?? variable)}
                        </span>
                      `
                    )
                    .join('')}
                </div>
              </details>
              <div class="template-card-actions">
                <label class="checkbox-row compact">
                  <input type="checkbox" data-template-field="is_active" data-key="${escapeHtml(template.template_key)}" ${template.is_active !== false ? 'checked' : ''} />
                  <span>Attivo</span>
                </label>
                <button class="btn btn-ghost btn-compact" data-action="preview-communication-template" data-key="${escapeHtml(template.template_key)}" type="button">
                  <i class="fa-solid fa-eye"></i> Anteprima
                </button>
                <button class="btn btn-ghost btn-compact" data-action="save-communication-template" data-key="${escapeHtml(template.template_key)}" type="button">
                  <i class="fa-solid fa-floppy-disk"></i> Salva
                </button>
              </div>
            </article>
          `;
        })
        .join('')}
    </div>
    <p class="muted template-help">Le parole tra doppie graffe vengono sostituite automaticamente prima dell'invio. Esempio: <code>{{home}}</code> diventa il nome della squadra di casa.</p>
  `;
}

function renderPlayerRankingTable(rows) {
  const body = document.querySelector('#report-table-students tbody');
  if (!body) return;

  body.innerHTML = rows
    .map(
      (player, index) => `
      <tr>
        <td data-col-group="team_students" data-col="rank">${index + 1}</td>
        <td data-col-group="team_students" data-col="student"><strong>${escapeHtml(player.name)}</strong></td>
        <td data-col-group="team_students" data-col="class">${escapeHtml(player.team)}</td>
        <td class="text-center" data-col-group="team_students" data-col="presence">${player.presencePct}%</td>
        <td class="text-center" data-col-group="team_students" data-col="fouls">${player.fouls}</td>
        <td class="text-center" data-col-group="team_students" data-col="mvp">${player.mvpVotes}</td>
        <td class="text-center" data-col-group="team_students" data-col="score"><span class="score-chip">${player.score}</span></td>
      </tr>
    `
    )
    .join('');

  applyReportColumnVisibility();
}

function renderTeamReportTable(rows) {
  const body = document.querySelector('#report-table-teams tbody');
  if (!body) return;

  body.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td data-col-group="team_standings" data-col="position">${medalByRank(row.rank - 1)}</td>
        <td data-col-group="team_standings" data-col="team"><strong>${escapeHtml(row.name)}</strong></td>
        <td class="text-center" data-col-group="team_standings" data-col="points">${row.points}</td>
        <td class="text-center" data-col-group="team_standings" data-col="played">${row.played}</td>
        <td class="text-center" data-col-group="team_standings" data-col="wins">${row.wins}</td>
        <td class="text-center" data-col-group="team_standings" data-col="draws">${row.draws}</td>
        <td class="text-center" data-col-group="team_standings" data-col="losses">${row.losses}</td>
        <td class="text-center" data-col-group="team_standings" data-col="goal_diff">${row.goalDiff}</td>
      </tr>
    `
    )
    .join('');

  applyReportColumnVisibility();
}

function renderReportLayouts(isAthletics) {
  getEl('report-team-filters')?.classList.toggle('hidden', isAthletics);
  getEl('report-team-layout')?.classList.toggle('hidden', isAthletics);
  getEl('report-athletics-layout')?.classList.toggle('hidden', !isAthletics);
  setFilterToggleState(getEl('btn-toggle-report-filters'), [getEl('report-team-filters'), getEl('report-athletics-filters')].filter(Boolean));
}

function getReportColumnStorageKey(sportId) {
  return `${REPORT_COLUMNS_STORAGE_PREFIX}${Number(sportId)}`;
}

function buildDefaultReportColumnPrefs() {
  const defaults = {};
  Object.entries(REPORT_COLUMN_GROUPS).forEach(([groupKey, group]) => {
    defaults[groupKey] = {};
    (group.columns ?? []).forEach((column) => {
      defaults[groupKey][column.key] = true;
    });
  });
  return defaults;
}

function normalizeReportColumnPrefs(rawPrefs) {
  const normalized = buildDefaultReportColumnPrefs();
  if (!rawPrefs || typeof rawPrefs !== 'object') return normalized;

  Object.entries(REPORT_COLUMN_GROUPS).forEach(([groupKey, group]) => {
    (group.columns ?? []).forEach((column) => {
      if (typeof rawPrefs?.[groupKey]?.[column.key] === 'boolean') {
        normalized[groupKey][column.key] = rawPrefs[groupKey][column.key];
      }
    });
  });

  return normalized;
}

function ensureReportColumnPrefs(sportId) {
  const numericSportId = Number(sportId || 0);
  if (!numericSportId) {
    return buildDefaultReportColumnPrefs();
  }

  if (state.reportColumnPrefs[numericSportId]) {
    return state.reportColumnPrefs[numericSportId];
  }

  const defaults = buildDefaultReportColumnPrefs();
  try {
    const stored = window.localStorage.getItem(getReportColumnStorageKey(numericSportId));
    const parsed = stored ? JSON.parse(stored) : null;
    state.reportColumnPrefs[numericSportId] = normalizeReportColumnPrefs(parsed ?? defaults);
  } catch (_error) {
    state.reportColumnPrefs[numericSportId] = defaults;
  }

  return state.reportColumnPrefs[numericSportId];
}

function persistReportColumnPrefs(sportId) {
  const numericSportId = Number(sportId || 0);
  if (!numericSportId) return;
  const prefs = ensureReportColumnPrefs(numericSportId);
  try {
    window.localStorage.setItem(getReportColumnStorageKey(numericSportId), JSON.stringify(prefs));
  } catch (_error) {
    // ignore storage quota / private mode failures
  }
}

function getVisibleReportColumnGroups() {
  return isCurrentReportAthletics() ? ['athletics'] : ['team_students', 'team_standings'];
}

function applyReportColumnVisibility() {
  const sportId = Number(getEl('report-sport-select')?.value || 0);
  const prefs = ensureReportColumnPrefs(sportId);

  document.querySelectorAll('[data-col-group][data-col]').forEach((cell) => {
    const groupKey = String(cell.dataset.colGroup ?? '');
    const columnKey = String(cell.dataset.col ?? '');
    const visible = prefs?.[groupKey]?.[columnKey] !== false;
    cell.classList.toggle('report-col-hidden', !visible);
  });
}

function renderReportColumnsPanel() {
  const panel = getEl('report-columns-panel');
  const toggleButton = getEl('btn-toggle-report-columns');
  if (!panel || !toggleButton) return;

  const sportId = Number(getEl('report-sport-select')?.value || 0);
  if (!sportId) {
    panel.innerHTML = '<div class="empty-state">Seleziona un torneo per configurare le colonne.</div>';
    panel.classList.add('hidden');
    toggleButton.disabled = true;
    toggleButton.setAttribute('aria-expanded', 'false');
    return;
  }

  toggleButton.disabled = false;
  const prefs = ensureReportColumnPrefs(sportId);
  const groupKeys = getVisibleReportColumnGroups();

  panel.innerHTML = `
    <div class="report-columns-grid">
      ${groupKeys
        .map((groupKey) => {
          const group = REPORT_COLUMN_GROUPS[groupKey];
          if (!group) return '';
          const items = (group.columns ?? [])
            .map((column) => {
              const checked = prefs?.[groupKey]?.[column.key] !== false;
              return `
                <label class="report-columns-item">
                  <input type="checkbox" data-action="toggle-report-column" data-group="${groupKey}" data-column="${column.key}" ${checked ? 'checked' : ''}>
                  <span>${escapeHtml(column.label)}</span>
                </label>
              `;
            })
            .join('');

          return `
            <section class="report-columns-group">
              <h4 class="report-columns-group-title">${escapeHtml(group.label)}</h4>
              <div class="report-columns-list">${items}</div>
            </section>
          `;
        })
        .join('')}
    </div>
  `;

  toggleButton.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
}

function isCurrentReportAthletics() {
  const sportId = Number(getEl('report-sport-select')?.value || 0);
  if (!sportId) return false;
  const sport = getSportById(sportId);
  return sport?.sport_type === 'atletica';
}

function getAthleticsReportFilters() {
  const selectedPlayerValue = String(getEl('rep-ath-player-select')?.value ?? 'all');
  const selectedPlayerId = selectedPlayerValue !== 'all' ? Number(selectedPlayerValue) : null;
  const searchTerm = String(getEl('rep-ath-player-search')?.value ?? '').trim().toLowerCase();
  const selectedEventId = String(getEl('rep-ath-event-select')?.value ?? 'all');
  const selectedTeam = String(getEl('rep-ath-team-select')?.value ?? 'all');

  return {
    selectedPlayerId: Number.isFinite(selectedPlayerId) && Number(selectedPlayerId) > 0
      ? Number(selectedPlayerId)
      : null,
    searchTerm,
    selectedEventId: selectedEventId !== 'all' ? Number(selectedEventId) : null,
    selectedTeam,
  };
}

function playerMatchesAthleticsFilters(row, filters) {
  if (!row) return false;
  if (filters.selectedTeam !== 'all' && row.teamName !== filters.selectedTeam) return false;
  if (filters.selectedPlayerId) return Number(row.playerId) === filters.selectedPlayerId;
  if (filters.searchTerm) {
    return String(row.playerName ?? '').toLowerCase().includes(filters.searchTerm);
  }
  return true;
}

function buildAthleticsAggregation(events, config, filters) {
  const minEvents = Math.max(0, Number(config?.athletics_min_events_per_player ?? 1));
  const maxEvents = Math.max(minEvents || 1, Number(config?.athletics_max_events_per_player ?? 99));
  const byPlayer = new Map();
  const allEvents = events ?? [];
  const filteredEvents = allEvents.filter((eventItem) => {
    if (!filters.selectedEventId) return true;
    return Number(eventItem.id) === filters.selectedEventId;
  });
  const selectedEventPlayerIds = new Set();

  const eventCards = filteredEvents.map((eventItem) => {
    const baseRows = [...(eventItem.results ?? [])].sort(
      (a, b) => Number(a.rank ?? 0) - Number(b.rank ?? 0)
    );
    baseRows.forEach((row) => {
      const playerId = Number(row.playerId);
      if (playerId > 0) selectedEventPlayerIds.add(playerId);
    });

    const filteredRows = baseRows
      .filter((row) => playerMatchesAthleticsFilters(row, filters))
      .slice(0, 3);

    return {
      ...eventItem,
      filteredRows,
    };
  });

  allEvents.forEach((eventItem) => {
    const baseRows = [...(eventItem.results ?? [])].sort(
      (a, b) => Number(a.rank ?? 0) - Number(b.rank ?? 0)
    );

    baseRows.forEach((row) => {
      const key = Number(row.playerId);
      if (!Number.isFinite(key) || key <= 0) return;

      const existing = byPlayer.get(key) ?? {
        playerId: key,
        playerName: row.playerName,
        teamName: row.teamName,
        events: 0,
        score: 0,
        medals: { gold: 0, silver: 0, bronze: 0 },
      };

      existing.events += 1;

      const eventRank = Number(row.rank ?? 0);
      if (eventRank === 1) {
        existing.score += 3;
        existing.medals.gold += 1;
      } else if (eventRank === 2) {
        existing.score += 2;
        existing.medals.silver += 1;
      } else if (eventRank === 3) {
        existing.score += 1;
        existing.medals.bronze += 1;
      }

      byPlayer.set(key, existing);
    });
  });

  const rankingAll = [...byPlayer.values()]
    .map((row) => ({
      ...row,
      isQualified: row.events >= minEvents && row.events <= maxEvents,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.medals.gold - a.medals.gold ||
        b.medals.silver - a.medals.silver ||
        b.medals.bronze - a.medals.bronze ||
        a.playerName.localeCompare(b.playerName, 'it', { sensitivity: 'base' })
    )
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  const rankingQualified = rankingAll
    .filter((row) => row.isQualified)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  const rankingFiltered = rankingQualified.filter((row) => {
    if (!playerMatchesAthleticsFilters(row, filters)) return false;
    if (filters.selectedEventId && !selectedEventPlayerIds.has(Number(row.playerId))) return false;
    return true;
  });

  return {
    eventCards,
    rankingAll,
    rankingQualified,
    rankingFiltered,
    minEvents,
    maxEvents,
  };
}

function renderAthleticsEventsCards(eventCards) {
  const container = getEl('report-ath-events-container');
  if (!container) return;

  if (!(eventCards ?? []).length) {
    container.innerHTML = '<div class="empty-state">Nessun evento disponibile con i filtri selezionati.</div>';
    return;
  }

  container.innerHTML = `
    <div class="ath-report-events-grid">
      ${eventCards
        .map((eventItem) => {
          const topRowsHtml = (eventItem.filteredRows ?? []).length
            ? eventItem.filteredRows
                .map(
                  (row) => `
                    <div class="ath-report-top-row">
                      <span>${medalByRank(Math.max(Number(row.rank ?? 1) - 1, 0))} ${escapeHtml(row.playerName)}</span>
                      <span class="muted">(${Number(row.value ?? 0).toFixed(2)})</span>
                    </div>
                  `
                )
                .join('')
            : '<div class="muted">Nessun risultato per i filtri correnti.</div>';

          return `
            <article class="ath-report-event-card">
              <h4 class="ath-report-event-title">${escapeHtml(eventItem.name)}</h4>
              <div class="ath-report-event-meta">
                Unità: ${escapeHtml(eventItem.unit)} · Ordinamento: ${eventItem.sort_order === 'asc' ? 'minore è migliore' : 'maggiore è migliore'}
              </div>
              <div class="ath-report-top-list">
                ${topRowsHtml}
              </div>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderAthleticsRankingTable(rankingRows) {
  const body = getEl('report-ath-ranking-body');
  if (!body) return;

  if (!(rankingRows ?? []).length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">Nessun atleta trovato per i filtri selezionati.</td></tr>';
    applyReportColumnVisibility();
    return;
  }

  body.innerHTML = rankingRows
    .map((row) => `
      <tr>
        <td data-col-group="athletics" data-col="position">${medalByRank(Math.max(Number(row.rank ?? 1) - 1, 0))}</td>
        <td data-col-group="athletics" data-col="student"><strong>${escapeHtml(row.playerName)}</strong></td>
        <td data-col-group="athletics" data-col="class">${escapeHtml(row.teamName)}</td>
        <td class="text-center" data-col-group="athletics" data-col="events">${row.events}</td>
        <td class="text-center" data-col-group="athletics" data-col="medals">O ${row.medals.gold} · A ${row.medals.silver} · B ${row.medals.bronze}</td>
        <td class="text-center" data-col-group="athletics" data-col="points"><strong>${row.score}</strong></td>
      </tr>
    `)
    .join('');

  applyReportColumnVisibility();
}

function applyAthleticsReportFilters() {
  if (!state.athleticsReport) return;
  const filters = getAthleticsReportFilters();
  const aggregation = buildAthleticsAggregation(state.athleticsReport.events, state.athleticsReport.config, filters);
  renderAthleticsEventsCards(aggregation.eventCards);
  renderAthleticsRankingTable(aggregation.rankingFiltered);
}

function applyReportFilters() {
  if (isCurrentReportAthletics()) {
    applyAthleticsReportFilters();
    return;
  }

  const teamFilter = getEl('rep-filter-team')?.value ?? 'all';
  const presenceFilter = getEl('rep-filter-pres')?.value ?? 'all';
  const foulsFilter = getEl('rep-filter-fouls')?.value ?? 'all';
  const scoreFilter = getEl('rep-filter-score')?.value ?? 'all';

  const filtered = state.cachedPlayersRanking.filter((row) => {
    if (teamFilter !== 'all' && row.team !== teamFilter) return false;
    if (presenceFilter !== 'all') {
      const [min, max] = presenceFilter.split('-').map(Number);
      if (row.presencePct < min || row.presencePct > max) return false;
    }
    if (foulsFilter !== 'all') {
      if (foulsFilter === '3' && row.fouls < 3) return false;
      if (foulsFilter !== '3' && row.fouls !== Number(foulsFilter)) return false;
    }
    if (scoreFilter !== 'all') {
      const [min, max] = scoreFilter.split('-').map(Number);
      if (row.score < min || row.score > max) return false;
    }
    return true;
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));

  renderPlayerRankingTable(filtered);
}

function renderAthleticsReportFilterOptions(reportDataset) {
  const playerSelect = getEl('rep-ath-player-select');
  const eventSelect = getEl('rep-ath-event-select');
  const teamSelect = getEl('rep-ath-team-select');

  const players = [...(reportDataset?.players ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, 'it', { sensitivity: 'base' })
  );
  const events = [...(reportDataset?.events ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, 'it', { sensitivity: 'base' })
  );
  const teams = [...(reportDataset?.teams ?? [])].sort((a, b) =>
    a.localeCompare(b, 'it', { sensitivity: 'base' })
  );

  if (playerSelect) {
    playerSelect.innerHTML =
      '<option value="all">Tutti</option>' +
      players
        .map((player) => `<option value="${player.id}">${escapeHtml(player.name)} · ${escapeHtml(player.teamName)}</option>`)
        .join('');
    playerSelect.value = 'all';
  }

  if (eventSelect) {
    eventSelect.innerHTML =
      '<option value="all">Tutti</option>' +
      events.map((eventItem) => `<option value="${eventItem.id}">${escapeHtml(eventItem.name)}</option>`).join('');
    eventSelect.value = 'all';
  }

  if (teamSelect) {
    teamSelect.innerHTML =
      '<option value="all">Tutte</option>' +
      teams.map((teamName) => `<option value="${escapeHtml(teamName)}">${escapeHtml(teamName)}</option>`).join('');
    teamSelect.value = 'all';
  }

  const playerSearch = getEl('rep-ath-player-search');
  if (playerSearch) playerSearch.value = '';
}

async function loadReportData() {
  const sportId = Number(getEl('report-sport-select')?.value || 0);
  const mvpBox = getEl('mvp-winner-box');

  if (!sportId) {
    renderReportLayouts(false);
    state.cachedPlayersRanking = [];
    state.athleticsReport = null;
    document.querySelector('#report-table-students tbody').innerHTML = '';
    document.querySelector('#report-table-teams tbody').innerHTML = '';
    getEl('report-ath-events-container').innerHTML = '';
    getEl('report-ath-ranking-body').innerHTML = '';
    mvpBox.innerHTML = '<div class="empty-state">Seleziona un torneo per visualizzare il report.</div>';
    renderReportColumnsPanel();
    applyReportColumnVisibility();
    return;
  }

  const sport = getSportById(sportId);
  const isAthletics = sport?.sport_type === 'atletica';

  if (isAthletics) {
    renderReportLayouts(true);
    ensureReportColumnPrefs(sportId);
    renderReportColumnsPanel();
    state.cachedPlayersRanking = [];
    mvpBox.innerHTML = '';

    const [events, config] = await Promise.all([
      loadAthleticsEvents(sportId),
      loadAthleticsConfigBySport(sportId),
    ]);

    const eventBundles = await Promise.all(
      (events ?? []).map(async (eventItem) => {
        const rawResults = await loadEventResults(eventItem.id);
        const ranking = computeAthleticsRanking(rawResults, eventItem.sort_order)
          .map((row, index) => {
            const resolvedPlayerId = Number(row.player?.id ?? 0);
            if (!resolvedPlayerId) return null;
            return {
              eventId: Number(eventItem.id),
              playerId: resolvedPlayerId,
              playerName: row.player.full_name,
              teamName: row.player.teams?.name ?? '-',
              value: Number(row.value ?? 0),
              notes: row.notes ?? '',
              attemptCount: Number(row.attempt_count ?? (row.attempt_values?.length ?? 1)),
              rank: index + 1,
            };
          })
          .filter(Boolean);

        return {
          id: Number(eventItem.id),
          name: eventItem.name,
          unit: eventItem.unit,
          sort_order: eventItem.sort_order,
          results: ranking,
        };
      })
    );

    const playersMap = new Map();
    const teamsSet = new Set();
    eventBundles.forEach((eventItem) => {
      (eventItem.results ?? []).forEach((row) => {
        playersMap.set(row.playerId, {
          id: row.playerId,
          name: row.playerName,
          teamName: row.teamName,
        });
        if (row.teamName) teamsSet.add(row.teamName);
      });
    });

    state.athleticsReport = {
      sportId,
      config,
      events: eventBundles,
      players: [...playersMap.values()],
      teams: [...teamsSet.values()],
    };

    renderAthleticsReportFilterOptions(state.athleticsReport);
    applyAthleticsReportFilters();
    applyReportColumnVisibility();
    return;
  }

  renderReportLayouts(false);
  ensureReportColumnPrefs(sportId);
  renderReportColumnsPanel();
  state.athleticsReport = null;

  const dataset = await loadReportDataset(sportId);
  const ranking = computePlayerRanking(dataset);
  state.cachedPlayersRanking = ranking;

  const mvpEnabled = Boolean(dataset.config?.allow_mvp ?? true);
  const winner = mvpEnabled ? pickMvpWinner(ranking) : null;
  if (!mvpEnabled) {
    mvpBox.innerHTML = '<div class="empty-state">MVP disabilitato nelle impostazioni del torneo.</div>';
  } else {
    mvpBox.innerHTML = winner
      ? `<div style="background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#1e293b;padding:18px;border-radius:14px;border:1px solid #f59e0b;"><div style="font-size:0.78rem;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">MVP Fair Play</div><div style="font-size:1.6rem;font-weight:900;margin-top:6px;">${escapeHtml(winner.name)}</div><div style="font-weight:600;margin-top:4px;">Classe ${escapeHtml(winner.team)} · ${winner.mvpVotes} voti MVP</div></div>`
      : '<div class="empty-state">Nessun MVP disponibile al momento.</div>';
  }

  const teamRows = computeTeamStandingsForReport(dataset.teams, dataset.matches, dataset.config);
  renderTeamReportTable(teamRows);

  const teamFilter = getEl('rep-filter-team');
  const uniqueTeams = [...new Set(ranking.map((row) => row.team))]
    .sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  teamFilter.innerHTML =
    '<option value="all">Tutte</option>' +
    uniqueTeams.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');

  applyReportFilters();
  applyReportColumnVisibility();
}
function getSportFormData() {
  return {
    id: getEl('edit-sport-id').value || null,
    name: getEl('input-sport-name').value.trim(),
    year: Number(getEl('input-sport-year').value || 0),
    sport_type: getEl('input-sport-type').value,
    format: getEl('input-sport-format').value,
    gender: getEl('input-sport-gender').value,
    has_return_match: getEl('input-sport-return').checked,
    is_active: getEl('input-sport-active').checked,
  };
}

function openSportModal(sport = null) {
  resetFormValues(getEl('form-sport'));
  if (sport) {
    getEl('title-modal-sport').textContent = 'Modifica Torneo';
    getEl('edit-sport-id').value = sport.id;
    getEl('input-sport-name').value = sport.name ?? '';
    getEl('input-sport-year').value = sport.year ?? '';
    getEl('input-sport-type').value = sport.sport_type ?? 'calcio';
    getEl('input-sport-format').value = sport.format ?? 'gironi';
    getEl('input-sport-gender').value = sport.gender ?? 'Misto';
    getEl('input-sport-return').checked = Boolean(sport.has_return_match);
    getEl('input-sport-active').checked = Boolean(sport.is_active);
  } else {
    getEl('title-modal-sport').textContent = 'Nuovo Torneo';
    getEl('input-sport-active').checked = true;
  }
  openModal('modal-sport');
}

async function handleSaveSport(event) {
  event.preventDefault();
  const payload = getSportFormData();
  if (!payload.name || !payload.year || !payload.sport_type || !payload.format) {
    showToast('Compila tutti i campi obbligatori del torneo.', 'error');
    return;
  }
  await saveSport(payload);
  closeModal('modal-sport');
  await refreshSportsState();
  await loadSportsTable();
  showToast('Torneo salvato.', 'success');
}

async function handleDeleteSport(sportId) {
  if (!(await showAppConfirm('Confermi eliminazione torneo?', {
    title: 'Elimina torneo',
    tone: 'danger',
    confirmLabel: 'Elimina',
  }))) return;
  await deleteSport(sportId);
  await refreshSportsState();
  await loadSportsTable();
  showToast('Torneo eliminato.', 'success');
}

function parsePlayersInput() {
  return getEl('input-players-list').value
    .split(/,|\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function populateCaptainSelect(selectedName = '') {
  const captainSelect = getEl('select-team-captain');
  if (!captainSelect) return;
  const players = parsePlayersInput();
  captainSelect.innerHTML =
    '<option value="">-- Nessun capitano --</option>' +
    players
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join('');
  if (selectedName && players.some((name) => name === selectedName)) {
    captainSelect.value = selectedName;
  }
}

async function confirmStudentCompatibilityWarnings({ sportId, teamId, players }) {
  const normalizedPlayers = new Set(
    (players ?? []).map((name) => String(name).trim().toLowerCase()).filter(Boolean)
  );
  if (!sportId || !normalizedPlayers.size) return true;

  const teams = await loadTeamsBySport(sportId);
  const otherTeams = teams.filter((team) => Number(team.id) !== Number(teamId || 0));
  const conflicts = [];

  for (const team of otherTeams) {
    const teamPlayers = await loadPlayersByTeam(team.id);
    teamPlayers.forEach((player) => {
      if (normalizedPlayers.has(String(player.full_name ?? '').trim().toLowerCase())) {
        conflicts.push(`${player.full_name} risulta gia in ${team.name}`);
      }
    });
  }

  if (!conflicts.length) return true;
  return showAppConfirm(`Possibili iscrizioni incompatibili:\n\n${conflicts.map((item) => `- ${item}`).join('\n')}\n\nVuoi salvare comunque?`, {
    title: 'Controllo iscrizioni',
    confirmLabel: 'Salva comunque',
  });
}

async function openTeamModal(team = null) {
  resetFormValues(getEl('form-team'));
  if (team) {
    getEl('title-modal-team').textContent = 'Modifica Squadra';
    getEl('edit-team-id').value = team.id;
    getEl('input-team-name').value = team.name;
    getEl('select-sport-team').value = String(team.sport_id);
    const players = await loadPlayersByTeam(team.id);
    getEl('input-players-list').value = players.map((item) => item.full_name).join(', ');
    populateCaptainSelect(players.find((item) => Boolean(item.is_captain))?.full_name ?? '');
  } else {
    getEl('title-modal-team').textContent = 'Nuova Squadra';
    populateCaptainSelect();
  }
  openModal('modal-team');
}

async function handleSaveTeam(event) {
  event.preventDefault();
  const players = parsePlayersInput();
  const teamId = getEl('edit-team-id').value || null;
  const sportId = getEl('select-sport-team').value;
  const canSave = await confirmStudentCompatibilityWarnings({ sportId, teamId, players });
  if (!canSave) return;
  await saveTeam({
    id: teamId,
    name: getEl('input-team-name').value,
    sport_id: sportId,
    players,
    captainName: getEl('select-team-captain')?.value ?? '',
  });
  closeModal('modal-team');
  await loadTeamsTable();
  showToast('Squadra salvata.', 'success');
}

async function handleDeleteTeam(teamId) {
  if (!(await showAppConfirm('Confermi eliminazione squadra?', {
    title: 'Elimina squadra',
    tone: 'danger',
    confirmLabel: 'Elimina',
  }))) return;
  await deleteTeam(teamId);
  await loadTeamsTable();
  showToast('Squadra eliminata.', 'success');
}

async function populateMatchTeams(sportId) {
  const homeSelect = getEl('select-home-team');
  const awaySelect = getEl('select-away-team');
  if (!sportId) {
    homeSelect.innerHTML = '<option value="">-- Seleziona torneo --</option>';
    awaySelect.innerHTML = '<option value="">-- Seleziona torneo --</option>';
    homeSelect.disabled = true;
    awaySelect.disabled = true;
    return;
  }
  const teams = await loadTeamsBySport(sportId);
  const options = '<option value="">-- Seleziona --</option>' + teams.map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join('');
  homeSelect.innerHTML = options;
  awaySelect.innerHTML = options;
  homeSelect.disabled = false;
  awaySelect.disabled = false;
}

async function renderMatchDetailStaff(matchId) {
  const target = getEl('match-detail-staff-list');
  if (!target) return;

  try {
    const staff = await loadMatchStaff(matchId);
    const items = [
      ['Arbitro', staff.referee?.name],
      ['Segnapunti', staff.scorekeeper?.name],
      ['Responsabile campo', staff.field_manager?.name],
      ['Docente supervisore', staff.supervisor?.name],
    ];

    target.innerHTML = items
      .map(
        ([label, value]) => `
        <div class="staff-chip">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value || 'Da assegnare')}</strong>
        </div>
      `
      )
      .join('');
  } catch (error) {
    target.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function getCheckinDefinitions(match) {
  return [
    { role: 'home_team', label: `Capitano ${match?.home?.name ?? 'casa'}`, teamId: match?.home_team_id },
    { role: 'away_team', label: `Capitano ${match?.away?.name ?? 'ospite'}`, teamId: match?.away_team_id },
    { role: 'referee', label: 'Arbitro', teamId: null },
    { role: 'scorekeeper', label: 'Segnapunti', teamId: null },
    { role: 'field_manager', label: 'Responsabile campo', teamId: null },
    { role: 'supervisor', label: 'Docente supervisore', teamId: null },
  ];
}

function renderStatusHistoryRows(rows) {
  if (!rows?.length) return '<div class="empty-state compact">Nessun cambio stato registrato.</div>';
  return rows
    .slice(0, 6)
    .map(
      (row) => `
        <article class="status-history-row">
          <strong>${escapeHtml(formatOperationalStatusLabel(row.previous_status))} ? ${escapeHtml(formatOperationalStatusLabel(row.new_status))}</strong>
          <span>${escapeHtml(formatReportDateTime(row.changed_at))}</span>
          ${row.reason ? `<small>${escapeHtml(row.reason)}</small>` : ''}
        </article>
      `
    )
    .join('');
}

async function renderMatchDetailOperations(match) {
  const checkinsTarget = getEl('match-detail-checkins');
  const historyTarget = getEl('match-detail-status-history');
  if (!checkinsTarget && !historyTarget) return;

  const [checkins, history] = await Promise.all([
    loadMatchCheckins(match.id),
    loadMatchStatusHistory(match.id),
  ]);
  const rowsByRole = new Map((checkins ?? []).map((row) => [`${row.role}:${Number(row.team_id ?? 0)}`, row]));
  const defs = getCheckinDefinitions(match);

  if (checkinsTarget) {
    checkinsTarget.innerHTML = defs
      .map((def) => {
        const row = rowsByRole.get(`${def.role}:${Number(def.teamId ?? 0)}`);
        const checked = Boolean(row?.checked_in);
        return `
          <label class="match-checkin-item ${checked ? 'checked' : ''}">
            <input
              type="checkbox"
              data-action="toggle-match-checkin"
              data-match-id="${match.id}"
              data-role="${escapeHtml(def.role)}"
              data-team-id="${def.teamId ? Number(def.teamId) : ''}"
              ${checked ? 'checked' : ''}
              ${canEditMatches(state.admin?.ruolo) ? '' : 'disabled'}
            />
            <span>${escapeHtml(def.label)}</span>
            <small>${checked ? `OK · ${escapeHtml(formatReportDateTime(row.checked_at))}` : 'Da confermare'}</small>
          </label>
        `;
      })
      .join('');
  }

  if (historyTarget) {
    historyTarget.innerHTML = `
      <h4>Storico stati</h4>
      ${renderStatusHistoryRows(history)}
    `;
  }
}

async function buildMatchConflictWarnings(payload) {
  const warnings = [];
  const newRange = getTimeRange(payload.scheduledStart, payload.scheduledEnd);
  const teamIds = getPayloadTeamIds(payload);

  if (!newRange) {
    warnings.push('La partita non ha uno slot completo: restera da programmare.');
    return warnings;
  }

  const existingMatches = state.adminMatches.filter((match) => isRelevantScheduleMatch(match, payload));
  const teamNamesById = new Map();
  existingMatches.forEach((match) => {
    if (match.home_team_id) teamNamesById.set(Number(match.home_team_id), match.home?.name ?? `Squadra ${match.home_team_id}`);
    if (match.away_team_id) teamNamesById.set(Number(match.away_team_id), match.away?.name ?? `Squadra ${match.away_team_id}`);
  });

  for (const match of existingMatches) {
    const otherRange = getTimeRange(match.scheduled_start, match.scheduled_end);
    if (!otherRange) continue;

    if (payload.venueId && Number(match.venue_id ?? 0) === Number(payload.venueId) && rangesOverlap(newRange, otherRange)) {
      warnings.push(`Campo gia occupato: ${match.venue?.name ?? 'campo'} per ${getMatchTeamsLabel(match)} (${formatScheduleRange(match)}).`);
    }

    const overlappingTeams = getMatchTeamIds(match).filter((teamId) => teamIds.includes(teamId));
    if (overlappingTeams.length && rangesOverlap(newRange, otherRange)) {
      warnings.push(`Squadra gia impegnata: ${overlappingTeams.map((id) => teamNamesById.get(id) ?? `#${id}`).join(', ')} in ${getMatchTeamsLabel(match)}.`);
    }
  }

  let config = null;
  try {
    config = await loadSportConfig(payload.sportId);
  } catch (_error) {
    config = null;
  }

  const minRestMinutes = Math.max(0, Number(config?.min_rest_minutes ?? 0));
  if (minRestMinutes > 0) {
    existingMatches.forEach((match) => {
      const otherRange = getTimeRange(match.scheduled_start, match.scheduled_end);
      if (!otherRange) return;
      const commonTeams = getMatchTeamIds(match).filter((teamId) => teamIds.includes(teamId));
      if (!commonTeams.length) return;
      const gap = minutesBetweenRanges(newRange, otherRange);
      if (gap < minRestMinutes) {
        warnings.push(`Riposo insufficiente (${gap} min): ${commonTeams.map((id) => teamNamesById.get(id) ?? `#${id}`).join(', ')} sotto il limite di ${minRestMinutes} min.`);
      }
    });
  }

  const minPlayers = Math.max(0, Number(config?.min_players ?? 0));
  if (minPlayers > 0) {
    const playerCounts = await Promise.all(
      teamIds.map(async (teamId) => {
        try {
          const players = await loadPlayersByTeam(teamId);
          return { teamId, count: players.length };
        } catch (_error) {
          return { teamId, count: minPlayers };
        }
      })
    );

    playerCounts
      .filter((row) => row.count < minPlayers)
      .forEach((row) => {
        warnings.push(`Numero minimo partecipanti non raggiunto: squadra #${row.teamId} ha ${row.count}/${minPlayers} studenti.`);
      });
  }

  return [...new Set(warnings)];
}

async function confirmMatchConflictWarnings(payload) {
  const warnings = await buildMatchConflictWarnings(payload);
  if (!warnings.length) return true;
  return showAppConfirm(`Controllo automatico conflitti:\n\n${warnings.map((item) => `- ${item}`).join('\n')}\n\nVuoi salvare comunque?`, {
    title: 'Conflitti calendario',
    confirmLabel: 'Salva comunque',
  });
}

async function openMatchModal(match = null) {
  resetFormValues(getEl('form-match'));
  getEl('title-modal-match').textContent = match ? 'Modifica Match' : 'Nuovo Match';
  getEl('btn-submit-match').textContent = match ? 'Salva Match' : 'Crea Match';
  getEl('edit-match-id').value = match?.id ?? '';

  if (match?.sport_id) {
    getEl('select-sport-match').value = String(match.sport_id);
    await populateMatchTeams(match.sport_id);
    renderMatchPhaseOptions(match.sport_id, match.round_name ?? '');
  } else {
    const defaultSportId = getEl('select-sport-match')?.value || getTeamSports()[0]?.id || '';
    if (defaultSportId) {
      getEl('select-sport-match').value = String(defaultSportId);
      await populateMatchTeams(defaultSportId);
      renderMatchPhaseOptions(defaultSportId);
    }
  }

  if (match?.round_name) {
    getEl('select-match-phase').value = match.round_name;
  }
  getEl('select-home-team').value = match?.home_team_id ? String(match.home_team_id) : '';
  getEl('select-away-team').value = match?.away_team_id ? String(match.away_team_id) : '';
  getEl('select-match-venue').value = match?.venue_id ? String(match.venue_id) : '';
  const deviceSelect = getEl('select-match-device');
  if (deviceSelect) deviceSelect.value = match?.assigned_device_id ?? '';

  if (match?.scheduled_start) {
    const start = new Date(match.scheduled_start);
    getEl('input-match-date').value = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    getEl('input-match-start').value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  }
  if (match?.scheduled_end) {
    const end = new Date(match.scheduled_end);
    getEl('input-match-end').value = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  }
  getEl('input-match-notes').value = match?.schedule_notes ?? '';

  openModal('modal-match');
}

function buildMatchFormPayload() {
  const date = getEl('input-match-date')?.value ?? '';
  const startTime = getEl('input-match-start')?.value ?? '';
  const endTime = getEl('input-match-end')?.value ?? '';
  const hasSchedule = Boolean(date || startTime || endTime);

  return {
    matchId: Number(getEl('edit-match-id')?.value || 0) || null,
    sportId: Number(getEl('select-sport-match').value || 0),
    homeTeamId: Number(getEl('select-home-team').value || 0),
    awayTeamId: Number(getEl('select-away-team').value || 0),
    roundName: getEl('select-match-phase').value,
    venueId: Number(getEl('select-match-venue').value || 0) || null,
    assignedDeviceId: getEl('select-match-device')?.value || null,
    scheduledStart: hasSchedule ? combineLocalDateTime(date, startTime) : null,
    scheduledEnd: hasSchedule ? combineLocalDateTime(date, endTime) : null,
    scheduleNotes: getEl('input-match-notes')?.value ?? '',
  };
}

async function handleSaveMatch(event) {
  event.preventDefault();
  const payload = buildMatchFormPayload();
  const originalMatch = payload.matchId ? getMatchById(payload.matchId) : null;
  if (didOperationalScheduleChange(originalMatch, payload)) {
    const reason = await showAppPrompt('Motivo della variazione/rinvio:', {
      title: 'Motivo variazione',
      inputLabel: 'Motivo',
      multiline: true,
      placeholder: 'Indica perche stai cambiando orario, campo o programmazione...',
      confirmLabel: 'Continua',
    });
    if (reason === null) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 5) {
      showToast('Inserisci una motivazione di almeno 5 caratteri per la variazione.', 'error');
      return;
    }
    payload.scheduleNotes = [payload.scheduleNotes, `Variazione: ${cleanReason}`]
      .filter((item) => String(item ?? '').trim())
      .join(' | ');
  }
  const shouldSendVariationTelegram = didMatchVariationChange(originalMatch, payload);
  const canSaveDespiteWarnings = await confirmMatchConflictWarnings(payload);
  if (!canSaveDespiteWarnings) return;

  let savedMatch;
  if (payload.matchId) {
    savedMatch = await updateManualMatch(payload);
  } else {
    savedMatch = await createManualMatch(payload);
  }
  const savedMatchId = Number(payload.matchId || savedMatch?.id || 0);
  if (canAccessControlCenter(state.admin?.ruolo) && savedMatchId) {
    const originalDeviceId = String(originalMatch?.assigned_device_id ?? '');
    const nextDeviceId = String(payload.assignedDeviceId ?? '');
    if (originalDeviceId !== nextDeviceId) {
      await assignMatchDevice(savedMatchId, nextDeviceId, payload.matchId ? 'Aggiornamento postazione match' : 'Assegnazione postazione match');
    }
  }
  closeModal('modal-match');
  await loadMatchesTable();
  if (payload.matchId && shouldSendVariationTelegram) {
    sendTelegramMatchReminder(payload.matchId)
      .then(() => showToast('Variazione salvata e comunicata su Telegram.', 'success'))
      .catch((error) => showToast(`Partita salvata, ma Telegram non inviato: ${error.message}`, 'error'));
  }
  if (savedMatch?.__scheduleUnsupported) {
    showToast('Partita salvata senza campo/orario. Applica la migrazione 009 e ricarica schema/cache Supabase.', 'error');
    return;
  }
  if (savedMatch?.__savedViaRpc) {
    showToast(payload.matchId ? 'Partita aggiornata via RPC.' : 'Partita creata via RPC.', 'success');
    return;
  }
  showToast(payload.matchId ? 'Partita aggiornata.' : 'Partita creata.', 'success');
}

async function handleGenerateMatches() {
  const filterSport = getEl('filter-match-sport')?.value ?? 'all';
  const sportId = Number(filterSport !== 'all' ? filterSport : getEl('select-sport-match').value || 0);
  if (!sportId) return showToast('Seleziona un torneo per la generazione.', 'error');
  const sport = getSportById(sportId);
  const inserted = await generateMatchesForSport(sportId, Boolean(sport?.has_return_match));
  showToast(`${inserted.message ?? 'Calendario generato.'} Partite create: ${inserted.inserted}.`, 'success');
  await loadMatchesTable();
}

async function handleGenerateSemifinals() {
  const sportId = Number(getEl('playoff-sport-select').value || 0);
  if (!sportId) return showToast('Seleziona un torneo.', 'error');
  const count = await generateSemifinals(sportId);
  showToast(`Semifinali create: ${count}.`, 'success');
  await loadMatchesTable();
}

function moveIsoToCalendarDayKeepingTime(value, targetDayKey) {
  const original = value ? new Date(value) : null;
  if (!original || Number.isNaN(original.getTime()) || targetDayKey === 'unscheduled') return null;
  const [year, month, day] = String(targetDayKey).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(
    year,
    month - 1,
    day,
    original.getHours(),
    original.getMinutes(),
    original.getSeconds(),
    original.getMilliseconds()
  ).toISOString();
}

async function handleCalendarDropReschedule(matchId, targetDayKey) {
  const match = getMatchById(matchId);
  if (!match || !canEditMatches(state.admin?.ruolo)) return;
  if (targetDayKey === 'unscheduled') {
    showToast('Trascina su un giorno programmato, non nella colonna da programmare.', 'error');
    return;
  }
  if (!match.scheduled_start || !match.scheduled_end) {
    showToast('Questo match non ha ancora uno slot completo: apri Modifica e imposta orario/campo.', 'error');
    return;
  }

  const scheduledStart = moveIsoToCalendarDayKeepingTime(match.scheduled_start, targetDayKey);
  const scheduledEnd = moveIsoToCalendarDayKeepingTime(match.scheduled_end, targetDayKey);
  if (!scheduledStart || !scheduledEnd) return;
  if (formatCalendarDayKey(scheduledStart) === formatCalendarDayKey(match.scheduled_start)) return;

  const reason = await showAppPrompt(`Motivo dello spostamento di ${getMatchTeamsLabel(match)}:`, {
    title: 'Sposta match',
    inputLabel: 'Motivo',
    multiline: true,
    placeholder: 'Es. campo non disponibile, rinvio per ritardo, cambio programma',
    confirmLabel: 'Sposta',
  });
  if (reason === null) return;
  const cleanReason = reason.trim();
  if (cleanReason.length < 5) {
    showToast('Inserisci una motivazione di almeno 5 caratteri.', 'error');
    return;
  }

  const payload = {
    matchId: match.id,
    sportId: match.sport_id,
    homeTeamId: match.home_team_id,
    awayTeamId: match.away_team_id,
    roundName: match.round_name ?? 'Girone (Andata)',
    venueId: match.venue_id,
    scheduledStart,
    scheduledEnd,
    scheduleNotes: [match.schedule_notes, `Spostamento calendario: ${cleanReason}`]
      .filter((item) => String(item ?? '').trim())
      .join(' | '),
  };

  if (!(await confirmMatchConflictWarnings(payload))) return;
  await updateManualMatch(payload);
  await loadMatchesTable();
  sendTelegramMatchReminder(match.id)
    .then(() => showToast('Match spostato e comunicato su Telegram.', 'success'))
    .catch((error) => showToast(`Match spostato, ma Telegram non inviato: ${error.message}`, 'error'));
}

async function handleDeleteMatch(matchId) {
  if (!(await showAppConfirm('Confermi eliminazione match?', {
    title: 'Elimina match',
    tone: 'danger',
    confirmLabel: 'Elimina',
  }))) return;
  await deleteMatch(matchId);
  await loadMatchesTable();
  showToast('Match eliminato.', 'success');
}

async function handleReopenMatchForCorrection(matchId) {
  const match = getMatchById(matchId);
  const teams = match ? getMatchTeamsLabel(match) : 'questo match';
  const reason = await showAppPrompt(`Motivo della riapertura per ${teams}:\n\nLa motivazione restera nel registro modifiche.`, {
    title: 'Riapri match',
    inputLabel: 'Motivo',
    multiline: true,
    confirmLabel: 'Riapri',
  });
  if (reason === null) return;

  await reopenMatchForCorrection(matchId, reason);
  closeModal('modal-match-detail');
  await loadMatchesTable();
  await loadDashboardStats();
  showToast('Match riaperto per correzione. Ora puoi aprire il live e richiuderlo con nuove firme.', 'success');
}

function goToLive(matchId) {
  window.location.href = `live.html?match=${encodeURIComponent(matchId)}`;
}

function getSettingsVisibility(sportType, format) {
  if (!sportType) {
    return {
      comuni_team: false,
      classifica_gironi: false,
      basket_live: false,
      calcio_discipline: false,
      pallavolo_live: false,
      athletics_rules: false,
      athletics_note: false,
    };
  }
  const isAthletics = sportType === 'atletica';
  const usesStandings = format === 'gironi';
  return {
    comuni_team: !isAthletics,
    classifica_gironi: !isAthletics && usesStandings,
    basket_live: sportType === 'basket',
    calcio_discipline: sportType === 'calcio',
    pallavolo_live: sportType === 'pallavolo',
    athletics_rules: isAthletics,
    athletics_note: false,
  };
}

function applySettingsVisibility(sport) {
  const sportType = sport?.sport_type ?? '';
  const format = sport?.format ?? '';
  const visibility = getSettingsVisibility(sportType, format);

  document
    .querySelectorAll('[data-settings-group]')
    .forEach((section) => section.classList.toggle('hidden', !visibility[section.dataset.settingsGroup]));

  getEl('settings-athletics-note')?.classList.toggle('hidden', !visibility.athletics_note);
  getEl('settings-selected-sport-type').value = SPORT_TYPE_LABELS[sportType] ?? '-';
  getEl('settings-selected-format').value = FORMAT_LABELS[format] ?? '-';
}

function parseRankingTiebreakersInput(value) {
  const allowed = new Set(DEFAULT_RANKING_RULES);
  const rawValues = Array.isArray(value) ? value : String(value ?? '').split(',');
  const parsed = rawValues
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => allowed.has(item));
  const unique = [...new Set(parsed)];
  return unique.length ? unique : [...DEFAULT_RANKING_RULES];
}

function getRankingRulesFromDom() {
  const list = getEl('set-ranking-tiebreakers-list');
  const values = [...(list?.querySelectorAll('[data-ranking-rule]') ?? [])].map((item) => item.dataset.rankingRule);
  return parseRankingTiebreakersInput(values);
}

function renderRankingRulesList(rules = DEFAULT_RANKING_RULES) {
  const list = getEl('set-ranking-tiebreakers-list');
  if (!list) return;
  const ordered = parseRankingTiebreakersInput(rules);
  const missing = DEFAULT_RANKING_RULES.filter((rule) => !ordered.includes(rule));
  const allRules = [...ordered, ...missing];

  list.innerHTML = allRules
    .map(
      (rule, index) => `
      <div class="ranking-sort-item" draggable="true" data-ranking-rule="${escapeHtml(rule)}">
        <span class="ranking-sort-handle"><i class="fa-solid fa-grip-vertical"></i></span>
        <strong>${index + 1}. ${escapeHtml(RANKING_RULE_LABELS[rule] ?? rule)}</strong>
      </div>
    `
    )
    .join('');
}

function renumberRankingRulesList() {
  getEl('set-ranking-tiebreakers-list')
    ?.querySelectorAll('.ranking-sort-item strong')
    .forEach((label, index) => {
      const rule = label.closest('[data-ranking-rule]')?.dataset.rankingRule;
      label.textContent = `${index + 1}. ${RANKING_RULE_LABELS[rule] ?? rule}`;
    });
}

function bindRankingRulesDrag() {
  const list = getEl('set-ranking-tiebreakers-list');
  if (!list) return;

  let dragged = null;
  list.addEventListener('dragstart', (event) => {
    dragged = event.target.closest('[data-ranking-rule]');
    if (!dragged) return;
    dragged.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragover', (event) => {
    event.preventDefault();
    const target = event.target.closest('[data-ranking-rule]');
    if (!dragged || !target || dragged === target) return;
    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    list.insertBefore(dragged, after ? target.nextSibling : target);
  });

  list.addEventListener('dragend', () => {
    dragged?.classList.remove('dragging');
    dragged = null;
    renumberRankingRulesList();
  });
}

function normalizePrivacySettings(config = {}) {
  const raw = config.privacy_settings;
  const parsed = typeof raw === 'string'
    ? (() => {
        try {
          return JSON.parse(raw);
        } catch (_error) {
          return {};
        }
      })()
    : raw ?? {};
  const playerName = ['full', 'abbreviated', 'hidden'].includes(parsed.player_name) ? parsed.player_name : 'full';
  const hidden = playerName === 'hidden';
  return {
    player_name: playerName,
    show_class: hidden ? false : parsed.show_class !== false,
    show_personal_stats: hidden ? false : parsed.show_personal_stats !== false,
    show_mvp: hidden ? false : parsed.show_mvp !== false,
    show_disciplinary: hidden ? false : parsed.show_disciplinary !== false,
  };
}

function applyPrivacyPublicLock() {
  const hidden = getEl('set-privacy-player-name')?.value === 'hidden';
  [
    'set-privacy-show-class',
    'set-privacy-show-stats',
    'set-privacy-show-mvp',
    'set-privacy-show-disciplinary',
  ].forEach((id) => {
    const input = getEl(id);
    if (!input) return;
    if (hidden) input.checked = false;
    input.disabled = hidden;
    input.closest('.checkbox-row')?.classList.toggle('is-disabled', hidden);
  });
}

function buildSuperSettingsPayload() {
  const playerName = getEl('set-privacy-player-name')?.value || 'full';
  const hidden = playerName === 'hidden';
  return {
    ranking_tiebreakers: getRankingRulesFromDom(),
    min_rest_minutes: Math.max(0, Number(getEl('set-min-rest-minutes')?.value || 0)),
    advanced_live_events_enabled: Boolean(getEl('set-advanced-live-events')?.checked),
    privacy_settings: {
      player_name: playerName,
      show_class: hidden ? false : Boolean(getEl('set-privacy-show-class')?.checked),
      show_personal_stats: hidden ? false : Boolean(getEl('set-privacy-show-stats')?.checked),
      show_mvp: hidden ? false : Boolean(getEl('set-privacy-show-mvp')?.checked),
      show_disciplinary: hidden ? false : Boolean(getEl('set-privacy-show-disciplinary')?.checked),
    },
  };
}

function fillSuperSettingsForm(settings = {}) {
  const rankingValue = settings.global_ranking_tiebreakers?.rules ?? DEFAULT_RANKING_RULES;
  renderRankingRulesList(rankingValue);

  const conflicts = settings.global_conflict_rules ?? {};
  getEl('set-min-rest-minutes').value = Math.max(0, Number(conflicts.min_rest_minutes ?? 0));

  const live = settings.global_live_settings ?? {};
  getEl('set-advanced-live-events').checked = Boolean(live.advanced_live_events_enabled);

  const privacy = normalizePrivacySettings({
    privacy_settings: settings.global_privacy_settings ?? {},
  });
  getEl('set-privacy-player-name').value = privacy.player_name;
  getEl('set-privacy-show-class').checked = Boolean(privacy.show_class);
  getEl('set-privacy-show-stats').checked = Boolean(privacy.show_personal_stats);
  getEl('set-privacy-show-mvp').checked = Boolean(privacy.show_mvp);
  getEl('set-privacy-show-disciplinary').checked = Boolean(privacy.show_disciplinary);
  applyPrivacyPublicLock();
}

async function saveSuperSettingsGeneral() {
  const payload = buildSuperSettingsPayload();
  await Promise.all([
    savePlatformSetting('global_ranking_tiebreakers', { rules: payload.ranking_tiebreakers }),
    savePlatformSetting('global_conflict_rules', { min_rest_minutes: payload.min_rest_minutes }),
    savePlatformSetting('global_live_settings', {
      advanced_live_events_enabled: payload.advanced_live_events_enabled,
    }),
    savePlatformSetting('global_privacy_settings', payload.privacy_settings),
  ]);

  const updates = state.sports.map((sport) =>
    upsertSportConfig(sport.id, {
      ranking_tiebreakers: payload.ranking_tiebreakers,
      min_rest_minutes: payload.min_rest_minutes,
      advanced_live_events_enabled: payload.advanced_live_events_enabled,
      privacy_settings: payload.privacy_settings,
    }).catch(() => null)
  );
  await Promise.all(updates);
}

function buildSettingsPayloadForSport(sport) {
  const sportType = sport?.sport_type ?? '';
  const format = sport?.format ?? '';
  const visibility = getSettingsVisibility(sportType, format);
  const payload = {};

  if (visibility.comuni_team) {
    payload.max_fouls = Number(getEl('set-max-fouls').value || 3);
    payload.min_players = Number(getEl('set-min-players').value || 5);
    payload.ranking_weight_presence = Number(getEl('set-weight-pres').value || 70);
    payload.ranking_weight_fairplay = Number(getEl('set-weight-fair').value || 30);
    payload.allow_mvp = getEl('set-allow-mvp').checked;
  }

  if (visibility.classifica_gironi) {
    payload.points_win = Number(getEl('set-pts-win').value || 3);
    payload.points_draw = Number(getEl('set-pts-draw').value || 1);
    payload.points_loss = Number(getEl('set-pts-loss').value || 0);
  }

  if (visibility.basket_live) {
    payload.quarters_count = Number(getEl('set-quarters').value || 4);
    payload.quarter_duration_sec = Number(getEl('set-quarter-duration').value || 600);
    payload.timeouts_per_team = Number(getEl('set-timeouts').value || 2);
  }

  if (visibility.calcio_discipline) {
    payload.allow_yellow_cards = getEl('set-allow-yellow').checked;
    payload.allow_red_cards = getEl('set-allow-red').checked;
    payload.max_yellow_cards = Math.max(1, Number(getEl('set-max-yellow-cards')?.value || 2));
    payload.max_red_cards = Math.max(1, Number(getEl('set-max-red-cards')?.value || 1));
  }

  if (visibility.pallavolo_live) {
    payload.volley_sets = Number(getEl('set-volley-sets').value || 3);
  }

  if (visibility.athletics_rules) {
    payload.athletics_attempts_per_event = Number(getEl('set-ath-attempts').value || 1);
    payload.athletics_min_events_per_player = Number(getEl('set-ath-min-events').value || 1);
    payload.athletics_max_events_per_player = Number(getEl('set-ath-max-events').value || 99);
  }

  return payload;
}

function fillSettingsForm(config) {
  getEl('set-pts-win').value = config.points_win;
  getEl('set-pts-draw').value = config.points_draw;
  getEl('set-pts-loss').value = config.points_loss;
  getEl('set-max-fouls').value = config.max_fouls;
  getEl('set-quarters').value = config.quarters_count;
  getEl('set-quarter-duration').value = config.quarter_duration_sec;
  getEl('set-timeouts').value = config.timeouts_per_team;
  getEl('set-min-players').value = config.min_players;
  getEl('set-weight-pres').value = config.ranking_weight_presence;
  getEl('set-weight-fair').value = config.ranking_weight_fairplay;
  getEl('set-volley-sets').value = config.volley_sets;
  getEl('set-ath-attempts').value = config.athletics_attempts_per_event ?? 1;
  getEl('set-ath-min-events').value = config.athletics_min_events_per_player ?? 1;
  getEl('set-ath-max-events').value = config.athletics_max_events_per_player ?? 99;
  getEl('set-allow-yellow').checked = Boolean(config.allow_yellow_cards);
  getEl('set-allow-red').checked = Boolean(config.allow_red_cards);
  getEl('set-max-yellow-cards').value = config.max_yellow_cards ?? 2;
  getEl('set-max-red-cards').value = config.max_red_cards ?? 1;
  getEl('set-allow-mvp').checked = Boolean(config.allow_mvp ?? true);
}

async function loadSettingsForSelectedSport() {
  const sportId = Number(getEl('settings-sport-select')?.value || 0);
  const sport = getSportById(sportId);
  applySettingsVisibility(sport);
  if (!sportId || !sport) return;
  const config = await loadSportConfig(sportId);
  fillSettingsForm(config);
}

async function saveSettingsForSport() {
  const sportId = Number(getEl('settings-sport-select').value || 0);
  if (!sportId) return showToast('Seleziona un torneo per salvare la configurazione.', 'error');
  const sport = getSportById(sportId);
  if (!sport) return showToast('Torneo non trovato.', 'error');

  const payload = buildSettingsPayloadForSport(sport);
  if (sport.sport_type === 'atletica') {
    const minEvents = Number(payload.athletics_min_events_per_player ?? 0);
    const maxEvents = Number(payload.athletics_max_events_per_player ?? 99);
    if (minEvents > maxEvents) {
      showToast('Configurazione atletica non valida: il minimo eventi non può superare il massimo.', 'error');
      return;
    }
  }

  const savedConfig = await upsertSportConfig(sportId, payload);
  const unsupportedColumns = savedConfig?.__unsupportedConfigColumns ?? [];
  if (unsupportedColumns.length) {
    showToast(
      `Impostazioni salvate con compatibilità. Aggiorna schema/cache per colonne: ${unsupportedColumns.join(', ')}.`,
      'error'
    );
    return;
  }
  showToast('Impostazioni salvate.', 'success');
}

async function openSuperSettingsModal() {
  if (!canManageAll(state.admin?.ruolo)) {
    showToast('Solo un Super Admin può aprire queste impostazioni.', 'error');
    return;
  }
  const platformSettings = await loadPlatformSettingsMap().catch(() => ({}));
  fillSuperSettingsForm(platformSettings);
  openModal('modal-super-settings');
  await Promise.all([
    renderPlatformBackupsList().catch((error) => showToast(error.message, 'error')),
    adminUsersPanel.load().catch(() => {
      adminUsersPanel.renderUnavailable();
    }),
  ]);
}

async function handleCreatePlatformBackup() {
  const reason = await showAppPrompt('Motivo del backup:', {
    title: 'Crea backup',
    inputLabel: 'Motivo',
    placeholder: 'Es. prima della giornata torneo',
    confirmLabel: 'Crea backup',
  });
  if (reason === null) return;
  const result = await createPlatformBackup({ sportId: null, reason });
  await renderPlatformBackupsList();
  showToast(`Backup creato: #${result.backup_id}.`, 'success');
}

function renderPlatformBackupRows(rows = []) {
  const body = getEl('table-platform-backups-body');
  if (!body) return;
  body.innerHTML = rows.length
    ? rows
        .map(
          (backup) => `
        <tr>
          <td><strong>#${backup.id}</strong></td>
          <td>${escapeHtml(formatReportDateTime(backup.created_at))}</td>
          <td>${escapeHtml(backup.scope === 'sport' ? `Torneo #${backup.sport_id}` : 'Completo')}</td>
          <td>${escapeHtml(backup.reason || '-')}</td>
          <td>${backup.restored_at ? `<span class="badge badge-warning">Ripristinato ${escapeHtml(formatReportDateTime(backup.restored_at))}</span>` : '<span class="badge badge-success">Disponibile</span>'}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-ghost btn-compact" type="button" data-action="restore-backup" data-id="${backup.id}"><i class="fa-solid fa-rotate-left"></i> Ripristina</button>
              <button class="btn btn-danger btn-compact" type="button" data-action="delete-backup" data-id="${backup.id}"><i class="fa-solid fa-trash"></i> Elimina</button>
            </div>
          </td>
        </tr>
      `
        )
        .join('')
    : '<tr><td colspan="6" class="empty-state">Nessun backup disponibile.</td></tr>';
}

async function renderPlatformBackupsList() {
  try {
    renderPlatformBackupRows(await loadPlatformBackups({ limit: 12 }));
  } catch (error) {
    const body = getEl('table-platform-backups-body');
    if (body) body.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function handleRestorePlatformBackup(backupId) {
  if (!backupId) return;
  const reason = await showAppPrompt('Motivo del ripristino:', {
    title: `Ripristina backup #${backupId}`,
    inputLabel: 'Motivo',
    multiline: true,
    placeholder: 'Spiega perche stai ripristinando questo backup...',
    confirmLabel: 'Ripristina',
  });
  if (reason === null) return;
  const result = await restorePlatformBackup({ backupId, reason });
  await loadSettingsForSelectedSport();
  await loadMatchesTable();
  await renderPlatformBackupsList();
  showToast(result.message || 'Backup ripristinato.', 'success');
}

async function handleDeletePlatformBackup(backupId) {
  if (!backupId) return;
  if (!(await showAppConfirm(`Eliminare definitivamente il backup #${backupId}?`, {
    title: 'Elimina backup',
    tone: 'danger',
    confirmLabel: 'Elimina',
  }))) return;
  await deletePlatformBackup(backupId);
  await renderPlatformBackupsList();
  showToast('Backup eliminato.', 'success');
}

function getSelectedAthleticsSportId() {
  return Number(getEl('athletics-sport-select')?.value || 0);
}

function setAthleticsModalPanel(panelId) {
  document.querySelectorAll('[data-athletics-modal-panel]').forEach((button) => {
    button.classList.toggle('active', button.dataset.athleticsModalPanel === panelId);
  });
  document.querySelectorAll('[data-athletics-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.athleticsPanel === panelId);
  });
  const titles = {
    'new-event': 'Inserisci',
    'result-entry': 'Inserisci',
    records: 'Inserisci',
    relays: 'Inserisci',
    heats: 'Inserisci',
  };
  getEl('title-modal-event').textContent = titles[panelId] ?? 'Atletica';
}

async function openEventModal(eventItem = null, panelId = 'new-event') {
  resetFormValues(getEl('form-event'));
  resetFormValues(getEl('form-event-result'));
  if (eventItem) {
    setAthleticsModalPanel('new-event');
    getEl('title-modal-event').textContent = 'Inserisci';
    getEl('edit-event-id').value = eventItem.id;
    getEl('input-event-name').value = eventItem.name;
    getEl('input-event-unit').value = eventItem.unit;
    getEl('input-event-order').value = eventItem.sort_order;
  } else {
    getEl('edit-event-id').value = '';
    setAthleticsModalPanel(panelId);
  }
  openModal('modal-event');
}

async function saveEventFromForm(event) {
  event.preventDefault();
  const payload = {
    id: getEl('edit-event-id').value || null,
    sport_id: getSelectedAthleticsSportId(),
    name: getEl('input-event-name').value,
    unit: getEl('input-event-unit').value,
    sort_order: getEl('input-event-order').value,
  };

  if (!payload.sport_id || !payload.name) {
    showToast('Compila i campi evento.', 'error');
    return;
  }

  const savedEvent = await saveAthleticsEvent(payload);
  if (savedEvent?.id) state.selectedEventId = Number(savedEvent.id);
  await loadEventsSection();
  showToast('Evento atletica salvato.', 'success');
}

async function handleDeleteEvent(eventId) {
  if (!(await showAppConfirm('Confermi disattivazione evento?', {
    title: 'Disattiva evento',
    tone: 'danger',
    confirmLabel: 'Disattiva',
  }))) return;
  await deleteAthleticsEvent(eventId);
  await loadEventsSection();
  showToast('Evento disattivato.', 'success');
}

async function populatePlayersForAthleticsSport(sportId) {
  const playerSelect = getEl('event-player-select');
  if (!sportId) {
    playerSelect.innerHTML = '<option value="">-- Seleziona --</option>';
    return;
  }

  const teams = await loadTeamsBySport(sportId);
  const teamIds = teams.map((item) => item.id);

  if (!teamIds.length) {
    playerSelect.innerHTML = '<option value="">Nessun giocatore</option>';
    return;
  }

  const { data: players } = await run(
    db
      .from('players')
      .select('id, full_name, team_id, teams(name)')
      .in('team_id', teamIds)
      .order('full_name', { ascending: true }),
    'Caricamento studenti atletica'
  );

  playerSelect.innerHTML =
    '<option value="">-- Seleziona --</option>' +
    (players ?? [])
      .map(
        (player) =>
          `<option value="${player.id}">${escapeHtml(player.full_name)} · ${escapeHtml(player.teams?.name ?? '-')}</option>`
      )
      .join('');
}

function renderEventsTable(events) {
  const body = getEl('table-events-body');
  if (!body) return;

  body.innerHTML = (events ?? [])
    .map(
      (event) => `
      <tr>
        <td><strong>${escapeHtml(event.name)}</strong></td>
        <td>${escapeHtml(event.unit)}</td>
        <td>${event.sort_order === 'asc' ? 'Tempo / minore è meglio' : 'Misura / maggiore è meglio'}</td>
        <td>
          <div class="table-actions" ${canManageAll(state.admin?.ruolo) ? '' : 'style="display:none"'}>
            <button class="icon-btn edit" data-action="edit-event" data-id="${event.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn delete" data-action="delete-event" data-id="${event.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `
    )
    .join('');

  const eventOptions =
    '<option value="">-- Seleziona evento --</option>' +
    (events ?? [])
      .map(
        (event) =>
          `<option value="${event.id}" data-order="${event.sort_order}" data-unit="${escapeHtml(event.unit)}">${escapeHtml(event.name)}</option>`
      )
      .join('');

  ['event-select-results', 'event-ranking-select', 'ath-heat-event', 'ath-record-event', 'ath-relay-event'].forEach((id) => {
    const select = getEl(id);
    if (!select) return;
    const previousValue = select.value || (state.selectedEventId ? String(state.selectedEventId) : '');
    select.innerHTML = eventOptions;
    if (previousValue && [...select.options].some((option) => option.value === String(previousValue))) {
      select.value = String(previousValue);
    }
  });
}

function formatAthleticsPhase(phase) {
  if (phase === 'final') return 'Finale';
  return 'Qualificazione';
}

function formatAthleticsLaneStatus(status) {
  const labels = {
    scheduled: 'Programmato',
    false_start: 'Falsa partenza',
    dns: 'Non partito',
    dnf: 'Ritirato',
    dq: 'Squalificato',
    qualified: 'Qualificato',
    finalist: 'Finalista',
  };
  return labels[status] ?? 'Programmato';
}

async function loadAthleticsRoster(sportId) {
  const teams = await loadTeamsBySport(sportId);
  const teamIds = teams.map((item) => Number(item.id)).filter(Boolean);
  if (!teamIds.length) return { teams, players: [] };

  const { data: players } = await run(
    db
      .from('players')
      .select('id, full_name, team_id, teams(name)')
      .in('team_id', teamIds)
      .order('full_name', { ascending: true }),
    'Caricamento roster atletica avanzata'
  );

  return { teams, players: players ?? [] };
}

function renderAthleticsRosterOptions({ teams = [], players = [] } = {}) {
  const playerOptions = '<option value="">-- Seleziona studente --</option>' +
    players
      .map((player) => `<option value="${player.id}" data-team-id="${player.team_id}">${escapeHtml(player.full_name)} · ${escapeHtml(player.teams?.name ?? '-')}</option>`)
      .join('');
  ['ath-lane-player', 'ath-relay-player'].forEach((id) => {
    const select = getEl(id);
    if (select) select.innerHTML = playerOptions;
  });

  const teamOptions = '<option value="">-- Classe --</option>' +
    teams.map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join('');
  const relayTeam = getEl('ath-relay-team');
  if (relayTeam) relayTeam.innerHTML = teamOptions;
}

function renderAthleticsAdvancedPanel(_events, advancedData, roster) {
  renderAthleticsRosterOptions(roster);

  const heats = advancedData?.heats ?? [];
  const lanes = advancedData?.lanes ?? [];
  const records = advancedData?.records ?? [];
  const relays = advancedData?.relays ?? [];
  const relayMembers = advancedData?.relayMembers ?? [];

  const heatOptions = '<option value="">-- Seleziona batteria --</option>' +
    heats
      .map((heat) => `<option value="${heat.id}">${escapeHtml(heat.event?.name ?? 'Evento')} · ${escapeHtml(formatAthleticsPhase(heat.phase))} ${heat.heat_number}</option>`)
      .join('');
  const heatSelect = getEl('ath-lane-heat');
  if (heatSelect) heatSelect.innerHTML = heatOptions;

  const relayOptions = '<option value="">-- Seleziona staffetta --</option>' +
    relays
      .map((relay) => `<option value="${relay.id}">${escapeHtml(relay.relay_name)} · ${escapeHtml(relay.event?.name ?? '-')}</option>`)
      .join('');
  const relaySelect = getEl('ath-relay-select');
  if (relaySelect) relaySelect.innerHTML = relayOptions;

  const heatList = getEl('athletics-heats-list');
  if (heatList) {
    heatList.innerHTML = heats.length
      ? heats
          .map((heat) => {
            const heatLanes = lanes.filter((lane) => Number(lane.heat_id) === Number(heat.id));
            return `
              <article class="athletics-compact-row">
                <strong>${escapeHtml(heat.event?.name ?? 'Evento')} · ${escapeHtml(formatAthleticsPhase(heat.phase))} ${heat.heat_number}</strong>
                <span>${heat.scheduled_start ? escapeHtml(formatReportDateTime(heat.scheduled_start)) : 'Senza orario'}${heat.notes ? ` · ${escapeHtml(heat.notes)}` : ''}</span>
                <small>${heatLanes.length ? heatLanes.map((lane) => `Corsia ${lane.lane_number}: ${escapeHtml(lane.player?.full_name ?? lane.team?.name ?? '-')}`).join(' · ') : 'Nessuna corsia assegnata'}</small>
              </article>
            `;
          })
          .join('')
      : '<div class="empty-state compact">Nessuna batteria configurata.</div>';
  }

  const recordList = getEl('athletics-records-list');
  if (recordList) {
    recordList.innerHTML = records.length
      ? records
          .map((record) => `
            <article class="athletics-compact-row">
              <strong>${escapeHtml(record.event_name)} · ${Number(record.value).toFixed(3)} ${escapeHtml(record.unit ?? '')}</strong>
              <span>${escapeHtml([record.player_name, record.team_name].filter(Boolean).join(' · ') || 'Record storico')}</span>
              <small>${record.record_date ? escapeHtml(new Date(record.record_date).toLocaleDateString('it-IT')) : 'Data non indicata'}${record.notes ? ` · ${escapeHtml(record.notes)}` : ''}</small>
            </article>
          `)
          .join('')
      : '<div class="empty-state compact">Nessun record salvato.</div>';
  }

  const relaysList = getEl('athletics-relays-list');
  if (relaysList) {
    relaysList.innerHTML = relays.length
      ? relays
          .map((relay) => {
            const members = relayMembers
              .filter((member) => Number(member.relay_team_id) === Number(relay.id))
              .sort((a, b) => Number(a.leg_order) - Number(b.leg_order));
            return `
              <article class="athletics-compact-row">
                <strong>${escapeHtml(relay.relay_name)}</strong>
                <span>${escapeHtml(relay.event?.name ?? '-')} · ${escapeHtml(relay.team?.name ?? 'Classe libera')}</span>
                <small>${members.length ? members.map((member) => `${member.leg_order}. ${escapeHtml(member.player?.full_name ?? '-')}`).join(' · ') : 'Nessun frazionista'}</small>
              </article>
            `;
          })
          .join('')
      : '<div class="empty-state compact">Nessuna staffetta configurata.</div>';
  }
}

async function handleSaveAthleticsHeat(event) {
  event.preventDefault();
  const eventId = Number(getEl('ath-heat-event')?.value || 0);
  if (!eventId) {
    showToast('Seleziona un evento nella barra Atletica.', 'error');
    return;
  }
  const scheduledValue = getEl('ath-heat-start')?.value;
  await saveAthleticsHeat({
    event_id: eventId,
    phase: getEl('ath-heat-phase').value,
    heat_number: getEl('ath-heat-number').value,
    scheduled_start: scheduledValue ? new Date(scheduledValue).toISOString() : null,
    notes: getEl('ath-heat-notes').value,
  });
  await loadEventsSection();
  showToast('Batteria salvata.', 'success');
}

async function handleSaveAthleticsLane(event) {
  event.preventDefault();
  const playerOption = getEl('ath-lane-player')?.selectedOptions?.[0];
  await saveAthleticsLaneAssignment({
    heat_id: getEl('ath-lane-heat').value,
    player_id: getEl('ath-lane-player').value,
    team_id: playerOption?.dataset?.teamId ?? null,
    lane_number: getEl('ath-lane-number').value,
    status: getEl('ath-lane-status').value,
  });
  await loadEventsSection();
  showToast('Corsia assegnata.', 'success');
}

async function handleSaveAthleticsRecord(event) {
  event.preventDefault();
  const selectedEvent = getEl('ath-record-event')?.selectedOptions?.[0];
  const eventId = Number(getEl('ath-record-event')?.value || 0);
  if (!eventId) {
    showToast('Seleziona un evento nella barra Atletica.', 'error');
    return;
  }
  await saveAthleticsSchoolRecord({
    sport_id: getSelectedAthleticsSportId(),
    event_id: eventId,
    event_name: selectedEvent?.textContent ?? '',
    unit: selectedEvent?.dataset?.unit ?? 'points',
    player_name: getEl('ath-record-player').value,
    team_name: getEl('ath-record-team').value,
    value: getEl('ath-record-value').value,
    record_date: getEl('ath-record-date').value || null,
    notes: getEl('ath-record-notes').value,
  });
  getEl('form-athletics-record')?.reset();
  await loadEventsSection();
  showToast('Record salvato.', 'success');
}

async function handleSaveAthleticsRelay(event) {
  event.preventDefault();
  const eventId = Number(getEl('ath-relay-event')?.value || 0);
  if (!eventId) {
    showToast('Seleziona un evento nella barra Atletica.', 'error');
    return;
  }
  await saveAthleticsRelayTeam({
    event_id: eventId,
    team_id: getEl('ath-relay-team').value || null,
    relay_name: getEl('ath-relay-name').value,
  });
  await loadEventsSection();
  showToast('Staffetta salvata.', 'success');
}

async function handleSaveAthleticsRelayMember(event) {
  event.preventDefault();
  await saveAthleticsRelayMember({
    relay_team_id: getEl('ath-relay-select').value,
    player_id: getEl('ath-relay-player').value,
    leg_order: getEl('ath-relay-leg').value,
  });
  await loadEventsSection();
  showToast('Frazionista salvato.', 'success');
}

async function renderEventResults(eventId) {
  const body = getEl('table-event-results-body');
  if (!body) return;

  if (!eventId) {
    body.innerHTML = '';
    return;
  }

  const selectedOption =
    getEl('event-ranking-select')?.selectedOptions?.[0] ??
    getEl('event-select-results')?.selectedOptions?.[0];
  const orderRule = selectedOption?.dataset?.order ?? 'desc';

  const results = await loadEventResults(eventId);
  const ranked = computeAthleticsRanking(results, orderRule);
  const validRows = ranked.filter((row) => Number(row.player?.id ?? 0) > 0);

  if (!validRows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">Nessun risultato valido disponibile.</td></tr>';
    return;
  }

  body.innerHTML = validRows
    .map(
      (row, index) => `
      <tr>
        <td>${medalByRank(index)}</td>
        <td><strong>${escapeHtml(row.player.full_name)}</strong></td>
        <td>${escapeHtml(row.player.teams?.name ?? '-')}</td>
        <td class="text-center">${Number(row.value).toFixed(2)}</td>
        <td class="text-center">${Math.max(1, Number(row.attempt_count ?? (row.attempt_values?.length ?? 1)))}</td>
        <td>${escapeHtml(row.notes ?? '')}</td>
      </tr>
    `
    )
    .join('');
}

async function loadEventsSection() {
  const sportId = getSelectedAthleticsSportId();
  if (!sportId) {
    getEl('table-events-body').innerHTML = '';
    getEl('table-event-results-body').innerHTML = '';
    getEl('table-athletics-ranking-body').innerHTML = '';
    getEl('athletics-attempts-help').textContent = 'Tentativi per evento: 1 · Min eventi atleta: 1 · Max eventi atleta: 99';
    ['event-select-results', 'event-ranking-select', 'ath-heat-event', 'ath-record-event', 'ath-relay-event', 'ath-lane-heat', 'ath-lane-player', 'ath-relay-team', 'ath-relay-select', 'ath-relay-player'].forEach((id) => {
      const el = getEl(id);
      if (el) el.innerHTML = '<option value="">-- Seleziona --</option>';
    });
    ['athletics-heats-list', 'athletics-records-list', 'athletics-relays-list'].forEach((id) => {
      const el = getEl(id);
      if (el) el.innerHTML = '<div class="empty-state compact">Seleziona un torneo atletica.</div>';
    });
    return;
  }

  const [events, leaderboard, config, advancedData, roster] = await Promise.all([
    loadAthleticsEvents(sportId),
    loadAthleticsLeaderboard(sportId),
    loadAthleticsConfigBySport(sportId),
    loadAthleticsAdvancedData(sportId),
    loadAthleticsRoster(sportId),
  ]);

  renderEventsTable(events);
  await populatePlayersForAthleticsSport(sportId);
  renderAthleticsAdvancedPanel(events, advancedData, roster);
  getEl('athletics-attempts-help').textContent = `Tentativi per evento: ${Math.max(1, Number(config.athletics_attempts_per_event ?? 1))} · Min eventi atleta: ${Math.max(0, Number(config.athletics_min_events_per_player ?? 1))} · Max eventi atleta: ${Math.max(1, Number(config.athletics_max_events_per_player ?? 99))}`;

  getEl('table-athletics-ranking-body').innerHTML = leaderboard
    .map(
      (row, index) => `
      <tr>
        <td>${medalByRank(index)}</td>
        <td><strong>${escapeHtml(row.playerName)}</strong></td>
        <td>${escapeHtml(row.teamName)}</td>
        <td class="text-center">${row.events}</td>
        <td class="text-center">O ${row.medals.gold} · A ${row.medals.silver} · B ${row.medals.bronze}</td>
        <td class="text-center"><strong>${row.score}</strong></td>
      </tr>
    `
    )
    .join('');

  const rankingSelect = getEl('event-ranking-select');
  const eventSelect = getEl('event-select-results');
  const selectedValue = rankingSelect?.value || eventSelect?.value || '';
  if (selectedValue) {
    state.selectedEventId = Number(selectedValue);
    if (eventSelect) eventSelect.value = String(state.selectedEventId);
    if (rankingSelect) rankingSelect.value = String(state.selectedEventId);
    await renderEventResults(state.selectedEventId);
  } else {
    state.selectedEventId = null;
    getEl('table-event-results-body').innerHTML = '';
  }
}

async function saveEventResultForm(event) {
  event.preventDefault();

  const eventId = Number(getEl('event-select-results')?.value || 0);
  const playerId = Number(getEl('event-player-select').value || 0);
  const valueRaw = String(getEl('input-event-value').value || '').trim().replace(',', '.');
  const value = Number(valueRaw);
  const notes = getEl('input-event-notes').value;

  if (!eventId || !playerId || !Number.isFinite(value) || value <= 0) {
    showToast('Inserisci evento, studente e valore valido.', 'error');
    return;
  }

  const saveResult = await upsertEventResult({ event_id: eventId, player_id: playerId, value, notes });
  state.selectedEventId = eventId;
  await renderEventResults(eventId);
  await loadEventsSection();
  getEl('input-event-value').value = '';
  getEl('input-event-notes').value = '';
  if (saveResult?.__attemptColumnsUnsupported) {
    showToast('Risultato salvato con fallback (tentativi non disponibili finché non applichi migrazione/cached schema).', 'error');
    return;
  }
  if (Number(saveResult?.__legacyDuplicateRowsCount ?? 0) > 0) {
    showToast(
      `Risultato salvato. Nota: trovate ${saveResult.__legacyDuplicateRowsCount} righe duplicate legacy per questo atleta/evento.`,
      'error'
    );
    return;
  }
  showToast(`Risultato atletica salvato. Tentativo ${saveResult.attempt_count}/${saveResult.attempts_limit}.`, 'success');
}
function bindCoreActions() {
  bindRankingRulesDrag();

  getEl('btn-logout').addEventListener('click', async () => {
    await signOutAdmin();
    window.location.href = '../';
  });

  getEl('btn-new-sport')?.addEventListener('click', () => openSportModal(null));
  document.querySelectorAll('[data-open-team-modal]').forEach((btn) => btn.addEventListener('click', () => openTeamModal(null)));
  document.querySelectorAll('[data-open-match-modal]').forEach((btn) => btn.addEventListener('click', () => {
    openMatchModal(null).catch((error) => showToast(error.message, 'error'));
  }));
  getEl('btn-new-venue')?.addEventListener('click', () => openVenueModal(null));
  getEl('btn-toggle-athletics-result')?.addEventListener('click', () => openEventModal(null));
  getEl('btn-csv-teams-players')?.addEventListener('click', () => openCsvImportModal('teams_players'));
  getEl('btn-csv-athletics-events')?.addEventListener('click', () => openCsvImportModal('athletics_events'));
  getEl('btn-csv-athletics-results')?.addEventListener('click', () => openCsvImportModal('athletics_results'));
  getEl('btn-print-athletics-sheets')?.addEventListener('click', () => {
    printAthleticsRaceSheets().catch((error) => showToast(error.message, 'error'));
  });
  getEl('modal-event')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-athletics-modal-panel]');
    if (!button) return;
    setAthleticsModalPanel(button.dataset.athleticsModalPanel);
  });

  getEl('btn-generate-matches')?.addEventListener('click', () => {
    handleGenerateMatches().catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-toggle-matches-view')?.addEventListener('click', () => {
    state.matchesViewMode = state.matchesViewMode === 'calendar' ? 'table' : 'calendar';
    renderMatchesViews();
  });
  getEl('btn-prepare-offline')?.addEventListener('click', () => {
    prepareMatchesForOffline().catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-download-finished-match-reports')?.addEventListener('click', () => {
    try {
      const printWindow = openMatchReportPrintWindow();
      downloadAllFinishedMatchReports(printWindow).catch((error) => showToast(error.message, 'error'));
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  getEl('btn-refresh-regia-ops')?.addEventListener('click', () => {
    loadRegiaOperations().catch((error) => showToast(error.message, 'error'));
  });
  getEl('regia-venues-panel')?.addEventListener('change', (event) => {
    const select = event.target.closest('[data-action="regia-venue-status"]');
    if (!select) return;
    handleRegiaVenueStatusChange(select).catch((error) => showToast(error.message, 'error'));
  });
  getEl('regia-devices-panel')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const row = actionEl.closest('[data-device-id]');
    if (actionEl.dataset.action === 'save-regia-device') {
      handleSaveRegiaDevice(row).catch((error) => showToast(error.message, 'error'));
    }
    if (actionEl.dataset.action === 'toggle-regia-device-block') {
      handleToggleRegiaDeviceBlock(row).catch((error) => showToast(error.message, 'error'));
    }
    if (actionEl.dataset.action === 'revoke-regia-device') {
      handleRevokeRegiaDevice(row).catch((error) => showToast(error.message, 'error'));
    }
  });
  getEl('regia-action-queue-panel')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('.regia-action-item');
    if (!actionEl) return;
    handleRegiaActionNavigation(actionEl);
  });
  getEl('regia-checklist-panel')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-entity-type][data-entity-id]');
    if (!item) return;
    const type = item.dataset.entityType;
    const id = Number(item.dataset.entityId || 0);
    if (type === 'match' && id) {
      switchView('matches').then(() => {
        const match = getMatchById(id);
        if (match) openMatchDetail(id);
      }).catch((error) => showToast(error.message, 'error'));
    }
    if (type === 'team') {
      switchView('teams').catch((error) => showToast(error.message, 'error'));
    }
  });
  getEl('regia-delays-panel')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action="open-match-detail"]');
    if (!actionEl) return;
    switchView('matches').then(() => openMatchDetail(Number(actionEl.dataset.id))).catch((error) => showToast(error.message, 'error'));
  });
  adminUsersPanel.bind();

  getEl('btn-generate-semifinals')?.addEventListener('click', () => {
    handleGenerateSemifinals().catch((error) => showToast(error.message, 'error'));
  });

  getEl('btn-save-settings')?.addEventListener('click', () => {
    saveSettingsForSport().catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-open-super-settings')?.addEventListener('click', () => {
    openSuperSettingsModal().catch((error) => showToast(error.message, 'error'));
  });
  getEl('set-privacy-player-name')?.addEventListener('change', applyPrivacyPublicLock);
  getEl('btn-save-super-settings')?.addEventListener('click', () => {
    saveSuperSettingsGeneral()
      .then(() => {
        showToast('Impostazioni Superadmin salvate per tutta la piattaforma.', 'success');
        closeModal('modal-super-settings');
      })
      .catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-create-platform-backup')?.addEventListener('click', () => {
    handleCreatePlatformBackup().catch((error) => showToast(error.message, 'error'));
  });
  getEl('table-platform-backups-body')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const backupId = Number(actionEl.dataset.id);
    if (actionEl.dataset.action === 'restore-backup') {
      handleRestorePlatformBackup(backupId).catch((error) => showToast(error.message, 'error'));
    }
    if (actionEl.dataset.action === 'delete-backup') {
      handleDeletePlatformBackup(backupId).catch((error) => showToast(error.message, 'error'));
    }
  });

  getEl('btn-archive-tournament')?.addEventListener('click', () => {
    handleArchiveTournament().catch((error) => showToast(error.message, 'error'));
  });

  getEl('btn-print-venue-qr')?.addEventListener('click', printVenueQr);
  getEl('telegram-template-panel')?.addEventListener('click', (event) => {
    const previewButton = event.target.closest('[data-action="preview-communication-template"]');
    if (previewButton) {
      showTemplatePreviewFromCard(previewButton.closest('.communication-template-card')).catch((error) => showToast(error.message, 'error'));
      return;
    }

    const button = event.target.closest('[data-action="save-communication-template"]');
    if (!button) return;
    const key = String(button.dataset.key ?? '').trim();
    const card = button.closest('.communication-template-card');
    const title = card?.querySelector('[data-template-field="title"]')?.value ?? '';
    const body = card?.querySelector('[data-template-field="body"]')?.value ?? '';
    const isActive = Boolean(card?.querySelector('[data-template-field="is_active"]')?.checked);
    saveCommunicationTemplate({ template_key: key, title, body, is_active: isActive, channel: 'telegram' })
      .then(() => renderTelegramTemplates())
      .then(() => showToast('Template comunicazione salvato.', 'success'))
      .catch((error) => showToast(error.message, 'error'));
  });
  getEl('form-public-notification')?.addEventListener('submit', (event) => {
    handleSavePublicNotification(event).catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-reset-public-notification')?.addEventListener('click', resetPublicNotificationForm);
  getEl('public-notifications-admin-list')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const id = Number(actionEl.dataset.id || 0);
    if (actionEl.dataset.action === 'edit-public-notification') {
      const item = state.publicNotifications.find((row) => Number(row.id) === id);
      fillPublicNotificationForm(item);
    }
    if (actionEl.dataset.action === 'delete-public-notification') {
      handleDeletePublicNotification(id).catch((error) => showToast(error.message, 'error'));
    }
  });

  document.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', () => {
      closeModal(button.dataset.modalClose);
    });
  });

  ['modal-sport', 'modal-team', 'modal-match', 'modal-super-settings', 'modal-venue', 'modal-venue-qr', 'modal-match-detail', 'modal-event', 'modal-csv-import'].forEach((modalId) => {
    getEl(modalId)?.addEventListener('click', (event) => {
      if (event.target.id === modalId) closeModal(modalId);
    });
  });

  getEl('btn-csv-download-template')?.addEventListener('click', () => {
    const mode = getCsvMode();
    if (!mode) return;
    downloadCsvTemplate(mode);
  });

  getEl('input-csv-file')?.addEventListener('change', (event) => {
    const file = event.target?.files?.[0];
    getEl('csv-import-file-name').textContent = file?.name
      ? `File selezionato: ${file.name}`
      : 'Nessun file selezionato.';
    getEl('btn-csv-confirm-import').disabled = true;
    state.csvPreview = null;
  });

  getEl('csv-import-sport-select')?.addEventListener('change', () => {
    state.csvPreview = null;
    getEl('btn-csv-confirm-import').disabled = true;
  });

  getEl('btn-csv-preview')?.addEventListener('click', () => {
    handleCsvPreview().catch((error) => showToast(error.message, 'error'));
  });

  getEl('btn-csv-confirm-import')?.addEventListener('click', () => {
    handleCsvConfirmImport().catch((error) => {
      getEl('btn-csv-confirm-import').disabled = false;
      showToast(error.message, 'error');
    });
  });

  getEl('form-sport')?.addEventListener('submit', (event) => {
    handleSaveSport(event).catch((error) => showToast(error.message, 'error'));
  });

  getEl('form-team')?.addEventListener('submit', (event) => {
    handleSaveTeam(event).catch((error) => showToast(error.message, 'error'));
  });
  getEl('input-players-list')?.addEventListener('input', () => populateCaptainSelect(getEl('select-team-captain')?.value ?? ''));

  getEl('form-match')?.addEventListener('submit', (event) => {
    handleSaveMatch(event).catch((error) => showToast(error.message, 'error'));
  });

  getEl('form-venue')?.addEventListener('submit', (event) => {
    saveVenueFromForm(event).catch((error) => showToast(error.message, 'error'));
  });
  getEl('input-venue-name')?.addEventListener('input', () => {
    const slugInput = getEl('input-venue-slug');
    if (slugInput && !slugInput.value.trim()) {
      slugInput.value = slugifyVenueName(getEl('input-venue-name').value);
    }
  });

  getEl('form-event')?.addEventListener('submit', (event) => {
    saveEventFromForm(event).catch((error) => showToast(error.message, 'error'));
  });

  getEl('form-event-result')?.addEventListener('submit', (event) => {
    saveEventResultForm(event).catch((error) => showToast(error.message, 'error'));
  });
  getEl('form-athletics-heat')?.addEventListener('submit', (event) => {
    handleSaveAthleticsHeat(event).catch((error) => showToast(error.message, 'error'));
  });
  getEl('form-athletics-lane')?.addEventListener('submit', (event) => {
    handleSaveAthleticsLane(event).catch((error) => showToast(error.message, 'error'));
  });
  getEl('form-athletics-record')?.addEventListener('submit', (event) => {
    handleSaveAthleticsRecord(event).catch((error) => showToast(error.message, 'error'));
  });
  getEl('form-athletics-relay')?.addEventListener('submit', (event) => {
    handleSaveAthleticsRelay(event).catch((error) => showToast(error.message, 'error'));
  });
  getEl('form-athletics-relay-member')?.addEventListener('submit', (event) => {
    handleSaveAthleticsRelayMember(event).catch((error) => showToast(error.message, 'error'));
  });
  getEl('view-events')?.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-action="toggle-collapsible-card"]');
    if (!toggle) return;
    const card = toggle.closest('[data-collapsible-card]');
    if (!card) return;
    const willOpen = card.classList.contains('is-collapsed');
    card.classList.toggle('is-collapsed', !willOpen);
    toggle.setAttribute('aria-expanded', String(willOpen));
    toggle.querySelector('.card-toggle-chevron')?.classList.toggle('fa-chevron-up', willOpen);
    toggle.querySelector('.card-toggle-chevron')?.classList.toggle('fa-chevron-down', !willOpen);
  });

  ['filter-match-team', 'filter-match-sport', 'filter-match-venue', 'filter-match-phase', 'filter-match-status'].forEach((id) => {
    getEl(id)?.addEventListener('input', () => {
      loadMatchesTable().catch((error) => showToast(error.message, 'error'));
    });
    getEl(id)?.addEventListener('change', () => {
      loadMatchesTable().catch((error) => showToast(error.message, 'error'));
    });
  });
  bindFilterToggle('btn-toggle-match-filters', ['match-filters']);

  getEl('select-sport-match')?.addEventListener('change', (event) => {
    populateMatchTeams(event.target.value).catch((error) => showToast(error.message, 'error'));
    renderMatchPhaseOptions(event.target.value);
  });

  getEl('report-sport-select')?.addEventListener('change', () => {
    loadReportData().catch((error) => showToast(error.message, 'error'));
  });

  getEl('btn-toggle-report-columns')?.addEventListener('click', () => {
    const panel = getEl('report-columns-panel');
    const button = getEl('btn-toggle-report-columns');
    if (!panel || !button || button.disabled) return;
    panel.classList.toggle('hidden');
    button.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
  });

  getEl('report-columns-panel')?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[type="checkbox"][data-action="toggle-report-column"]');
    if (!checkbox) return;

    const sportId = Number(getEl('report-sport-select')?.value || 0);
    if (!sportId) return;

    const groupKey = String(checkbox.dataset.group ?? '');
    const columnKey = String(checkbox.dataset.column ?? '');
    const prefs = ensureReportColumnPrefs(sportId);
    const groupPrefs = prefs[groupKey] ?? {};

    groupPrefs[columnKey] = checkbox.checked;
    const visibleCount = Object.values(groupPrefs).filter(Boolean).length;
    if (visibleCount === 0) {
      groupPrefs[columnKey] = true;
      checkbox.checked = true;
      showToast('Deve restare visibile almeno una colonna per sezione.', 'error');
      return;
    }

    prefs[groupKey] = groupPrefs;
    state.reportColumnPrefs[sportId] = prefs;
    persistReportColumnPrefs(sportId);
    applyReportColumnVisibility();
  });

  document.addEventListener('click', (event) => {
    const panel = getEl('report-columns-panel');
    const button = getEl('btn-toggle-report-columns');
    if (!panel || !button || panel.classList.contains('hidden')) return;
    if (panel.contains(event.target) || button.contains(event.target)) return;
    panel.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.match-action-menu')) return;
    closeMatchActionMenus();
  });

  ['rep-filter-team', 'rep-filter-pres', 'rep-filter-fouls', 'rep-filter-score'].forEach((id) => {
    getEl(id)?.addEventListener('change', applyReportFilters);
  });
  bindFilterToggle('btn-toggle-report-filters', ['report-team-filters', 'report-athletics-filters']);
  getEl('rep-ath-player-select')?.addEventListener('change', (event) => {
    if (String(event.target?.value ?? 'all') !== 'all') {
      const search = getEl('rep-ath-player-search');
      if (search) search.value = '';
    }
    applyAthleticsReportFilters();
  });
  ['rep-ath-event-select', 'rep-ath-team-select'].forEach((id) => {
    getEl(id)?.addEventListener('change', applyAthleticsReportFilters);
  });
  getEl('rep-ath-player-search')?.addEventListener('input', applyAthleticsReportFilters);

  getEl('btn-print-report')?.addEventListener('click', () => window.print());

  getEl('athletics-sport-select')?.addEventListener('change', () => {
    state.selectedEventId = null;
    loadEventsSection().catch((error) => showToast(error.message, 'error'));
  });

  getEl('event-select-results')?.addEventListener('change', (event) => {
    state.selectedEventId = Number(event.target.value || 0) || null;
    const rankingSelect = getEl('event-ranking-select');
    if (rankingSelect) rankingSelect.value = event.target.value || '';
    renderEventResults(state.selectedEventId).catch((error) => showToast(error.message, 'error'));
  });

  getEl('event-ranking-select')?.addEventListener('change', (event) => {
    state.selectedEventId = Number(event.target.value || 0) || null;
    const resultSelect = getEl('event-select-results');
    if (resultSelect) resultSelect.value = event.target.value || '';
    renderEventResults(state.selectedEventId).catch((error) => showToast(error.message, 'error'));
  });

  getEl('settings-sport-select')?.addEventListener('change', () => {
    loadSettingsForSelectedSport().catch((error) => showToast(error.message, 'error'));
  });

  getEl('table-sports-body')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = Number(actionEl.dataset.id);
    if (action === 'edit-sport') return openSportModal(getSportById(id));
    if (action === 'qr-sport') return showEntityQr('sport', getSportById(id));
    if (action === 'delete-sport') {
      handleDeleteSport(id).catch((error) => showToast(error.message, 'error'));
    }
  });

  getEl('table-honor-roll-body')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const id = Number(actionEl.dataset.id);
    if (actionEl.dataset.action === 'unarchive-entry') {
      handleUnarchiveTournament(id).catch((error) => showToast(error.message, 'error'));
    }
  });

  getEl('table-teams-body')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = Number(actionEl.dataset.id);
    if (action === 'telegram-team') {
      handleSendTelegramTeamReminder(id, actionEl.dataset.name).catch((error) => showToast(error.message, 'error'));
      return;
    }
    if (action === 'qr-team') {
      return showEntityQr('team', {
        id,
        name: actionEl.dataset.name,
        sport_id: Number(actionEl.dataset.sportId),
      });
    }
    if (action === 'edit-team') {
      return openTeamModal({
        id,
        name: actionEl.dataset.name,
        sport_id: Number(actionEl.dataset.sportId),
      }).catch((error) => showToast(error.message, 'error'));
    }
    if (action === 'delete-team') {
      handleDeleteTeam(id).catch((error) => showToast(error.message, 'error'));
    }
  });

  getEl('table-matches-list')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = Number(actionEl.dataset.id);

    if (action === 'toggle-match-menu') {
      const menu = actionEl.closest('.match-action-menu');
      if (!menu) return;
      const shouldOpen = !menu.classList.contains('open');
      closeMatchActionMenus(menu);
      menu.classList.toggle('open', shouldOpen);
      actionEl.setAttribute('aria-expanded', String(shouldOpen));
      return;
    }

    if (action === 'open-match-detail') {
      if (event.target.closest('.match-action-menu')) return;
      openMatchDetail(id);
      return;
    }

    closeMatchActionMenus();
    if (action === 'start-live') return goToLive(id);
    if (action === 'edit-match') {
      const match = state.adminMatches.find((item) => Number(item.id) === id);
      if (match) {
        openMatchModal(match).catch((error) => showToast(error.message, 'error'));
      }
      return;
    }
    if (action === 'qr-match') {
      closeModal('modal-match-detail');
      showEntityQr('match', getMatchById(id));
      return;
    }
    if (action === 'telegram-match') {
      handleSendTelegramMatchReminder(id).catch((error) => showToast(error.message, 'error'));
      return;
    }
    if (action === 'toggle-audit-log') {
      event.preventDefault();
      event.stopPropagation();
      const list = getEl('match-detail-audit-list');
      const button = actionEl;
      if (!list) return;
      const willOpen = button.getAttribute('aria-expanded') !== 'true';
      list.classList.toggle('hidden', !willOpen);
      list.hidden = !willOpen;
      button.setAttribute('aria-expanded', String(willOpen));
      button.querySelector('i')?.classList.toggle('fa-chevron-up', willOpen);
      button.querySelector('i')?.classList.toggle('fa-chevron-down', !willOpen);
      if (willOpen && list.dataset.loaded !== 'true') {
        list.innerHTML = '<div class="empty-state">Caricamento registro...</div>';
        renderMatchAuditLog(id)
          .then(() => {
            list.dataset.loaded = 'true';
          })
          .catch((error) => {
            list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
          });
      }
      return;
    }
    if (action === 'download-match-report') {
      const match = getMatchById(id);
      try {
        const printWindow = openMatchReportPrintWindow();
        downloadMatchReports(match ? [match] : [], printWindow).catch((error) => showToast(error.message, 'error'));
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }
    if (action === 'reopen-match') {
      handleReopenMatchForCorrection(id).catch((error) => showToast(error.message, 'error'));
      return;
    }
    if (action === 'delete-match') {
      handleDeleteMatch(id).catch((error) => showToast(error.message, 'error'));
    }
  });

  getEl('matches-calendar-board')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    if (actionEl.dataset.action === 'open-match-detail') {
      openMatchDetail(Number(actionEl.dataset.id));
    }
  });
  getEl('matches-calendar-board')?.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.calendar-match-card[draggable="true"]');
    if (!card) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(card.dataset.id ?? ''));
    card.classList.add('dragging');
  });
  getEl('matches-calendar-board')?.addEventListener('dragend', () => {
    document.querySelectorAll('.calendar-match-card.dragging').forEach((card) => card.classList.remove('dragging'));
    document.querySelectorAll('.calendar-day-column.drag-over').forEach((column) => column.classList.remove('drag-over'));
  });
  getEl('matches-calendar-board')?.addEventListener('dragover', (event) => {
    const column = event.target.closest('.calendar-day-column[data-calendar-day]');
    if (!column) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.calendar-day-column.drag-over').forEach((item) => {
      if (item !== column) item.classList.remove('drag-over');
    });
    column.classList.add('drag-over');
  });
  getEl('matches-calendar-board')?.addEventListener('dragleave', (event) => {
    const column = event.target.closest('.calendar-day-column[data-calendar-day]');
    if (!column || column.contains(event.relatedTarget)) return;
    column.classList.remove('drag-over');
  });
  getEl('matches-calendar-board')?.addEventListener('drop', (event) => {
    const column = event.target.closest('.calendar-day-column[data-calendar-day]');
    if (!column) return;
    event.preventDefault();
    column.classList.remove('drag-over');
    const matchId = Number(event.dataTransfer.getData('text/plain') || 0);
    if (matchId) {
      handleCalendarDropReschedule(matchId, column.dataset.calendarDay).catch((error) => showToast(error.message, 'error'));
    }
  });

  getEl('match-detail-content')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = Number(actionEl.dataset.id);
    if (action === 'set-match-operational-status') {
      const status = getEl('match-operational-status-select')?.value || 'scheduled';
      const reason = getEl('match-operational-status-reason')?.value || '';
      setMatchOperationalStatus(id, status, reason)
        .then(() => loadMatchesTable())
        .then(() => {
          const updated = getMatchById(id);
          if (updated) openMatchDetail(id);
          showToast('Stato operativo aggiornato.', 'success');
        })
        .catch((error) => showToast(error.message, 'error'));
      return;
    }
    if (action === 'toggle-match-checkin') {
      const match = getMatchById(Number(actionEl.dataset.matchId));
      upsertMatchCheckin({
        matchId: Number(actionEl.dataset.matchId),
        role: actionEl.dataset.role,
        teamId: actionEl.dataset.teamId ? Number(actionEl.dataset.teamId) : null,
        checkedIn: Boolean(actionEl.checked),
      })
        .then(() => (match ? renderMatchDetailOperations(match) : null))
        .then(() => showToast('Check-in aggiornato.', 'success'))
        .catch((error) => {
          actionEl.checked = !actionEl.checked;
          showToast(error.message, 'error');
        });
      return;
    }
    if (action === 'start-live') return goToLive(id);
    if (action === 'edit-match') {
      closeModal('modal-match-detail');
      const match = getMatchById(id);
      if (match) openMatchModal(match).catch((error) => showToast(error.message, 'error'));
      return;
    }
    if (action === 'qr-match') {
      closeModal('modal-match-detail');
      showEntityQr('match', getMatchById(id));
      return;
    }
    if (action === 'telegram-match') {
      handleSendTelegramMatchReminder(id).catch((error) => showToast(error.message, 'error'));
      return;
    }
    if (action === 'download-match-report') {
      const match = getMatchById(id);
      try {
        const printWindow = openMatchReportPrintWindow();
        downloadMatchReports(match ? [match] : [], printWindow).catch((error) => showToast(error.message, 'error'));
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }
    if (action === 'toggle-audit-log') {
      event.preventDefault();
      const list = getEl('match-detail-audit-list');
      if (!list) return;
      const willOpen = actionEl.getAttribute('aria-expanded') !== 'true';
      list.classList.toggle('hidden', !willOpen);
      list.hidden = !willOpen;
      actionEl.setAttribute('aria-expanded', String(willOpen));
      actionEl.querySelector('i')?.classList.toggle('fa-chevron-up', willOpen);
      actionEl.querySelector('i')?.classList.toggle('fa-chevron-down', !willOpen);
      if (willOpen && list.dataset.loaded !== 'true') {
        list.innerHTML = '<div class="empty-state">Caricamento registro...</div>';
        renderMatchAuditLog(id)
          .then(() => {
            list.dataset.loaded = 'true';
          })
          .catch((error) => {
            list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
          });
      }
      return;
    }
    if (action === 'reopen-match') {
      handleReopenMatchForCorrection(id).catch((error) => showToast(error.message, 'error'));
      return;
    }
    if (action === 'approve-official-match') {
      showAppPrompt('Motivo/verifica approvazione ufficiale:', {
        title: 'Risultato ufficiale',
        inputLabel: 'Nota verifica',
        placeholder: 'Es. Referto controllato dal Super Admin',
        confirmLabel: 'Rendi ufficiale',
      })
        .then((reason) => {
          if (reason === null) return null;
  return approveMatchOfficial(id, reason || 'Referto verificato dal Super Admin');
        })
        .then((result) => {
          if (!result) return;
          return loadMatchesTable().then(() => openMatchDetail(id));
        })
        .then(() => showToast('Risultato reso ufficiale.', 'success'))
        .catch((error) => showToast(error.message, 'error'));
    }
  });

  getEl('table-venues-body')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = Number(actionEl.dataset.id);
    const venue = state.venues.find((item) => Number(item.id) === id);
    if (action === 'qr-venue') return showVenueQr(venue);
    if (action === 'edit-venue') return openVenueModal(venue);
    if (action === 'delete-venue') {
      handleDeleteVenue(id).catch((error) => showToast(error.message, 'error'));
    }
  });

  getEl('table-events-body')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = Number(actionEl.dataset.id);

    if (action === 'edit-event') {
      loadAthleticsEvents(getEl('athletics-sport-select').value)
        .then((events) => {
          const item = events.find((eventItem) => Number(eventItem.id) === id);
          if (item) openEventModal(item);
        })
        .catch((error) => showToast(error.message, 'error'));
      return;
    }

    if (action === 'delete-event') {
      handleDeleteEvent(id).catch((error) => showToast(error.message, 'error'));
    }
  });

}

async function init() {
  setAdminAuthStatus('Controllo sessione Supabase...');
  getEl('btn-admin-auth-retry')?.addEventListener('click', () => window.location.reload());

  const session = await withTimeout(
    requireAdmin({ redirectTo: '../' }),
    10000,
    'Verifica accesso scaduta: controlla connessione Supabase e ricarica senza cache.'
  );
  if (!session.allowed) return;

  state.admin = session.admin;
  if (!state.admin?.ruolo) {
    redirectHomeWithAdminError('Accesso negato: UUID Auth senza ruolo admin valido.');
    return;
  }
  setAdminAuthStatus(`Accesso autorizzato: ${formatRoleLabel(state.admin.ruolo)}.`);
  document.body.classList.remove('auth-pending');
  getEl('admin-name').textContent = formatAdminDisplayName(state.admin);
  getEl('admin-role').textContent = formatRoleLabel(state.admin?.ruolo);
  await promptDeviceLabel();
  updateSidebarDeviceLabel();
  registerCurrentDevice().catch(() => null);

  bindSidebar();
  bindMobileSidebar();
  bindCoreActions();
  applyRolePermissions();

  if (session.offline) {
    await renderOfflineAdminDashboard();
    showToast('Modalita offline: disponibili solo i match gia preparati su questo dispositivo.', 'error');
    startAdminTour();
    return;
  }

  await Promise.all([refreshSportsState(), refreshVenuesState(), refreshDevicesState()]);
  await loadDashboardStats();

  if (state.sports.length) {
    const firstSport = state.sports[0];
    const firstTeamSport = getTeamSports()[0];
    ['report-sport-select', 'settings-sport-select'].forEach((id) => {
      const el = getEl(id);
      if (el && !el.value && firstSport?.id) el.value = String(firstSport.id);
    });
    if (getEl('archive-sport-select') && firstSport?.id) {
      getEl('archive-sport-select').value = String(firstSport.id);
    }
    ['select-sport-match', 'playoff-sport-select'].forEach((id) => {
      const el = getEl(id);
      if (el && !el.value && firstTeamSport?.id) el.value = String(firstTeamSport.id);
    });

    const firstAthletics = state.sports.find((sport) => sport.sport_type === 'atletica');
    if (firstAthletics) {
      getEl('athletics-sport-select').value = String(firstAthletics.id);
    }

    await populateMatchTeams(getEl('select-sport-match').value);
    await loadSettingsForSelectedSport();
  }

  if (canManageAll(state.admin?.ruolo)) await switchView('dashboard');
  else if (canEditMatches(state.admin?.ruolo)) await switchView('matches');
  else await switchView('reports');

  startAdminTour();
}

init().catch((error) => {
  const role = getEl('admin-role');
  if (role) role.textContent = 'Errore connessione DB';
  const name = getEl('admin-name');
  if (name) name.textContent = 'Accesso non verificato';
  setAdminAuthStatus(error.message, true);
  window.setTimeout(() => redirectHomeWithAdminError(error.message), 1800);
});
