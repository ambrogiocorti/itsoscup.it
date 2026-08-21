export function registerOfflineSupport() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;

  const showUpdateBanner = () => {
    let banner = document.getElementById('app-update-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'app-update-banner';
      banner.className = 'app-update-banner';
      banner.innerHTML = `
        <span>Nuova versione disponibile.</span>
        <button type="button" id="btn-apply-app-update">Aggiorna</button>
      `;
      document.body.appendChild(banner);
      banner.querySelector('#btn-apply-app-update')?.addEventListener('click', () => {
        window.location.reload();
      });
    }
    banner.classList.add('show');
  };

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
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner();
            }
          });
        });
      })
      .catch(() => {
        // Offline support is best-effort; the app must keep working without it.
      });
    syncBanner();
  });
  window.addEventListener('offline', syncBanner);
  window.addEventListener('online', syncBanner);
}
