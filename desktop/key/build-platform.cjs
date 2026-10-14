'use strict';
// Explicit public-asset allowlist: never copy the checkout, env, uploads or data.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const site = path.resolve(__dirname, '../..'), output = path.join(__dirname, 'platform-bundle');
const esbuild = require('esbuild');
const pages = ['index.html', 'team.html', 'class.html', 'admin.html', 'live.html', 'gym.html', 'offline-workspace.html', 'admin/index.html', 'admin/admin.html', 'admin/innovation.html'];
const files = [...pages, 'favicon.svg', 'manifest.webmanifest'];
for (const folder of ['js', 'css']) for (const entry of fs.readdirSync(path.join(site, folder), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(folder === 'js' ? '.js' : '.css')) files.push(folder + '/' + entry.name);
}
// The target is fixed inside desktop/key, with no caller-provided path.
if (path.dirname(output) !== __dirname) throw new Error('Invalid bundle destination');
fs.rmSync(output, { recursive: true, force: true }); fs.mkdirSync(output, { recursive: true });
function write(name, value) { const target = path.join(output, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); }
for (const name of files) {
  let data = fs.readFileSync(path.join(site, name));
  if (name.endsWith('.html')) {
    let html = data.toString('utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/g, '/platform-client.js')
      .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.4\.0\/css\/all\.min\.css/g, '/vendor/fontawesome/css/all.min.css');
    // Class/offline pages normally obtain their SDK through dynamic CDN imports.
    if (!html.includes('src="/platform-client.js"')) html = html.replace('</head>', '<script src="/platform-client.js"></script></head>');
    if (name === 'admin/index.html') html = html.replace('</head>', '<script src="/vendor/qr.js"></script></head>');
    // No desktop cache worker: the installed app is already self-contained.
    html = html.replace('</head>', '<script src="/desktop-context.js"></script></head>');
    if (name === 'admin/index.html' || name === 'offline-workspace.html') {
      html = html.replace('</head>', '<link rel="stylesheet" href="/desktop-nav.css"></head>');
    }
    if (name === 'index.html') html = html.replace('<label for="login-pass">Password</label>', '<label for="login-pass">PIN locale</label>').replace('id="login-pass" placeholder="Password"', 'id="login-pass" placeholder="PIN di 8–20 cifre"');
    if (name === 'live.html') html = html.replace('fa-solid fa-cloud', 'fa-solid fa-database').replace('Sincronizzazione in attesa', 'Archivio centrale pronto');
    data = Buffer.from(html);
  }
  if (name === 'js/db.js') data = Buffer.from(data.toString('utf8').replace('async function loadSupabaseSdk() {', 'async function loadSupabaseSdk() {\n  if (window.ITSOSCUP_PLATFORM_READY) await window.ITSOSCUP_PLATFORM_READY;').replace('persistSession: true,', 'persistSession: false,').replace('detectSessionInUrl: true,', 'detectSessionInUrl: false,').replace(/const cdnUrls = \[[\s\S]*?\];/, 'const cdnUrls = [];'));
  if (name === 'js/offline.js') data = Buffer.from(data.toString('utf8').replace('export function registerOfflineSupport() {', 'export function registerOfflineSupport() {\n  if (window.ITSOSCUP_DESKTOP) return;'));
  if (['js/main-live.js', 'js/offline-workspace.js'].includes(name)) data = Buffer.from(data.toString('utf8').replace(/navigator\.onLine/g, '(Boolean(window.itsoscupPlatform) || navigator.onLine)').replace(/fa-solid fa-cloud/g, 'fa-solid fa-database').replace(/Tutto salvato online/g, 'Salvato nell’archivio centrale').replace(/Versione online/g, 'Versione centrale').replace(/versione online/g, 'versione centrale').replace(/salvata online/g, 'salvata nell’archivio centrale').replace(/salvati online/g, 'salvati nell’archivio centrale').replace(/salvato online/g, 'salvato nell’archivio centrale'));
  if (name === 'js/main-admin.js') data = Buffer.from(data.toString('utf8').replace(/`https:\/\/api\.qrserver\.com\/v1\/create-qr-code\/\?size=320x320&data=\$\{encodeURIComponent\((url|channelUrl)\)\}`/g, 'window.itsoscupQrUrl($1)').replace('function getPublicBaseUrl(baseHref = window.location.href) {', "function getPublicBaseUrl(baseHref = window.location.href) {\n  if (window.ITSOSCUP_DESKTOP) return new URL('https://itsoscup.it/');"));
  write(name, data);
}
const supabasePackage = path.dirname(require.resolve('@supabase/supabase-js/package.json'));
write('vendor/supabase.js', fs.readFileSync(path.join(supabasePackage, 'dist/umd/supabase.js')));
const fa = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
write('vendor/fontawesome/css/all.min.css', fs.readFileSync(path.join(fa, 'css/all.min.css')));
for (const name of fs.readdirSync(path.join(fa, 'webfonts'))) if (/\.(woff2?|ttf)$/.test(name)) write('vendor/fontawesome/webfonts/' + name, fs.readFileSync(path.join(fa, 'webfonts', name)));
write('vendor/qr.js', esbuild.buildSync({ stdin: { contents: `const {create}=require('qrcode/lib/core/qrcode'); window.itsoscupQrUrl=text=>{const q=create(String(text),{errorCorrectionLevel:'M'}),s=q.modules.size;let d='';for(let y=0;y<s;y++)for(let x=0;x<s;x++)if(q.modules.get(y,x))d+='M'+(x+4)+' '+(y+4)+'h1v1h-1z';return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+(s+8)+' '+(s+8)+'" shape-rendering="crispEdges"><path fill="white" d="M0 0h'+(s+8)+'v'+(s+8)+'H0z"/><path fill="black" d="'+d+'"/></svg>');};`, resolveDir: __dirname }, bundle: true, platform: 'browser', minify: true, write: false }).outputFiles[0].contents);
write('desktop-context.js', "'use strict';Object.defineProperty(window,'ITSOSCUP_DESKTOP',{value:true,writable:false});");
write('desktop-nav.css', "@media (min-width: 901px) and (max-width: 1024px) {\n  .admin-shell { display:grid!important; grid-template-columns:232px minmax(0,1fr)!important; }\n  .admin-shell .sidebar { width:232px!important; min-width:0; position:static!important; inset:auto!important; transform:none!important; transition:none!important; box-shadow:none!important; height:100vh; overflow:hidden; z-index:auto; }\n  .admin-shell .sidebar-menu { display:grid; overflow-y:auto; gap:4px; align-content:start; padding:12px 10px; }\n  .admin-shell .sidebar-menu li { margin:0; }\n  .admin-shell .sidebar-link { padding:9px 10px; white-space:normal; }\n  .admin-shell .sidebar-logout { margin-top:auto; }\n  .admin-shell .mobile-sidebar-toggle, .admin-shell .sidebar-backdrop { display:none!important; }\n  .admin-shell .main-pane { padding:28px 22px!important; }\n  .offline-sidebar-nav { flex:1 1 auto; overflow-y:auto; }\n}\n");
for (const name of ['desktop-home.html', 'desktop-home.css', 'desktop-home.js', 'platform-client.js']) write(name, fs.readFileSync(path.join(__dirname, 'platform-shell', name)));
const manifest = {};
function inventory(folder, prefix = '') {
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    const name = prefix + e.name;
    if (e.isDirectory()) inventory(path.join(folder, e.name), name + '/');
    else { const data = fs.readFileSync(path.join(folder, e.name)); manifest['/' + name] = { size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }; }
  }
}
inventory(output);
write('manifest.json', JSON.stringify({ version: require('./package.json').version, supabaseOrigin: 'https://nalxfsbjeinptjflvndp.supabase.co', resources: manifest }, null, 2));
process.stdout.write(`Bundled ${Object.keys(manifest).length} public platform assets with pinned local SDK, icons and QR generation.\n`);
