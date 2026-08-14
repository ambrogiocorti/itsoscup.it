export function registerOfflineSupport() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;

  const syncBanner = () => {
    let banner = document.getElementById('offline-status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offline-status-banner';
      banner.className = 'offline-status-banner';
      banner.textContent = 'Connessione assente: uso dati locali e cache dove disponibili.';
      document.body.appendChild(banner);
    }
    banner.classList.toggle('show', !navigator.onLine);
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is best-effort; the app must keep working without it.
    });
    syncBanner();
  });
  window.addEventListener('offline', syncBanner);
  window.addEventListener('online', syncBanner);
}
