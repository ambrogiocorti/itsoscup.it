import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function assertNotIncludes(file, fragments) {
  const content = read(file);
  fragments.forEach((fragment) => {
    assert(
      !content.includes(fragment),
      `${file} must not contain public frontend secret/password fragment: ${fragment}`
    );
  });
}

assertNotIncludes('js/app-config.js', [
  'settingsAccessPassword',
  'superAdminSettingsPassword',
  "'impostazioni'",
  "'superadmin'",
  'TELEGRAM_BOT_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
]);

const adminHtml = read('admin.html');
const adminIndexHtml = read('admin/index.html');
const matchesJs = read('js/matches.js');
assert(
  matchesJs.includes('APP_CONFIG') &&
    matchesJs.includes('requireDirectTableFallback') &&
    matchesJs.includes('allowDirectTableFallbacks'),
  'matches.js must gate direct table fallbacks behind APP_CONFIG.allowDirectTableFallbacks'
);

const supportedFormats = [
  'gironi',
  'eliminazione',
];
supportedFormats.forEach((format) => {
  assert(adminIndexHtml.includes(`value="${format}"`), `admin/index.html must expose supported format ${format}`);
});
[
  'gironi_playoff',
  'doppia_eliminazione',
  'terzo_posto',
  'italiana',
  'gironi_multipli',
  'migliori_seconde',
  'svizzero',
].forEach((format) => {
  assert(!adminIndexHtml.includes(`value="${format}"`), `admin/index.html must not expose unsupported format ${format}`);
});
assert(adminIndexHtml.includes('id="form-admin-user"'), 'admin UI must include admin user form');
assert(adminIndexHtml.includes('id="btn-print-athletics-sheets"'), 'admin UI must expose printable athletics race sheets');
assert(!adminIndexHtml.includes('id="link-admin-users"'), 'admin management must not be a sidebar section');
assert(!adminIndexHtml.includes('id="view-admin-users"'), 'admin management must live inside Superadmin settings');
assert(!adminIndexHtml.includes('id="athletics-event-select"'), 'athletics UI must not expose a global event selector');
assert(!adminIndexHtml.includes('btn-toggle-athletics-filters'), 'athletics UI must not expose a separate filter toggle');
assert(adminIndexHtml.includes('id="event-select-results"'), 'athletics result form must expose its own event selector');
assert(adminIndexHtml.includes('id="ath-heat-event"'), 'athletics heat form must expose its own event selector');
assert(adminIndexHtml.includes('class="athletics-workflow-nav"'), 'athletics modal must expose a vertical workflow nav');
assert(adminIndexHtml.includes('ITSOSCup.it'), 'admin sidebar brand must show ITSOSCup.it');
assert(adminIndexHtml.includes('id="athletics-sport-select"'), 'athletics UI must expose tournament selector');
assert(!adminIndexHtml.includes('id="btn-validate-pre-event"'), 'dashboard quick pre-event button must be removed');
assert(!adminIndexHtml.includes('id="dashboard-pre-event-panel"'), 'dashboard pre-event panel must be removed');
assert(!adminIndexHtml.includes('id="btn-export-platform-data"'), 'dashboard quick export button must be removed');
assert(!adminIndexHtml.includes('id="btn-run-tournament-simulation"'), 'dashboard quick simulation button must be removed');
assert(read('index.html').includes('id="public-notifications-btn"'), 'public home must expose notifications button');
assert(read('index.html').includes('id="public-notifications-popover"'), 'public home must expose notifications popover');
assert(adminIndexHtml.includes('id="form-public-notification"'), 'admin Telegram view must expose public notification form');
assert(adminIndexHtml.includes('id="public-notifications-admin-list"'), 'admin Telegram view must list public notifications');
assert(adminIndexHtml.includes('class="admin-page auth-pending"'), 'admin page must start hidden until auth passes');
assert(adminIndexHtml.includes('class="admin-auth-guard"'), 'admin page must show only an auth guard before authorization');
assert(adminIndexHtml.includes('id="admin-auth-status"'), 'admin auth guard must expose diagnostic status text');
assert(adminIndexHtml.includes("import('./js/main-admin.js"), 'admin module must be loaded through diagnostic bootstrap import');
assert(adminIndexHtml.includes('css/admin-modules.css'), 'admin UI must load split admin module CSS');
assert(!adminIndexHtml.includes('UUID'), 'admin UI must not ask users to paste Auth UUIDs');

const supabaseConfig = read('supabase/config.toml');
assert(supabaseConfig.includes('[functions.manage-admin-user]'), 'Supabase config must expose manage-admin-user');
assert(read('js/admin-system.js').includes("'030'"), 'migration verification must require migration 030');
assert(read('js/admin-system.js').includes("'031'"), 'migration verification must require migration 031');
assert(read('js/admin-system.js').includes("'032'"), 'migration verification must require migration 032');
assert(read('js/admin-system.js').includes("'033'"), 'migration verification must require migration 033');
assert(read('js/admin-system.js').includes("'034'"), 'migration verification must require migration 034');
assert(read('js/admin-system.js').includes("'035'"), 'migration verification must require migration 035');
assert(read('js/admin-system.js').includes("'037'"), 'migration verification must require migration 037');
assert(read('js/admin-system.js').includes("'038'"), 'migration verification must require migration 038');
assert(read('js/matches.js').includes('create_issue_report'), 'public issue reports must use the create_issue_report RPC');
assert(read('js/platform-ops.js').includes('list_issue_reports'), 'admin issue reports must use the list_issue_reports RPC');
assert(!read('js/auth.js').includes('Caricamento profilo admin per email'), 'auth must not resolve admin profiles by email');
assert(read('js/auth.js').includes('Accesso negato: il tuo UUID Auth'), 'login must reject non-admin UUIDs before opening admin');
assert(read('js/main-admin.js').includes("document.body.classList.remove('auth-pending')"), 'admin UI must reveal only after requireAdmin passes');
assert(read('js/main-admin.js').includes('withTimeout'), 'admin auth check must not hang indefinitely');
assert(!read('js/app-config.js').includes("REGIA: 'regia'"), 'app config must not define the Regia role');
assert(read('js/auth.js').includes('canAccessControlCenter'), 'auth helpers must expose Super Admin control center checks');
assert(adminIndexHtml.includes('data-view="operations"'), 'admin sidebar must expose Centro Operativo');
assert(adminIndexHtml.includes('id="view-operations"'), 'admin UI must include Centro Operativo view');
assert(adminIndexHtml.includes('id="regia-action-queue-panel"'), 'Centro Operativo must include Regia action queue');
assert(!adminIndexHtml.includes('id="regia-automation-panel"'), 'Centro Operativo must not include automation panel');
assert(!adminIndexHtml.includes('Automazioni operative'), 'Centro Operativo must not show the automation panel title');
assert(adminIndexHtml.includes('id="regia-mode-badge"'), 'Centro Operativo must show event mode');
assert(adminIndexHtml.includes('id="regia-last-refresh"'), 'Centro Operativo must show last refresh time');
assert(adminIndexHtml.includes('id="select-match-device"'), 'match modal must allow Super Admin to assign a device');
assert(adminIndexHtml.includes('id="public-notification-expires"'), 'public notifications must support expiration date');
assert(!adminIndexHtml.includes('value="regia"'), 'admin user form must not expose Regia role');
assert(read('js/platform-ops.js').includes('loadRegiaOperationalSnapshot'), 'platform ops must load Regia operational snapshot');
assert(read('js/platform-ops.js').includes('assignMatchDevice'), 'platform ops must expose match-device assignment');
assert(!read('js/platform-ops.js').includes('resumeEmergencyRegia'), 'platform ops must not expose emergency resume in the UI layer');
assert(!read('js/platform-ops.js').includes('suspendAllMatchesRegia'), 'platform ops must not expose global emergency suspension in the UI layer');
assert(!read('js/platform-ops.js').includes('loadGlobalAuditLog'), 'global activity log must remain database-only');
assert(!read('js/main-admin.js').includes('loadMatches()'), 'Regia delay recovery must reload matches through the existing loadMatchesTable function');
assert(read('js/main-index.js').includes('getMatchIdFromQuery'), 'public home must support direct match QR routes');
assert(read('sql/034_regia_permissions_patch.sql').includes("get_event_statistics"), 'migration 034 must patch event statistics permissions for Regia');
assert(read('sql/035_auto_shift_after_late_finish.sql').includes('apply_late_finish_autoshift'), 'migration 035 must auto-shift matches after a late finish');
assert(read('sql/037_regia_live_permissions.sql').includes("'regia', 'super_admin', 'match_manager'"), 'migration 037 must allow Regia to manage live matches');
assert(read('sql/038_disable_regia_emergency_controls.sql').includes('revoke execute on function public.suspend_all_matches_regia'), 'migration 038 must revoke emergency suspension');
assert(read('js/admin-system.js').includes("'039'"), 'migration verification must require migration 039');
assert(read('sql/039_remove_regia_role.sql').includes("where ruolo = 'regia'"), 'migration 039 must migrate Regia admins');
assert(!adminIndexHtml.includes('btn-regia-delay-recovery'), 'Centro Operativo must not expose manual delay recovery button');
assert(!adminIndexHtml.includes('btn-regia-emergency'), 'Centro Operativo must not expose emergency button');
assert(!adminIndexHtml.includes('btn-regia-resume-emergency'), 'Centro Operativo must not expose emergency resume button');
assert(!adminIndexHtml.includes('regia-audit-panel'), 'global activity log must not be visible in the platform');
assert(!adminIndexHtml.includes('Registro attivita globale'), 'global activity log title must not be visible in the platform');
assert(!read('js/main-admin.js').includes('Da monitorare'), 'Centro Operativo must not show the Da monitorare badge');
assert(adminIndexHtml.includes('Ritardi e slittamenti automatici'), 'Centro Operativo must explain automatic delay handling');
assert(!read('supabase/functions/manage-admin-user/index.ts').includes('email=eq.'), 'admin Edge Function must authorize callers by UUID only');
assert(!read('sql/024_platform_professional_completion.sql').includes('grant usage, select on sequences'), 'migration 024 must use valid GRANT ON SEQUENCE syntax');

const adminFunction = read('supabase/functions/manage-admin-user/index.ts');
assert(adminFunction.includes('SUPABASE_SERVICE_ROLE_KEY'), 'admin Edge Function must use service role server-side');
assert(!adminFunction.includes("'regia'"), 'admin Edge Function must not support Regia role');
assert(!adminFunction.includes('countRegiaAdmins'), 'admin Edge Function must not protect removed Regia accounts');
assert(adminFunction.includes("caller.ruolo !== 'super_admin'"), 'admin Edge Function must require Super Admin callers');
assert(!read('js/admin-users.js').includes('SUPABASE_SERVICE_ROLE_KEY'), 'frontend admin user module must not contain service role key');
assert(!read('js/admin-users-panel.js').includes('SUPABASE_SERVICE_ROLE_KEY'), 'frontend admin user panel must not contain service role key');

assert(existsSync(join(root, 'manifest.webmanifest')), 'manifest.webmanifest is required');
assert(existsSync(join(root, '.github/workflows/ci.yml')), 'GitHub CI workflow is required');
const manifest = JSON.parse(read('manifest.webmanifest'));
assert.equal(manifest.display, 'standalone', 'manifest display must be standalone');
assert.equal(manifest.start_url, '/', 'manifest start_url must be /');
assert.equal(manifest.scope, '/', 'manifest scope must be /');
assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest must define at least one icon');

['index.html', 'admin/index.html', 'live.html', 'gym.html'].forEach((file) => {
  const content = read(file);
  assert(content.includes('rel="manifest"'), `${file} must link manifest.webmanifest`);
  assert(content.includes('name="theme-color"'), `${file} must define theme-color`);
  assert(content.includes('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'), `${file} must load Supabase SDK from CDN`);
  assert(content.includes('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'), `${file} must load Font Awesome from CDN`);
  assert(!content.includes('vendor/supabase'), `${file} must not load Supabase from vendor`);
  assert(!content.includes('vendor/fontawesome'), `${file} must not load Font Awesome from vendor`);
  assert(!content.includes('fonts.googleapis.com'), `${file} must not depend on Google Fonts`);
});

['admin.html', 'admin/admin.html'].forEach((file) => {
  const content = read(file);
  assert(content.includes('/admin/'), `${file} must redirect to canonical /admin/ route`);
  assert(!content.includes('cdn.jsdelivr.net'), `${file} must not depend on jsDelivr`);
  assert(!content.includes('fonts.googleapis.com'), `${file} must not depend on Google Fonts`);
});

const sw = read('sw.js');
assert(sw.includes('./manifest.webmanifest'), 'service worker must cache manifest.webmanifest');
assert(!sw.includes('vendor/supabase'), 'service worker must not cache missing local Supabase SDK');
assert(!sw.includes('vendor/fontawesome'), 'service worker must not cache missing local Font Awesome');
assert(!sw.includes('./https://'), 'service worker must not turn CDN URLs into local paths');
assert(sw.includes('tornei-scuola-offline-v51'), 'service worker cache version must be bumped after admin module import cache busting');
assert(read('js/main-admin.js').includes("from './platform-ops.js?v=51'"), 'admin must cache-bust platform ops module imports');
assert(read('js/main-index.js').includes("from './platform-ops.js?v=51'"), 'public page must cache-bust platform ops module imports');
assert(read('js/main-live.js').includes("from './platform-ops.js?v=51'"), 'live page must cache-bust platform ops module imports');
assert(sw.includes('./css/admin-modules.css'), 'service worker must cache admin module CSS');
assert(sw.includes('./js/offline-db.js'), 'service worker must cache IndexedDB offline module');
assert(sw.includes('./js/admin-system.js'), 'service worker must cache system module');
assert(sw.includes('./js/admin-users.js'), 'service worker must cache admin users module');
assert(sw.includes('./js/admin-users-panel.js'), 'service worker must cache admin users panel module');
assert(sw.includes('CACHE_NAME'), 'service worker must declare a cache name');
const appShellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
assert(appShellMatch, 'service worker must declare APP_SHELL');
const appShellAssets = [...appShellMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
appShellAssets.forEach((asset) => {
  const normalized = asset.replace(/^\.\//, '').split('?')[0];
  const target = normalized || '.';
  assert(existsSync(join(root, target)), `APP_SHELL asset does not exist: ${asset}`);
});

const css = read('css/style.css');
assert(
  css.includes('.admin-shell') && css.includes('height: auto !important') && css.includes('#view-reports'),
  'print CSS must allow the report view to span multiple pages'
);
assert(
  css.includes('.regia-hero') &&
    css.includes('.regia-device-table') &&
    css.includes('.regia-action-queue') &&
    css.includes('.regia-status-chip'),
  'CSS must include Centro Operativo styles'
);

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  },
};

const {
  countCachedMatches,
  getOfflineManifest,
  loadLiveMatchCache,
  saveLiveMatchCache,
} = await import('../js/offline-store.js');

assert.equal(countCachedMatches(), 0, 'offline cache must start empty in the test environment');
assert.equal(
  saveLiveMatchCache(
    77,
    {
      match: {
        id: 77,
        home: { name: '3A' },
        away: { name: '3B' },
        sport: { name: 'Calcio M' },
        scheduled_start: '2026-08-15T10:00:00+02:00',
      },
      config: { points_win: 3 },
      homePlayers: [{ id: 1, full_name: 'Mario Rossi' }],
      awayPlayers: [{ id: 2, full_name: 'Luca Bianchi' }],
    },
    { stats: [{ player_id: 1, fouls: 1 }], source: 'test' }
  ),
  true,
  'saveLiveMatchCache must write a prepared match'
);
assert.equal(countCachedMatches(), 1, 'offline manifest must count prepared matches');
assert.equal(loadLiveMatchCache(77).match_id, 77, 'offline cache must reload prepared match');
assert.equal(getOfflineManifest().matches['77'].label, '3A vs 3B', 'offline manifest must store readable label');

const { computeStandings } = await import('../js/matches.js');

const teams = [
  { id: 1, name: '3A' },
  { id: 2, name: '3B' },
  { id: 3, name: '3C' },
];

const headToHeadRows = computeStandings(
  teams.slice(0, 2),
  [
    { is_finished: true, home_team_id: 1, away_team_id: 2, home_score: 2, away_score: 0 },
    { is_finished: true, home_team_id: 2, away_team_id: 1, home_score: 1, away_score: 0 },
  ],
  { points_win: 3, points_draw: 1, points_loss: 0, ranking_tiebreakers: ['points', 'head_to_head', 'draw'] }
);
assert.equal(headToHeadRows[0].id, 1, 'head-to-head goal difference must break tied points');

const goalDiffRows = computeStandings(
  teams,
  [
    { is_finished: true, home_team_id: 1, away_team_id: 3, home_score: 3, away_score: 0 },
    { is_finished: true, home_team_id: 2, away_team_id: 3, home_score: 1, away_score: 0 },
  ],
  { points_win: 3, points_draw: 1, points_loss: 0, ranking_tiebreakers: ['points', 'goal_diff', 'draw'] }
);
assert.equal(goalDiffRows[0].id, 1, 'goal difference must break tied points');

const fairPlayRows = computeStandings(
  teams.slice(0, 2),
  [
    {
      is_finished: true,
      home_team_id: 1,
      away_team_id: 2,
      home_score: 0,
      away_score: 0,
      live_payload: {
        stats_snapshot: [
          { team_id: 1, fouls: 2, yellow_cards: 1, red_cards: 0 },
          { team_id: 2, fouls: 0, yellow_cards: 0, red_cards: 0 },
        ],
      },
    },
  ],
  { points_win: 3, points_draw: 1, points_loss: 0, ranking_tiebreakers: ['points', 'fair_play', 'draw'] }
);
assert.equal(fairPlayRows[0].id, 2, 'fair play must prefer the team with fewer penalties');

console.log('Static, offline cache and standings checks passed.');
