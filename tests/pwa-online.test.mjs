import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('one PWA manifest with public, admin and scorekeeper routes', () => {
  const manifest = JSON.parse(source('manifest.webmanifest'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  assert.ok(manifest.shortcuts.some(item => item.url === '/admin/'));
  assert.ok(manifest.shortcuts.some(item => item.url === '/admin/?view=matches'));
});

test('install command uses the same site and authenticated views', () => {
  const publicHtml = source('index.html');
  const adminHtml = source('admin/index.html');
  for (const html of [publicHtml, adminHtml]) {
    assert.doesNotMatch(html, /data-install-pwa/);
    assert.match(html, /js\/pwa-install\.js/);
    assert.match(html, /manifest\.webmanifest/);
  }
  assert.ok(source('js/pwa-install.js').includes('pwa-first-visit'));
  assert.ok(source('js/pwa-install.js').includes('itsoscup_pwa_install_seen_v2'));
  assert.ok(source('js/pwa-install.js').includes('beforeinstallprompt'));
  assert.ok(source('js/pwa-install.js').includes('appinstalled'));
  assert.ok(!adminHtml.includes('href="./offline-workspace.html"'), 'No offline stations in main control center navigation');
  assert.ok(source('js/main-admin.js').includes("canEditMatches(state.admin?.ruolo)"), 'Existing online role-based permissions stay active');
  assert.ok(source('js/main-live.js').includes('requireAdmin'), 'Live match remains behind the existing account');
});

function harness(networkWorks) {
  const callbacks = {};
  const removed = [];
  let calls = 0;
  const scope = {
    self: {
      location: { origin: 'https://itsoscup.it' },
      addEventListener(name, handler) { callbacks[name] = handler; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      keys: async () => ['tornei-scuola-offline-v64', 'other-app-cache'],
      delete: async (key) => { removed.push(key); return true; },
    },
    URL, Response,
    fetch: async () => {
      calls++;
      if (!networkWorks) throw new Error('Network down');
      return new Response('Online', { status: 200 });
    },
  };
  vm.runInNewContext(source('sw.js'), scope);
  return { callbacks, removed, calls: () => calls };
}
test('PWA activation removes old offline caches but not unrelated caches', async () => {
  const h = harness(true);
  let work;
  h.callbacks.activate({ waitUntil(value) { work = value; } });
  await work;
  assert.deepEqual(h.removed, ['tornei-scuola-offline-v64']);
});
test('PWA navigations use server, never old cached pages', async () => {
  const h = harness(true);
  let result;
  h.callbacks.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://itsoscup.it/admin/' },
    respondWith(value) { result = value; },
  });
  const res = await result;
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'Online');
  assert.equal(h.calls(), 1);
});
test('PWA does not pretend to save matches when internet is unavailable', async () => {
  const h = harness(false);
  let result;
  h.callbacks.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://itsoscup.it/live.html?match=5' },
    respondWith(value) { result = value; },
  });
  const res = await result;
  assert.equal(res.status, 503);
  assert.match(await res.text(), /Connessione Internet necessaria/);
});
test('non-navigation assets are not intercepted or cached', () => {
  const h = harness(true);
  let called = false;
  h.callbacks.fetch({
    request: { method: 'GET', mode: 'no-cors', url: 'https://itsoscup.it/css/style.css' },
    respondWith() { called = true; },
  });
  assert.equal(called, false);
});
