import { renderMatchReport, assertMatchReportPrintCapacity } from '/match-report.js';
'use strict';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let state = null, currentId = null, busy = false, clockBase = 0, clockAt = 0, clockRunning = false;
const duration = seconds => [Math.floor(seconds / 60), seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
const labels = { score:'Punto / rete', presence:'Presenza', mvp:'Selezione MVP', foul:'Fallo', yellow_card:'Cartellino giallo', red_card:'Cartellino rosso', timeout:'Timeout', substitution:'Sostituzione', period:'Periodo', note:'Nota', timer_start:'Avvio cronometro', timer_stop:'Pausa cronometro', timer_set:'Correzione tempo', prepare_signatures:'Preparazione firme', captain_signature:'Firma capitano', finalize:'Chiusura referto', supervisor_reopen:'Riapertura autorizzata' };
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function request(name, args = {}) {
  const result = await window.itsoscupKey.call(name, args);
  if (!result.ok) { if (result.dirty) showPending(); throw new Error(result.error); }
  return result.value;
}
function showPending() {
  if (state) state.dirty = true;
  $('pending').hidden = false;
  for (const control of $('editor').querySelectorAll('button,input,select,textarea')) control.disabled = true;
}
async function perform(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (error) { message(error.message, true); }
  finally { busy = false; }
}
function accept(value) {
  if (value?.canceled) return;
  if (value?.view) value = value.view;
  if (!value || typeof value.unlocked !== 'boolean') return;
  state = value; render();
}
function render() {
  const unlocked = state?.unlocked, user = state?.user;
  if (!unlocked || !user) {
    $('print-report').replaceChildren(); $('editor').replaceChildren(); $('matches').replaceChildren();
    $('new-matches').replaceChildren(); $('preparation').replaceChildren(); $('user-name').textContent = ''; $('station-label').textContent = '';
    if (!unlocked) $('operator').replaceChildren();
    drawings.clear(); clockBase = 0; clockRunning = false;
    $('package-password').value = ''; $('login-pin').value = ''; $('new-pin').value = ''; $('setup-pin').value = '';
  }
  $('unlock-panel').hidden = unlocked; $('setup-panel').hidden = !unlocked || !state.setup_required;
  $('login-panel').hidden = !unlocked || state.setup_required || Boolean(user);
  $('workspace').hidden = !user; $('session-controls').hidden = !user; $('pending').hidden = !state?.dirty;
  if (!unlocked) { $('create-vault').checked = !state?.exists; $('archive-path').textContent = state?.directory || ''; return; }
  $('operator').innerHTML = state.operators.map(o => `<option value="${escape(o.id)}">${escape(o.name)} · ${o.role === 'supervisor' ? 'Supervisore' : 'Segnapunti'}</option>`).join('');
  if (!user) { $('editor').hidden = true; return; }
  $('user-name').textContent = user.name;
  $('station-label').textContent = 'Postazione ' + state.station_id + ' · ' + state.matches.length + ' partite';
  const total = state.matches.length;
  const signing = state.matches.filter(m => m.signing && !m.finalized).length;
  const readyToExport = state.matches.filter(m => m.finalized && !m.exported && !m.acknowledged).length;
  const needsReview = state.matches.filter(m => m.receipt?.status === 'conflict').length;
  $('key-overview').innerHTML = [
    ['Partite assegnate', total, 'fa-calendar-check'],
    ['Firme da completare', signing, 'fa-signature'],
    ['Da esportare', readyToExport, 'fa-file-arrow-up'],
    ['Da verificare', needsReview, 'fa-triangle-exclamation']
  ].map(([label, value, icon]) => `<div><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span><strong>${value}</strong></div>`).join('');
  const transferLink = document.querySelector('[data-key-link="transfers"]');
  if (transferLink) transferLink.hidden = user.role !== 'supervisor';
  $('supervisor-panel').hidden = user.role !== 'supervisor';
  $('key-nav-transfers').hidden = user.role !== 'supervisor';
  $('key-nav-editor').hidden = !(state.current && state.current.entry.match_id === currentId);
  const assigned = state.matches;
  $('key-stat-total').textContent = String(assigned.length);
  $('key-stat-open').textContent = String(assigned.filter(m => !m.finalized).length);
  $('key-stat-export').textContent = String(assigned.filter(m => m.finalized && !m.exported).length);
  $('key-stat-confirmed').textContent = String(assigned.filter(m => m.acknowledged).length);
  $('new-matches').innerHTML = state.matches.map(m => `<label class="check"><input type="checkbox" name="assigned-match" value="${m.match_id}">${escape(m.label)} · ${escape(m.venue)}</label>`).join('') || '<p class="key-note">Importa prima la preparazione delle partite.</p>';
  const selectedPreparation = $('preparation').value;
  $('preparation').innerHTML = state.preparations.map(p => `<option value="${escape(p.preparation_id)}">${escape(p.station_label)} · ${p.match_ids.length} partite${p.legacy ? ' · pacchetto precedente' : ''}</option>`).join('');
  if (state.preparations.some(p => p.preparation_id === selectedPreparation)) $('preparation').value = selectedPreparation;
  $('matches').innerHTML = state.matches.length ? state.matches.map(m => `<article class="key-card"><span class="key-pill ${m.acknowledged ? 'success' : m.receipt?.status === 'conflict' ? 'warning' : ''}">${escape(m.acknowledged ? 'Confermato dal centro' : m.receipt?.status === 'conflict' ? 'Conflitto da verificare al centro' : m.exported ? 'Esportato · attesa ricevuta' : m.finalized ? 'Referto chiuso' : m.signing ? 'Firme da completare' : 'Da giocare / in corso')}</span><h2>${escape(m.label)}</h2><p class="key-match-meta">${escape(m.sport)} · ${escape(m.venue)}<br>${escape(m.scheduled_start ? new Date(m.scheduled_start).toLocaleString('it-IT') : 'Orario da definire')} · #${m.match_id}</p><strong>${m.home_score} – ${m.away_score}</strong><div class="key-actions"><button class="btn btn-primary" data-open="${m.match_id}">Apri partita</button></div></article>`).join('') : '<div class="key-card"><h2>La postazione è pronta per la preparazione</h2><p>Il supervisore può importare un pacchetto cifrato dal centro. Ogni segnapunti vedrà soltanto le partite assegnate.</p></div>';
  if (state.current && state.current.entry.match_id === currentId) renderEditor(state.current);
  else $('editor').hidden = true;
}
function reportHTML(m) {
  const entry = m.entry;
  return renderMatchReport({
    match: entry.match,
    payload: m.payload,
    config: entry.config || {},
    homePlayers: entry.homePlayers || [],
    awayPlayers: entry.awayPlayers || [],
    stats: m.payload.stats_snapshot,
    eventLog: m.payload.event_log,
    signatures: m.signatures,
    staff: m.payload.staff,
    notes: m.payload.offline_notes,
    mode: m.finalized ? 'final' : 'draft',
    reportHash: m.report_hash,
    reportRevision: m.report_revision,
    deviceLabel: m.payload.device?.label || m.payload.device?.device_id,
  });
}
function eventsHTML(m) {
  return m.payload.event_log.length ? `<table class="key-table"><thead><tr><th>Minuto</th><th>Evento</th><th>Giocatore</th><th>Risultato</th><th>Note</th></tr></thead><tbody>${m.payload.event_log.map(e => `<tr><td>${e.minute}</td><td>${escape(labels[e.event_type] || e.event_type)}</td><td>${escape(m.payload.stats_snapshot.find(p=>p.player_id===e.player_id)?.player_name || '')}</td><td>${e.home_score} – ${e.away_score}</td><td>${escape(e.notes || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="key-note">Nessun evento registrato.</p>';
}
function renderEditor(m) {
  const e = m.entry, p = m.payload, config = e.config || {}, sport = String(e.match.sport?.sport_type || '').toLowerCase();
  const readonly = m.signing || m.finalized || state.dirty, disabled = readonly ? 'disabled' : '';
  clockBase = m.elapsed; clockAt = performance.now(); clockRunning = m.timer.running;
  $('editor').hidden = false;
  $('editor').innerHTML = `<div class="key-heading"><div><p class="eyebrow">Partita #${e.match_id}</p><h2>${escape(e.match.home?.name)} – ${escape(e.match.away?.name)}</h2></div><button class="btn btn-ghost" data-close>Chiudi schermata</button></div>
    ${m.timer_recovery ? '<p class="key-status">Il cronometro è stato fermato all’ultimo salvataggio dopo il riavvio. Verifica il tempo e correggilo se necessario.</p>' : ''}
    ${state.matches.find(x=>x.match_id===e.match_id)?.legacy ? '<p class="key-status">Preparazione precedente: il referto firmato richiede un nuovo pacchetto Key v2 dal centro.</p>' : ''}
    <div class="key-score">${['home','away'].map((side,i)=>`${i ? '<div><div id="clock" class="key-timer">'+duration(m.elapsed)+'</div><small>Periodo '+p.quarter+'</small></div>' : ''}<div><h3>${escape(e.match[side]?.name || side)}</h3><strong>${p[side+'_score']}</strong><div class="key-actions">${(sport==='basket'?[1,2,3]:[1]).map(points=>`<button class="btn btn-primary" ${disabled} data-action="score" data-side="${side}" data-points="${points}">+${points}</button>`).join('')}<button class="btn btn-ghost" ${disabled} data-action="score" data-side="${side}" data-points="-1">−1</button></div></div>`).join('')}</div>
    <div class="key-actions"><button class="btn btn-primary" ${disabled} data-action="${m.timer.running?'timer_stop':'timer_start'}">${m.timer.running?'Pausa':'Avvia cronometro'}</button><label>Tempo (secondi)<input id="timer-seconds" type="number" min="0" max="86400" value="${m.elapsed}" ${disabled}></label><button class="btn btn-ghost" ${disabled} data-action="timer_set">Imposta tempo</button><label>Periodo / set<input id="period" type="number" min="1" max="99" value="${p.quarter}" ${disabled}></label><button class="btn btn-ghost" ${disabled} data-action="period">Imposta periodo</button></div>
    ${(sport==='basket'||config.allow_timeouts) ? `<div class="key-actions">${['home','away'].map(side=>`<button class="btn btn-ghost" ${disabled} data-action="timeout" data-side="${side}">Timeout ${escape(e.match[side]?.name)} (${p.timeouts[side]}/${config.timeouts_per_team??2})</button>`).join('')}</div>` : ''}
    <h3 class="key-section-title">Presenze, punti e sanzioni</h3><div class="key-table-wrap"><table class="key-table"><thead><tr><th>Giocatore</th><th>Presenza</th><th>Punti</th><th>Sanzioni</th></tr></thead><tbody>${p.stats_snapshot.map(s=>`<tr><td>${[...(e.homePlayers||[]),...(e.awayPlayers||[])].find(x=>x.id===s.player_id)?.is_captain?`<strong>${escape(s.player_name)}</strong>`:escape(s.player_name)}${config.allow_mvp!==false?` <button class="btn btn-ghost key-mvp" ${disabled} data-action="mvp" data-player="${s.player_id}" aria-pressed="${s.is_mvp_vote}" title="${s.is_mvp_vote?'Rimuovi MVP':'Seleziona MVP'}: ${escape(s.player_name)}" aria-label="${s.is_mvp_vote?'Rimuovi MVP':'Seleziona MVP'}: ${escape(s.player_name)}">${s.is_mvp_vote?'★':'☆'}</button>`:''}${[...(e.homePlayers||[]),...(e.awayPlayers||[])].find(x=>x.id===s.player_id)?.is_captain?' <span class="key-pill">Capitano</span>':''}</td><td><button class="btn btn-ghost" ${disabled} data-action="presence" data-player="${s.player_id}" data-played="${!s.played}">${s.played?'Presente ✓':'Assente'}</button></td><td>${s.points_scored} <button class="btn btn-ghost" ${disabled} data-action="score" data-player="${s.player_id}" data-side="${s.team_id===e.match.home_team_id?'home':'away'}" data-points="1">+1</button></td><td>${sport==='basket'||config.allow_fouls?`<button class="btn btn-ghost" ${disabled} data-action="foul" data-player="${s.player_id}">Fallo ${s.fouls}</button>`:''}${config.allow_yellow_cards?`<button class="btn btn-ghost" ${disabled} data-action="yellow_card" data-player="${s.player_id}">Giallo ${s.yellow_cards}</button>`:''}${config.allow_red_cards?`<button class="btn btn-ghost" ${disabled} data-action="red_card" data-player="${s.player_id}">Rosso ${s.red_cards}</button>`:''}</td></tr>`).join('')}</tbody></table></div>
    ${config.allow_substitutions!==false ? `<div class="key-transfer"><label>Giocatore uscente<select id="out-player" ${disabled}>${p.stats_snapshot.map(s=>`<option value="${s.player_id}">${escape(s.player_name)}</option>`).join('')}</select></label><label>Giocatore entrante<select id="in-player" ${disabled}>${p.stats_snapshot.map(s=>`<option value="${s.player_id}">${escape(s.player_name)}</option>`).join('')}</select></label><button class="btn btn-ghost" ${disabled} data-action="substitution">Registra sostituzione</button></div>` : ''}
    <h3 class="key-section-title">Note ed eventi</h3><div class="key-transfer"><label>Nota evento<input id="event-note" maxlength="1000" ${disabled}></label><button class="btn btn-ghost" ${disabled} data-action="note">Aggiungi evento</button></div><div class="key-table-wrap">${eventsHTML(m)}</div>
    <details><summary>Referto e personale</summary><div class="key-grid-two">${[['referee','Arbitro'],['scorekeeper','Segnapunti'],['field_manager','Responsabile campo'],['supervisor','Supervisore']].map(([k,label])=>`<label>${label}<input id="staff-${k}" value="${escape(p.staff[k]||'')}" maxlength="100" ${disabled}></label>`).join('')}</div><div class="key-actions"><button class="btn btn-ghost" ${disabled} data-action="staff">Salva personale</button></div><label>Note del referto<textarea id="report-notes" maxlength="4000" ${disabled}>${escape(p.offline_notes)}</textarea></label><button class="btn btn-ghost" ${disabled} data-action="notes">Salva note</button></details>
    <h3 class="key-section-title">Chiusura e conferma dei capitani</h3>${m.signing ? `<p>Verificate il referto qui sotto. Dopo ogni correzione sarà necessario raccogliere entrambe le firme nuovamente.</p>${reportHTML(m)}<div class="key-grid-two">${['home','away'].map(side=>{const signed=m.signatures.some(s=>s.team_side===side);return `<section class="key-signature"><h3>${escape(e.match[side]?.name)}</h3>${signed?'<p class="key-pill success">Firma raccolta sul referto corrente</p>':`<canvas id="signature-${side}" width="600" height="180" aria-label="Firma del capitano ${escape(e.match[side]?.name)}"></canvas><label class="check"><input id="consent-${side}" type="checkbox">Ho verificato il referto e confermo per la mia squadra.</label><div class="key-actions"><button class="btn btn-primary" data-sign="${side}">Conferma firma</button><button class="btn btn-ghost" data-clear="${side}">Cancella</button></div>`}</section>`;}).join('')}</div><div class="key-actions"><button class="btn btn-primary" data-finalize ${m.signatures.length===2?'':'disabled'}>Chiudi referto firmato</button></div>` : m.finalized ? `<p class="key-pill success">Referto chiuso${m.acknowledged?' e confermato dal centro':''}</p><p class="key-hash">${escape(m.report_hash)}</p>` : '<p>Al termine, blocca punteggio ed eventi, mostra il referto ai capitani e raccogli le firme.</p><button class="btn btn-primary" data-prepare '+disabled+'>Termina partita e prepara firme</button>'}
    <div class="key-actions"><button class="btn btn-ghost" data-print>Stampa referto</button>${state.user.role==='supervisor'&&(m.signing||m.finalized)&&!m.exported?'<button class="btn btn-ghost" data-reopen>Correzione autorizzata · annulla firme</button>':''}</div><details><summary>Storico delle modifiche (${m.audit.length})</summary>${m.audit.slice().reverse().map(a=>`<p><strong>${escape(labels[a.action]||a.action)}</strong> · ${escape(a.actor_name)} · ${escape(new Date(a.at).toLocaleString('it-IT'))}${a.reason?'<br>'+escape(a.reason):''}</p>`).join('')}</details>`;
  $('print-report').innerHTML = reportHTML(m);
  for (const side of ['home','away']) bindSignature(side);
}
const drawings = new Map();
function bindSignature(side) {
  const canvas = $('signature-'+side); if (!canvas) return;
  const ctx=canvas.getContext('2d');ctx.lineWidth=3;ctx.lineCap='round';ctx.strokeStyle='#0f172a';let drawing=false,moves=0;
  const point=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];};
  canvas.addEventListener('pointerdown',e=>{drawing=true;canvas.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(...point(e));e.preventDefault();});
  canvas.addEventListener('pointermove',e=>{if(drawing){ctx.lineTo(...point(e));ctx.stroke();moves++;e.preventDefault();}});
  for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>{drawing=false;});
  drawings.set(side,{canvas,hasInk:()=>moves>3,clear:()=>{ctx.clearRect(0,0,canvas.width,canvas.height);moves=0;}});
}
async function edit(action, args={}) { const m=state.current; accept(await request('change',{match_id:currentId,expected_revision:m.local_revision,action,...args})); message('Operazione salvata sulla chiavetta.'); }
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;perform(async()=>{
  if(b.dataset.open){currentId=Number(b.dataset.open);accept(await request('view',{match_id:currentId}));$('editor').scrollIntoView({behavior:'smooth'});}
  if(b.hasAttribute('data-close')){currentId=null;$('editor').hidden=true;}
  if(b.dataset.action){const action=b.dataset.action,args={};if(b.dataset.side)args.side=b.dataset.side;if(b.dataset.player)args.player_id=Number(b.dataset.player);if(b.dataset.points)args.points=Number(b.dataset.points);if(b.dataset.played)args.played=b.dataset.played==='true';
    if(action==='timer_set')args.seconds=Number($('timer-seconds').value);if(action==='period')args.period=Number($('period').value);if(action==='note')args.notes=$('event-note').value;if(action==='notes')args.notes=$('report-notes').value;
    if(action==='substitution'){args.player_id=Number($('out-player').value);args.incoming_id=Number($('in-player').value);}if(action==='staff')args.staff=Object.fromEntries(['referee','scorekeeper','field_manager','supervisor'].map(k=>[k,$('staff-'+k).value]));await edit(action,args);}
  if(b.hasAttribute('data-prepare')){accept(await request('prepareSignatures',{match_id:currentId,expected_revision:state.current.local_revision}));message('Referto bloccato. Mostra il riepilogo ai capitani prima della firma.');}
  if(b.dataset.clear)drawings.get(b.dataset.clear)?.clear();
  if(b.dataset.sign){const side=b.dataset.sign,pad=drawings.get(side);if(!pad?.hasInk())throw new Error('Il capitano deve tracciare una firma sul riquadro');accept(await request('sign',{match_id:currentId,expected_revision:state.current.local_revision,side,signature_data_url:pad.canvas.toDataURL('image/png'),consent:$('consent-'+side).checked}));message('Firma collegata al referto e salvata sulla chiavetta.');}
  if(b.hasAttribute('data-finalize')){accept(await request('finalize',{match_id:currentId,expected_revision:state.current.local_revision}));message('Referto firmato chiuso e salvato sulla chiavetta. Il supervisore può esportarlo per il centro.');}
  if(b.hasAttribute('data-reopen')){const reason=window.prompt('Motivo della correzione (almeno 10 caratteri). Entrambe le firme saranno annullate.');if(reason!==null){accept(await request('reopen',{match_id:currentId,expected_revision:state.current.local_revision,reason}));message('Referto riaperto. Le firme precedenti sono annullate nello storico.');}}
  if(b.hasAttribute('data-print')){assertMatchReportPrintCapacity($('print-report'));await request('print',{match_id:currentId});}
});});
function wire(id, fn) { $(id).addEventListener('click',()=>perform(fn)); }
function form(id, fn) { $(id).addEventListener('submit',event=>{event.preventDefault();perform(fn);}); }
form('unlock-form',async()=>{accept(await request('unlock',{password:$('vault-password').value,create:$('create-vault').checked}));$('vault-password').value='';message('Archivio sbloccato. Accedi con il PIN personale.');});
wire('recover',async()=>{accept(await request('unlock',{password:$('vault-password').value,recover:true}));$('vault-password').value='';message('Recuperato il backup cifrato più recente disponibile. Verifica gli ultimi eventi e il cronometro di ogni partita.');});
wire('restore-backup',async()=>{const result=await request('restoreBackup',{password:$('vault-password').value});accept(result);if(!result.canceled){$('vault-password').value='';message('Backup recuperato sulla nuova chiavetta. Accedi e verifica gli ultimi referti prima di riprendere.');}});
form('setup-form',async()=>{accept(await request('setupSupervisor',{name:$('setup-name').value,pin:$('setup-pin').value}));$('setup-pin').value='';message('Supervisore configurato. Accedi per importare la preparazione.');});
form('login-form',async()=>{accept(await request('login',{operator_id:$('operator').value,pin:$('login-pin').value}));$('login-pin').value='';message('Postazione aperta. Tutte le operazioni sono salvate sulla chiavetta.');});
wire('logout',async()=>{currentId=null;accept(await request('logout'));});
wire('lock',async()=>{accept(await request('lock'));currentId=null;message('Archivio bloccato.');});
wire('retry',async()=>{accept(await request('retry',{match_id:currentId}));message('Salvataggio completato sulla chiavetta reinserita.');});
wire('import',async()=>{const result=await request('importPackage',{password:$('package-password').value});accept(result);if(!result.canceled){$('package-password').value='';message(result.duplicate?'Pacchetto già importato: nessun duplicato.':'Pacchetto verificato e importato sulla chiavetta.');}});
async function exportBatch(reexport=false){const result=await request('exportResults',{preparation_id:$('preparation').value,password:$('package-password').value,reexport});accept(result);$('package-password').value='';message(result.operations+' referti cifrati esportati: '+result.filename+'. Porta tutti i file al centro, poi importa le ricevute.'+(result.remaining_operations?' Rimangono '+result.remaining_operations+' referti: puoi esportare subito il prossimo lotto senza rete.':''));}
wire('export',()=>exportBatch());wire('reexport',()=>exportBatch(true));
wire('backup',async()=>{const result=await request('backup');if(!result.canceled)message('Backup cifrato salvato: '+result.filename+'. La password dell’archivio serve per il recupero.');});
form('add-operator-form',async()=>{const match_ids=Array.from(document.querySelectorAll('input[name="assigned-match"]:checked'),input=>Number(input.value));accept(await request('addOperator',{name:$('new-name').value,pin:$('new-pin').value,role:$('new-role').value,match_ids}));$('new-pin').value='';message('Operatore locale aggiunto con assegnazioni specifiche.');});
setInterval(()=>{const c=$('clock');if(c)c.textContent=duration(clockBase+(clockRunning?Math.max(0,Math.floor((performance.now()-clockAt)/1000)):0));},250);
setInterval(()=>{if(!busy&&state?.unlocked)perform(async()=>{const s=await request('status');if(s.dirty){showPending();message('Chiavetta non disponibile: dati in memoria, salvataggio da riprovare.',true);}});},5000);
perform(async()=>{accept(await request('status'));message('Applicazione pronta senza rete. Sblocca l’archivio della chiavetta.');});
