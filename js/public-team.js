import { computeStandings, formatPublicPlayerName, getPrivacySettings, loadSportById, loadSportConfig, loadTeamsBySport, loadMatchesBySport } from './matches.js';
import { db, run } from './db.js';
import { loadPublicTeamNotices } from './team-notices.js';
import { escapeHtml, formatDateTime } from './utils.js';
import { formatScheduleRange } from './schedule.js';

export function parseTeamRoute(search) {
  const params = new URLSearchParams(search);
  const sportId = Number(params.get('sport')), teamId = Number(params.get('team'));
  return Number.isSafeInteger(sportId) && sportId > 0 && Number.isSafeInteger(teamId) && teamId > 0 ? { sportId, teamId } : null;
}
export function teamPageUrl(sportId, teamId, base = window.location.href) {
  const url = new URL('team.html', base);
  url.searchParams.set('sport', String(sportId));
  url.searchParams.set('team', String(teamId));
  return url.toString();
}
export function formatPublicTeamName(name, privacy = getPrivacySettings()) {
  if (privacy.player_name === 'hidden' || privacy.show_class === false) return 'Classe';
  return String(name || '').trim() || 'Da definire';
}
export function teamMatchStatus(match) {
  if (match.is_finished) return 'Conclusa';
  if (match.status === 'cancelled' || match.operational_status === 'cancelled') return 'Annullata';
  if (match.status === 'postponed' || match.operational_status === 'postponed') return 'Rinviata';
  if (match.operational_status === 'paused') return 'Sospesa';
  if (match.status === 'live') return 'In corso';
  return match.scheduled_start ? 'Programmata' : 'Da programmare';
}
export function teamMatchScore(match) { return match.is_finished || match.status === 'live' ? `${Number(match.home_score || 0)} - ${Number(match.away_score || 0)}` : '–'; }
export function teamOverview(teamId, matches, now = Date.now()) {
  const rows = matches.filter((m) => Number(m.home_team_id) === Number(teamId) || Number(m.away_team_id) === Number(teamId))
    .sort((a, b) => (Date.parse(a.scheduled_start) || Number.MAX_SAFE_INTEGER) - (Date.parse(b.scheduled_start) || Number.MAX_SAFE_INTEGER) || Number(a.id) - Number(b.id));
  const upcoming = rows.filter((m) => !m.is_finished);
  const results = rows.filter((m) => m.is_finished).sort((a, b) => (Date.parse(b.finished_at || b.scheduled_start) || 0) - (Date.parse(a.finished_at || a.scheduled_start) || 0) || Number(b.id) - Number(a.id));
  const eligible = upcoming.filter((m) => !['cancelled', 'postponed', 'paused'].includes(m.operational_status) && !['cancelled', 'postponed'].includes(m.status));
  const next = eligible.find((m) => m.status === 'live') || eligible.find((m) => Date.parse(m.scheduled_start) >= now) || eligible.find((m) => !m.scheduled_start) || null;
  return { matches: rows, upcoming, results, next, latest: results[0] || null };
}
export async function loadPublicTournament(sportId) {
  const [sport, teams, matches, config] = await Promise.all([loadSportById(sportId), loadTeamsBySport(sportId), loadMatchesBySport(sportId, { includeUnfinished: true }), loadSportConfig(sportId)]);
  if (!sport) throw new Error('Torneo non trovato.');
  return { sport, teams, matches, config, privacy: getPrivacySettings(config), standings: sport.sport_type === 'atletica' ? [] : computeStandings(teams, matches, config) };
}
export async function loadPublicTeam(sportId, teamId, { tournament = null, roster = false } = {}) {
  const data = tournament || await loadPublicTournament(sportId);
  const team = data.teams.find((t) => Number(t.id) === Number(teamId));
  if (!team) throw new Error('Squadra non trovata in questo torneo.');
  const playersTask = roster && data.privacy.player_name !== 'hidden'
    ? run(db.from('players').select('id, full_name, is_captain').eq('team_id', Number(teamId)).order('full_name', { ascending: true }), 'Caricamento rosa squadra')
    : Promise.resolve({ data: [] });
  const [noticeResult, playersResult] = await Promise.allSettled([loadPublicTeamNotices(sportId, teamId), playersTask]);
  return { ...data, team, sportId: Number(sportId), teamId: Number(teamId), overview: teamOverview(teamId, data.matches), notices: noticeResult.status === 'fulfilled' ? noticeResult.value : null, players: playersResult.status === 'fulfilled' ? playersResult.value.data || [] : null };
}
export function renderTeamNotices(notices) {
  if (!Array.isArray(notices)) return '<div class="empty-state">Avvisi temporaneamente non disponibili. Riprova con Aggiorna.</div>';
  return notices.length ? notices.map((item) => `<article class="team-public-notice"><div class="team-public-notice-top"><strong>${escapeHtml(item.title)}</strong><time datetime="${escapeHtml(item.created_at || '')}">${escapeHtml(item.created_at ? formatDateTime(item.created_at) : '')}</time></div><p>${escapeHtml(item.body)}</p></article>`).join('') : '<div class="empty-state">Nessun avviso pubblico per questa squadra.</div>';
}
export function renderTeamRoster(players, privacy) {
  if (privacy.player_name === 'hidden') return '<span>Rosa non pubblica.</span>';
  if (!Array.isArray(players)) return '<span>Rosa temporaneamente non disponibile.</span>';
  return players.map((p) => `<span>${escapeHtml(formatPublicPlayerName(p.full_name, privacy))}${p.is_captain ? ' <strong>· Capitano</strong>' : ''}</span>`).join('') || '<span>Nessuna rosa pubblicata.</span>';
}
export function renderTeamMatchRows(matches, privacy, emptyMessage) {
  return matches.map((m) => `<article class="team-match-row" id="team-match-${Number(m.id)}"><span><strong>${escapeHtml(formatPublicTeamName(m.home?.name, privacy))} vs ${escapeHtml(formatPublicTeamName(m.away?.name, privacy))}</strong><small>${escapeHtml(teamMatchStatus(m))} · ${escapeHtml(formatScheduleRange(m))}</small><small>${escapeHtml(m.venue?.name || 'Campo da definire')}${m.round_name ? ` · ${escapeHtml(m.round_name)}` : ''}</small></span><span class="team-match-result">${escapeHtml(teamMatchScore(m))}</span></article>`).join('') || `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
}
