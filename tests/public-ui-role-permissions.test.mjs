import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowedAdminViews, canAccessAdminView, defaultAdminView } from '../js/admin-role-views.js';

const adminHtml = readFileSync(new URL('../admin/index.html', import.meta.url),'utf8');
const adminJs = readFileSync(new URL('../js/main-admin.js', import.meta.url),'utf8');
const homeHtml = readFileSync(new URL('../index.html', import.meta.url),'utf8');
const homeJs = readFileSync(new URL('../js/main-index.js', import.meta.url),'utf8');
const teamJs = readFileSync(new URL('../js/team-follow-ui.js', import.meta.url),'utf8');

test('super admin keeps every dashboard section', () => {
  const expected = ['dashboard','operations','reports','matches','venues','archive','telegram','sports','teams','events','settings'];
  assert.deepEqual(allowedAdminViews('super_admin'), expected);
  assert.equal(defaultAdminView('super_admin'), 'dashboard');
});

test('match manager has calendar only, including direct URL navigation', () => {
  assert.deepEqual(allowedAdminViews('match_manager'), ['matches']);
  assert.equal(defaultAdminView('match_manager'), 'matches');
  for (const view of ['dashboard','venues','archive','telegram','reports','operations','sports','teams','events','settings']) {
    assert.equal(canAccessAdminView('match_manager',view), false, view);
  }
});

test('report viewer has only reports, including direct URL navigation', () => {
  assert.deepEqual(allowedAdminViews('report_viewer'), ['reports']);
  assert.equal(defaultAdminView('report_viewer'), 'reports');
  for(const view of ['dashboard','matches','venues','archive','telegram','operations','sports','teams','events','settings']) {
    assert.equal(canAccessAdminView('report_viewer',view), false, view);
  }
  assert.deepEqual(allowedAdminViews('unknown_role'), []);
});

test('real SPA checks permissions, hides entire menu items and falls back to allowed page', () => {
  assert.match(adminJs, /canAccessAdminView\(state\.admin\?\.ruolo, viewId\)/);
  assert.match(adminJs, /viewId = getDefaultAdminView\(\)/);
  assert.match(adminJs, /button\.closest\('li'\)\?\.classList\.toggle\('hidden', !permitted\)/);
  assert.match(adminJs, /button\.disabled = !permitted/);
  for(const id of ['link-dashboard','link-venues','link-archive','link-telegram','link-reports','link-matches']) assert.ok(adminHtml.includes('id="' + id + '"'),id);
});

test('public star opens a standalone followed-teams popup and no choose-tournament empty state', () => {
  assert.match(homeHtml, /id="my-teams-toggle"[^>]*aria-controls="my-teams-popover"/);
  assert.match(homeHtml, /id="my-teams-popover"[^>]*role="dialog"/);
  assert.ok(homeHtml.indexOf('id="my-teams-popover"') < homeHtml.indexOf('<main class="container">'));
  assert.ok(!teamJs.includes('<a href="#sport-select">Scegli un torneo</a>'));
  assert.match(homeJs, /bindMyTeamsPopover\(myTeams\)/);
});

test('notifications support individual read and persistent mark-all-as-read', () => {
  assert.match(homeHtml, /id="public-notifications-clear"/);
  assert.match(homeJs, /data-public-notification-read/);
  assert.match(homeJs, /PUBLIC_READ_NOTIFICATIONS_KEY/);
  assert.match(homeJs, /window\.localStorage\.setItem\(PUBLIC_READ_NOTIFICATIONS_KEY/);
  assert.match(homeJs, /rememberReadNotifications\(latestPublicAnnouncements\)/);
});
