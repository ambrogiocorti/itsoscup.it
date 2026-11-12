'use strict';
// The site itself supplies the navigation and contextual print actions.
// This native header only selects between the full site and the offline Key.
function select(section) {
  const key = section === 'key';
  document.getElementById('open-key').setAttribute('aria-pressed', String(key));
  if (key) {
    document.getElementById('open-platform').setAttribute('aria-pressed', 'false');
    document.getElementById('open-site').setAttribute('aria-pressed', 'false');
  }
}
function navigate(section) {
  return window.itsoscupDesktop.open(section).then(opened => {
    if (!opened) return;
    for (const [id, value] of [['open-platform', 'platform'], ['open-site', 'home'], ['open-key', 'key']]) {
      document.getElementById(id).setAttribute('aria-pressed', String(section === value));
    }
  });
}
document.getElementById('open-platform').addEventListener('click', () => void navigate('platform'));
document.getElementById('open-site').addEventListener('click', () => void navigate('home'));
document.getElementById('open-key').addEventListener('click', () => void navigate('key'));
document.getElementById('open-archive').addEventListener('click', () => void navigate('archive'));
document.getElementById('desktop-retry').addEventListener('click', () => window.itsoscupDesktop.retry());
window.itsoscupDesktop.onPending(state => {
  const button = document.getElementById('desktop-retry');
  button.hidden = !state.dirty;
  button.title = state.message || 'Reinserisci la stessa chiavetta e riprova il salvataggio';
});
window.itsoscupDesktop.onSection(select);
