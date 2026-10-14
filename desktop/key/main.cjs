'use strict';
const { app, BrowserWindow, ipcMain, protocol, session, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { Vault } = require('./vault.cjs');
const { Engine } = require('./engine.cjs');
const { LIMIT, VAULT_LIMIT, encryptPackage, decryptPackage } = require('./crypto.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'key', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
for (const switchName of ['disable-background-networking', 'disable-component-update', 'disable-sync', 'disable-breakpad', 'disable-crash-reporter', 'disable-gpu-shader-disk-cache']) app.commandLine.appendSwitch(switchName);
app.commandLine.appendSwitch('disk-cache-size', '0');
const rootDirectory = !app.isPackaged && process.env.ITSOSCUP_KEY_DATA_DIR
  ? path.resolve(process.env.ITSOSCUP_KEY_DATA_DIR)
  : path.join(process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname), 'ITSOSCup-Key-data');
// Chromium's profile contains no persistent session and is distinct from the vault.
// All student data is kept in the main process encrypted archive and renderer RAM.
const runtimeDirectory = path.join(os.tmpdir(), 'itsoscup-key-runtime-' + createHash('sha256').update(rootDirectory.toLowerCase()).digest('hex').slice(0, 24));
app.setPath('userData', runtimeDirectory); app.setPath('crashDumps', path.join(runtimeDirectory, 'crash-disabled'));
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
const vault = new Vault(rootDirectory), engine = new Engine(vault);
let window, checkpoint, closeAllowed = false, commandRunning = false, pendingExport = null;
const commands = new Set(['status', 'unlock', 'restoreBackup', 'lock', 'setupSupervisor', 'login', 'logout', 'view', 'change', 'prepareSignatures', 'sign', 'finalize', 'reopen', 'addOperator', 'importPackage', 'exportResults', 'backup', 'retry', 'print']);
const contentSecurityPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
function lockedStatus() { return { unlocked: false, exists: vault.exists(), directory: rootDirectory, dirty: false }; }
function hasPending() { return vault.dirty || pendingExport !== null; }
function writePendingExport() {
  if (!pendingExport) return;
  vault.assertVolume(); const folder = path.join(rootDirectory, 'exchange');
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
  vault.assertVolume(); vault.atomicFile(pendingExport.filename, pendingExport.ciphertext, false);
  pendingExport = null;
}
function isTrusted(event) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame.url === 'key://app/index.html';
}
async function command(name, args) {
  if (name === 'status') return vault.db ? engine.view() : lockedStatus();
  if (name === 'unlock') {
    await vault.unlock(args.password, { create: args.create === true, recover: args.recover === true });
    engine.recoverTimers(); return engine.view();
  }
  if (name === 'restoreBackup') {
    if (vault.db || vault.exists()) throw new Error('Il recupero esterno richiede una nuova chiavetta senza archivio. Nessun dato esistente verrà sostituito');
    const selection = await dialog.showOpenDialog(window, { title: 'Recupera archivio da backup cifrato', properties: ['openFile'], filters: [{ name: 'Backup ITSOSCup Key', extensions: ['keyvault'] }] });
    if (selection.canceled) return { canceled: true };
    if (fs.statSync(selection.filePaths[0]).size > VAULT_LIMIT * 2.1) throw new Error('Backup troppo grande');
    const confirmation = await dialog.showMessageBox(window, { type: 'question', title: 'Recupera su nuova chiavetta', message: 'Confermi il ripristino del backup selezionato in questa nuova chiavetta? Dopo il recupero verifica gli ultimi eventi e riprepara le partite se il centro ha già importato risultati più recenti.', buttons: ['Annulla', 'Recupera backup'], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) return { canceled: true };
    await vault.restoreBackup(fs.readFileSync(selection.filePaths[0], 'utf8'), args.password);
    engine.recoverTimers(); return engine.view();
  }
  if (!vault.db) throw new Error('Sbloccare l’archivio con la password della chiavetta');
  if (name === 'lock') { if (hasPending()) throw new Error('Salvataggio o esportazione in sospeso: reinserire la chiavetta e riprovare'); vault.lock(); engine.user = null; return lockedStatus(); }
  if (name === 'retry') { if (vault.dirty) vault.persist(); writePendingExport(); return engine.view(args.match_id || null); }
  if (name === 'view') return engine.view(args.match_id || null);
  if (hasPending() && !['logout', 'status'].includes(name)) throw new Error('Salvataggio in sospeso: reinserire la stessa chiavetta e riprovare');
  if (name === 'importPackage') {
    engine.supervisor();
    const selection = await dialog.showOpenDialog(window, { title: 'Importa preparazione o ricevuta cifrata', properties: ['openFile'], filters: [{ name: 'Pacchetto ITSOSCup', extensions: ['json', 'keypack'] }] });
    if (selection.canceled) return { canceled: true };
    const file = selection.filePaths[0];
    if (fs.statSync(file).size > LIMIT * 2.1) throw new Error('File troppo grande');
    const payload = decryptPackage(fs.readFileSync(file, 'utf8'), args.password);
    if (payload.kind === 'prepared') return engine.importPrepared(payload);
    if (payload.kind === 'receipt') return engine.importReceipt(payload);
    throw new Error('Qui è possibile importare soltanto preparazioni e ricevute');
  }
  if (name === 'exportResults') {
    const payload = engine.results(args.preparation_id, { reexport: args.reexport === true }), ciphertext = encryptPackage(payload, args.password);
    const destination = path.join(rootDirectory, 'exchange', 'results-' + payload.package_id + '.keypack');
    // Persist the export intent FIRST. A transferable file can never exist without
    // its immutable operation and package identity already durable in the vault.
    const view = engine.markExported(payload);
    pendingExport = { filename: destination, ciphertext };
    writePendingExport();
    return { view, filename: destination, operations: payload.operations.length, remaining_operations: payload.remaining_operations };
  }
  if (name === 'backup') {
    engine.supervisor();
    const selection = await dialog.showSaveDialog(window, { title: 'Salva backup cifrato', defaultPath: 'ITSOSCup-Key-backup-' + new Date().toISOString().slice(0, 10) + '.keyvault', filters: [{ name: 'Archivio cifrato', extensions: ['keyvault'] }] });
    if (selection.canceled) return { canceled: true };
    vault.backup(selection.filePath); return { filename: selection.filePath };
  }
  if (name === 'print') {
    engine.find(args.match_id); if (vault.dirty) throw new Error('Salvare prima il referto');
    window.webContents.print({ silent: false, printBackground: true }); return { requested: true };
  }
  if (typeof engine[name] !== 'function' || !commands.has(name)) throw new Error('Operazione non consentita');
  return engine[name](args);
}
ipcMain.handle('itsoscup-key:command', async (event, name, args) => {
  if (!isTrusted(event) || !commands.has(name) || !args || typeof args !== 'object' || Array.isArray(args)
      || JSON.stringify(args).length > 350000) return { ok: false, error: 'Richiesta non autorizzata' };
  if (commandRunning) return { ok: false, error: 'Attendere il completamento dell’operazione in corso' };
  commandRunning = true;
  try {
    const value = await command(name, args), view = value?.view || value;
    if (view?.unlocked) view.dirty = hasPending();
    return { ok: true, value };
  }
  catch (error) { return { ok: false, error: error.message, dirty: hasPending() }; }
  finally { commandRunning = false; }
});
async function start() {
  const ses = session.fromPartition('itsoscup-key-' + randomUUID(), { cache: false });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('key://app/') && !details.url.startsWith('data:image/') }));
  ses.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy] } }));
  // Network is denied in the default session as well, including unexpected pages.
  session.defaultSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
  const resources = new Map([
    ['/index.html', [path.join(__dirname, 'renderer/index.html'), 'text/html; charset=utf-8']],
    ['/app.js', [path.join(__dirname, 'renderer/app.js'), 'text/javascript; charset=utf-8']],
    ['/key.css', [path.join(__dirname, 'renderer/key.css'), 'text/css; charset=utf-8']],
    ['/style.css', [app.isPackaged ? path.join(process.resourcesPath, 'site-style.css') : path.resolve(__dirname, '../../css/style.css'), 'text/css; charset=utf-8']],
    ['/favicon.svg', [app.isPackaged ? path.join(process.resourcesPath, 'favicon.svg') : path.resolve(__dirname, '../../favicon.svg'), 'image/svg+xml']]
  ]);
  ses.protocol.handle('key', request => {
    const url = new URL(request.url), resource = url.host === 'app' && resources.get(url.pathname);
    if (!resource || request.method !== 'GET') return new Response('Accesso negato', { status: 403 });
    return new Response(fs.readFileSync(resource[0]), { headers: { 'Content-Type': resource[1], 'Content-Security-Policy': contentSecurityPolicy, 'Cache-Control': 'no-store' } });
  });
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1280, height: 900, minWidth: 760, minHeight: 600, title: 'ITSOSCup Key', show: false,
    webPreferences: { session: ses, preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', async event => {
    if (closeAllowed || !vault.db) return;
    event.preventDefault();
    if (hasPending()) {
      await dialog.showMessageBox(window, { type: 'error', title: 'Chiavetta da reinserire', message: 'Ci sono dati ancora in memoria. Reinserire la stessa chiavetta e premere Riprova salvataggio prima di chiudere.' }); return;
    }
    try { engine.checkpoint(); } catch (error) { await dialog.showMessageBox(window, { type: 'error', title: 'Salvataggio da completare', message: error.message }); return; }
    if (vault.dirty) return;
    vault.lock(); closeAllowed = true; window.close();
  });
  await window.loadURL('key://app/index.html');
  // The packaged diagnostic accepts no output path and never unlocks an archive.
  // Its only output is a self-check file beside the launcher, for USB preparation.
  const selfCheck = process.argv.includes('--key-self-check');
  const launcherDirectory = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  const smokeOutput = selfCheck ? path.join(launcherDirectory, 'ITSOSCup-Key-self-check.json')
    : !app.isPackaged && process.argv.includes('--key-smoke') ? process.argv[process.argv.indexOf('--key-smoke') + 1] : null;
  if (smokeOutput) {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => ({
        title: document.title, loaded: Boolean(document.getElementById('unlock-form')),
        nodeAvailable: typeof require !== 'undefined' || typeof process !== 'undefined',
        trustedBridge: typeof window.itsoscupKey?.call === 'function',
        background: getComputedStyle(document.body).backgroundColor,
        externalDenied: await fetch('https://example.com').then(() => false, () => true),
        localhostDenied: await fetch('http://127.0.0.1:54321').then(() => false, () => true),
        filesystemDenied: await fetch('file:///C:/Windows/win.ini').then(() => false, () => true),
        arbitraryBridgeDenied: await window.itsoscupKey.call('readFile', {}).then(() => false, () => true),
        status: await window.itsoscupKey.call('status')
      }))()`);
      result.sandbox = window.webContents.getLastWebPreferences().sandbox; result.contextIsolation = window.webContents.getLastWebPreferences().contextIsolation;
      result.packaged = app.isPackaged; result.version = app.getVersion();
      fs.writeFileSync(smokeOutput, JSON.stringify(result, null, 2)); closeAllowed = true; app.quit();
    } catch (error) { fs.writeFileSync(smokeOutput, JSON.stringify({ error: error.message })); closeAllowed = true; app.exit(1); }
  } else window.show();
  checkpoint = setInterval(() => {
    if (vault.db && !commandRunning && !hasPending()) { try { engine.checkpoint(); } catch { /* Renderer polls dirty status and exposes retry. */ } }
  }, 5000);
}
if (singleInstance) app.whenReady().then(start).catch(error => { dialog.showErrorBox('ITSOSCup Key', error.message); app.exit(1); });
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('window-all-closed', () => { clearInterval(checkpoint); app.quit(); });
app.on('before-quit', event => { if (vault.db && hasPending()) event.preventDefault(); });
