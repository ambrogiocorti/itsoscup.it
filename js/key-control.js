import { decryptKeyPackage, encryptKeyPackage, createKeyOperator, hashText, KEY_LIMIT } from './key-transfer.js';
import { getMeta, putMeta } from './offline-db.js';

const INBOX = 'itsoscup_key_encrypted_inbox_v2';
const isNativeCentral = () => Boolean(window.itsoscupPlatform);
async function readInbox() {
  if (!isNativeCentral()) return await getMeta(INBOX, []) || [];
  const { data, error } = await window.itsoscupPlatform.call({ type: 'storage', method: 'get', key: INBOX });
  if (error) throw new Error(error.message);
  return data || [];
}
async function saveInbox(value) {
  if (!isNativeCentral()) return putMeta(INBOX, value);
  const { data, error } = await window.itsoscupPlatform.call({ type: 'storage', method: 'set', key: INBOX, value });
  if (error) throw new Error(error.message);
  return data === true;
}
const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let connection = null, selectedMatches = [], busy = false;
function status(text, error = false) {
  $('key-central-status').textContent = text;
  $('key-central-status').classList.toggle('is-error', error);
}
function password() {
  const value = $('key-password').value;
  if (value.length < 12) throw new Error('Inserisci la password di trasferimento (almeno 12 caratteri)');
  return value;
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function runAction(fn) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll('#key-central-panel button')];
  buttons.forEach(b => b.disabled = true);
  try { await fn(); } catch (error) { status(error.message, true); }
  finally { busy = false; buttons.forEach(b => b.disabled = false); }
}
async function authorize() {
  const { getCurrentUser, getAdminProfile, canEditMatches } = await import('./auth.js');
  const user = await getCurrentUser();
  const admin = user && await getAdminProfile(user.id);
  if (!admin || !canEditMatches(admin.ruolo)) throw new Error('Accedi alla dashboard con un ruolo autorizzato a gestire le partite');
  const { db, run, runRpc } = await import('./db.js');
  return { user, admin, db, run, runRpc };
}
async function connect() {
  status('Verifica sessione e calendario…');
  connection = await authorize();
  const { db, run } = connection;
  const [sports, venues, devices] = await Promise.all([
    run(db.from('sports').select('id,name,sport_type').order('name'), 'Tornei'),
    run(db.from('venues').select('id,name').order('name'), 'Campi'),
    run(db.from('registered_devices').select('device_id,label,is_revoked,is_blocked').order('label'), 'Postazioni'),
  ]);
  $('key-sport').innerHTML = (sports.data || []).filter(s => s.sport_type !== 'atletica').map(s => `<option value="${Number(s.id)}">${safe(s.name)}</option>`).join('');
  $('key-venue').innerHTML = '<option value="">Tutti i campi</option>' + (venues.data || []).map(v => `<option value="${Number(v.id)}">${safe(v.name)}</option>`).join('');
  $('key-station').innerHTML = '<option value="">Nuova chiavetta / postazione</option>' + (devices.data || [])
    .filter(d => !d.is_revoked && !d.is_blocked && /^[0-9a-f-]{36}$/i.test(d.device_id))
    .map(d => `<option value="${safe(d.device_id)}">${safe(d.label || d.device_id)}</option>`).join('');
  $('key-preparation-fields').hidden = false;
  await loadMatches();
  status('Sessione verificata. Seleziona partite e operatori prima di preparare la chiavetta.');
}
async function loadMatches() {
  if (!connection) return;
  const sid = Number($('key-sport').value), venue = Number($('key-venue').value);
  if (!sid) { selectedMatches = []; $('key-match-list').textContent = 'Nessun torneo disponibile.'; return; }
  const { db, run } = connection;
  const { data } = await run(db.from('matches').select('id,sport_id,venue_id,status,is_finished,scheduled_start,lock_version,home:teams!home_team_id(name),away:teams!away_team_id(name)')
    .eq('sport_id', sid).order('scheduled_start'), 'Calendario della postazione');
  selectedMatches = (data || []).filter(m => !m.is_finished && !['cancelled', 'live'].includes(m.status) && (!venue || Number(m.venue_id) === venue));
  $('key-match-list').innerHTML = selectedMatches.length ? selectedMatches.map(m => `<label class="key-match-choice"><input type="checkbox" value="${Number(m.id)}" checked>
    <span><strong>${safe(m.home?.name)} – ${safe(m.away?.name)}</strong><small>${safe(m.scheduled_start ? new Date(m.scheduled_start).toLocaleString('it-IT') : 'Orario da definire')} · #${Number(m.id)}</small></span></label>`).join('')
    : '<p class="empty-state">Nessuna partita preparabile per questa selezione.</p>';
}
async function prepare() {
  const pass = password();
  connection = await authorize();
  const ids = [...$('key-match-list').querySelectorAll('input:checked')].map(i => Number(i.value));
  if (!ids.length) throw new Error('Seleziona almeno una partita');
  const label = $('key-label').value.trim();
  if (!label) throw new Error('Inserisci il nome della postazione');
  const operators = await Promise.all([
    createKeyOperator({ name: $('key-operator-name').value, role: 'operator', pin: $('key-operator-pin').value, matchIds: ids }),
    createKeyOperator({ name: $('key-supervisor-name').value, role: 'supervisor', pin: $('key-supervisor-pin').value, matchIds: ids }),
  ]);
  if ($('key-operator-pin').value === $('key-supervisor-pin').value) throw new Error('Operatore e supervisore devono usare PIN diversi');
  const station = $('key-station').value || crypto.randomUUID();
  status('Autorizzazione postazione e preparazione delle partite…');
  const authorization = await connection.runRpc('prepare_key_station', {
    p_station_id: station, p_sport_id: Number($('key-sport').value), p_match_ids: ids, p_label: label,
    p_venue_id: Number($('key-venue').value) || null,
  }, 'Preparazione ITSOSCup Key');
  const { loadLiveMatch } = await import('./live.js');
  const matches = [];
  for (const id of ids) {
    const data = await loadLiveMatch(id);
    const version = authorization.match_versions.find(row => Number(row.match_id) === id)?.base_version;
    if (Number(data.match.lock_version) !== Number(version)) throw new Error('La partita #' + id + ' è cambiata durante la preparazione. Ripeti la preparazione.');
    // Export only operational roster fields; never student contact/access codes.
    const roster = rows => rows.map(p => ({ id: Number(p.id), team_id: Number(p.team_id), full_name: String(p.full_name || ''), is_captain: Boolean(p.is_captain) }));
    const m = data.match;
    const match = Object.fromEntries(['id', 'sport_id', 'home_team_id', 'away_team_id', 'venue_id', 'scheduled_start', 'scheduled_end', 'round_name', 'status', 'is_finished', 'lock_version', 'home_score', 'away_score', 'duration', 'live_payload'].map(k => [k, m[k] ?? null]));
    match.home = { id: m.home_team_id, name: m.home?.name || '' }; match.away = { id: m.away_team_id, name: m.away?.name || '' };
    match.sport = { id: m.sport_id, name: m.sport?.name || '', sport_type: m.sport?.sport_type || '' }; match.venue = { id: m.venue_id, name: m.venue?.name || '' };
    matches.push({ match_id: id, match, config: data.config, homePlayers: roster(data.homePlayers), awayPlayers: roster(data.awayPlayers), stats: [], cached_at: new Date().toISOString() });
  }
  const payload = { schema: 'itsoscup-offline-transfer', version: 2, kind: 'prepared', device_id: station, station_id: station,
    preparation_id: authorization.preparation_id, authorization_secret: authorization.authorization_secret,
    created_at: authorization.created_at, expires_at: authorization.expires_at, station_label: label, operators, matches, operations: [] };
  download(await encryptKeyPackage(payload, pass), 'itsoscup-key-prepared-' + authorization.preparation_id + '.json');
  $('key-operator-pin').value = ''; $('key-supervisor-pin').value = '';
  status('Preparazione cifrata scaricata: ' + ids.length + ' partite. Copia app e pacchetto sulla USB; apri ITSOSCup Key, importa e verifica l’avvio senza rete.');
}
async function inbox() { return readInbox(); }
async function stage() {
  const file = $('key-result-file').files?.[0];
  if (!file) throw new Error('Seleziona il pacchetto risultati della chiavetta');
  if (file.size > KEY_LIMIT * 2) throw new Error('Pacchetto troppo grande');
  const text = await file.text();
  const payload = await decryptKeyPackage(text, password());
  if (payload.kind !== 'results') throw new Error('Seleziona un pacchetto risultati ITSOSCup Key');
  if (!isNativeCentral() && !('indexedDB' in window)) throw new Error('Archivio locale non disponibile. Conserva il file USB e usa un browser che supporti IndexedDB.');
  const digest = await hashText(text), items = await inbox();
  if (items.some(i => i.digest === digest)) { status('Questo file cifrato è già nell’archivio centrale.'); return; }
  items.push({ digest, encrypted: text, package_id: payload.package_id, count: payload.operations.length, staged_at: new Date().toISOString() });
  if (!await saveInbox(items)) throw new Error('Salvataggio del pacchetto non riuscito');
  if (!(await inbox()).some(i => i.digest === digest)) throw new Error('Il browser non ha conservato il pacchetto. Mantieni il file sulla USB.');
  $('key-result-file').value = '';
  status('Risultati conservati cifrati nella centrale. Puoi importare altri campi anche senza Internet; la sincronizzazione richiede una sessione autorizzata.');
  await renderInbox();
}
async function renderInbox() {
  const items = await inbox();
  $('key-inbox').innerHTML = items.length ? items.map(i => `<div class="offline-ops-row"><strong>${Number(i.count)} referti</strong> · ${safe(i.staged_at)}
    <span class="badge">${i.receipt ? 'Ricevuta disponibile' : 'In attesa di sincronizzazione'}</span>
    <button type="button" class="btn btn-ghost" data-key-sync="${safe(i.digest)}">${i.receipt ? 'Scarica ricevuta' : 'Verifica e sincronizza'}</button></div>`).join('')
    : '<p class="empty-state">Nessun pacchetto Key in attesa.</p>';
}
async function sync(digest) {
  const items = await inbox(), item = items.find(i => i.digest === digest);
  if (!item) throw new Error('Pacchetto non trovato');
  if (item.receipt) { download(item.receipt, 'itsoscup-key-receipt-' + item.package_id + '.json'); status('Ricevuta cifrata scaricata. Importala sulla chiavetta originale.'); return; }
  const pass = password(), payload = await decryptKeyPackage(item.encrypted, pass);
  if (!isNativeCentral() && !navigator.onLine) throw new Error('Serve Internet per inviare a Supabase. Il pacchetto rimane cifrato nell’archivio.');
  connection = await authorize();
  if (!window.confirm('Importare ' + payload.operations.length + ' referti firmati? Le versioni concorrenti verranno bloccate per revisione.')) return;
  status('Verifica integrità, autorizzazioni e versioni dei referti…');
  const results = [];
  for (const operation of payload.operations) results.push(await connection.runRpc('import_key_operation', { p_operation: operation }, 'Importazione referto #' + operation.match_id));
  const recorded = results.filter(r => ['imported', 'duplicate', 'conflict'].includes(r.status));
  if (!recorded.length) {
    status('Tutti i referti sono stati rifiutati. Nessuna ricevuta emessa: conserva il pacchetto e verifica il contenuto con il responsabile centrale.', true);
    return;
  }
  const receipt = await connection.runRpc('create_key_receipt', { p_preparation_id: payload.preparation_id, p_results_package_id: payload.package_id, p_operation_ids: recorded.map(r => r.operation_id) }, 'Ricevuta importazione');
  item.receipt = await encryptKeyPackage(receipt, pass);
  if (!await saveInbox(items)) throw new Error('Risultati verificati nella centrale; conservazione della ricevuta fallita. Riprova: gli ID impediscono duplicati.');
  download(item.receipt, 'itsoscup-key-receipt-' + payload.package_id + '.json');
  const count = state => results.filter(r => r.status === state).length;
  status('Verificati: ' + count('imported') + ' importati, ' + count('duplicate') + ' già presenti, ' + count('conflict') + ' conflitti, ' + count('rejected') + ' rifiutati. Riporta la ricevuta cifrata sulla chiavetta.');
  await renderInbox();
}
export function initializeKeyControl() {
  if (!$('key-central-panel')) return;
  $('key-connect').addEventListener('click', () => runAction(connect));
  $('key-prepare').addEventListener('click', () => runAction(prepare));
  $('key-stage').addEventListener('click', () => runAction(stage));
  $('key-sport').addEventListener('change', () => runAction(loadMatches));
  $('key-venue').addEventListener('change', () => runAction(loadMatches));
  $('key-inbox').addEventListener('click', event => { const button = event.target.closest('[data-key-sync]'); if (button) runAction(() => sync(button.dataset.keySync)); });
  $('key-lock').addEventListener('click', () => { $('key-password').value = ''; $('key-operator-pin').value = ''; $('key-supervisor-pin').value = ''; connection = null; $('key-preparation-fields').hidden = true; status('Password e PIN rimossi dalla schermata. I pacchetti restano cifrati.'); });
  window.addEventListener('pagehide', () => { $('key-password').value = ''; });
  renderInbox().catch(e => status(e.message, true));
}
