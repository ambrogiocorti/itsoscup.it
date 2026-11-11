// Atletica: iscrizioni e risultati in un'unica tabella pensata per la velocità.
// Si scrive il valore, Invio salva in background e il cursore passa all'atleta successivo,
// così un operatore può registrare decine di tentativi al minuto senza aprire finestre.
import { db, run } from './db.js';
import { loadPlayersBySport } from './teams.js';
import { loadAthleticsConfigBySport } from './events.js';
import { requireAdmin } from './auth.js';
import { showToast, escapeHtml } from './utils.js';
import { isSportArchived, ARCHIVED_MESSAGE } from './archive-status.js';
import {
  attemptsOf, buildNextResult, formatAthleticsValue, initials, parseAthleticsValue, UNIT_LABELS,
} from './athletics-quick-core.js';

const $ = (id) => document.getElementById(id);
const S = {
  initialized: false, role: '', sportId: 0, eventId: 0, filter: 'entered', search: '', archived: false,
  events: [], players: [], results: new Map(), entries: new Map(), config: null,
  queue: new Map(), pending: 0, saved: 0, failed: 0, loadToken: 0,
};
const key = (eventId, playerId) => `${Number(eventId)}:${Number(playerId)}`;
const canWrite = () => S.role === 'super_admin' && !S.archived;
const currentEvent = () => S.events.find((e) => Number(e.id) === Number(S.eventId)) ?? null;

function setSync(state, text) {
  const box = $('qe-sync');
  if (!box) return;
  box.dataset.state = state;
  $('qe-sync-text').textContent = text;
}
function refreshSync() {
  if (S.pending) setSync('busy', `Salvataggio di ${S.pending}…`);
  else if (S.failed) setSync('error', `${S.failed} non salvati`);
  else setSync('idle', S.saved ? `Tutto salvato · ${S.saved} in questa sessione` : 'Tutto salvato');
}
function notifyChanged() {
  document.dispatchEvent(new CustomEvent('itsos:athletics-results-changed', { detail: { sportId: S.sportId } }));
}

function eventsWithResultsFor(playerId) {
  let n = 0;
  for (const e of S.events) if (S.results.has(key(e.id, playerId))) n += 1;
  return n;
}

function visiblePlayers() {
  const q = S.search.trim().toLocaleLowerCase('it');
  return S.players.filter((p) => {
    const k = key(S.eventId, p.id);
    if (S.filter === 'entered' && !S.entries.get(k) && !S.results.has(k)) return false;
    if (S.filter === 'missing' && S.results.has(k)) return false;
    if (!q) return true;
    return `${p.full_name} ${p.teams?.name ?? ''}`.toLocaleLowerCase('it').includes(q);
  });
}

function renderEventsTabs() {
  const box = $('qe-events');
  box.replaceChildren(...S.events.map((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'qe-event-tab';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(Number(e.id) === Number(S.eventId)));
    b.dataset.eventId = e.id;
    let done = 0, entered = 0;
    for (const p of S.players) { const k = key(e.id, p.id); if (S.results.has(k)) done += 1; if (S.entries.get(k)) entered += 1; }
    b.innerHTML = `<strong>${escapeHtml(e.name)}</strong><small>${done}/${Math.max(entered, done)} risultati</small>`;
    return b;
  }));
  if (!S.events.length) box.innerHTML = '<p class="qe-empty">Nessun evento: crealo con il pulsante + in basso a destra.</p>';
}

function rowHtml(p, index) {
  const ev = currentEvent();
  const k = key(ev.id, p.id);
  const row = S.results.get(k);
  const attempts = attemptsOf(row);
  const best = row ? Number(row.value) : null;
  const limit = Math.max(1, Number(S.config?.athletics_attempts_per_event ?? 1));
  const full = attempts.length >= limit;
  const entered = Boolean(S.entries.get(k));
  const pending = S.queue.has(k);
  const disabled = !canWrite();
  return `<tr data-player-id="${p.id}" class="${pending ? 'is-pending' : ''}">
    <td class="qe-col-check"><input type="checkbox" data-qe-entry aria-label="Iscritto: ${escapeHtml(p.full_name)}" ${entered ? 'checked' : ''} ${disabled ? 'disabled' : ''}></td>
    <td><div class="qe-athlete"><span class="qe-avatar" aria-hidden="true">${escapeHtml(initials(p.full_name))}</span><span><strong>${escapeHtml(p.full_name)}</strong><small>${escapeHtml(p.teams?.name ?? 'Classe')}</small></span></div></td>
    <td><div class="qe-attempts">${attempts.length ? attempts.map((v, i) => `<span class="qe-attempt${v === best ? ' is-best' : ''}" title="Tentativo ${i + 1}">${escapeHtml(formatAthleticsValue(v, ev.unit))}</span>`).join('') : '<span class="qe-muted">—</span>'}<span class="qe-limit">${attempts.length}/${Math.max(limit, attempts.length)}</span></div></td>
    <td class="qe-col-best">${best ? `<strong>${escapeHtml(formatAthleticsValue(best, ev.unit))}</strong>` : '<span class="qe-muted">—</span>'}</td>
    <td class="qe-col-input"><div class="qe-input-wrap"><input type="text" inputmode="decimal" autocomplete="off" data-qe-value data-index="${index}" placeholder="${full ? 'Completo' : ev.unit === 'time' ? 'es. 12,45 o 1:02,3' : 'es. 4,35'}" aria-label="Nuovo tentativo di ${escapeHtml(p.full_name)}" ${disabled || full ? 'disabled' : ''}><span class="qe-row-state" aria-hidden="true">${pending ? '<i class="fa-solid fa-spinner fa-spin"></i>' : ''}</span></div></td>
  </tr>`;
}

function renderTable({ keepFocus = null } = {}) {
  const body = $('qe-body');
  const ev = currentEvent();
  const total = { entries: 0, results: 0 };
  if (ev) for (const p of S.players) { const k = key(ev.id, p.id); if (S.entries.get(k)) total.entries += 1; if (S.results.has(k)) total.results += 1; }
  $('qe-count-entries').textContent = String(total.entries);
  $('qe-count-results').textContent = String(total.results);
  if (!S.sportId) { body.innerHTML = '<tr><td colspan="5" class="empty-state">Seleziona un torneo di atletica.</td></tr>'; return; }
  if (!ev) { body.innerHTML = '<tr><td colspan="5" class="empty-state">Crea almeno un evento per iniziare.</td></tr>'; return; }
  const limit = Math.max(1, Number(S.config?.athletics_attempts_per_event ?? 1));
  $('qe-rules').textContent = `${ev.name} · ${UNIT_LABELS[ev.unit] ?? ev.unit} · ${ev.sort_order === 'asc' ? 'vince il valore più basso' : 'vince il valore più alto'} · ${limit} ${limit === 1 ? 'tentativo' : 'tentativi'} per atleta`;
  const list = visiblePlayers();
  body.innerHTML = list.length
    ? list.map(rowHtml).join('')
    : `<tr><td colspan="5" class="empty-state">${S.filter === 'entered' ? 'Nessun iscritto a questo evento: scegli «Tutti» e spunta gli atleti da iscrivere.' : 'Nessun atleta corrisponde alla ricerca.'}</td></tr>`;
  if (keepFocus) body.querySelector(`tr[data-player-id="${keepFocus}"] [data-qe-value]`)?.focus();
}

function updateRow(playerId) {
  const tr = $('qe-body').querySelector(`tr[data-player-id="${playerId}"]`);
  const p = S.players.find((x) => Number(x.id) === Number(playerId));
  if (!tr || !p) return;
  const focused = tr.contains(document.activeElement) ? document.activeElement : null;
  const draft = tr.querySelector('[data-qe-value]')?.value ?? '';
  const index = Number(tr.querySelector('[data-qe-value]')?.dataset.index ?? 0);
  const tmp = document.createElement('tbody');
  tmp.innerHTML = rowHtml(p, index);
  const fresh = tmp.firstElementChild;
  const input = fresh.querySelector('[data-qe-value]');
  if (input && draft) input.value = draft;
  tr.replaceWith(fresh);
  if (focused?.matches('[data-qe-value]') && input && !input.disabled) input.focus();
  renderEventsTabs();
  const ev = currentEvent();
  let entries = 0, results = 0;
  for (const x of S.players) { const k = key(ev.id, x.id); if (S.entries.get(k)) entries += 1; if (S.results.has(k)) results += 1; }
  $('qe-count-entries').textContent = String(entries);
  $('qe-count-results').textContent = String(results);
}

async function fetchResult(eventId, playerId) {
  const { data } = await run(db.from('event_results').select('id,event_id,player_id,value,attempt_count,attempt_values,updated_at')
    .eq('event_id', Number(eventId)).eq('player_id', Number(playerId)).order('updated_at', { ascending: false }), 'Risultato atletica');
  return (data ?? [])[0] ?? null;
}

// Un solo salvataggio alla volta per atleta/evento; atleti diversi si salvano in parallelo.
async function persistAttempt(ev, playerId, value, attempt = 0) {
  const k = key(ev.id, playerId);
  const existing = S.results.get(k) ?? null;
  const limit = Math.max(1, Number(S.config?.athletics_attempts_per_event ?? 1));
  const maxEvents = Math.max(1, Number(S.config?.athletics_max_events_per_player ?? 99));
  const next = buildNextResult({ existing, value, order: ev.sort_order, attemptsLimit: limit, eventsWithResults: eventsWithResultsFor(playerId), maxEvents });
  const payload = { event_id: Number(ev.id), player_id: Number(playerId), ...next };
  let saved;
  if (existing) {
    // Il numero di tentativi già letto fa da controllo: se un altro dispositivo ha salvato
    // nel frattempo, nessuna riga viene aggiornata e si riprova con i dati aggiornati.
    let query = db.from('event_results').update(payload).eq('event_id', payload.event_id).eq('player_id', payload.player_id);
    if (existing.attempt_count != null) query = query.eq('attempt_count', Number(existing.attempt_count));
    const { data } = await run(query.select('id,event_id,player_id,value,attempt_count,attempt_values,updated_at'), 'Salvataggio tentativo');
    saved = (data ?? [])[0];
  } else {
    try {
      const { data } = await run(db.from('event_results').insert(payload).select('id,event_id,player_id,value,attempt_count,attempt_values,updated_at').single(), 'Salvataggio tentativo');
      saved = data;
    } catch (error) {
      if (!/duplicate|unique|23505/i.test(String(error?.message ?? error?.code ?? '')) || attempt) throw error;
    }
  }
  if (!saved) {
    if (attempt) throw new Error('Il risultato è stato modificato da un\'altra postazione. Ricarica e riprova.');
    const fresh = await fetchResult(ev.id, playerId);
    if (fresh) S.results.set(k, fresh); else S.results.delete(k);
    return persistAttempt(ev, playerId, value, attempt + 1);
  }
  S.results.set(k, { ...saved, attempt_values: saved.attempt_values ?? next.attempt_values, attempt_count: saved.attempt_count ?? next.attempt_count });
  if (!S.entries.get(k)) {
    // Chi ha un risultato è di fatto iscritto: l'iscrizione si registra in automatico.
    S.entries.set(k, true);
    run(db.rpc('set_athletics_entry', { p_sport_id: S.sportId, p_event_id: Number(ev.id), p_player_id: Number(playerId), p_registered: true }), 'Iscrizione atletica')
      .catch(() => { S.entries.set(k, false); updateRow(playerId); });
  }
}

function enqueueAttempt(playerId, value) {
  const ev = currentEvent();
  if (!ev) return;
  const k = key(ev.id, playerId);
  const previous = S.queue.get(k) ?? Promise.resolve();
  S.pending += 1; refreshSync();
  const job = previous.catch(() => null).then(() => persistAttempt(ev, playerId, value))
    .then(() => { S.saved += 1; notifyChanged(); })
    .catch((error) => {
      S.failed += 1;
      const name = S.players.find((p) => Number(p.id) === Number(playerId))?.full_name ?? 'Atleta';
      showToast(`${name}: ${error.message}`, 'error');
    })
    .finally(() => {
      S.pending -= 1;
      if (S.queue.get(k) === job) S.queue.delete(k);
      refreshSync();
      if (Number(S.eventId) === Number(ev.id)) updateRow(playerId);
    });
  S.queue.set(k, job);
  if (Number(S.eventId) === Number(ev.id)) updateRow(playerId);
}

async function toggleEntry(playerId, registered, checkbox) {
  const ev = currentEvent();
  const k = key(ev.id, playerId);
  if (!registered && S.results.has(k)) {
    checkbox.checked = true;
    showToast('Non puoi ritirare un atleta che ha già tentativi registrati.', 'error');
    return;
  }
  S.entries.set(k, registered);
  checkbox.disabled = true;
  try {
    await run(db.rpc('set_athletics_entry', { p_sport_id: S.sportId, p_event_id: Number(ev.id), p_player_id: Number(playerId), p_registered: registered }), registered ? 'Iscrizione atletica' : 'Ritiro atletica');
  } catch (error) {
    S.entries.set(k, !registered);
    showToast(error.message, 'error');
  } finally {
    updateRow(playerId);
  }
}

async function enrollVisible() {
  if (!canWrite()) return;
  const ev = currentEvent();
  if (!ev) return;
  const targets = visiblePlayers().filter((p) => !S.entries.get(key(ev.id, p.id)));
  if (!targets.length) { showToast('Tutti gli atleti visibili sono già iscritti.', 'info'); return; }
  const button = $('qe-enroll-visible');
  button.disabled = true;
  let ok = 0;
  // Pochi salvataggi in parallelo: veloce senza sovraccaricare il server.
  for (let i = 0; i < targets.length; i += 8) {
    const slice = targets.slice(i, i + 8);
    const outcome = await Promise.allSettled(slice.map((p) => run(db.rpc('set_athletics_entry', { p_sport_id: S.sportId, p_event_id: Number(ev.id), p_player_id: Number(p.id), p_registered: true }), 'Iscrizione atletica')));
    outcome.forEach((r, j) => { if (r.status === 'fulfilled') { ok += 1; S.entries.set(key(ev.id, slice[j].id), true); } });
  }
  button.disabled = false;
  showToast(`${ok} atleti iscritti a ${ev.name}.`, ok === targets.length ? 'success' : 'error');
  renderEventsTabs(); renderTable();
}

function applyArchiveState() {
  const banner = $('athletics-archive-banner');
  if (banner) banner.hidden = !S.archived;
  document.getElementById('view-events')?.classList.toggle('is-archived', S.archived);
  const enrollButton = $('qe-enroll-visible');
  if (enrollButton) enrollButton.disabled = !canWrite();
}

async function load() {
  const sportId = Number($('athletics-sport-select')?.value || 0);
  const token = ++S.loadToken;
  S.sportId = sportId;
  if (!sportId) { S.events = []; S.players = []; renderEventsTabs(); renderTable(); return; }
  $('qe-body').innerHTML = '<tr><td colspan="5" class="empty-state">Caricamento atleti e risultati…</td></tr>';
  try {
    const [events, players, entries, config, archived] = await Promise.all([
      run(db.from('events').select('id,name,unit,sort_order,is_active').eq('sport_id', sportId).order('name'), 'Eventi'),
      loadPlayersBySport(sportId),
      run(db.from('athletics_entries').select('event_id,player_id,status').eq('sport_id', sportId), 'Iscrizioni'),
      loadAthleticsConfigBySport(sportId),
      isSportArchived(sportId, { force: true }).catch(() => false),
    ]);
    const evs = (events.data ?? []).filter((e) => e.is_active !== false);
    const ids = evs.map((e) => e.id);
    const results = ids.length
      ? await run(db.from('event_results').select('id,event_id,player_id,value,attempt_count,attempt_values,updated_at').in('event_id', ids), 'Risultati')
      : { data: [] };
    if (token !== S.loadToken) return;
    S.events = evs;
    S.players = [...(players ?? [])].sort((a, b) => (a.teams?.name ?? '').localeCompare(b.teams?.name ?? '', 'it', { numeric: true }) || a.full_name.localeCompare(b.full_name, 'it'));
    S.config = config;
    S.archived = Boolean(archived);
    S.entries = new Map((entries.data ?? []).map((e) => [key(e.event_id, e.player_id), e.status === 'registered']));
    S.results = new Map();
    // Se esistono righe doppie (vecchi dati) si usa la più recente, come nel resto della piattaforma.
    for (const r of [...(results.data ?? [])].sort((a, b) => String(a.updated_at ?? '').localeCompare(String(b.updated_at ?? '')))) S.results.set(key(r.event_id, r.player_id), r);
    if (!S.events.some((e) => Number(e.id) === Number(S.eventId))) S.eventId = S.events[0]?.id ?? 0;
    applyArchiveState();
    renderEventsTabs();
    renderTable();
  } catch (error) {
    if (token === S.loadToken) $('qe-body').innerHTML = `<tr><td colspan="5" class="empty-state">Impossibile caricare i dati: ${escapeHtml(error.message)}</td></tr>`;
  }
}

function focusNext(fromInput, step = 1) {
  const inputs = [...$('qe-body').querySelectorAll('[data-qe-value]:not(:disabled)')];
  const at = inputs.indexOf(fromInput);
  const target = inputs[at + step] ?? (step > 0 ? null : inputs[0]);
  if (target) { target.focus(); target.select?.(); }
}

function bind() {
  $('athletics-sport-select')?.addEventListener('change', () => void load());
  $('qe-refresh')?.addEventListener('click', () => void load());
  $('qe-enroll-visible')?.addEventListener('click', () => void enrollVisible());
  $('qe-events')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-event-id]');
    if (!tab) return;
    S.eventId = Number(tab.dataset.eventId);
    renderEventsTabs(); renderTable();
    $('qe-body').querySelector('[data-qe-value]:not(:disabled)')?.focus();
  });
  document.querySelectorAll('[data-qe-filter]').forEach((button) => button.addEventListener('click', () => {
    S.filter = button.dataset.qeFilter;
    document.querySelectorAll('[data-qe-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    renderTable();
  }));
  let searchTimer = 0;
  $('qe-search')?.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.search = event.target.value; renderTable(); }, 120);
  });
  const body = $('qe-body');
  body.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-qe-value]');
    if (!input) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); focusNext(input, 1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); focusNext(input, -1); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!canWrite()) { showToast(S.archived ? ARCHIVED_MESSAGE : 'Solo il Super Admin registra i risultati.', 'error'); return; }
    const raw = input.value;
    if (!raw.trim()) { focusNext(input, 1); return; }
    const value = parseAthleticsValue(raw);
    if (value === null) {
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
      showToast('Valore non valido: usa numeri come 12,45 oppure 1:02,30.', 'error');
      return;
    }
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
    const playerId = Number(input.closest('tr').dataset.playerId);
    input.value = '';
    focusNext(input, 1);
    enqueueAttempt(playerId, value);
  });
  body.addEventListener('input', (event) => {
    const input = event.target.closest('[data-qe-value]');
    if (input?.classList.contains('is-invalid') && parseAthleticsValue(input.value) !== null) input.classList.remove('is-invalid');
  });
  body.addEventListener('change', (event) => {
    const box = event.target.closest('[data-qe-entry]');
    if (!box) return;
    if (!canWrite()) { box.checked = !box.checked; return; }
    void toggleEntry(Number(box.closest('tr').dataset.playerId), box.checked, box);
  });
  window.addEventListener('beforeunload', (event) => {
    if (S.pending) { event.preventDefault(); event.returnValue = ''; }
  });
}

/** Mantiene il nome storico: main-admin.js la chiama aprendo la sezione Atletica. */
export async function initAthleticsEnrollment() {
  if (S.initialized) { await load(); return; }
  if (!$('athletics-quick-entry')) return;
  S.initialized = true;
  const access = await requireAdmin({ redirectTo: './' });
  if (!access.allowed) return;
  S.role = access.admin?.ruolo;
  bind();
  await load();
}

export function getAthleticsQuickEntryState() {
  return { sportId: S.sportId, archived: S.archived };
}

// I punteggi ricalcolati altrove (finestra Inserisci) aggiornano anche questa tabella.
document.addEventListener('itsos:athletics-data-reloaded', () => { if (S.initialized) void load(); });
