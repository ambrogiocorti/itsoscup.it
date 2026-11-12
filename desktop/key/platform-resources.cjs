'use strict';
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
function loadResources(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const resources = new Map();
  for (const [pathname, info] of Object.entries(manifest.resources)) {
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(pathname) || pathname.includes('..') || pathname.includes('//')) throw new Error('Invalid bundled resource');
    const resolved = path.resolve(root, '.' + pathname), relative = path.relative(root, resolved);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Invalid bundled path');
    const data = fs.readFileSync(resolved);
    if (data.length !== info.size || createHash('sha256').update(data).digest('hex') !== info.sha256) throw new Error('Bundled platform integrity failed: ' + pathname);
    resources.set(pathname, { data, type: mime[path.extname(pathname)] || 'application/octet-stream' });
  }
  return { resources, supabaseOrigin: manifest.supabaseOrigin };
}
function canonicalResource(url, resources) {
  let parsed; try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'platform:' || parsed.hostname !== 'app' || parsed.port || parsed.username || parsed.password || /%|\\/.test(parsed.pathname)) return null;
  const aliases = { '/': '/index.html', '/admin': '/admin/index.html', '/admin/': '/admin/index.html' };
  return resources.get(aliases[parsed.pathname] || parsed.pathname) || null;
}
function isPlatformPage(url, resources) { const r = canonicalResource(url, resources); return Boolean(r && r.type.startsWith('text/html')); }
function inlineHashes(data) { return [...data.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter(x => x[1].trim()).map(x => "'sha256-" + createHash('sha256').update(x[1].replace(/\r\n?/g, '\n')).digest('base64') + "'").join(' '); }
function platformPolicy(resource, origin) { return `default-src 'none'; script-src 'self' ${inlineHashes(resource?.data || Buffer.alloc(0))}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${origin}; font-src 'self'; connect-src 'self' ${origin} ${origin.replace('https:', 'wss:')}; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; worker-src 'none'`; }
module.exports = { loadResources, canonicalResource, isPlatformPage, platformPolicy };
