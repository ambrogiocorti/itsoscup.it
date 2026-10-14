// A single installable ITSOSCup PWA for public visitors, admins and scorekeepers.
// Installation never creates a separate account or local match database.
let installPrompt = null;
const buttons = () => [...document.querySelectorAll('[data-install-pwa]')];
const installed = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function reflectInstallState() {
  buttons().forEach((button) => { button.hidden = installed(); });
}

function showInstallInstructions() {
  const existing = document.getElementById('itsoscup-install-help');
  if (existing) { existing.showModal?.(); return; }
  const dialog = document.createElement('dialog');
  dialog.id = 'itsoscup-install-help';
  dialog.className = 'pwa-install-dialog';
  dialog.setAttribute('aria-labelledby', 'itsoscup-install-title');
  const heading = document.createElement('h2');
  heading.id = 'itsoscup-install-title';
  heading.textContent = 'Installa ITSOSCup';
  const description = document.createElement('p');
  description.textContent = 'È sempre lo stesso sito ITSOSCup: un\u2019unica applicazione online, con accessi e permessi già configurati.';
  const info = document.createElement('p');
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  info.textContent = ios
    ? 'In Safari tocca Condividi, quindi Aggiungi alla schermata Home.'
    : 'In Chrome o Edge apri il menu (⋮ o …) e scegli Installa ITSOSCup oppure App → Installa questo sito come app. Se non compare, controlla di essere su https://itsoscup.it.';
  const close = document.createElement('button');
  close.className = 'btn btn-primary';
  close.type = 'button';
  close.textContent = 'Ho capito';
  close.addEventListener('click', () => dialog.close());
  dialog.append(heading, description, info, close);
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else window.alert([heading.textContent, description.textContent, info.textContent].join('\n\n'));
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  reflectInstallState();
});
window.addEventListener('appinstalled', () => { installPrompt = null; reflectInstallState(); });
document.addEventListener('DOMContentLoaded', () => {
  reflectInstallState();
  buttons().forEach((button) => button.addEventListener('click', async () => {
    if (installed()) return;
    if (!installPrompt) { showInstallInstructions(); return; }
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') reflectInstallState();
    } catch (_error) {
      showInstallInstructions();
    }
  }));
});
