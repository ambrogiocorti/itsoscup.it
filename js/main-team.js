import { parseTeamRoute, teamPageUrl, loadPublicTeam, formatPublicTeamName, renderTeamNotices, renderTeamRoster, renderTeamMatchRows, teamMatchScore } from './public-team.js';
import { teamFollowId, TEAM_FOLLOW_KEY, teamFollowStore } from './team-follow-store.js';
import { bindFollowReadActions, renderFollowUpdates, toggleTeamFollow } from './team-follow-ui.js';
import { subscribeTable } from './db.js';
import { formatScheduleRange } from './schedule.js';
import { escapeHtml, formatDateTime, showToast } from './utils.js';
import { registerOfflineSupport } from './offline.js';

registerOfflineSupport();
const route = parseTeamRoute(window.location.search);
const content = document.getElementById('team-page-content');
const status = document.getElementById('team-page-status');
let bundle = null, refreshing = false, unsubscribe = null;

function render() {
  if (!bundle) return;
  const { team, sport, privacy, overview, standings } = bundle;
  const local = teamFollowStore.read(), key = teamFollowId(route.sportId, route.teamId);
  const followed = local.favorites.some((f) => teamFollowId(f.sportId, f.teamId) === key);
  const row = standings.find((r) => Number(r.id) === route.teamId);
  const position = standings.findIndex((r) => Number(r.id) === route.teamId) + 1;
  const name = formatPublicTeamName(team.name, privacy);
  const opponent = overview.next ? formatPublicTeamName(Number(overview.next.home_team_id) === route.teamId ? overview.next.away?.name : overview.next.home?.name, privacy) : '';
  document.title = `${name} — ${sport.name} | ITSOSCup`;
  content.innerHTML = `<section class="card team-summary-card"><div class="card-body"><div class="team-profile-hero"><div><span class="team-profile-kicker">${escapeHtml(sport.name)}</span><h1>${escapeHtml(name)}</h1><p>${escapeHtml(privacy.show_class ? `Classe ${team.name}` : 'Identità della classe riservata')} · ${escapeHtml({ calcio: 'Calcio', basket: 'Basket', pallavolo: 'Pallavolo', atletica: 'Atletica' }[sport.sport_type] || 'Torneo')} · ${escapeHtml(sport.year || '–')}° anno</p></div><div class="team-profile-actions"><button class="team-follow-btn ${followed ? 'is-following' : ''}" id="btn-toggle-team-favorite" type="button" aria-pressed="${followed}"><i class="fa-${followed ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i><span>${followed ? 'Squadra seguita' : 'Segui squadra'}</span></button><button class="btn btn-ghost btn-compact" id="btn-copy-team-link" type="button">Copia link</button></div></div>${sport.sport_type === 'atletica' ? '<p class="follow-helper">I risultati individuali e la classifica di atletica sono disponibili nella pagina del torneo.</p>' : `<div class="team-profile-metrics"><span>Posizione<strong>${position ? `${position}ª` : '–'}</strong></span><span>Punti<strong>${Number(row?.points || 0)}</strong></span><span>Giocate<strong>${Number(row?.played || 0)}</strong></span><span>V / N / P<strong>${Number(row?.wins || 0)} / ${Number(row?.draws || 0)} / ${Number(row?.losses || 0)}</strong></span><span>Diff. punti/reti<strong>${Number(row?.goalDiff || 0)}</strong></span></div>`}${!local.available ? '<p class="follow-helper" role="status">Preferenze locali non disponibili. La pagina squadra resta consultabile.</p>' : ''}</div></section><div class="team-profile-grid team-page-sections"><section class="team-profile-panel"><h2><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> ${overview.next?.status === 'live' ? 'Partita in corso' : 'Prossima partita'}</h2><div class="team-next-match ${overview.next ? '' : 'is-empty'}"><span>${overview.next?.status === 'live' ? `In corso · ${escapeHtml(teamMatchScore(overview.next))}` : 'In calendario'}</span><strong>${overview.next ? `contro ${escapeHtml(opponent)}` : 'Nessuna partita programmata'}</strong><small>${overview.next ? `${escapeHtml(formatScheduleRange(overview.next))} · ${escapeHtml(overview.next.venue?.name || 'Campo da definire')}` : 'Controlla il calendario per partite rinviate o da programmare.'}</small></div></section><section class="team-profile-panel"><h2><i class="fa-solid fa-clipboard-user" aria-hidden="true"></i> Rosa e capitano</h2><div class="team-roster-list">${renderTeamRoster(bundle.players, privacy)}</div></section><section class="team-profile-panel team-profile-calendar"><h2><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Calendario squadra</h2><div class="team-match-list">${renderTeamMatchRows(overview.upcoming, privacy, 'Nessuna partita da giocare.')}</div></section><section class="team-profile-panel team-profile-calendar"><h2><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> Risultati e storico</h2><div class="team-match-list">${renderTeamMatchRows(overview.results, privacy, 'Nessun risultato disponibile.')}</div></section><section class="team-profile-panel team-profile-announcements"><h2><i class="fa-solid fa-bell" aria-hidden="true"></i> Avvisi per la squadra</h2><p class="team-announcements-helper">Comunicazioni pubbliche destinate a questa squadra.</p><div id="team-public-notices-list" class="team-public-notices-list">${renderTeamNotices(bundle.notices)}</div></section>${followed ? `<section class="team-profile-panel team-profile-announcements"><h2><i class="fa-solid fa-star" aria-hidden="true"></i> I tuoi aggiornamenti</h2><div id="team-follow-updates">${renderFollowUpdates(bundle, local.records[key])}</div><p class="follow-helper">Salvati solo in questo browser. Ultimo controllo: ${escapeHtml(formatDateTime(bundle.checkedAt || local.records[key]?.checkedAt))}. Controlliamo le novità mentre la pagina è aperta e quando torni sul sito.</p></section>` : ''}</div>`;
  status.hidden = true;
  content.hidden = false;
  document.getElementById('btn-toggle-team-favorite').addEventListener('click', async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try { await toggleTeamFollow(bundle); render(); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; }
  });
  document.getElementById('btn-copy-team-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(teamPageUrl(route.sportId, route.teamId)); showToast('Link squadra copiato.', 'success'); }
    catch (_error) { showToast('Puoi copiare il link dalla barra degli indirizzi.', 'info'); }
  });
  bindFollowReadActions(content, bundle, render);
}
async function refresh() {
  if (!route || refreshing) return;
  refreshing = true;
  document.getElementById('team-refresh').disabled = true;
  try {
    bundle = await loadPublicTeam(route.sportId, route.teamId, { roster: true });
    bundle.checkedAt = new Date().toISOString();
    try { await teamFollowStore.observe(route.sportId, route.teamId, bundle.overview.matches, bundle.notices); }
    catch (error) { showToast(error.message, 'error'); }
    render();
  } catch (error) {
    status.hidden = false;
    status.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}<p>Usa Aggiorna per riprovare oppure torna al torneo.</p></div>`;
    // Do not leave previously visible roster data when privacy settings cannot be checked.
    content.hidden = true;
    bundle = null;
  } finally { refreshing = false; document.getElementById('team-refresh').disabled = false; }
}
if (!route) {
  status.innerHTML = '<div class="empty-state">Link squadra non valido. Apri una squadra dalla classifica del torneo.</div>';
  document.getElementById('team-refresh').hidden = true;
} else {
  const canonical = teamPageUrl(route.sportId, route.teamId);
  document.getElementById('team-canonical').href = canonical;
  document.getElementById('team-tournament-link').href = `./?sport=${route.sportId}`;
  document.getElementById('team-refresh').addEventListener('click', () => void refresh());
  window.addEventListener('team-follows-changed', render);
  window.addEventListener('storage', (e) => { if ([TEAM_FOLLOW_KEY, 'tornei_device_id', null].includes(e.key)) render(); });
  const visibleRefresh = () => { if (!document.hidden) void refresh(); };
  document.addEventListener('visibilitychange', visibleRefresh);
  window.addEventListener('online', visibleRefresh);
  let timer;
  const startUpdates = () => {
    timer = window.setInterval(visibleRefresh, 60_000);
    unsubscribe = subscribeTable({ channelName: `public-team-${route.sportId}-${route.teamId}`, table: 'matches', filter: `sport_id=eq.${route.sportId}`, onChange: visibleRefresh });
  };
  startUpdates();
  window.addEventListener('pagehide', () => { window.clearInterval(timer); unsubscribe?.(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) { startUpdates(); visibleRefresh(); } });
  void refresh();
}
