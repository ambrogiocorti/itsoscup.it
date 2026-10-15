/* ITSOSCup PWA: ONLINE-ONLY navigation. Supabase remains the single data source.
 * The former service worker pre-cached private admin/live pages and offered stale
 * offline content. Do not cache HTML, authentication, API requests or match state.
 */
const PWA_VERSION = 'itsoscup-pwa-online-v1';
const OLD_CACHE_PREFIXES = ['tornei-scuola-offline-', 'itsoscup-pwa-online-'];

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) =>
      OLD_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
    ).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      // Always request the current site, including role authorization and live state.
      return await fetch(request, { cache: 'no-store' });
    } catch (_error) {
      // A useful explanation, never an outdated admin/scorekeeper screen.
      return new Response(`<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ITSOSCup · Connessione necessaria</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;font:16px system-ui,sans-serif}
main{max-width:440px;margin:20px;padding:30px;border-radius:14px;border:1px solid #e2e8f0;background:#fff}
h1{font-size:1.45rem}p{line-height:1.6;color:#475569}button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:12px 17px;font:inherit;cursor:pointer}</style></head>
<body><main><h1>Connessione Internet necessaria</h1>
<p>ITSOSCup salva le partite sul server. Controlla la connessione prima di continuare: non registrare punteggi su questa schermata.</p>
<button type="button" onclick="location.reload()">Riprova</button></main></body></html>`,
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
  })());
});

self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?.json()||{}}catch{}
  const title=String(payload.title||'ITSOSCup').slice(0,80);
  const href=String(payload.url||'/');
  const url=href.startsWith('/')&&!href.startsWith('//')?href:'/';
  event.waitUntil(self.registration.showNotification(title,{
    body:String(payload.body||'').slice(0,200),
    icon:'/favicon.svg',badge:'/favicon.svg',
    tag:String(payload.tag||'itsos-notice'),renotify:false,
    data:{url},
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const path=event.notification.data?.url||'/';
  const url=new URL(path,self.location.origin);
  if(url.origin!==self.location.origin)return;
  event.waitUntil((async()=>{
    const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const tab of tabs){
      if(new URL(tab.url).origin===url.origin){
        await tab.navigate(url.href);
        return tab.focus();
      }
    }
    return self.clients.openWindow(url.href);
  })());
});
