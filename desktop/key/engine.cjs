'use strict';
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { FORMAT, hash, tag, verifyTag, decode64, pinCredential, verifyPin } = require('./crypto.cjs');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy = value => JSON.parse(JSON.stringify(value));
const integer = (value, min = 0, max = 999999) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Numero non valido');
  return value;
};
const text = (value, max = 500) => { if (typeof value !== 'string' || value.length > max) throw new Error('Testo non valido'); return value.trim(); };
function validatePrepared(p) {
  if (!p || p.schema !== FORMAT || ![1, 2].includes(p.version) || p.kind !== 'prepared' || !Array.isArray(p.matches)
      || !p.matches.length || p.matches.length > 250 || (p.operations?.length ?? 0) !== 0) throw new Error('Selezionare un pacchetto di preparazione valido');
  if (p.version === 2) {
    if (!uuid.test(p.station_id) || !uuid.test(p.preparation_id)) throw new Error('Identità postazione non valida');
    decode64(p.authorization_secret, 32);
    if (!Array.isArray(p.operators) || !p.operators.some(o => o.role === 'supervisor')) throw new Error('La preparazione deve includere un supervisore');
  }
  const ids = new Set();
  for (const entry of p.matches) {
    integer(entry.match_id, 1); integer(entry.match?.id, 1);
    if (entry.match.id !== entry.match_id || ids.has(entry.match_id)) throw new Error('Partita duplicata o non valida');
    integer(entry.match.lock_version, 0); ids.add(entry.match_id);
    for (const side of ['home', 'away']) {
      const players = entry[side + 'Players'] || [];
      if (!Array.isArray(players) || players.length > 100) throw new Error('Rosa non valida');
      const seen = new Set();
      for (const player of players) {
        integer(player.id, 1);
        if (seen.has(player.id) || Number(player.team_id) !== Number(entry.match[side + '_team_id'])) throw new Error('Giocatore non assegnato alla squadra');
        seen.add(player.id);
      }
    }
  }
  for (const operator of p.operators || []) validateOperator(operator, ids);
  return p;
}
function validateOperator(operator, matches) {
  if (!uuid.test(operator.id) || !text(operator.name, 80) || !['operator', 'supervisor'].includes(operator.role)
      || !Array.isArray(operator.assigned_match_ids) || operator.assigned_match_ids.some(id => !matches.has(id))) throw new Error('Operatore o assegnazioni non validi');
  decode64(operator.pin_salt, 16); decode64(operator.pin_hash, 32);
}
function statsFor(entry, payload) {
  const existing = new Map((payload.stats_snapshot || entry.stats || []).map(row => [Number(row.player_id), row]));
  return [...(entry.homePlayers || []), ...(entry.awayPlayers || [])].map(player => {
    const row = existing.get(player.id) || {};
    return { player_id: player.id, player_name: String(player.full_name || ''), team_id: Number(player.team_id), played: Boolean(row.played),
      points_scored: integer(Number(row.points_scored || 0)), fouls: integer(Number(row.fouls || 0)), yellow_cards: integer(Number(row.yellow_cards || 0)),
      red_cards: integer(Number(row.red_cards || 0)), is_mvp_vote: Boolean(row.is_mvp_vote) };
  });
}
function initialMatch(entry, preparation) {
  const p = entry.match.live_payload || {};
  const payload = { home_score: integer(Number(p.home_score ?? entry.match.home_score ?? 0)), away_score: integer(Number(p.away_score ?? entry.match.away_score ?? 0)),
    duration: integer(Number(p.duration ?? entry.match.duration ?? 0)), quarter: integer(Number(p.quarter || 1), 1, 99),
    timeouts: { home: integer(Number(p.timeouts?.home || 0)), away: integer(Number(p.timeouts?.away || 0)) },
    stats_snapshot: statsFor(entry, p), event_log: copy(p.event_log || []), device: { id: preparation.station_id, device_id: preparation.station_id, label: preparation.station_label || 'ITSOSCup Key' },
    offline_notes: '', staff: {}, is_finished: false, updated_at: new Date().toISOString() };
  return { entry: copy(entry), preparation_id: preparation.preparation_id, base_version: entry.match.lock_version, local_revision: 0,
    report_revision: 1, payload, signatures: [], finalized: false, signing: false, operation: null, exported: false, acknowledged: false,
    timer: { running: false, started_at: null }, audit: [] };
}
class Engine {
  constructor(vault, { now = () => Date.now(), monotonic = () => Math.floor(performance.now()) } = {}) {
    this.vault = vault; this.user = null; this.failures = new Map(); this.now = now; this.monotonic = monotonic;
  }
  state() { return this.vault.read(); }
  requireUser() { if (!this.user) throw new Error('Accedere con il proprio PIN'); return this.user; }
  supervisor() { if (this.requireUser().role !== 'supervisor') throw new Error('Serve il PIN di un supervisore'); }
  authorized(match, state = this.state()) {
    const user = this.requireUser(), active = state.operators.find(o => o.id === user.id);
    if (!active || (active.role !== 'supervisor' && !active.assigned_match_ids.includes(match.entry.match_id))) throw new Error('Partita non assegnata a questo operatore');
  }
  setupSupervisor({ name, pin }) {
    const state = this.state();
    if (state.operators.length || state.preparations.length) throw new Error('Supervisore già configurato');
    const operator = { id: randomUUID(), name: text(name, 80), role: 'supervisor', ...pinCredential(pin), assigned_match_ids: [] };
    if (!operator.name) throw new Error('Inserire il nome del supervisore');
    state.operators.push(operator); this.vault.write(state); return this.view();
  }
  login({ operator_id, pin }) {
    const operator = this.state().operators.find(o => o.id === operator_id);
    const failure = this.failures.get(operator_id) || { count: 0, until: 0 };
    if (failure.until > this.now()) throw new Error('Troppi tentativi. Attendere un minuto');
    if (!operator || !verifyPin(pin, operator)) {
      failure.count++; if (failure.count >= 5) { failure.until = this.now() + 60000; failure.count = 0; }
      this.failures.set(operator_id, failure); throw new Error('Operatore o PIN errato');
    }
    this.failures.delete(operator_id); this.user = { id: operator.id, name: operator.name, role: operator.role }; return this.view();
  }
  logout() { this.user = null; return this.view(); }
  addOperator({ name, pin, role, match_ids }) {
    this.supervisor(); const state = this.state();
    const operator = { id: randomUUID(), name: text(name, 80), role, ...pinCredential(pin), assigned_match_ids: match_ids };
    validateOperator(operator, new Set(Object.keys(state.matches).map(Number)));
    state.operators.push(operator); this.vault.write(state); return this.view();
  }
  importPrepared(payload) {
    this.supervisor(); validatePrepared(payload); const state = this.state();
    if (state.preparations.some(p => p.preparation_id === payload.preparation_id)) return { duplicate: true, view: this.view() };
    const conflicts = payload.matches.filter(entry => state.matches[entry.match_id]);
    if (conflicts.length) throw new Error('Partite già presenti (' + conflicts.map(e => e.match_id).join(', ') + '): nessuna sovrascrittura consentita');
    const v2 = payload.version === 2;
    if (v2 && state.preparations.length && state.station_id !== payload.station_id) throw new Error('Questo pacchetto è assegnato a una postazione diversa');
    if (v2 && !state.preparations.length) state.station_id = payload.station_id;
    const preparation = { preparation_id: v2 ? payload.preparation_id : randomUUID(), station_id: state.station_id,
      station_label: text(String(payload.station_label || 'ITSOSCup Key'), 80), legacy: !v2,
      authorization_secret: v2 ? payload.authorization_secret : null, imported_at: new Date(this.now()).toISOString(), match_ids: payload.matches.map(e => e.match_id) };
    state.preparations.push(preparation);
    for (const entry of payload.matches) state.matches[entry.match_id] = initialMatch(entry, preparation);
    for (const operator of payload.operators || []) {
      const previous = state.operators.find(o => o.id === operator.id);
      if (previous && hash(previous) !== hash(operator)) throw new Error('Credenziali operatore già esistenti e diverse');
      if (!previous) state.operators.push(copy(operator));
    }
    state.audit.push({ id: randomUUID(), type: 'prepare_import', preparation_id: preparation.preparation_id, actor: this.user.id, at: new Date(this.now()).toISOString() });
    this.vault.write(state); return { duplicate: false, view: this.view() };
  }
  find(id, revision) {
    integer(id, 1); const state = this.state(), match = state.matches[id];
    if (!match) throw new Error('Partita non preparata su questa postazione');
    this.authorized(match, state);
    if (revision != null && revision !== match.local_revision) throw new Error('La partita è cambiata: aggiornare la schermata prima di riprovare');
    return { state, match };
  }
  elapsed(match) {
    return match.payload.duration + (match.timer.running ? Math.max(0, Math.floor((this.monotonic() - match.timer.started_at) / 1000)) : 0);
  }
  pause(match) { match.payload.duration = this.elapsed(match); match.timer = { running: false, started_at: null }; }
  audit(match, action, before, reason, detail = {}) {
    const row = { id: randomUUID(), actor_id: this.user.id, actor_name: this.user.name, role: this.user.role, action,
      at: new Date(this.now()).toISOString(), reason: reason || '', details: detail, before_hash: before,
      after_hash: hash(match.payload), previous_hash: match.audit.at(-1)?.hash || null, local_revision: match.local_revision + 1 };
    row.hash = hash(row); match.audit.push(row); match.local_revision++;
  }
  change({ match_id, expected_revision, action, ...arg }) {
    const { state, match } = this.find(match_id, expected_revision);
    if (match.finalized || match.signing) throw new Error('Referto bloccato. Il supervisore deve riaprire con una motivazione');
    if (match.audit.length >= 9995 || match.payload.event_log.length >= 9995) throw new Error('Limite dello storico raggiunto: chiudere questo referto prima di registrare altre operazioni');
    const before = hash(match.payload), config = match.entry.config || {}, sport = String(match.entry.match.sport?.sport_type || '').toLowerCase();
    const side = arg.side;
    const requireSide = () => { if (!['home', 'away'].includes(side)) throw new Error('Squadra non valida'); };
    let player, statistic;
    if (arg.player_id != null) {
      player = [...(match.entry.homePlayers || []), ...(match.entry.awayPlayers || [])].find(p => p.id === arg.player_id);
      if (!player) throw new Error('Giocatore non appartenente alla partita');
      statistic = match.payload.stats_snapshot.find(s => s.player_id === player.id);
    }
    const expelled = s => sport === 'calcio' ? s.red_cards >= Number(config.max_red_cards || 1) || s.yellow_cards >= Number(config.max_yellow_cards || 2) : s.fouls >= Number(config.max_fouls || 3);
    const event = (event_type, extra = {}) => match.payload.event_log.push({ id: randomUUID(), event_type,
      team_id: side ? match.entry.match[side + '_team_id'] : player?.team_id || null, player_id: player?.id || null,
      minute: Math.floor(this.elapsed(match) / 60), home_score: match.payload.home_score, away_score: match.payload.away_score,
      notes: text(String(arg.notes || ''), 1000), created_at: new Date(this.now()).toISOString(), ...extra });
    switch (action) {
      case 'timer_start':
        if (match.timer.running) throw new Error('Cronometro già avviato');
        match.timer = { running: true, started_at: this.monotonic() }; break;
      case 'timer_stop': this.pause(match); break;
      case 'timer_set': this.pause(match); match.payload.duration = integer(arg.seconds, 0, 86400); break;
      case 'period': match.payload.quarter = integer(arg.period, 1, 99); event('period'); break;
      case 'score':
        requireSide(); integer(arg.points, -3, 3);
        if (arg.points === 0 || (sport !== 'basket' && Math.abs(arg.points) !== 1)) throw new Error('Incremento punti non previsto dal regolamento');
        if (statistic && (statistic.team_id !== match.entry.match[side + '_team_id'] || !statistic.played || expelled(statistic))) throw new Error('Selezionare un giocatore presente e non espulso della squadra');
        match.payload[side + '_score'] = integer(match.payload[side + '_score'] + arg.points, 0, 9999);
        if (statistic) statistic.points_scored = integer(statistic.points_scored + arg.points, 0, 9999);
        event('score', { points: arg.points }); break;
      case 'presence':
        if (!statistic) throw new Error('Selezionare un giocatore'); statistic.played = Boolean(arg.played); event('presence', { played: statistic.played }); break;
      case 'foul':
      case 'yellow_card':
      case 'red_card': {
        if (!statistic || !statistic.played || expelled(statistic)) throw new Error('Selezionare un giocatore presente e non espulso');
        if (action === 'yellow_card' && !config.allow_yellow_cards || action === 'red_card' && !config.allow_red_cards || action === 'foul' && sport !== 'basket' && !config.allow_fouls) throw new Error('Sanzione non prevista dalle impostazioni di questo sport');
        const field = { foul: 'fouls', yellow_card: 'yellow_cards', red_card: 'red_cards' }[action];
        const limit = Number(config['max_' + field] || (action === 'foul' ? 3 : action === 'yellow_card' ? 2 : 1));
        if (statistic[field] >= limit) throw new Error('Limite sanzioni raggiunto'); statistic[field]++; event(action); break;
      }
      case 'timeout':
        requireSide(); if ((sport !== 'basket' && !config.allow_timeouts) || match.payload.timeouts[side] >= Number(config.timeouts_per_team ?? 2)) throw new Error('Timeout non disponibile');
        match.payload.timeouts[side]++; this.pause(match); event('timeout'); break;
      case 'substitution': {
        if (config.allow_substitutions === false) throw new Error('Sostituzioni disabilitate');
        const incoming = match.payload.stats_snapshot.find(s => s.player_id === arg.incoming_id);
        if (!statistic || !incoming || statistic.team_id !== incoming.team_id || statistic.player_id === incoming.player_id || !statistic.played || expelled(incoming)) throw new Error('Sostituzione non valida');
        incoming.played = true; event('substitution', { incoming_player_id: incoming.player_id }); break;
      }
      case 'note': event('note'); break;
      case 'staff': match.payload.staff = Object.fromEntries(['referee', 'scorekeeper', 'field_manager', 'supervisor'].map(k => [k, text(String(arg.staff?.[k] || ''), 100)])); break;
      case 'notes': match.payload.offline_notes = text(arg.notes, 4000); break;
      default: throw new Error('Operazione non supportata');
    }
    match.payload.updated_at = new Date(this.now()).toISOString();
    this.audit(match, action, before, '', { ...arg }); this.vault.write(state); return this.view(match_id);
  }
  prepareSignatures({ match_id, expected_revision }) {
    const { state, match } = this.find(match_id, expected_revision);
    if (state.preparations.find(p => p.preparation_id === match.preparation_id).legacy) throw new Error('Pacchetto precedente: preparare una postazione Key v2 dal centro per chiudere e sincronizzare referti firmati');
    if (match.finalized || match.signing) throw new Error('Referto già pronto per la firma');
    if (match.audit.length > 9995 || match.payload.event_log.length > 10000
        || Buffer.byteLength(JSON.stringify({ payload: match.payload, audit_log: match.audit })) > 2 * 1024 * 1024 - 450000)
      throw new Error('Referto oltre il limite di trasferimento: richiedere verifica al centro. Le firme non sono state bloccate');
    for (const side of ['home', 'away']) if (!(match.entry[side + 'Players'] || []).some(p => p.is_captain)) throw new Error('Capitano non presente nella rosa ' + side);
    const before = hash(match.payload); this.pause(match); match.payload.is_finished = true; match.payload.updated_at = new Date(this.now()).toISOString();
    match.report_hash = hash({ match_id, payload: match.payload, report_revision: match.report_revision });
    match.signing = true; match.signatures = [];
    this.audit(match, 'prepare_signatures', before, ''); this.vault.write(state); return this.view(match_id);
  }
  sign({ match_id, expected_revision, side, signature_data_url, consent }) {
    const { state, match } = this.find(match_id, expected_revision);
    if (!match.signing || match.finalized || !['home', 'away'].includes(side) || consent !== true) throw new Error('Il capitano deve verificare e accettare il referto prima di firmare');
    if (typeof signature_data_url !== 'string' || signature_data_url.length > 200000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(signature_data_url)) throw new Error('Firma PNG non valida');
    const png = Buffer.from(signature_data_url.split(',')[1], 'base64');
    if (png.length < 67 || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Firma PNG danneggiata');
    const captain = match.entry[side + 'Players'].find(p => p.is_captain);
    if (match.signatures.some(s => s.team_side === side)) throw new Error('Capitano già firmatario');
    match.signatures.push({ team_side: side, team_id: match.entry.match[side + '_team_id'], player_id: captain.id,
      captain_name: String(captain.full_name || ''), signature_data_url, signed_at: new Date(this.now()).toISOString(), report_hash: match.report_hash,
      consent_text: 'Ho verificato punteggio, presenze ed eventi del referto e confermo la firma per la mia squadra.', witnessed_by: this.user.id });
    this.audit(match, 'captain_signature', hash(match.payload), '', { side, report_hash: match.report_hash });
    this.vault.write(state); return this.view(match_id);
  }
  finalize({ match_id, expected_revision }) {
    const { state, match } = this.find(match_id, expected_revision);
    if (!match.signing || match.finalized || match.signatures.length !== 2 || match.signatures.some(s => s.report_hash !== match.report_hash)) throw new Error('Servono entrambe le firme sullo stesso referto');
    if (hash({ match_id, payload: match.payload, report_revision: match.report_revision }) !== match.report_hash) throw new Error('Il referto è cambiato dopo la firma');
    this.audit(match, 'finalize', hash(match.payload), '');
    const preparation = state.preparations.find(p => p.preparation_id === match.preparation_id);
    const op = { id: randomUUID(), type: 'key_report', match_id, base_version: match.base_version, preparation_id: match.preparation_id,
      station_id: state.station_id, payload: copy(match.payload), report_revision: match.report_revision, report_hash: match.report_hash,
      signatures_payload: copy(match.signatures), audit_log: copy(match.audit) };
    op.auth_tag = tag(op, preparation.authorization_secret);
    if (Buffer.byteLength(JSON.stringify(op)) > 2 * 1024 * 1024 || op.audit_log.length > 10000 || op.payload.event_log.length > 10000)
      throw new Error('Referto troppo grande per il centro: nessuna chiusura registrata');
    match.operation = op; match.finalized = true; match.signing = false; this.vault.write(state); return this.view(match_id);
  }
  reopen({ match_id, expected_revision, reason }) {
    this.supervisor(); const { state, match } = this.find(match_id, expected_revision);
    if (!match.finalized && !match.signing) throw new Error('Referto già modificabile');
    if (!text(reason, 1000) || reason.trim().length < 10) throw new Error('Motivazione obbligatoria di almeno 10 caratteri');
    if (match.exported || match.acknowledged) throw new Error('Referto già esportato: correggere al centro e preparare una nuova assegnazione per evitare risultati concorrenti');
    const before = hash(match.payload); match.payload.is_finished = false; match.signatures = []; match.report_hash = null;
    match.operation = null; match.finalized = false; match.signing = false; match.report_revision++;
    this.audit(match, 'supervisor_reopen', before, reason); this.vault.write(state); return this.view(match_id);
  }
  results(preparation_id, { reexport = false } = {}) {
    this.supervisor(); const state = this.state(), preparation = state.preparations.find(p => p.preparation_id === preparation_id);
    if (!preparation) throw new Error('Preparazione non trovata');
    if (preparation.legacy) throw new Error('Per esportare referti verificabili occorre una preparazione Key v2');
    const eligible = Object.values(state.matches).filter(m => m.preparation_id === preparation_id && m.operation && !m.acknowledged
      && (reexport ? m.exported : !m.exported)).map(m => copy(m.operation));
    if (!eligible.length) throw new Error('Nessun referto chiuso da esportare. Le copie già esportate restano nella cartella exchange; è possibile ricrearle');
    const result = { schema: FORMAT, version: 2, kind: 'results', package_id: randomUUID(), station_id: state.station_id, preparation_id,
      device_id: state.station_id, created_at: new Date(this.now()).toISOString(), matches: [], operations: [], remaining_operations: 0 };
    let bytes = Buffer.byteLength(JSON.stringify(result));
    for (const op of eligible) {
      const size = Buffer.byteLength(JSON.stringify(op)) + 1;
      if (bytes + size > 10 * 1024 * 1024) break;
      result.operations.push(op); bytes += size;
    }
    if (!result.operations.length) throw new Error('Referto oltre il limite del pacchetto');
    result.remaining_operations = eligible.length - result.operations.length; return result;
  }
  markExported(payload) {
    this.supervisor(); const state = this.state();
    for (const op of payload.operations) { const m = state.matches[op.match_id]; if (!m || m.operation?.id !== op.id) throw new Error('Referto cambiato durante l’esportazione'); m.exported = true; }
    state.audit.push({ id: randomUUID(), type: 'export_results', package_id: payload.package_id, actor: this.user.id, at: new Date(this.now()).toISOString(), operation_ids: payload.operations.map(o => o.id) });
    this.vault.write(state); return this.view();
  }
  importReceipt(receipt) {
    this.supervisor(); const state = this.state(), preparation = state.preparations.find(p => p.preparation_id === receipt?.preparation_id);
    if (receipt?.schema !== FORMAT || receipt.version !== 2 || receipt.kind !== 'receipt' || !uuid.test(receipt.receipt_id)
        || receipt.station_id !== state.station_id || !preparation || !Array.isArray(receipt.results) || !verifyTag(receipt, preparation.authorization_secret)) throw new Error('Ricevuta non autentica o di un’altra postazione');
    if (state.receipts.some(r => r.receipt_id === receipt.receipt_id)) return { duplicate: true, view: this.view() };
    const exported = state.audit.find(row => row.type === 'export_results' && row.package_id === receipt.package_id);
    if (!exported) throw new Error('Ricevuta di un pacchetto mai esportato da questa chiavetta');
    const seen = new Set();
    for (const row of receipt.results) {
      if (seen.has(row.operation_id) || !['imported', 'duplicate', 'conflict', 'rejected'].includes(row.status)) throw new Error('Esito ricevuta non valido');
      seen.add(row.operation_id);
      const match = Object.values(state.matches).find(m => m.operation?.id === row.operation_id);
      if (!match || match.preparation_id !== receipt.preparation_id) throw new Error('La ricevuta contiene un referto sconosciuto');
      const { auth_tag, ...content } = match.operation;
      if (!exported.operation_ids.includes(row.operation_id) || row.report_hash !== match.operation.report_hash || row.content_hash !== hash(content)) throw new Error('La ricevuta si riferisce a una versione diversa del referto');
      if (['imported', 'duplicate'].includes(row.status)) { integer(row.remote_version, 0); match.acknowledged = true; }
      match.receipt = copy(row);
    }
    state.receipts.push(copy(receipt)); this.vault.write(state); return { duplicate: false, view: this.view() };
  }
  recoverTimers() {
    const state = this.state(); let changed = false;
    for (const match of Object.values(state.matches)) if (match.timer.running) {
      // A crash/restart stops the clock at its last checkpoint; guessing wall time
      // would silently count periods when the game was interrupted.
      match.timer = { running: false, started_at: null }; match.timer_recovery = true; changed = true;
    }
    if (changed) this.vault.write(state);
  }
  checkpoint() {
    if (this.vault.dirty) return;
    const state = this.state(); let changed = false;
    for (const match of Object.values(state.matches)) if (match.timer.running) {
      match.payload.duration = this.elapsed(match); match.timer.started_at = this.monotonic(); changed = true;
    }
    if (changed) this.vault.write(state);
  }
  view(match_id = null) {
    const state = this.state();
    const result = { unlocked: true, dirty: this.vault.dirty, station_id: state.station_id, user: this.user, setup_required: !state.operators.length,
      operators: state.operators.map(o => ({ id: o.id, name: o.name, role: o.role })), generation: this.vault.generation,
      preparations: this.user?.role === 'supervisor' ? state.preparations.map(({ authorization_secret, ...p }) => p) : [], matches: [] };
    if (!this.user) return result;
    const operator = state.operators.find(o => o.id === this.user.id);
    result.matches = Object.values(state.matches).filter(m => operator?.role === 'supervisor' || operator?.assigned_match_ids.includes(m.entry.match_id)).map(m => ({
      match_id: m.entry.match_id, label: String(m.entry.match.home?.name || 'Casa') + ' – ' + String(m.entry.match.away?.name || 'Ospite'),
      scheduled_start: m.entry.match.scheduled_start || null, venue: m.entry.match.venue?.name || '', sport: m.entry.match.sport?.name || '',
      home_score: m.payload.home_score, away_score: m.payload.away_score, finalized: m.finalized, signing: m.signing,
      acknowledged: m.acknowledged, exported: m.exported, legacy: state.preparations.find(p => p.preparation_id === m.preparation_id).legacy, receipt: m.receipt || null }));
    if (match_id != null) {
      const { match } = this.find(match_id); result.current = copy(match); result.current.elapsed = this.elapsed(match);
    }
    return result;
  }
}
module.exports = { Engine, validatePrepared, integer };
