// Presentation-only controls. Operational transfers stay in key-control.js.
const shell = document.getElementById('offline-shell');
const sidebar = document.getElementById('admin-sidebar');
const toggle = document.getElementById('btn-mobile-menu');
const mobile = window.matchMedia('(max-width: 1024px)');
function setMenu(open, restoreFocus = false) {
  shell.classList.toggle('menu-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Chiudi menu' : 'Apri menu');
  if ('inert' in sidebar) sidebar.inert = mobile.matches && !open;
  if (restoreFocus) toggle.focus();
}
toggle.addEventListener('click', () => setMenu(!shell.classList.contains('menu-open')));
document.getElementById('sidebar-backdrop').addEventListener('click', () => setMenu(false, true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && shell.classList.contains('menu-open')) setMenu(false, true);
  if (event.key !== 'Tab' || !mobile.matches || !shell.classList.contains('menu-open')) return;
  const focusable = [toggle, ...sidebar.querySelectorAll('a[href],button:not([disabled])')];
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
mobile.addEventListener('change', () => setMenu(false));
setMenu(false);

const native = Boolean(window.itsoscupPlatform);
if (native) {
  document.getElementById('offline-workspace-mode').textContent = 'Centrale offline';
  document.getElementById('offline-storage-label').textContent = 'Archivio centrale su questo PC';
  document.getElementById('offline-environment-label').textContent = 'Centrale offline';
  document.getElementById('offline-environment').classList.add('is-native');
}
document.querySelectorAll('[data-online-label][data-native-label]').forEach((node) => {
  node.textContent = native ? node.dataset.nativeLabel : node.dataset.onlineLabel;
});
document.querySelectorAll('.offline-workflow a').forEach((link) => link.addEventListener('click', (event) => {
  const target = document.getElementById(link.hash.slice(1));
  if (!target) return;
  event.preventDefault();
  if (target.tagName === 'DETAILS') target.open = true;
  target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  const heading = target.querySelector('summary,h3');
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
}));
function hidePasswords() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    input.type = 'password';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', button.dataset.showLabel);
    button.querySelector('i').className = 'fa-solid fa-eye';
  });
}
document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  button.dataset.showLabel = button.getAttribute('aria-label');
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(reveal));
    button.setAttribute('aria-label', reveal ? button.dataset.showLabel.replace('Mostra', 'Nascondi') : button.dataset.showLabel);
    button.querySelector('i').className = reveal ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });
});
document.getElementById('key-lock').addEventListener('click', hidePasswords);
window.addEventListener('pagehide', hidePasswords);
const fields = document.getElementById('key-preparation-fields');
const help = document.getElementById('key-connect-help');
const updateHelp = () => { help.hidden = !fields.hidden; };
new MutationObserver(updateHelp).observe(fields, { attributes: true, attributeFilter: ['hidden'] });
updateHelp();
