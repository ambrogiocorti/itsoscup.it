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
import { db, run } from './db.js';
import { escapeHtml, getEl, medalByRank, showToast } from './utils.js';

const state = {
  admin: null,
  sports: [],
  cachedPlayersRanking: [],
  selectedEventId: null,
  csvPreview: null,
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

function renderSportsOptions() {
  const targets = [
    ['report-sport-select', false, false],
    ['select-sport-team', false, false],
    ['select-sport-match', false, false],
    ['playoff-sport-select', false, false],
    ['settings-sport-select', false, false],
    ['event-sport-select', false, false],
    ['athletics-sport-select', false, true],
    ['filter-match-sport', true, false],
  ];

  targets.forEach(([id, includeAll, athleticsOnly]) => {
    const el = getEl(id);
    if (!el) return;

    const source = athleticsOnly
      ? state.sports.filter((sport) => sport.sport_type === 'atletica')
      : state.sports;

    const options = source
      .map((sport) => `<option value="${sport.id}">${escapeHtml(sport.name)}</option>`)
      .join('');

    el.innerHTML = `${includeAll ? '<option value="all">Tutti</option>' : '<option value="">-- Seleziona --</option>'}${options}`;
  });
}

async function refreshSportsState() {
  state.sports = await loadSports({ includeInactive: true });
  renderSportsOptions();
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
    db.from('teams').select('*, sports(name)').order('name', { ascending: true }),
    'Caricamento tabella squadre'
  );

  const body = getEl('table-teams-body');
  if (!body) return;

  body.innerHTML = (teams ?? [])
    .map(
      (team) => `
      <tr>
        <td><strong>${escapeHtml(team.name)}</strong></td>
        <td>${escapeHtml(team.sports?.name ?? '-')}</td>
        <td>
          <div class="table-actions" ${canManageAll(state.admin?.ruolo) ? '' : 'style="display:none"'}>
            <button class="icon-btn edit" data-action="edit-team" data-id="${team.id}" data-name="${escapeHtml(team.name)}" data-sport-id="${team.sport_id}"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn delete" data-action="delete-team" data-id="${team.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `
    )
    .join('');
}

function renderMatchesTableRows(rows) {
  const body = getEl('table-matches-list');
  if (!body) return;

  body.innerHTML = rows
    .map((match) => {
      const isFinished = Boolean(match.is_finished);
      const actions = [];

      if (!isFinished && canEditMatches(state.admin?.ruolo)) {
        actions.push(`<button class="icon-btn live" data-action="start-live" data-id="${match.id}" title="Apri live"><i class="fa-solid fa-play"></i></button>`);
      }
      if (canEditMatches(state.admin?.ruolo)) {
        actions.push(`<button class="icon-btn delete" data-action="delete-match" data-id="${match.id}" title="Elimina"><i class="fa-solid fa-trash"></i></button>`);
      }

      return `
      <tr>
        <td>${escapeHtml(match.sport?.name ?? '-')}</td>
        <td>
          <strong>${escapeHtml(match.home?.name ?? 'TBD')} vs ${escapeHtml(match.away?.name ?? 'TBD')}</strong>
          <div class="muted" style="font-size:0.8rem;">${escapeHtml(match.round_name ?? '-')}</div>
        </td>
        <td><span class="score-chip">${isFinished ? `${match.home_score ?? 0} - ${match.away_score ?? 0}` : '- -'}</span></td>
        <td>${isFinished ? '<span class="badge badge-success">Finale</span>' : '<span class="badge badge-info">Da giocare</span>'}</td>
        <td><div class="table-actions">${actions.join('')}</div></td>
      </tr>`;
    })
    .join('');
}

async function loadMatchesTable() {
  const filters = {
    teamSearch: getEl('filter-match-team')?.value ?? '',
    sportId: getEl('filter-match-sport')?.value ?? 'all',
    phase: getEl('filter-match-phase')?.value ?? 'all',
    status: getEl('filter-match-status')?.value ?? 'all',
  };

  const rows = await listMatchesForAdmin(filters);
  renderMatchesTableRows(rows);
}

function renderPlayerRankingTable(rows) {
  const body = document.querySelector('#report-table-students tbody');
  if (!body) return;

  body.innerHTML = rows
    .map(
      (player, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(player.name)}</strong></td>
        <td>${escapeHtml(player.team)}</td>
        <td class="text-center">${player.presencePct}%</td>
        <td class="text-center">${player.fouls}</td>
        <td class="text-center">${player.mvpVotes}</td>
        <td class="text-center"><span class="score-chip">${player.score}</span></td>
      </tr>
    `
    )
    .join('');
}

function renderTeamReportTable(rows) {
  const body = document.querySelector('#report-table-teams tbody');
  if (!body) return;

  body.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${medalByRank(row.rank - 1)}</td>
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td class="text-center">${row.points}</td>
        <td class="text-center">${row.played}</td>
        <td class="text-center">${row.wins}</td>
        <td class="text-center">${row.draws}</td>
        <td class="text-center">${row.losses}</td>
        <td class="text-center">${row.goalDiff}</td>
      </tr>
    `
    )
    .join('');
}

function applyReportFilters() {
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

async function loadReportData() {
  const sportId = Number(getEl('report-sport-select')?.value || 0);
  if (!sportId) {
    document.querySelector('#report-table-students tbody').innerHTML = '';
    document.querySelector('#report-table-teams tbody').innerHTML = '';
    getEl('mvp-winner-box').innerHTML = '<div class="empty-state">Seleziona un torneo per visualizzare il report.</div>';
    return;
  }

  const dataset = await loadReportDataset(sportId);
  const ranking = computePlayerRanking(dataset);
  state.cachedPlayersRanking = ranking;

  const mvpEnabled = Boolean(dataset.config?.allow_mvp ?? true);
  const winner = mvpEnabled ? pickMvpWinner(ranking) : null;
  const mvpBox = getEl('mvp-winner-box');
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
  const uniqueTeams = [...new Set(ranking.map((row) => row.team))].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  teamFilter.innerHTML = '<option value="all">Tutte</option>' + uniqueTeams.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');

  applyReportFilters();
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

async function openTeamModal(team = null) {
  resetFormValues(getEl('form-team'));
  if (team) {
    getEl('title-modal-team').textContent = 'Modifica Squadra';
    getEl('edit-team-id').value = team.id;
    getEl('input-team-name').value = team.name;
    getEl('select-sport-team').value = String(team.sport_id);
    const players = await loadPlayersByTeam(team.id);
    getEl('input-players-list').value = players.map((item) => item.full_name).join(', ');
  } else {
    getEl('title-modal-team').textContent = 'Nuova Squadra';
  }
  openModal('modal-team');
}

async function handleSaveTeam(event) {
  event.preventDefault();
  const players = getEl('input-players-list').value.split(/,|\n/g).map((item) => item.trim()).filter(Boolean);
  await saveTeam({
    id: getEl('edit-team-id').value || null,
    name: getEl('input-team-name').value,
    sport_id: getEl('select-sport-team').value,
    players,
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

async function handleSaveMatch(event) {
  event.preventDefault();
  await createManualMatch({
    sportId: Number(getEl('select-sport-match').value || 0),
    homeTeamId: Number(getEl('select-home-team').value || 0),
    awayTeamId: Number(getEl('select-away-team').value || 0),
    roundName: getEl('select-match-phase').value,
  });
  closeModal('modal-match');
  await loadMatchesTable();
  showToast('Partita creata.', 'success');
}

async function handleGenerateMatches() {
  const sportId = Number(getEl('select-sport-match').value || 0);
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
    athletics_note: isAthletics,
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
  }

  if (visibility.pallavolo_live) {
    payload.volley_sets = Number(getEl('set-volley-sets').value || 3);
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
  getEl('set-allow-yellow').checked = Boolean(config.allow_yellow_cards);
  getEl('set-allow-red').checked = Boolean(config.allow_red_cards);
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

  if (sport.sport_type === 'atletica') {
    return showToast('Per atletica non ci sono impostazioni live partita da salvare.', 'success');
  }

  const payload = buildSettingsPayloadForSport(sport);

  const savedConfig = await upsertSportConfig(sportId, payload);
  if (savedConfig?.__allowMvpUnsupported) {
    showToast('Impostazioni salvate, ma MVP non disponibile finché non aggiorni la colonna allow_mvp su sport_config.', 'error');
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

  body.innerHTML = ranked
    .map(
      (row, index) => `
      <tr>
        <td>${medalByRank(index)}</td>
        <td><strong>${escapeHtml(row.player?.full_name ?? '-')}</strong></td>
        <td>${escapeHtml(row.player?.teams?.name ?? '-')}</td>
        <td class="text-center">${Number(row.value).toFixed(2)}</td>
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
    return;
  }

  const [events, leaderboard] = await Promise.all([
    loadAthleticsEvents(sportId),
    loadAthleticsLeaderboard(sportId),
  ]);

  renderEventsTable(events);
  await populatePlayersForAthleticsSport(sportId);

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
  }
}

async function saveEventResultForm(event) {
  event.preventDefault();

  const eventId = Number(getEl('event-select-results').value || 0);
  const playerId = Number(getEl('event-player-select').value || 0);
  const value = Number(getEl('input-event-value').value || 0);
  const notes = getEl('input-event-notes').value;

  if (!eventId || !playerId || !Number.isFinite(value) || value <= 0) {
    showToast('Inserisci evento, studente e valore valido.', 'error');
    return;
  }

  await upsertEventResult({ event_id: eventId, player_id: playerId, value, notes });
  state.selectedEventId = eventId;
  await renderEventResults(eventId);
  await loadEventsSection();
  showToast('Risultato atletica salvato.', 'success');
}
function bindCoreActions() {
  getEl('btn-logout').addEventListener('click', async () => {
    await signOutAdmin();
    window.location.href = 'index.html';
  });

  getEl('btn-new-sport')?.addEventListener('click', () => openSportModal(null));
  document.querySelectorAll('[data-open-team-modal]').forEach((btn) => btn.addEventListener('click', () => openTeamModal(null)));
  document.querySelectorAll('[data-open-match-modal]').forEach((btn) => btn.addEventListener('click', () => openModal('modal-match')));
  getEl('btn-new-event')?.addEventListener('click', () => openEventModal(null));
  getEl('btn-csv-teams-players')?.addEventListener('click', () => openCsvImportModal('teams_players'));
  getEl('btn-csv-athletics-events')?.addEventListener('click', () => openCsvImportModal('athletics_events'));
  getEl('btn-csv-athletics-results')?.addEventListener('click', () => openCsvImportModal('athletics_results'));

  getEl('btn-generate-matches')?.addEventListener('click', () => {
    handleGenerateMatches().catch((error) => showToast(error.message, 'error'));
  });

  getEl('btn-generate-semifinals')?.addEventListener('click', () => {
    handleGenerateSemifinals().catch((error) => showToast(error.message, 'error'));
  });

  getEl('btn-save-settings')?.addEventListener('click', () => {
    saveSettingsForSport().catch((error) => showToast(error.message, 'error'));
  });

  document.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', () => {
      closeModal(button.dataset.modalClose);
    });
  });

  ['modal-sport', 'modal-team', 'modal-match', 'modal-event', 'modal-csv-import'].forEach((modalId) => {
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

  getEl('form-match')?.addEventListener('submit', (event) => {
    handleSaveMatch(event).catch((error) => showToast(error.message, 'error'));
  });

  getEl('form-event')?.addEventListener('submit', (event) => {
    saveEventFromForm(event).catch((error) => showToast(error.message, 'error'));
  });

  getEl('form-event-result')?.addEventListener('submit', (event) => {
    saveEventResultForm(event).catch((error) => showToast(error.message, 'error'));
  });

  ['filter-match-team', 'filter-match-sport', 'filter-match-phase', 'filter-match-status'].forEach((id) => {
    getEl(id)?.addEventListener('input', () => {
      loadMatchesTable().catch((error) => showToast(error.message, 'error'));
    });
    getEl(id)?.addEventListener('change', () => {
      loadMatchesTable().catch((error) => showToast(error.message, 'error'));
    });
  });

  getEl('select-sport-match')?.addEventListener('change', (event) => {
    populateMatchTeams(event.target.value).catch((error) => showToast(error.message, 'error'));
  });

  getEl('report-sport-select')?.addEventListener('change', () => {
    loadReportData().catch((error) => showToast(error.message, 'error'));
  });

  ['rep-filter-team', 'rep-filter-pres', 'rep-filter-fouls', 'rep-filter-score'].forEach((id) => {
    getEl(id)?.addEventListener('change', applyReportFilters);
  });

  getEl('btn-print-report')?.addEventListener('click', () => window.print());

  getEl('athletics-sport-select')?.addEventListener('change', () => {
    state.selectedEventId = null;
    loadEventsSection().catch((error) => showToast(error.message, 'error'));
  });

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

  getEl('table-teams-body')?.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = Number(actionEl.dataset.id);
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
    if (action === 'start-live') return goToLive(id);
    if (action === 'delete-match') {
      handleDeleteMatch(id).catch((error) => showToast(error.message, 'error'));
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

  await refreshSportsState();
  await loadDashboardStats();

  if (state.sports.length) {
    const firstSport = state.sports[0].id;
    ['report-sport-select', 'select-sport-match', 'playoff-sport-select', 'settings-sport-select'].forEach((id) => {
      const el = getEl(id);
      if (el && !el.value) el.value = String(firstSport);
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


