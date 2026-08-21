import { buildKnockoutBracket, renderKnockoutBracketHtml } from './knockout-bracket.js';

const groupMatches = [
  match({
    id: 1,
    round: 'Girone A',
    home: '3A Informatica',
    away: '4B Turismo',
    homeScore: 2,
    awayScore: 0,
    finished: true,
    start: '2026-05-10T09:00:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 2,
    round: 'Girone A',
    home: '5C Grafica',
    away: '4A AFM',
    homeScore: 1,
    awayScore: 1,
    finished: true,
    start: '2026-05-10T09:35:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 3,
    round: 'Girone A',
    home: '3A Informatica',
    away: '5C Grafica',
    homeScore: 3,
    awayScore: 2,
    finished: true,
    start: '2026-05-10T10:10:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 4,
    round: 'Girone A',
    home: '4B Turismo',
    away: '4A AFM',
    homeScore: 0,
    awayScore: 2,
    finished: true,
    start: '2026-05-10T10:45:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 5,
    round: 'Girone B',
    home: '3D SIA',
    away: '5A Turismo',
    homeScore: 1,
    awayScore: 2,
    finished: true,
    start: '2026-05-10T11:20:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 6,
    round: 'Girone B',
    home: '4C Informatica',
    away: '3B AFM',
    homeScore: 4,
    awayScore: 1,
    finished: true,
    start: '2026-05-10T11:55:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 7,
    round: 'Girone B',
    home: '5A Turismo',
    away: '4C Informatica',
    homeScore: 0,
    awayScore: 0,
    finished: true,
    start: '2026-05-10T12:30:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 8,
    round: 'Girone B',
    home: '3D SIA',
    away: '3B AFM',
    start: '2026-05-10T13:05:00+02:00',
    venue: 'Campo Esterno',
  }),
];

const finalMatches = [
  match({
    id: 101,
    round: 'Ottavi di finale 1',
    home: '3A Informatica',
    away: '4B Turismo',
    homeScore: 3,
    awayScore: 1,
    finished: true,
    start: '2026-05-12T09:00:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 102,
    round: 'Ottavi di finale 2',
    home: '5C Grafica',
    away: '4A AFM',
    homeScore: 2,
    awayScore: 0,
    finished: true,
    start: '2026-05-12T09:35:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 103,
    round: 'Ottavi di finale 3',
    home: '3D SIA',
    away: '5A Turismo',
    homeScore: 1,
    awayScore: 2,
    finished: true,
    start: '2026-05-12T10:10:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 104,
    round: 'Ottavi di finale 4',
    home: '4C Informatica',
    away: '3B AFM',
    homeScore: 4,
    awayScore: 3,
    finished: true,
    start: '2026-05-12T10:45:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 105,
    round: 'Ottavi di finale 5',
    home: '5B SIA',
    away: '3C Turismo',
    homeScore: 0,
    awayScore: 1,
    finished: true,
    start: '2026-05-12T11:20:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 106,
    round: 'Ottavi di finale 6',
    home: '4D Grafica',
    away: '5D Informatica',
    homeScore: 2,
    awayScore: 2,
    finished: true,
    start: '2026-05-12T11:55:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 107,
    round: 'Ottavi di finale 7',
    home: '3E Sportivo',
    away: '4E SIA',
    homeScore: 3,
    awayScore: 0,
    finished: true,
    start: '2026-05-12T12:30:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 108,
    round: 'Ottavi di finale 8',
    home: '5E AFM',
    away: '4F Turismo',
    homeScore: 1,
    awayScore: 2,
    finished: true,
    start: '2026-05-12T13:05:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 201,
    round: 'Quarti di finale 1',
    home: '3A Informatica',
    away: '5C Grafica',
    homeScore: 2,
    awayScore: 1,
    finished: true,
    start: '2026-05-13T09:00:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 202,
    round: 'Quarti di finale 2',
    home: '5A Turismo',
    away: '4C Informatica',
    homeScore: 1,
    awayScore: 0,
    finished: true,
    start: '2026-05-13T09:45:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 203,
    round: 'Quarti di finale 3',
    home: '3C Turismo',
    away: '5D Informatica',
    start: '2026-05-13T10:30:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 204,
    round: 'Quarti di finale 4',
    home: '3E Sportivo',
    away: '4F Turismo',
    start: '2026-05-13T11:15:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 301,
    round: 'Semifinale 1',
    home: '3A Informatica',
    away: '5A Turismo',
    start: '2026-05-14T09:30:00+02:00',
    venue: 'Palestra Grande',
  }),
  match({
    id: 302,
    round: 'Semifinale 2',
    home: 'Da definire',
    away: 'Da definire',
    start: '2026-05-14T10:15:00+02:00',
    venue: 'Campo Esterno',
  }),
  match({
    id: 401,
    round: 'Finale',
    home: 'Da definire',
    away: 'Da definire',
    start: '2026-05-15T12:00:00+02:00',
    venue: 'Palestra Grande',
  }),
];

const container = document.getElementById('demo-bracket');
const stats = document.getElementById('demo-stats');
const phaseSelect = document.getElementById('demo-phase-select');

phaseSelect?.addEventListener('change', renderDemo);
renderDemo();

function renderDemo() {
  const view = phaseSelect?.value === 'groups' ? 'groups' : 'finals';
  if (view === 'groups') {
    renderGroupsDemo();
    return;
  }

  const rounds = buildKnockoutBracket({ matches: finalMatches });
  const finishedCount = finalMatches.filter((item) => item.is_finished).length;
  stats.innerHTML = `
    <span class="kb-stat-badge kb-stat-rounds"><i class="fa-solid fa-sitemap"></i> ${rounds.length} turni</span>
    <span class="kb-stat-badge kb-stat-done"><i class="fa-solid fa-check-circle"></i> ${finishedCount} conclusi</span>
    <span class="kb-stat-badge kb-stat-pending"><i class="fa-solid fa-clock"></i> ${finalMatches.length - finishedCount} programmati</span>
  `;
  container.classList.add('kb-bracket-scroll-wrap');
  container.innerHTML = renderKnockoutBracketHtml({ rounds });
}

function renderGroupsDemo() {
  const groups = groupMatchesByRound(groupMatches);
  const finishedCount = groupMatches.filter((item) => item.is_finished).length;
  stats.innerHTML = `
    <span class="kb-stat-badge kb-stat-rounds"><i class="fa-solid fa-layer-group"></i> ${groups.length} gironi</span>
    <span class="kb-stat-badge kb-stat-done"><i class="fa-solid fa-check-circle"></i> ${finishedCount} conclusi</span>
    <span class="kb-stat-badge kb-stat-pending"><i class="fa-solid fa-clock"></i> ${groupMatches.length - finishedCount} programmati</span>
  `;
  container.classList.remove('kb-bracket-scroll-wrap');
  container.innerHTML = `
    <div class="knockout-groups-grid">
      ${groups.map(renderGroupCard).join('')}
    </div>
  `;
}

function renderGroupCard(group) {
  return `
    <section class="knockout-group-card">
      <header>
        <span class="badge badge-info">${escapeHtml(group.name)}</span>
        <strong>${group.matches.length} partite</strong>
      </header>
      <div class="knockout-group-match-list">
        ${group.matches.map(renderGroupMatch).join('')}
      </div>
    </section>
  `;
}

function renderGroupMatch(item) {
  const status = item.is_finished ? 'Conclusa' : 'Programmata';
  const score = item.is_finished ? `${item.home_score ?? 0} - ${item.away_score ?? 0}` : '- -';
  return `
    <button class="knockout-group-match" type="button">
      <span class="knockout-group-team text-right">${escapeHtml(item.home?.name ?? 'Da definire')}</span>
      <span class="knockout-group-score">${escapeHtml(score)}</span>
      <span class="knockout-group-team">${escapeHtml(item.away?.name ?? 'Da definire')}</span>
      <span class="knockout-group-meta">
        ${escapeHtml(status)} · ${escapeHtml(formatDemoDate(item.scheduled_start))} · ${escapeHtml(item.venue?.name ?? 'Campo da definire')}
      </span>
    </button>
  `;
}

function groupMatchesByRound(matches) {
  const byRound = new Map();
  for (const item of matches) {
    const round = item.round_name || 'Girone';
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push(item);
  }
  return [...byRound.entries()].map(([name, matches]) => ({ name, matches }));
}

function match({
  id,
  round,
  home,
  away,
  homeScore = null,
  awayScore = null,
  finished = false,
  start,
  venue,
}) {
  return {
    id,
    round_name: round,
    home: { name: home },
    away: { name: away },
    home_score: homeScore,
    away_score: awayScore,
    is_finished: finished,
    status: finished ? 'finished' : 'scheduled',
    scheduled_start: start,
    scheduled_end: addMinutes(start, 30),
    venue: { name: venue },
  };
}

function addMinutes(value, minutes) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function formatDemoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Orario da definire';
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
