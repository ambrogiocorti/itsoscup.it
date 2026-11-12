// Un solo benvenuto al primo accesso: installazione, notifiche e (per lo staff)
// nome della postazione e giro guidato, raccolti in un'unica finestra.
import { installApp, markInstallOfferSeen, shouldOfferInstall } from './pwa-install.js?v=4';
import { choosePushMode, getPushMode } from './push-preferences.js?v=3';
import { getDeviceInfo, setDeviceLabel } from './device.js';

const SEEN_PREFIX = 'itsoscup_welcome_seen_v1_';
const TOUR_PREFIX = 'tornei_tour_done_';

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* memoria non disponibile */ } };

let open = false;

// Senza memoria locale il benvenuto ricomparirebbe a ogni pagina: meglio non mostrarlo.
function storageAvailable() {
  try {
    const probe = 'itsoscup_welcome_probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} options
 * @param {'public'|'staff'} [options.audience]
 * @param {boolean} [options.askDeviceName] chiede il nome della postazione se manca
 * @param {(info: object) => void} [options.onDeviceNamed]
 * @param {{ key: string, start: () => void }} [options.tour] giro guidato facoltativo
 * @returns {boolean} true se la finestra è stata mostrata
 */
export function showWelcome({ audience = 'public', askDeviceName = false, onDeviceNamed, tour } = {}) {
  if (open || !storageAvailable() || read(SEEN_PREFIX + audience) === '1') return false;
  const askDevice = askDeviceName && !getDeviceInfo().isNamed;
  const offerInstall = shouldOfferInstall();
  const offerPush = !getPushMode();
  const offerTour = Boolean(tour?.start) && read(TOUR_PREFIX + tour.key) !== 'true';
  if (!askDevice && !offerInstall && !offerPush && !offerTour) {
    write(SEEN_PREFIX + audience, '1');
    return false;
  }

  open = true;
  const overlay = document.createElement('div');
  overlay.className = 'itsos-welcome-overlay';
  overlay.id = 'itsos-welcome';
  overlay.innerHTML = `
    <section class="itsos-welcome" role="dialog" aria-modal="true" aria-labelledby="itsos-welcome-title">
      <h2 id="itsos-welcome-title">Benvenuto su ITSOSCup</h2>
      <p class="itsos-welcome-lead">${audience === 'staff'
        ? 'Prima di iniziare, qualche scelta veloce. Puoi cambiarle in qualsiasi momento.'
        : 'Risultati, calendario e classifiche dei tornei della scuola. Due scelte facoltative:'}</p>
      ${askDevice ? `
        <div class="itsos-welcome-block">
          <label for="itsos-welcome-device"><strong>Nome di questa postazione</strong></label>
          <small>Compare nel registro delle modifiche, per sapere da quale dispositivo arriva un punteggio.</small>
          <input id="itsos-welcome-device" type="text" maxlength="80" placeholder="Es. Tablet Palestra Grande" autocomplete="off" />
        </div>` : ''}
      ${offerInstall ? `
        <div class="itsos-welcome-block">
          <strong>Installa l'app</strong>
          <small>Apri ITSOSCup dalla schermata Home o dal desktop, senza scaricare file.</small>
          <button type="button" class="btn btn-ghost" data-welcome-install>Installa ITSOSCup</button>
          <p class="itsos-welcome-note" data-welcome-install-note role="status" aria-live="polite"></p>
        </div>` : ''}
      ${offerPush ? `
        <div class="itsos-welcome-block">
          <strong>Notifiche su questo dispositivo</strong>
          <div class="itsos-welcome-choices" role="group" aria-label="Notifiche">
            <button type="button" data-welcome-push="all">Tutte</button>
            <button type="button" data-welcome-push="limited">Solo squadre seguite</button>
            <button type="button" data-welcome-push="none">Nessuna</button>
          </div>
          <p class="itsos-welcome-note" data-welcome-push-note role="status" aria-live="polite"></p>
        </div>` : ''}
      <div class="itsos-welcome-actions">
        ${offerTour ? '<button type="button" class="btn btn-ghost" data-welcome-tour>Fai il giro guidato</button>' : ''}
        <button type="button" class="btn btn-primary" data-welcome-continue>Continua</button>
      </div>
    </section>`;
  document.body.appendChild(overlay);

  const card = overlay.querySelector('.itsos-welcome');
  const close = ({ startTour = false } = {}) => {
    const deviceInput = overlay.querySelector('#itsos-welcome-device');
    const label = deviceInput?.value.trim();
    if (label) onDeviceNamed?.(setDeviceLabel(label));
    write(SEEN_PREFIX + audience, '1');
    if (offerInstall) markInstallOfferSeen();
    if (offerTour && !startTour) write(TOUR_PREFIX + tour.key, 'true');
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    open = false;
    if (startTour) tour.start();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  overlay.querySelector('[data-welcome-continue]').addEventListener('click', () => close());
  overlay.querySelector('[data-welcome-tour]')?.addEventListener('click', () => close({ startTour: true }));
  overlay.querySelector('[data-welcome-install]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const note = overlay.querySelector('[data-welcome-install-note]');
    const instructions = await installApp();
    if (instructions) note.textContent = instructions;
    else button.textContent = 'Installazione avviata';
    button.disabled = true;
  });
  overlay.querySelectorAll('[data-welcome-push]').forEach((button) => button.addEventListener('click', async () => {
    const buttons = overlay.querySelectorAll('[data-welcome-push]');
    const note = overlay.querySelector('[data-welcome-push-note]');
    buttons.forEach((b) => { b.disabled = true; });
    const message = await choosePushMode(button.dataset.welcomePush);
    buttons.forEach((b) => {
      b.disabled = false;
      b.setAttribute('aria-pressed', String(message === null && b === button));
    });
    note.textContent = message ?? 'Scelta salvata.';
  }));

  (card.querySelector('input') || overlay.querySelector('[data-welcome-continue]')).focus();
  return true;
}

// Pagine pubbliche: il benvenuto parte da solo. Admin e diretta lo aprono dopo l'accesso.
document.addEventListener('DOMContentLoaded', () => {
  if (document.body.classList.contains('public-page')) showWelcome({ audience: 'public' });
});
