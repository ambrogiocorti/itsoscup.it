import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 4173);

const mime = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
  '.webmanifest': 'application/manifest+json;charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function resolvePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0] || '/');
  const relative = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const full = normalize(join(root, relative));
  if (!full.startsWith(root)) return null;
  if (existsSync(full) && statSync(full).isDirectory()) return join(full, 'index.html');
  return full;
}

createServer((request, response) => {
  const target = resolvePath(request.url || '/');
  if (!target || !existsSync(target)) {
    response.writeHead(404, { 'Content-Type': 'text/plain;charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mime[extname(target)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  response.end(readFileSync(target));
}).listen(port, '127.0.0.1', () => {
  console.log(`Static test server running on http://127.0.0.1:${port}`);
});
