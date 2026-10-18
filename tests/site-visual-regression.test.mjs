import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('public homepage contains no redundant following instructions', () => {
  const html = read('index.html');
  const main = read('js/main-index.js');
  assert.ok(!html.includes('Preferiti e letture restano in questo browser.'));
  assert.ok(!main.includes('Apri una squadra dalla classifica e seguila'));
  assert.ok(html.includes('id="my-teams-checked"'), 'Keep actionable team-follow status');
});

test('home and team headers use the same icon-free title and no subtitle', () => {
  const home = read('index.html');
  const page = read('team.html');
  const css = read('css/team-follow.css');
  const sharedCss = read('css/style.css');
  const homeHeader = home.split('<header class="public-header">')[1]?.split('</header>')[0];
  const teamHeader = page.split('<header class="public-header team-page-header">')[1]?.split('</header>')[0];
  assert.ok(homeHeader && teamHeader, 'Both public headers must exist');
  assert.match(homeHeader, /<h1 class="public-title">Tornei Scolastici<\/h1>/);
  assert.match(teamHeader, /<h1 class="public-title"><a class="team-page-brand"[^>]+>Tornei Scolastici<\/a><\/h1>/);
  for (const header of [homeHeader, teamHeader]) {
    assert.doesNotMatch(header, /fa-trophy|public-subtitle|Risultati e classifica in tempo reale|La tua squadra, dentro e fuori dal campo/);
  }
  assert.ok(!/\.team-page h1\s*\{/.test(css), 'No unscoped heading override');
  assert.match(css, /\.team-page \.team-page-header \.team-page-brand/);
  assert.match(css, /\.public-page \.public-quick-actions\s*\{/);
  assert.match(sharedCss, /\.public-header\s*\{/);
  const main = read('js/main-index.js');
  assert.doesNotMatch(main, /DEFAULT_SUBTITLE|public-subtitle/);
});
test('offline workspace keeps the authentic sidebar and guided transfer stages', () => {
  const html = read('offline-workspace.html');
  const css = read('css/offline-workspace.css');
  assert.match(html, /id="admin-sidebar"/);
  assert.match(html, /class="sidebar-menu"/);
  for (const view of ['dashboard','operations','reports','matches','venues','archive','telegram','sports','teams','events','settings']) {
    assert.ok(html.includes('?view=' + view), 'Missing native navigation ' + view);
  }
  for (const anchor of ['#key-preparation','#key-collection','#key-confirmation']) assert.ok(html.includes(anchor));
  assert.match(css, /\.offline-workspace-page \.sidebar/);
  assert.match(css, /\.offline-skip-link:focus/);
});

test('admin reports show filters, column selector, density toggle, contextual print', () => {
  const html = read('admin/index.html');
  assert.ok(!html.includes('Analisi post-evento'));
  const section = html.split('<section id="view-reports"')[1]?.split('<section id="view-')[0];
  assert.ok(section, 'Report view must exist');
  const ids=['btn-toggle-report-columns','btn-toggle-report-filters','btn-report-density','btn-print-report'];
  let last=-1;
  for (const id of ids) { const index=section.indexOf('id="' + id + '"'); assert.ok(index > last, id + ' must be ordered alongside controls'); last=index; }
  assert.match(section,/id="btn-report-density"[^>]*aria-pressed="false"/);
});

test('control center prioritizes live metrics, actions and collapsible supporting details', () => {
  const html=read('admin/index.html');
  const ops=html.split('<section id="view-operations"')[1]?.split('<section id="view-reports"')[0];
  assert.ok(ops,'Control center view must exist');
  for(const id of ['regia-count-live','regia-count-scheduled','regia-count-finished','regia-count-delayed','regia-action-queue-panel','regia-venues-panel','regia-devices-details','regia-issues-details']) assert.ok(ops.includes('id="' + id + '"'),id);
  assert.match(ops,/<details class="card regia-detail-card/);
});

test('match reports retain sport-specific columns, captain styling, X and MVP star, chronology before signatures', () => {
  const js=read('js/match-report.js');
  const css=read('css/match-report.css');
  assert.match(js, /label: 'Falli'/);
  assert.match(js, /yellow_cards', 'Gialli'/);
  assert.match(js, /red_cards', 'Rossi'/);
  assert.match(js, /report-captain/);
  assert.match(js, /row\.played \? 'X' : ''/);
  assert.match(js, /&#9733;/);
  assert.match(js, /Cronologia partita/);
  assert.match(js, /assertMatchReportPrintCapacity/);
  assert.match(css, /@page\s*\{\s*size:\s*A4/);
});
