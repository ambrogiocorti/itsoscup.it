import { requireAdmin, signOutAdmin, canEditMatches, canManageAll } from './auth.js';
import {
  createManualMatch,
  deleteMatch,
  deleteSport,
  deleteTeam,
  generateMatchesForSport,
  generateSemifinals,
  listMatchesForAdmin,
  loadPlayersByTeam,
  loadSportConfig,
  loadSports,
  loadTeamsBySport,
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
  loadAthleticsEvents,
  loadAthleticsLeaderboard,
  loadEventResults,
  saveAthleticsEvent,
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
import { db, run } from './db.js';
import { APP_CONFIG } from './app-config.js';
import { escapeHtml, formatDuration, getEl, medalByRank, showToast } from './utils.js';

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
};
const MOBILE_MENU_BREAKPOINT = 1024;

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
  if (match?.is_finished) {
    return { key: 'finished', label: 'Concluso', badge: 'badge-success' };
  }

  if (match?.status === 'live') {
    return { key: 'in_progress', label: 'In corso', badge: 'badge-danger' };
  }

  const start = match?.scheduled_start ? new Date(match.scheduled_start) : null;
  const end = match?.scheduled_end ? new Date(match.scheduled_end) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return { key: 'unscheduled', label: 'Da programmare', badge: 'badge-warning' };
  }

  const now = new Date();
  if (start <= now && end && !Number.isNaN(end.getTime()) && end >= now) {
    return { key: 'in_progress', label: 'In corso', badge: 'badge-danger' };
  }

  return { key: 'scheduled', label: 'Programmato', badge: 'badge-info' };
}

function getMatchTeamsLabel(match) {
  return `${match?.home?.name ?? 'TBD'} vs ${match?.away?.name ?? 'TBD'}`;
}

function getMatchById(matchId) {
  return state.adminMatches.find((item) => Number(item.id) === Number(matchId)) ?? null;
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
  }
  if (match?.venue?.slug) {
    actions.push(`<button class="match-action-item" data-action="qr-match" data-venue-id="${match.venue.id}" type="button"><i class="fa-solid fa-qrcode"></i><span>QR campo</span></button>`);
  }
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

  const [playersResult, statsResult, signaturesResult] = await Promise.all([
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

  return { playersByTeam, statsByMatchPlayer, signaturesByMatchSide };
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
        </div>
        <div class="match-report-score">${escapeHtml(score)}</div>
      </header>

      <section class="match-report-meta">
        <div><span>Torneo</span><strong>${escapeHtml(match.sport?.name ?? '-')}</strong></div>
        <div><span>Fase</span><strong>${escapeHtml(match.round_name ?? '-')}</strong></div>
        <div><span>Campo</span><strong>${escapeHtml(match.venue?.name ?? 'Campo da definire')}</strong></div>
        <div><span>Slot</span><strong>${escapeHtml(formatScheduleRange(match))}</strong></div>
        <div><span>Chiuso il</span><strong>${escapeHtml(formatReportDateTime(match.finished_at))}</strong></div>
        <div><span>Durata live</span><strong>${escapeHtml(formatDuration(livePayload.duration ?? match.duration ?? 0))}</strong></div>
      </section>

      ${match.schedule_notes ? `<section class="match-report-notes"><strong>Note:</strong> ${escapeHtml(match.schedule_notes)}</section>` : ''}
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
          @page { size: A4; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #0f172a; font-family: Arial, sans-serif; background: #fff; }
          .match-report-page { page-break-after: always; padding: 0; }
          .match-report-page:last-child { page-break-after: auto; }
          .match-report-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 16px; }
          .match-report-header p { margin: 0 0 6px; color: #475569; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
          .match-report-header h1 { margin: 0; font-size: 24px; line-height: 1.15; }
          .match-report-score { min-width: 112px; padding: 10px 14px; border: 2px solid #0f172a; text-align: center; font-size: 26px; font-weight: 800; }
          .match-report-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
          .match-report-meta div, .match-report-notes, .match-report-signature-grid div { border: 1px solid #cbd5e1; padding: 8px; border-radius: 6px; }
          .match-report-meta span, .match-report-signature-grid span { display: block; color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
          .match-report-meta strong { font-size: 12px; }
          .match-report-notes { margin-bottom: 16px; font-size: 12px; }
          h3 { margin: 16px 0 8px; font-size: 15px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; }
          th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; }
          th:not(:first-child), td:not(:first-child) { text-align: center; }
          .match-report-signature-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .match-report-signature-grid strong, .match-report-signature-grid small { display: block; }
          .match-report-signature-grid small { color: #64748b; margin-top: 6px; }
          .match-report-signature-grid em { display: block; margin-top: 12px; color: #64748b; font-size: 11px; }
          .match-report-signature-img { display: block; width: 100%; max-height: 96px; object-fit: contain; margin-top: 10px; border-top: 1px solid #cbd5e1; padding-top: 8px; }
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
    getEl('event-sport-select')?.value ||
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

function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach((section) => section.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach((link) => link.classList.remove('active'));
  getEl(`view-${viewId}`)?.classList.add('active');
  document.querySelector(`.sidebar-link[data-view="${viewId}"]`)?.classList.add('active');

  if (viewId === 'dashboard') loadDashboardStats();
  if (viewId === 'sports') loadSportsTable();
  if (viewId === 'teams') loadTeamsTable();
  if (viewId === 'matches') loadMatchesTable();
  if (viewId === 'venues') loadVenuesTable();
  if (viewId === 'archive') loadArchiveTable();
  if (viewId === 'telegram') renderTelegramView();
  if (viewId === 'reports') loadReportData();
  if (viewId === 'events') loadEventsSection();
  if (viewId === 'settings') loadSettingsForSelectedSport();
}

function getSportById(sportId) {
  return state.sports.find((item) => Number(item.id) === Number(sportId));
}

function formatRoleLabel(role) {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'match_manager') return 'Match Manager';
  if (role === 'report_viewer') return 'Report Viewer';
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

  document.querySelectorAll('[data-requires-match-write]').forEach((el) => {
    el.classList.toggle('hidden', !matchWrite);
  });

  document.querySelectorAll('[data-requires-admin-write]').forEach((el) => {
    el.classList.toggle('hidden', !fullWrite);
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
      if (view) switchView(view);
      if (isMobileLayout()) setSidebarOpen(false);
    });
  });
}

function getTeamSports() {
  return state.sports.filter((sport) =>
    TEAM_SPORTS.includes(String(sport?.sport_type ?? '').trim().toLowerCase())
  );
}

function renderSportsOptions() {
  const targets = [
    ['report-sport-select', false, false, false],
    ['select-sport-team', false, false, false],
    ['select-sport-match', false, false, true],
    ['playoff-sport-select', false, false, true],
    ['archive-sport-select', false, false, false],
    ['settings-sport-select', false, false, false],
    ['event-sport-select', false, false, false],
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
        <td>${escapeHtml(sport.format)}</td>
        <td>${sport.year ?? '-'}</td>
        <td>${sport.is_active ? '<span class="badge badge-success">Attivo</span>' : '<span class="badge badge-warning">Disattivo</span>'}</td>
        <td>
          <div class="table-actions" ${canManageAll(state.admin?.ruolo) ? '' : 'style="display:none"'}>
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
            <section class="calendar-day-column">
              <div class="calendar-day-title">${escapeHtml(formatCalendarDayLabel(key))}</div>
              <div class="calendar-day-list">
                ${dayMatches
                  .map((match) => {
                    const status = getMatchCalendarStatus(match);
                    const start = formatCalendarTime(match.scheduled_start);
                    const end = formatCalendarTime(match.scheduled_end);
                    const timeLabel = match.scheduled_start ? `${start}${match.scheduled_end ? ` - ${end}` : ''}` : 'Da programmare';
                    return `
                      <button class="calendar-match-card status-${status.key}" data-action="open-match-detail" data-id="${match.id}" type="button">
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
      ? '<i class="fa-solid fa-table-list"></i> Vista tabella'
      : '<i class="fa-solid fa-calendar-days"></i> Vista calendario';
  }
}

async function handleSendTelegramMatchReminder(matchId) {
  const match = state.adminMatches.find((item) => Number(item.id) === Number(matchId));
  if (!match) {
    showToast('Match non trovato.', 'error');
    return;
  }

  const teams = `${match.home?.name ?? 'TBD'} vs ${match.away?.name ?? 'TBD'}`;
  if (!confirm(`Inviare un promemoria Telegram per ${teams}?`)) return;

  const result = await sendTelegramMatchReminder(matchId);
  showToast(`Promemoria Telegram inviato${result?.messageId ? ` (#${result.messageId})` : ''}.`, 'success');
}

async function handleSendTelegramTeamReminder(teamId, teamName = '') {
  const label = String(teamName || 'questa squadra').trim();
  if (!confirm(`Inviare un messaggio Telegram per ${label}?`)) return;

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
    match.venue?.slug
      ? `<button class="btn btn-ghost" data-action="qr-match" data-venue-id="${match.venue.id}" type="button"><i class="fa-solid fa-qrcode"></i> QR</button>`
      : '',
    canEditMatches(state.admin?.ruolo)
      ? `<button class="btn btn-ghost" data-action="telegram-match" data-id="${match.id}" type="button"><i class="fa-brands fa-telegram"></i> Telegram</button>`
      : '',
    match.is_finished
      ? `<button class="btn btn-primary" data-action="download-match-report" data-id="${match.id}" type="button"><i class="fa-solid fa-file-pdf"></i> Referto PDF</button>`
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
        <div><dt>Note</dt><dd>${escapeHtml(match.schedule_notes || '-')}</dd></div>
      </dl>
      <div class="match-detail-actions">${actions.join('')}</div>
    </div>
  `;
  openModal('modal-match-detail');
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
  if (!confirm('Confermi eliminazione campo?')) return;
  await deleteVenue(venueId);
  await refreshVenuesState();
  await loadVenuesTable();
  await loadMatchesTable();
  showToast('Campo eliminato.', 'success');
}

function showVenueQr(venue) {
  if (!venue) return;
  const url = getVenueQrUrl(venue, window.location.href);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}`;
  getEl('qr-modal-title').textContent = `QR · ${venue.name}`;
  getEl('qr-modal-content').innerHTML = `
    <div class="qr-preview">
      <img src="${escapeHtml(qrUrl)}" alt="QR ${escapeHtml(venue.name)}" />
      <div>
        <h3>${escapeHtml(venue.name)}</h3>
        <p class="muted">${escapeHtml(url)}</p>
      </div>
    </div>
  `;
  openModal('modal-venue-qr');
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
  const notes = prompt('Note archivio (opzionale):');
  if (notes === null) return;
  await archiveTournament(sportId, { notes });
  await loadArchiveTable();
  showToast('Torneo archiviato nell Albo d Oro.', 'success');
}

async function handleUnarchiveTournament(entryId) {
  if (!confirm('Vuoi rimuovere questa voce dall Albo d Oro?')) return;
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

function printVenueQr() {
  printWithBodyClass('print-venue-qr');
}

function renderTelegramView() {
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
  if (!confirm('Confermi eliminazione torneo?')) return;
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
  await saveTeam({
    id: getEl('edit-team-id').value || null,
    name: getEl('input-team-name').value,
    sport_id: getEl('select-sport-team').value,
    players,
    captainName: getEl('select-team-captain')?.value ?? '',
  });
  closeModal('modal-team');
  await loadTeamsTable();
  showToast('Squadra salvata.', 'success');
}

async function handleDeleteTeam(teamId) {
  if (!confirm('Confermi eliminazione squadra?')) return;
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

async function openMatchModal(match = null) {
  resetFormValues(getEl('form-match'));
  getEl('title-modal-match').textContent = match ? 'Modifica Match' : 'Nuovo Match';
  getEl('btn-submit-match').textContent = match ? 'Salva Match' : 'Crea Match';
  getEl('edit-match-id').value = match?.id ?? '';

  if (match?.sport_id) {
    getEl('select-sport-match').value = String(match.sport_id);
    await populateMatchTeams(match.sport_id);
  } else {
    const defaultSportId = getEl('select-sport-match')?.value || getTeamSports()[0]?.id || '';
    if (defaultSportId) {
      getEl('select-sport-match').value = String(defaultSportId);
      await populateMatchTeams(defaultSportId);
    }
  }

  getEl('select-match-phase').value = match?.round_name ?? 'Girone (Andata)';
  getEl('select-home-team').value = match?.home_team_id ? String(match.home_team_id) : '';
  getEl('select-away-team').value = match?.away_team_id ? String(match.away_team_id) : '';
  getEl('select-match-venue').value = match?.venue_id ? String(match.venue_id) : '';

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
    scheduledStart: hasSchedule ? combineLocalDateTime(date, startTime) : null,
    scheduledEnd: hasSchedule ? combineLocalDateTime(date, endTime) : null,
    scheduleNotes: getEl('input-match-notes')?.value ?? '',
  };
}

async function handleSaveMatch(event) {
  event.preventDefault();
  const payload = buildMatchFormPayload();
  let savedMatch;
  if (payload.matchId) {
    savedMatch = await updateManualMatch(payload);
  } else {
    savedMatch = await createManualMatch(payload);
  }
  closeModal('modal-match');
  await loadMatchesTable();
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
  showToast(`Partite generate: ${inserted.inserted}.`, 'success');
  await loadMatchesTable();
}

async function handleGenerateSemifinals() {
  const sportId = Number(getEl('playoff-sport-select').value || 0);
  if (!sportId) return showToast('Seleziona un torneo.', 'error');
  const count = await generateSemifinals(sportId);
  showToast(`Semifinali create: ${count}.`, 'success');
  await loadMatchesTable();
}

async function handleDeleteMatch(matchId) {
  if (!confirm('Confermi eliminazione match?')) return;
  await deleteMatch(matchId);
  await loadMatchesTable();
  showToast('Match eliminato.', 'success');
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
  return {
    comuni_team: !isAthletics,
    classifica_gironi: !isAthletics && format === 'gironi',
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
async function openEventModal(eventItem = null) {
  resetFormValues(getEl('form-event'));
  if (eventItem) {
    getEl('title-modal-event').textContent = 'Modifica Evento';
    getEl('edit-event-id').value = eventItem.id;
    getEl('event-sport-select').value = String(eventItem.sport_id);
    getEl('input-event-name').value = eventItem.name;
    getEl('input-event-unit').value = eventItem.unit;
    getEl('input-event-order').value = eventItem.sort_order;
  } else {
    getEl('title-modal-event').textContent = 'Nuovo Evento';
  }
  openModal('modal-event');
}

async function saveEventFromForm(event) {
  event.preventDefault();
  const payload = {
    id: getEl('edit-event-id').value || null,
    sport_id: Number(getEl('event-sport-select').value || 0),
    name: getEl('input-event-name').value,
    unit: getEl('input-event-unit').value,
    sort_order: getEl('input-event-order').value,
  };

  if (!payload.sport_id || !payload.name) {
    showToast('Compila i campi evento.', 'error');
    return;
  }

  await saveAthleticsEvent(payload);
  closeModal('modal-event');
  await loadEventsSection();
  showToast('Evento atletica salvato.', 'success');
}

async function handleDeleteEvent(eventId) {
  if (!confirm('Confermi disattivazione evento?')) return;
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

  const eventSelect = getEl('event-select-results');
  eventSelect.innerHTML =
    '<option value="">-- Seleziona evento --</option>' +
    (events ?? [])
      .map(
        (event) =>
          `<option value="${event.id}" data-order="${event.sort_order}">${escapeHtml(event.name)}</option>`
      )
      .join('');

  if (state.selectedEventId) {
    eventSelect.value = String(state.selectedEventId);
  }
}

async function renderEventResults(eventId) {
  const body = getEl('table-event-results-body');
  if (!body) return;

  if (!eventId) {
    body.innerHTML = '';
    return;
  }

  const selectedOption = getEl('event-select-results').selectedOptions[0];
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
  const sportId = Number(getEl('athletics-sport-select')?.value || 0);
  if (!sportId) {
    getEl('table-events-body').innerHTML = '';
    getEl('table-event-results-body').innerHTML = '';
    getEl('table-athletics-ranking-body').innerHTML = '';
    getEl('athletics-attempts-help').textContent = 'Tentativi per evento: 1 · Min eventi atleta: 1 · Max eventi atleta: 99';
    return;
  }

  const [events, leaderboard, config] = await Promise.all([
    loadAthleticsEvents(sportId),
    loadAthleticsLeaderboard(sportId),
    loadAthleticsConfigBySport(sportId),
  ]);

  renderEventsTable(events);
  await populatePlayersForAthleticsSport(sportId);
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

  const eventSelect = getEl('event-select-results');
  if (eventSelect.value) {
    state.selectedEventId = Number(eventSelect.value);
    await renderEventResults(state.selectedEventId);
  } else {
    state.selectedEventId = null;
    getEl('table-event-results-body').innerHTML = '';
  }
}

async function saveEventResultForm(event) {
  event.preventDefault();

  const eventId = Number(getEl('event-select-results').value || 0);
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
  getEl('btn-logout').addEventListener('click', async () => {
    await signOutAdmin();
    window.location.href = 'index.html';
  });

  getEl('btn-new-sport')?.addEventListener('click', () => openSportModal(null));
  document.querySelectorAll('[data-open-team-modal]').forEach((btn) => btn.addEventListener('click', () => openTeamModal(null)));
  document.querySelectorAll('[data-open-match-modal]').forEach((btn) => btn.addEventListener('click', () => {
    openMatchModal(null).catch((error) => showToast(error.message, 'error'));
  }));
  getEl('btn-new-venue')?.addEventListener('click', () => openVenueModal(null));
  getEl('btn-new-event')?.addEventListener('click', () => openEventModal(null));
  getEl('btn-csv-teams-players')?.addEventListener('click', () => openCsvImportModal('teams_players'));
  getEl('btn-csv-athletics-events')?.addEventListener('click', () => openCsvImportModal('athletics_events'));
  getEl('btn-csv-athletics-results')?.addEventListener('click', () => openCsvImportModal('athletics_results'));

  getEl('btn-generate-matches')?.addEventListener('click', () => {
    handleGenerateMatches().catch((error) => showToast(error.message, 'error'));
  });
  getEl('btn-toggle-matches-view')?.addEventListener('click', () => {
    state.matchesViewMode = state.matchesViewMode === 'calendar' ? 'table' : 'calendar';
    renderMatchesViews();
  });
  getEl('btn-download-finished-match-reports')?.addEventListener('click', () => {
    try {
      const printWindow = openMatchReportPrintWindow();
      downloadAllFinishedMatchReports(printWindow).catch((error) => showToast(error.message, 'error'));
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  getEl('btn-generate-semifinals')?.addEventListener('click', () => {
    handleGenerateSemifinals().catch((error) => showToast(error.message, 'error'));
  });

  getEl('btn-save-settings')?.addEventListener('click', () => {
    saveSettingsForSport().catch((error) => showToast(error.message, 'error'));
  });

  getEl('btn-archive-tournament')?.addEventListener('click', () => {
    handleArchiveTournament().catch((error) => showToast(error.message, 'error'));
  });

  getEl('btn-print-venue-qr')?.addEventListener('click', printVenueQr);

  document.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', () => {
      closeModal(button.dataset.modalClose);
    });
  });

  ['modal-sport', 'modal-team', 'modal-match', 'modal-venue', 'modal-venue-qr', 'modal-match-detail', 'modal-event', 'modal-csv-import'].forEach((modalId) => {
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
  bindFilterToggle('btn-toggle-athletics-filters', ['athletics-filters']);

  getEl('event-select-results')?.addEventListener('change', (event) => {
    state.selectedEventId = Number(event.target.value || 0) || null;
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
      const venue = state.venues.find((item) => Number(item.id) === Number(actionEl.dataset.venueId));
      showVenueQr(venue);
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

  getEl('match-detail-content')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = Number(actionEl.dataset.id);
    if (action === 'start-live') return goToLive(id);
    if (action === 'edit-match') {
      closeModal('modal-match-detail');
      const match = getMatchById(id);
      if (match) openMatchModal(match).catch((error) => showToast(error.message, 'error'));
      return;
    }
    if (action === 'qr-match') {
      const venue = state.venues.find((item) => Number(item.id) === Number(actionEl.dataset.venueId));
      showVenueQr(venue);
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
  const session = await requireAdmin({ redirectTo: 'index.html' });
  if (!session.allowed) return;

  state.admin = session.admin;
  getEl('admin-name').textContent = formatAdminDisplayName(state.admin);
  getEl('admin-role').textContent = formatRoleLabel(state.admin?.ruolo);

  bindSidebar();
  bindMobileSidebar();
  bindCoreActions();
  applyRolePermissions();

  await Promise.all([refreshSportsState(), refreshVenuesState()]);
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
      getEl('event-sport-select').value = String(firstAthletics.id);
    }

    await populateMatchTeams(getEl('select-sport-match').value);
    await loadSettingsForSelectedSport();
  }

  if (canManageAll(state.admin?.ruolo)) switchView('dashboard');
  else if (canEditMatches(state.admin?.ruolo)) switchView('matches');
  else switchView('reports');
}

init().catch((error) => {
  showToast(error.message, 'error');
});
