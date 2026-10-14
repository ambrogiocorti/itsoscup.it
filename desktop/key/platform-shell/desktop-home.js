'use strict';
const form = document.getElementById('central-unlock-form'), message = document.getElementById('central-status'), setup = document.getElementById('central-setup');
async function refresh() {
  const result = await window.itsoscupPlatform.call({ type: 'status' });
  if (result.error) { message.textContent = result.error.message; return; }
  const status = result.data;
  if (status.unlocked && status.station_id) { window.localStorage.setItem('tornei_device_id', status.station_id); if (!window.localStorage.getItem('tornei_device_label')) window.localStorage.setItem('tornei_device_label', 'Centrale offline'); }
  form.hidden = Boolean(status.unlocked); document.getElementById('central-ready').hidden = !status.unlocked;
  setup.hidden = status.exists; document.getElementById('central-unlock-title').textContent = status.exists ? 'Sblocca la piattaforma locale' : 'Prepara la piattaforma locale';
  document.getElementById('central-submit').textContent = status.exists ? 'Sblocca piattaforma' : 'Crea piattaforma';
  document.getElementById('central-path').textContent = status.directory || '';
  for (const input of setup.querySelectorAll('input')) input.required = !status.exists;
  document.getElementById('central-recover').hidden = status.exists || status.unlocked;
  form.dataset.create = String(!status.exists); message.textContent = status.unlocked ? 'Archivio locale aperto · modifiche salvate sulla chiavetta' : 'Archivio protetto · nessuna rete richiesta';
}
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = document.getElementById('central-submit'); button.disabled = true; message.textContent = 'Apertura archivio locale…';
  try {
    const result = await window.itsoscupPlatform.call({ type: 'unlock', password: document.getElementById('central-password').value, create: form.dataset.create === 'true', name: document.getElementById('central-name').value, email: document.getElementById('central-email').value, pin: document.getElementById('central-pin').value });
    if (result.error) throw new Error(result.error.message); form.reset(); await refresh();
  } catch (error) { message.textContent = error.message; } finally { button.disabled = false; }
});
document.getElementById('central-lock').addEventListener('click', async () => { const result = await window.itsoscupPlatform.call({ type: 'lock' }); if (result.error) message.textContent = result.error.message; else await refresh(); });
document.getElementById('home-open-key').addEventListener('click', () => window.itsoscupPlatform.openKey());
document.getElementById('central-backup').addEventListener('click', async () => { const result = await window.itsoscupPlatform.call({ type: 'backupFile' }); message.textContent = result.error ? result.error.message : result.data?.canceled ? 'Backup annullato' : 'Backup cifrato salvato: ' + result.data.filename; });
document.getElementById('central-recover').addEventListener('click', async () => {
  const password = document.getElementById('central-password').value;
  if (!password) { message.textContent = 'Inserisci la password dell’archivio da recuperare'; return; }
  const result = await window.itsoscupPlatform.call({ type: 'restoreFile', password });
  if (result.error) message.textContent = result.error.message; else if (!result.data?.canceled) { form.reset(); await refresh(); }
});
refresh().catch(error => { message.textContent = error.message; });
