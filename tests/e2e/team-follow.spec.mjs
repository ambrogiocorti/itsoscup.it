import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ serviceWorkers: 'block' });

function syntheticSdk({ privacy = 'full', denyStorage = false, showClass = true } = {}) {
  const data = {
    sports: [{ id: 37, name: 'Torneo di prova', sport_type: 'calcio', format: 'gironi', year: 4, is_active: true }],
    teams: [{ id: 124, sport_id: 37, name: '4A' }, { id: 125, sport_id: 37, name: '4B' }],
    players: [{ id: 1, team_id: 124, full_name: 'Studente Prova', is_captain: true }],
    sport_config: [{ sport_id: 37, privacy_settings: { player_name: privacy, show_class: showClass } }],
    matches: [
      { id: 11, sport_id: 37, home_team_id: 124, away_team_id: 125, home: { name: '4A' }, away: { name: '4B' }, home_score: 2, away_score: 1, is_finished: true, status: 'finished', scheduled_start: '2026-10-10T10:00:00Z', finished_at: '2026-10-10T11:00:00Z', venue_id: 2, venue: { id: 2, name: 'Campo 2' } },
      { id: 12, sport_id: 37, home_team_id: 124, away_team_id: 125, home: { name: '4A' }, away: { name: '4B' }, home_score: 0, away_score: 0, is_finished: false, status: 'scheduled', scheduled_start: '2099-11-14T10:00:00Z', scheduled_end: '2099-11-14T11:00:00Z', venue_id: 1, venue: { id: 1, name: 'Palestra' } },
    ],
    urgent_announcements: [],
  };
  window.__rows = data;
  window.__queries = [];
  window.__notices = [{ id: 9, title: 'Cambio palestra', body: 'Partita al campo 2', created_at: '2026-10-14T08:00:00Z' }];
  try { localStorage.setItem('tornei_tour_done_public', 'true'); } catch (_) {}
  if (denyStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  function query(name) {
    if (name === 'team_favorites' || name.startsWith('class_')) throw new Error('Private or cloud favorites table queried');
    const q = {
      filters: [],
      select(fields) { window.__queries.push({ table: name, fields }); return this; },
      eq(field, value) { this.filters.push([field, value]); return this; },
      in(field, value) { this.filters.push([field, value]); return this; },
      order() { return this; }, limit() { return this; }, or() { return this; },
      result() { return (data[name] || []).filter((row) => this.filters.every(([f, v]) => Array.isArray(v) ? v.includes(row[f]) : row[f] === v)); },
      maybeSingle() { return Promise.resolve({ data: this.result()[0] || null, error: name === 'sport_config' && window.__configError ? { message: 'Synthetic config error' } : null }); },
      single() { return this.maybeSingle(); },
      then(ok, bad) { return Promise.resolve({ data: this.result(), error: null }).then(ok, bad); },
    };
    return q;
  }
  window.supabase = { createClient: () => ({
    from: query,
    rpc: async (name, args) => {
      if (name !== 'public_team_notices') return { data: null, error: { message: 'Unexpected RPC: ' + name } };
      window.__lastNoticeArgs = args;
      return { data: args.p_sport_id === 37 && args.p_team_id === 124 ? window.__notices : [], error: window.__noticeError ? { message: 'Synthetic notice outage' } : null };
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel: async () => {},
  }) };
}

async function installFixture(context, args = {}) {
  await context.route('**/cdn.jsdelivr.net/**', (route) => route.abort());
  await context.route('**/cdnjs.cloudflare.com/**', (route) => route.abort());
  await context.addInitScript(syntheticSdk, args);
}
async function follow(page) {
  await page.locator('#btn-toggle-team-favorite').click();
  await page.getByRole('button', { name: 'Salva su questo dispositivo' }).click();
  await expect(page.locator('#btn-toggle-team-favorite')).toHaveAttribute('aria-pressed', 'true');
}

test('standalone team route and legacy redirect preserve identity, responsive layout and appropriate navigation', async ({ page, context }, testInfo) => {
  await installFixture(context);
  await page.goto('/index.html?sport=37&team=124');
  await expect(page).toHaveURL(/\/team\.html\?sport=37&team=124/);
  await expect(page.getByRole('heading', { name: '4A', exact: true })).toBeVisible();
  await expect(page.locator('#sport-select, #standings-card, #upcoming-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Rosa e capitano' })).toBeVisible();
  await expect(page.locator('.team-roster-list')).toContainText('Studente Prova');
  await expect(page.locator('.team-roster-list')).toContainText('Capitano');
  await expect(page.locator('#team-match-11')).toContainText('2 - 1');
  await expect(page.locator('#team-match-12')).toContainText('Palestra');
  await expect(page.locator('#team-public-notices-list')).toContainText('Cambio palestra');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('team-page.png'), fullPage: true });
  await page.locator('#team-tournament-link').click();
  await expect(page.locator('#standings-container a.public-team-link').first()).toHaveAttribute('href', /team\.html\?sport=37&team=124/);
  await page.locator('#standings-container a.public-team-link').first().click();
  await expect(page).toHaveURL(/team\.html/);
});

test('local follow survives navigation, shows home next/latest/notices, coalesces new updates and preserves read state', async ({ page, context }) => {
  await installFixture(context);
  await page.goto('/team.html?sport=37&team=124');
  await follow(page);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('tornei_team_follows_v1')));
  const deviceId = await page.evaluate(() => localStorage.getItem('tornei_device_id'));
  expect(persisted.deviceId).toBe(deviceId);
  expect(JSON.stringify(persisted)).not.toContain('Studente Prova');
  expect(JSON.stringify(persisted)).not.toContain('Cambio palestra');
  await page.evaluate(() => {
    window.__rows.matches[1].scheduled_start = '2099-11-14T12:00:00Z';
    window.__rows.matches[1].operational_status = 'postponed';
    window.__rows.matches[0].home_score = 3;
    window.__notices.push({ id: 10, title: 'Nuovo avviso', body: '<img src=x onerror=alert(1)>', created_at: '2026-10-14T10:00:00Z' });
  });
  await page.locator('#team-refresh').click();
  await expect(page.locator('#team-follow-updates')).toContainText('3 nuovi');
  await page.locator('#team-follow-updates summary').click();
  await expect(page.locator('#team-follow-updates')).toContainText('Partita rinviata');
  await expect(page.locator('#team-follow-updates')).toContainText('Risultato: 3 - 1');
  await expect(page.locator('#team-follow-updates img')).toHaveCount(0);
  await page.locator('#team-refresh').click();
  await expect(page.locator('#team-follow-updates')).toContainText('3 nuovi');
  await page.locator('#team-follow-updates summary').click();
  await page.getByRole('button', { name: 'Segna tutti come letti' }).click();
  await expect(page.locator('#team-follow-updates')).toContainText('Tutti letti');
  await page.goto('/');
  await expect(page.locator('#my-teams-content')).toContainText('4A');
  await expect(page.locator('#my-teams-content')).toContainText('Prossima partita');
  await expect(page.locator('#my-teams-content')).toContainText('Ultimo risultato');
  await expect(page.locator('#my-teams-content')).toContainText('Cambio palestra');
  // Returning the synthetic data to its previous score is a new correction; mark read again.
  const allRead = page.getByRole('button', { name: 'Segna tutti come letti' });
  if (await allRead.count()) { await page.locator('.follow-updates summary').click(); await allRead.click(); }
  await page.reload();
  await expect(page.locator('#my-teams-content .favorite-team-heading')).toContainText('4A');
  await page.locator('[data-unfollow]').click();
  await expect(page.locator('#my-teams-content')).toContainText('Apri una squadra dalla classifica');
});

test('hidden roster is never queried; notice boundaries and escaping remain intact; config failure hides previous roster', async ({ page, context }) => {
  await installFixture(context, { privacy: 'hidden' });
  await page.goto('/team.html?sport=37&team=124');
  await expect(page.getByRole('heading', { name: 'Classe', exact: true })).toBeVisible();
  await expect(page.locator('#team-page-content')).not.toContainText('4A');
  await expect(page.locator('#team-page-content')).not.toContainText('4B');
  await expect(page.locator('.team-roster-list')).toHaveText('Rosa non pubblica.');
  expect(await page.evaluate(() => window.__queries.filter((q) => q.table === 'players'))).toEqual([]);
  await page.evaluate(() => { window.__notices = [{ id: 22, title: '<script>test</script>', body: '<img src=x>', created_at: '2026-10-14T10:00:00Z' }]; });
  await page.locator('#team-refresh').click();
  await expect(page.locator('#team-public-notices-list')).toContainText('<script>test</script>');
  await expect(page.locator('#team-public-notices-list img, #team-public-notices-list script')).toHaveCount(0);
  await page.goto('/team.html?sport=37&team=125');
  await expect(page.locator('#team-public-notices-list')).toContainText('Nessun avviso pubblico');
  await page.evaluate(() => { window.__configError = true; });
  await page.locator('#team-refresh').click();
  await expect(page.locator('#team-page-content')).toBeHidden();
  await expect(page.locator('#team-page-status')).toContainText('Synthetic config error');
});

test('denied local storage and notice outages keep public page usable without claiming successful follow', async ({ page, context }) => {
  await installFixture(context, { denyStorage: true });
  await page.goto('/team.html?sport=37&team=124');
  await expect(page.getByRole('heading', { name: '4A', exact: true })).toBeVisible();
  await page.locator('#btn-toggle-team-favorite').click();
  await expect(page.locator('.toast')).toContainText('Preferenze locali non disponibili');
  await expect(page.locator('#btn-toggle-team-favorite')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { window.__noticeError = true; });
  await page.locator('#team-refresh').click();
  await expect(page.locator('#team-public-notices-list')).toContainText('temporaneamente non disponibili');
  await expect(page.locator('.team-roster-list')).toContainText('Studente Prova');
});

test('favorites and read updates survive an actual Chromium process restart on the same browser profile', async ({ baseURL }, testInfo) => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'itsoscup-team-follow-test-'));
  const options = { headless: true, serviceWorkers: 'block', viewport: testInfo.project.use.viewport || { width: 1280, height: 720 } };
  let browserContext;
  try {
    browserContext = await chromium.launchPersistentContext(profile, options);
    await installFixture(browserContext);
    let page = await browserContext.newPage();
    await page.goto(`${baseURL}/team.html?sport=37&team=124`);
    await follow(page);
    await page.evaluate(() => { window.__rows.matches[0].home_score = 5; });
    await page.locator('#team-refresh').click();
    await expect(page.locator('#team-follow-updates')).toContainText('1 nuovo');
    await page.locator('#team-follow-updates summary').click();
    await page.getByRole('button', { name: 'Segna tutti come letti' }).click();
    const device = await page.evaluate(() => localStorage.getItem('tornei_device_id'));
    await browserContext.close();
    browserContext = await chromium.launchPersistentContext(profile, options);
    await installFixture(browserContext);
    page = await browserContext.newPage();
    // Restore the synthetic current score before scripts load so reopening is not another change.
    await browserContext.addInitScript(() => { window.__rows.matches[0].home_score = 5; });
    await page.goto(`${baseURL}/team.html?sport=37&team=124`);
    await expect(page.locator('#btn-toggle-team-favorite')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#team-follow-updates')).toContainText('Tutti letti');
    expect(await page.evaluate(() => localStorage.getItem('tornei_device_id'))).toBe(device);
  } finally {
    await browserContext?.close();
    // Only the unique test profile created above is removed.
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
