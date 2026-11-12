'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { Vault } = require('./vault.cjs');
const { Engine } = require('./engine.cjs');
const { LIMIT, VAULT_LIMIT, encryptPackage, decryptPackage } = require('./crypto.cjs');
const { PlatformApi } = require('./platform-api.cjs');
const { loadResources, canonicalResource, isPlatformPage, platformPolicy } = require('./platform-resources.cjs');
protocol.registerSchemesAsPrivileged(['key', 'platform', 'shell'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } })));
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
const centralDirectory = !app.isPackaged && process.env.ITSOSCUP_PLATFORM_DATA_DIR ? path.resolve(process.env.ITSOSCUP_PLATFORM_DATA_DIR) : path.join(path.dirname(rootDirectory), 'ITSOSCup-Platform-data');
const platformApi = new PlatformApi({ directory: centralDirectory });
let window, keyView, platformView, activeSection = 'platform', checkpoint, closeAllowed = false, commandRunning = false, pendingExport = null, platformQueue = Promise.resolve(), centralUnlocked = false, platformResources;
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
  return keyView && event.sender === keyView.webContents && event.senderFrame === keyView.webContents.mainFrame
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
    keyView.webContents.print({ silent: false, printBackground: true }); return { requested: true };
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
function trustedPlatform(event) {
  return platformView && event.sender === platformView.webContents && event.senderFrame === platformView.webContents.mainFrame && isPlatformPage(event.senderFrame.url, platformResources);
}
function trustedShell(event) { return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === 'shell://app/index.html'; }
ipcMain.handle('itsoscup-platform:api', (event, request) => {
  if (!trustedPlatform(event) || !request || typeof request !== 'object' || Array.isArray(request) || JSON.stringify(request).length > 18000000) return { data: null, error: { message: 'Richiesta locale non autorizzata' } };
  const action = platformQueue.then(async () => {
    try {
      let result;
      if (request.type === 'backupFile') {
        result = await platformApi.call({ type: 'backup' });
        if (result.error) return result;
        const choice = await dialog.showSaveDialog(window, { title: 'Salva backup centrale cifrato', defaultPath: 'ITSOSCup-Platform-backup-' + new Date().toISOString().slice(0,10) + '.keyvault', filters: [{ name: 'Archivio centrale cifrato', extensions: ['keyvault'] }] });
        if (choice.canceled) return { data: { canceled: true }, error: null };
        platformApi.vault.backup(choice.filePath); return { data: { filename: choice.filePath }, error: null };
      }
      if (request.type === 'restoreFile') {
        const status = await platformApi.call({ type: 'status' });
        if (status.data?.exists || status.data?.unlocked) return { data: null, error: { message: 'Il recupero richiede una nuova chiavetta senza archivio centrale' } };
        const choice = await dialog.showOpenDialog(window, { title: 'Recupera archivio centrale cifrato', properties: ['openFile'], filters: [{ name: 'Archivio centrale cifrato', extensions: ['keyvault'] }] });
        if (choice.canceled) return { data: { canceled: true }, error: null };
        if (fs.statSync(choice.filePaths[0]).size > VAULT_LIMIT * 2.1) return { data: null, error: { message: 'Backup troppo grande' } };
        result = await platformApi.call({ type: 'restore', encrypted: fs.readFileSync(choice.filePaths[0], 'utf8'), password: request.password });
        if (!result.error) centralUnlocked = true;
      } else result = await platformApi.call(request);
      centralUnlocked = Boolean(platformApi.vault.db);
      window.webContents.send('itsoscup-platform:pending', { dirty: platformApi.vault.dirty, message: result.error?.message || '' });
      if (!result.error && request.type === 'lock') { centralUnlocked = false; await platformView.webContents.session.clearStorageData(); }
      if (!result.error && (request.type === 'query' && request.calls?.some(call => ['insert','update','upsert','delete'].includes(call.method)) || ['rpc', 'function'].includes(request.type) && !/^(get_|list_|public_|validate_|log_|register_device|generate_internal_notifications)/.test(request.name || ''))) platformView.webContents.send('itsoscup-platform:changed', { table: request.table || null });
      return result;
    } catch (error) { window.webContents.send('itsoscup-platform:pending', { dirty: platformApi.vault.dirty, message: error.message }); return { data: null, error: { message: error.message } }; }
  });
  platformQueue = action.then(() => {}, () => {}); return action;
});
function resizeViews() { if (window) { const [width, height] = window.getContentSize(); for (const view of [keyView, platformView]) view?.setBounds({ x: 0, y: 68, width, height: Math.max(0, height - 68) }); } }
function showSection(section) {
  const current = activeSection === 'key' ? keyView : platformView, next = section === 'key' ? keyView : platformView;
  if (current !== next) { window.contentView.removeChildView(current); window.contentView.addChildView(next); }
  activeSection = section; resizeViews(); window.webContents.send('itsoscup-platform:section', section); next.webContents.focus();
}
ipcMain.handle('itsoscup-platform:open', async (event, section) => {
  if (!trustedShell(event) || !['home', 'platform', 'key', 'archive'].includes(section)) return false;
  if (section === 'key') { showSection('key'); return true; }
  const wasKey = activeSection === 'key';
  showSection('platform');
  if (section === 'archive') await platformView.webContents.loadURL('platform://app/desktop-home.html');
  else if (section === 'home') await platformView.webContents.loadURL(centralUnlocked ? 'platform://app/index.html' : 'platform://app/desktop-home.html');
  else if (!wasKey || new URL(platformView.webContents.getURL()).pathname === '/desktop-home.html') {
    await platformView.webContents.loadURL(centralUnlocked ? 'platform://app/admin/' : 'platform://app/desktop-home.html');
  }
  return true;
});
ipcMain.handle('itsoscup-platform:key-open', event => { if (!trustedPlatform(event) || new URL(event.senderFrame.url).pathname !== '/desktop-home.html') return false; showSection('key'); return true; });
ipcMain.handle('itsoscup-platform:retry', event => {
  if (!trustedShell(event)) return false;
  const action = platformQueue.then(async () => { const result = await platformApi.call({ type: 'persist' }); window.webContents.send('itsoscup-platform:pending', { dirty: platformApi.vault.dirty, message: result.error?.message || '' }); return result; });
  platformQueue = action.then(() => {}, () => {}); return action;
});
function denyPermissions(ses) {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}
function denyNavigation(contents, allow) {
  contents.on('will-navigate', event => { if (!allow(event.url)) event.preventDefault(); });
  contents.on('will-frame-navigate', event => { if (!event.isMainFrame || !allow(event.url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!allow(url)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
}
async function start() {
  const keySession = session.fromPartition('itsoscup-key-' + randomUUID(), { cache: false });
  const platformSession = session.fromPartition('itsoscup-platform-' + randomUUID(), { cache: false });
  const shellSession = session.fromPartition('itsoscup-shell-' + randomUUID(), { cache: false });
  for (const ses of [keySession, platformSession, shellSession]) denyPermissions(ses);
  keySession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('key://app/') && !details.url.startsWith('data:image/') }));
  keySession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy] } }));
  const bundle = loadResources(app.isPackaged ? path.join(process.resourcesPath, 'platform') : path.join(__dirname, 'platform-bundle')); platformResources = bundle.resources;
  const clipboardWriteAllowed = (contents, permission) => permission === 'clipboard-sanitized-write' && contents === platformView?.webContents && isPlatformPage(contents.getURL(), platformResources);
  platformSession.setPermissionRequestHandler((contents, permission, callback) => callback(clipboardWriteAllowed(contents, permission)));
  platformSession.setPermissionCheckHandler((contents, permission) => clipboardWriteAllowed(contents, permission));
  platformSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !canonicalResource(details.url, platformResources) && !/^(data:|blob:platform:\/\/app\/|about:blank$)/.test(details.url) }));
  platformSession.webRequest.onHeadersReceived((details, callback) => {
    const r = canonicalResource(details.url, platformResources);
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [platformPolicy(r, '') .replace(/connect-src[^;]+;/, "connect-src 'self';")] } });
  });
  shellSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('shell://app/') }));
  session.defaultSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
  const localResource = name => app.isPackaged ? path.join(process.resourcesPath, name) : path.resolve(__dirname, name === 'site-style.css' ? '../../css/style.css' : name === 'match-report.js' ? '../../js/match-report.js' : name === 'match-report.css' ? '../../css/match-report.css' : '../../favicon.svg');
  const keyResources = new Map([
    ['/index.html', [path.join(__dirname, 'renderer/index.html'), 'text/html; charset=utf-8']], ['/app.js', [path.join(__dirname, 'renderer/app.js'), 'text/javascript; charset=utf-8']],
    ['/key.css', [path.join(__dirname, 'renderer/key.css'), 'text/css; charset=utf-8']], ['/style.css', [localResource('site-style.css'), 'text/css; charset=utf-8']],
    ['/match-report.js', [localResource('match-report.js'), 'text/javascript; charset=utf-8']], ['/match-report.css', [localResource('match-report.css'), 'text/css; charset=utf-8']], ['/favicon.svg', [localResource('favicon.svg'), 'image/svg+xml']]
  ]);
  function fileHandler(resources, policy) { return request => {
    const url = new URL(request.url), resource = url.hostname === 'app' && !url.username && !url.password && !url.port && resources.get(url.pathname);
    if (!resource || request.method !== 'GET') return new Response('Accesso negato', { status: 403 });
    return new Response(fs.readFileSync(resource[0]), { headers: { 'Content-Type': resource[1], 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' } });
  }; }
  keySession.protocol.handle('key', fileHandler(keyResources, contentSecurityPolicy));
  platformSession.protocol.handle('platform', request => {
    const resource = canonicalResource(request.url, platformResources);
    if (!resource || request.method !== 'GET') return new Response('Accesso negato', { status: 403 });
    return new Response(resource.data, { headers: { 'Content-Type': resource.type, 'Content-Security-Policy': platformPolicy(resource, '').replace(/connect-src[^;]+;/, "connect-src 'self';"), 'Cache-Control': 'no-store' } });
  });
  const shellResources = new Map([['/index.html',[path.join(__dirname,'platform-shell/index.html'),'text/html; charset=utf-8']],['/shell.css',[path.join(__dirname,'platform-shell/shell.css'),'text/css; charset=utf-8']],['/shell.js',[path.join(__dirname,'platform-shell/shell.js'),'text/javascript; charset=utf-8']],['/favicon.svg',[localResource('favicon.svg'),'image/svg+xml']]]);
  shellSession.protocol.handle('shell', fileHandler(shellResources, contentSecurityPolicy));
  Menu.setApplicationMenu(null);
  const preferences = ses => ({ session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: !app.isPackaged });
  window = new BrowserWindow({ width: 1360, height: 960, minWidth: 760, minHeight: 620, title: 'ITSOSCup Platform', show: false, webPreferences: { ...preferences(shellSession), preload: path.join(__dirname, 'shell-preload.cjs') } });
  keyView = new WebContentsView({ webPreferences: { ...preferences(keySession), preload: path.join(__dirname, 'preload.cjs') } });
  platformView = new WebContentsView({ webPreferences: { ...preferences(platformSession), preload: path.join(__dirname, 'platform-preload.cjs') } });
  window.contentView.addChildView(platformView); resizeViews(); window.on('resize', resizeViews);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); keyView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Only about:blank documents generated by the local report code can be opened.
  // They inherit a denied-network session, sandbox and no Node privileges.
  platformView.webContents.setWindowOpenHandler(details => details.url === 'about:blank' ? { action: 'allow', overrideBrowserWindowOptions: { title: 'Referto ITSOSCup', width: 1000, height: 800, webPreferences: { ...preferences(platformSession), preload: undefined } } } : { action: 'deny' });
  platformView.webContents.on('did-create-window', child => { denyNavigation(child.webContents, url => url === 'about:blank'); child.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); });
  denyNavigation(window.webContents, () => false); denyNavigation(keyView.webContents, () => false);
  denyNavigation(platformView.webContents, url => isPlatformPage(url, platformResources));
  platformView.webContents.on('will-navigate', event => {
    if (!centralUnlocked && isPlatformPage(event.url, platformResources) && new URL(event.url).pathname !== '/desktop-home.html') { event.preventDefault(); platformView.webContents.loadURL('platform://app/desktop-home.html'); }
  });
  window.on('close', async event => {
    if (closeAllowed) return; event.preventDefault();
    if (hasPending()) { await dialog.showMessageBox(window, { type: 'error', title: 'Chiavetta da reinserire', message: 'Ci sono dati Key ancora in memoria. Reinserisci la stessa chiavetta e premi Riprova salvataggio prima di chiudere.' }); showSection('key'); return; }
    try {
      await platformQueue;
      if (vault.db) { engine.checkpoint(); if (vault.dirty) return; }
      if (platformApi.vault.db) { const result = await platformApi.call({ type: 'lock' }); if (result.error) throw new Error(result.error.message); }
      if (vault.db) vault.lock(); closeAllowed = true; window.close();
    } catch (error) { await dialog.showMessageBox(window, { type: 'error', title: 'Salvataggio da completare', message: error.message }); }
  });
  window.on('closed', () => { for (const view of [keyView, platformView]) if (!view.webContents.isDestroyed()) view.webContents.close(); });
  await window.loadURL('shell://app/index.html'); await keyView.webContents.loadURL('key://app/index.html'); await platformView.webContents.loadURL('platform://app/desktop-home.html');
  if (process.argv.includes('--key-start') || process.argv.includes('--key-smoke') || process.argv.includes('--key-self-check')) showSection('key');
  const selfCheck = process.argv.includes('--key-self-check') || process.argv.includes('--platform-self-check');
  const launcherDirectory = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  const smokeFlag = process.argv.includes('--platform-smoke') ? '--platform-smoke' : '--key-smoke';
  const smokeOutput = selfCheck ? path.join(launcherDirectory, 'ITSOSCup-Platform-self-check.json') : !app.isPackaged && process.argv.includes(smokeFlag) ? process.argv[process.argv.indexOf(smokeFlag) + 1] : null;
  if (smokeOutput) {
    try {
      const result = await keyView.webContents.executeJavaScript(`(async () => ({title:document.title,loaded:Boolean(document.getElementById('unlock-form')),nodeAvailable:typeof require!=='undefined'||typeof process!=='undefined',trustedBridge:typeof window.itsoscupKey?.call==='function',background:getComputedStyle(document.body).backgroundColor,externalDenied:await fetch('https://example.com').then(()=>false,()=>true),localhostDenied:await fetch('http://127.0.0.1:54321').then(()=>false,()=>true),filesystemDenied:await fetch('file:///C:/Windows/win.ini').then(()=>false,()=>true),arbitraryBridgeDenied:await window.itsoscupKey.call('readFile',{}).then(()=>false,()=>true),centralBridgeDenied:typeof window.itsoscupPlatform==='undefined',status:await window.itsoscupKey.call('status')}))()`);
      result.sandbox = keyView.webContents.getLastWebPreferences().sandbox; result.contextIsolation = keyView.webContents.getLastWebPreferences().contextIsolation; result.packaged = app.isPackaged; result.version = app.getVersion();
      result.platform = await platformView.webContents.executeJavaScript(`(async()=>({loaded:Boolean(document.getElementById('central-unlock-form')),nodeAvailable:typeof require!=='undefined'||typeof process!=='undefined',trustedBridge:typeof window.itsoscupPlatform?.call==='function',keyBridgeDenied:typeof window.itsoscupKey==='undefined',externalDenied:await fetch('https://example.com').then(()=>false,()=>true),backendDenied:await fetch('https://nalxfsbjeinptjflvndp.supabase.co/rest/v1/sports').then(()=>false,()=>true),filesystemDenied:await fetch('file:///C:/Windows/win.ini').then(()=>false,()=>true),status:await window.itsoscupPlatform.call({type:'status'})}))()`);
      result.platform.sandbox = platformView.webContents.getLastWebPreferences().sandbox; result.platform.contextIsolation = platformView.webContents.getLastWebPreferences().contextIsolation;
      result.platform.assetCount = platformResources.size; result.platform.memorySession = !platformSession.getStoragePath();
      fs.writeFileSync(smokeOutput, JSON.stringify(result, null, 2)); closeAllowed = true; app.quit();
    } catch (error) { fs.writeFileSync(smokeOutput, JSON.stringify({ error: error.message })); closeAllowed = true; app.exit(1); }
  } else window.show();
  checkpoint = setInterval(() => { if (vault.db && !commandRunning && !hasPending()) { try { engine.checkpoint(); } catch {} } }, 5000);
}
if (singleInstance) app.whenReady().then(start).catch(error => { dialog.showErrorBox('ITSOSCup Platform', error.message); app.exit(1); });
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('window-all-closed', () => { clearInterval(checkpoint); app.quit(); });
app.on('before-quit', event => { if (vault.db && hasPending()) event.preventDefault(); });
