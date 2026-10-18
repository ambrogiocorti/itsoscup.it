import {
  computeStandings,
  loadMatchesBySport,
  loadSportConfig,
  loadSports,
  loadTeamsBySport,
} from './matches.js';
import { TEAM_SPORTS } from './app-config.js';
import { subscribeTable } from './db.js';
import { formatScheduleRange } from './schedule.js';
import { registerOfflineSupport } from './offline.js';
import { registerClientErrorLogger } from './error-logger.js';
import { escapeHtml, showToast } from './utils.js';

const state = {
  sports: [],
  selectedSportId: null,
  unsubscribe: null,
  mode: 'palestra',
  refreshHandle: null,
};

registerOfflineSupport();
registerClientErrorLogger('gym');

function updateClock() {
  const el=document.getElementById('gym-clock');
  if(el)el.textContent=new Intl.DateTimeFormat('it-IT',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}).format(new Date());
}
function setMode(mode) {
  state.mode = mode === 'atrio' ? 'atrio' : 'palestra';
  document.body.dataset.mode=state.mode;
  document.getElementById('gym-mode').value=state.mode;
  const title=document.getElementById('gym-title');
  if(title)title.setAttribute('aria-label',state.mode==='atrio'?'Tabellone atrio':'Tabellone palestra');
}
async function loadGymNotices(sportId) {
  const panel=document.getElementById('gym-notices');
  if(!panel)return;
  try{
    const {db,run}=await import('./db.js');
    const {data}=await run(db.from('public_notifications')
      .select('title,body,created_at')
      .eq('is_active',true)
      .order('created_at',{ascending:false}).limit(3),'Avvisi maxischermo');
    const notices=(data||[]).filter(n=>n.title||n.body);
    panel.hidden=!notices.length;
    if(notices.length)panel.innerHTML='<strong>Avvisi organizzazione</strong>'+
      notices.map(n=>'<p><strong>'+escapeHtml(n.title||'Comunicazione')+'</strong> · '+escapeHtml(n.body||'')+'</p>').join('');
  }catch(_error){panel.hidden=true;}
}
function getSportFromQuery() {
  return Number(new URLSearchParams(window.location.search).get('sport') || 0) || null;
}

function renderSportOptions() {
  const select = document.getElementById('gym-sport-select');
  if (!select) return;
  const teamSports = state.sports.filter((sport) =>
    TEAM_SPORTS.includes(String(sport.sport_type ?? '').toLowerCase())
  );
  select.innerHTML = teamSports
    .map((sport) => `<option value="${sport.id}">${escapeHtml(sport.name)}</option>`)
    .join('');
}

function getCurrentMatch(matches) {
  const now = Date.now();
  return (matches ?? []).find((match) => {
    const start = match.scheduled_start ? new Date(match.scheduled_start).getTime() : NaN;
    const end = match.scheduled_end ? new Date(match.scheduled_end).getTime() : NaN;
    return match.status === 'live' || (Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now);
  }) ?? null;
}

function getNextMatches(matches) {
  const now = Date.now();
  return (matches ?? [])
    .filter((match) => !match.is_finished && match.status !== 'cancelled')
    .filter((match) => {
      const start = match.scheduled_start ? new Date(match.scheduled_start).getTime() : NaN;
      return match.status === 'live' || !Number.isFinite(start) || start >= now;
    })
    .sort((a, b) => {
      const aStart = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER;
      const bStart = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER;
      return aStart - bStart;
    })
    .slice(0, 4);
}

function renderLive(match) {
  const panel = document.getElementById('gym-live-panel');
  if (!panel) return;
  if (!match) {
    panel.innerHTML = `
      <div class="gym-live-empty">
        <span>Nessun match in corso</span>
        <strong>Consulta i prossimi incontri</strong>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="gym-live-meta">
      <span>${match.status === 'live' ? 'LIVE' : 'IN CORSO'}</span>
      <strong>${escapeHtml(formatScheduleRange(match))}</strong>
    </div>
    <div class="gym-scoreboard">
      <div class="gym-team">${escapeHtml(match.home?.name ?? 'TBD')}</div>
      <div class="gym-score">${match.home_score ?? 0} - ${match.away_score ?? 0}</div>
      <div class="gym-team">${escapeHtml(match.away?.name ?? 'TBD')}</div>
    </div>
    <div class="gym-venue">${escapeHtml(match.venue?.name ?? 'Campo da definire')}</div>
  `;
}

function renderNext(matches) {
  const list = document.getElementById('gym-next-list');
  if (!list) return;
  const rows = getNextMatches(matches);
  list.innerHTML = rows.length
    ? rows
        .map(
          (match) => `
        <div class="gym-list-row">
          <strong>${escapeHtml(match.home?.name ?? 'TBD')} vs ${escapeHtml(match.away?.name ?? 'TBD')}</strong>
          <span>${escapeHtml(formatScheduleRange(match))} · ${escapeHtml(match.venue?.name ?? 'Campo da definire')}</span>
        </div>
      `
        )
        .join('')
    : '<div class="empty-state">Nessun prossimo incontro.</div>';
}

function renderStandings(standings) {
  const list = document.getElementById('gym-standings-list');
  if (!list) return;
  list.innerHTML = standings.length
    ? standings
        .slice(0, 8)
        .map(
          (row, index) => `
        <div class="gym-list-row gym-standing-row">
          <span>${index + 1}</span>
          <strong>${escapeHtml(row.name)}</strong>
          <b>${row.points}</b>
        </div>
      `
        )
        .join('')
    : '<div class="empty-state">Classifica non disponibile.</div>';
}

async function loadGymData() {
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }

  const sportId = Number(document.getElementById('gym-sport-select')?.value || state.selectedSportId || 0);
  state.selectedSportId = sportId || null;
  if (!sportId) return;

  const sport = state.sports.find((item) => Number(item.id) === sportId);
  document.getElementById('gym-title').textContent = sport?.name ?? 'Schermo palestra';

  const [teams, matches, config] = await Promise.all([
    loadTeamsBySport(sportId),
    loadMatchesBySport(sportId, { includeUnfinished: true }),
    loadSportConfig(sportId),
  ]);

  renderLive(getCurrentMatch(matches));
  renderNext(matches);
  renderStandings(computeStandings(teams, matches, config));
  await loadGymNotices(sportId);
  updateClock();

  state.unsubscribe = subscribeTable({
    channelName: `gym-screen-${sportId}`,
    table: 'matches',
    event: '*',
    onChange: () => loadGymData().catch((error) => showToast(error.message, 'error')),
  });
}

async function init() {
  document.getElementById('gym-mode')?.addEventListener('change', event=>setMode(event.target.value));
  document.getElementById('gym-fullscreen')?.addEventListener('click',()=>{
    if(document.fullscreenElement)document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(error=>showToast(error.message,'error'));
  });
  const chosen=new URLSearchParams(window.location.search).get('mode');
  setMode(chosen==='atrio'?'atrio':'palestra');
  updateClock();
  window.setInterval(updateClock,15_000);
  // Safety net if the realtime channel is disconnected.
  state.refreshHandle=window.setInterval(()=>{
    if(!document.hidden)loadGymData().catch(error=>showToast(error.message,'error'));
  },60_000);

  state.sports = await loadSports();
  renderSportOptions();
  const selectedSportId = getSportFromQuery() ?? state.sports.find((sport) => TEAM_SPORTS.includes(String(sport.sport_type ?? '').toLowerCase()))?.id;
  if (selectedSportId) {
    document.getElementById('gym-sport-select').value = String(selectedSportId);
    state.selectedSportId = Number(selectedSportId);
  }

  document.getElementById('gym-sport-select')?.addEventListener('change', () => {
    loadGymData().catch((error) => showToast(error.message, 'error'));
  });

  await loadGymData();
}

init().catch((error) => showToast(error.message, 'error'));
