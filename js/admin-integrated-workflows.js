import {
  listClassInvites, createClassInvite, rotateClassInvite, listClassRegistrations,
  decideClassRegistration, sendClassNotice, listClassNoticeHistory,
  loadEventAnalytics, analyticsCsv, safeLabel
} from './class-portal-admin.js';

const el = (id) => document.getElementById(id);
const canEdit = (role) => role === 'super_admin' || role === 'match_manager';
const fullAccess = (role) => role === 'super_admin';
const formattedDate = (v) => { try { return v ? new Date(v).toLocaleString('it-IT') : '—'; } catch { return '—'; } };
const state = { role: '', sports: [], invites: [], registrations: [], analytics: null, noticeInvites: [], noticeHistory: [] };

function feedback(id, message = '', failed = false) {
  const box = el(id);
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('is-error', failed);
}
function option(label, value) {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = String(value);
  return o;
}
function setSportOptions(targetId, first = '') {
  const select = el(targetId);
  if (!select) return;
  const selected = String(first || select.value || '');
  const sports = state.sports.filter(s => Number(s.id) > 0 && String(s.sport_type||'').toLowerCase() !== 'atletica');
  select.replaceChildren(option('— Seleziona un torneo —',''),
    ...sports.map(s => option(s.name + (s.year ? ' · ' + s.year + '°' : ''),s.id)));
  if (sports.some(s => String(s.id) === selected)) select.value = selected;
  else if (sports.length) select.value = String(sports[0].id);
  select.disabled = !sports.length;
  if (!sports.length) select.replaceChildren(option('Nessun torneo disponibile — riprova',''));
}
function selectedSport(id) { return Number(el(id)?.value || 0); }
function empty(message) { return '<div class="empty-state compact">' + safeLabel(message) + '</div>'; }
function linkForCode(code) { return new URL('class.html?code=' + encodeURIComponent(code), document.baseURI).href; }
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
  } else {
    const box = document.createElement('textarea');
    box.value = text; box.style.position = 'fixed'; box.style.opacity = '0';
    document.body.append(box); box.focus(); box.select();
    const copied = document.execCommand('copy'); box.remove();
    if (!copied) throw new Error('Copia non disponibile: usare una connessione HTTPS');
  }
}
function renderInvites() {
  const container = el('class-invite-list');
  if (!container) return;
  container.innerHTML = state.invites.length ? state.invites.map(i => `
    <article class="itsos-flow-row">
      <div><strong>${safeLabel(i.class_name)}</strong>
        <small>${i.is_active ? 'Link valido' : 'Link disattivato'}</small></div>
      <div class="itsos-flow-actions">
        <button class="btn btn-ghost" type="button" data-class-action="copy" data-id="${safeLabel(i.id)}" title="Copia link di iscrizione"><i class="fa-solid fa-link"></i> Copia</button>
        <button class="btn btn-ghost" type="button" data-class-action="rotate" data-id="${safeLabel(i.id)}" title="Revoca vecchio link e genera un nuovo codice"><i class="fa-solid fa-arrows-rotate"></i></button>
      </div>
    </article>`).join('') : empty('Nessuna classe invitata per questo torneo.');
}
function renderRegistrations() {
  const container = el('class-registration-list');
  if (!container) return;
  container.innerHTML = state.registrations.length ? state.registrations.map(r => {
    const badge = r.status === 'approved' ? 'is-ok' : r.status === 'rejected' ? 'is-denied' : '';
    const status = {approved:'Confermata',rejected:'Da correggere',pending:'In attesa'}[r.status] || r.status;
    const roster = Array.isArray(r.roster) ? r.roster : [];
    return `<article class="itsos-flow-row" data-registration-id="${Number(r.id)}">
      <div><strong>${safeLabel(r.class_name)} <span class="itsos-flow-badge ${badge}">${safeLabel(status)}</span></strong>
        <small>Capitano: ${safeLabel(r.captain_name)} · ${roster.length} componenti · ${safeLabel(formattedDate(r.submitted_at))}</small>
        <details><summary class="itsos-flow-btn-link">Visualizza rosa</summary><p>${roster.map(safeLabel).join(' · ')}</p></details>
        ${r.decision_note ? '<p class="itsos-flow-muted">'+safeLabel(r.decision_note)+'</p>' : ''}
      </div>
      ${r.status === 'pending' ? `<div class="itsos-flow-approval">
        <label class="itsos-flow-help" for="registration-note-${Number(r.id)}">Motivazione facoltativa (richiesta in caso di rifiuto)</label>
        <textarea id="registration-note-${Number(r.id)}" rows="2" maxlength="500" placeholder="Es. Verificare il capitano o correggere i nominativi"></textarea>
        <div class="itsos-flow-actions">
          <button type="button" class="btn btn-primary" data-registration-action="approve" data-id="${Number(r.id)}"><i class="fa-solid fa-check"></i> Approva</button>
          <button type="button" class="btn btn-ghost" data-registration-action="reject" data-id="${Number(r.id)}"><i class="fa-solid fa-xmark"></i> Richiedi correzione</button>
        </div>
      </div>` : ''}
    </article>`;
  }).join('') : empty('Nessuna proposta ricevuta.');
}
async function refreshRegistrations() {
  const id = selectedSport('class-registration-sport');
  if (!id) {
    state.invites = []; state.registrations = []; renderInvites(); renderRegistrations(); return;
  }
  feedback('class-registration-feedback', 'Caricamento iscrizioni…');
  try {
    [state.invites, state.registrations] = await Promise.all([listClassInvites(id),listClassRegistrations(id)]);
    renderInvites(); renderRegistrations();
    feedback('class-registration-feedback','');
  } catch(error) {
    feedback('class-registration-feedback',error.message,true);
  }
}
async function handleInviteSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    await createClassInvite(selectedSport('class-registration-sport'),el('class-invite-name').value);
    el('class-invite-name').value = '';
    await refreshRegistrations();
    feedback('class-registration-feedback','Invito creato: condividere il link solo con la classe interessata.');
  } catch(error) { feedback('class-registration-feedback',error.message,true); }
  finally { if(button) button.disabled = false; }
}
async function onInviteListClick(event) {
  const button = event.target.closest('[data-class-action]');
  if (!button) return;
  const row = state.invites.find(i => i.id === button.dataset.id);
  if (!row) return;
  button.disabled = true;
  try {
    if (button.dataset.classAction === 'copy') {
      await copyText(linkForCode(row.access_code));
      feedback('class-registration-feedback','Link per '+row.class_name+' copiato.');
    }
    if (button.dataset.classAction === 'rotate') {
      if (!window.confirm('Rigenerare il codice di '+row.class_name+'? Il precedente collegamento non sarà più utilizzabile.')) return;
      await rotateClassInvite(row.id);
      await refreshRegistrations();
      feedback('class-registration-feedback','Codice rigenerato. Copiare e distribuire il nuovo collegamento.');
    }
  } catch(error) { feedback('class-registration-feedback',error.message,true); }
  finally {button.disabled = false;}
}
async function onRegistrationClick(event) {
  const button = event.target.closest('[data-registration-action]');
  if (!button) return;
  const id=Number(button.dataset.id), approve=button.dataset.registrationAction==='approve';
  const row=state.registrations.find(r=>Number(r.id)===id);
  if(!row)return;
  const note=el('registration-note-'+id)?.value.trim()||'';
  if(!approve && !note)return feedback('class-registration-feedback','Inserire la motivazione della correzione richiesta.',true);
  if(approve && !window.confirm('Confermare la squadra '+row.class_name+' e aggiungerla al torneo?'))return;
  button.disabled=true;
  try {
    await decideClassRegistration(id,approve,note);
    await refreshRegistrations();
    feedback('class-registration-feedback',approve?'Squadra confermata e aggiunta al torneo.':'Richiesta di correzione inviata alla classe.');
    if(approve) el('link-teams')?.click();
  } catch(error) { feedback('class-registration-feedback',error.message,true); }
  finally { button.disabled=false; }
}
function updateAudience() {
  const audience=el('public-notification-audience');
  if(!audience)return;
  const targeted=audience.value==='classes';
  el('public-notification-target-fields').hidden=!targeted;
  el('public-notification-public-options')?.classList.toggle('itsos-flow-hidden',targeted);
  const body=el('public-notification-body');
  if(body)body.maxLength=targeted?3000:600;
  if(targeted){
    const hiddenId=el('public-notification-id');
    if(hiddenId) hiddenId.value='';
  }
}
async function refreshNoticeInvites() {
  const id=selectedSport('class-notice-sport');
  const select=el('class-notice-recipients');
  if(!select)return;
  select.replaceChildren();
  if(!id)return;
  try {
    state.noticeInvites=(await listClassInvites(id)).filter(i=>i.is_active);
    select.replaceChildren(...state.noticeInvites.map(i=>option(i.class_name,i.id)));
    if(!state.noticeInvites.length) feedback('public-notice-feedback','Nessuna classe invitata: crea gli inviti da Squadre.',true);
    else feedback('public-notice-feedback','');
  } catch(error) { feedback('public-notice-feedback',error.message,true); }
}
async function refreshNoticeHistory() {
  const target=el('class-notification-history');
  if(!target || !canEdit(state.role))return;
  const id=selectedSport('class-notice-sport');
  if(!id){target.innerHTML=empty('Seleziona un torneo.');return;}
  target.innerHTML=empty('Caricamento avvisi…');
  try {
    state.noticeHistory=await listClassNoticeHistory(id);
    const invitations=await listClassInvites(id);
    const classesById=new Map(invitations.map(x=>[x.id,x.class_name]));
    target.innerHTML=state.noticeHistory.length?state.noticeHistory.map(n=>{
      const receipts=n.recipients||[];
      const read=receipts.filter(x=>Boolean(x.read_at));
      const pending=receipts.filter(x=>!x.read_at).map(x=>classesById.get(x.invite_id)||'Classe');
      return `<article class="itsos-flow-history-row">
        <strong>${safeLabel(n.title)}</strong>
        <p>${safeLabel(n.body)}</p>
        <small>${safeLabel(formattedDate(n.created_at))} · Letto da ${read.length}/${receipts.length} classi</small>
        ${pending.length?'<small>In attesa: '+pending.map(safeLabel).join(', ')+'</small>':''}
      </article>`;
    }).join(''):empty('Nessun avviso indirizzato alle classi del torneo.');
  } catch(error) {target.innerHTML=empty('Errore caricamento: '+error.message);}
}
async function handleClassNotification(event) {
  if(el('public-notification-audience')?.value!=='classes')return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const form=el('form-public-notification');
  const button=form?.querySelector('button[type="submit"]');
  const ids=[...(el('class-notice-recipients')?.selectedOptions||[])].map(o=>o.value);
  const title=el('public-notification-title')?.value.trim()||'';
  const body=el('public-notification-body')?.value.trim()||'';
  if(!selectedSport('class-notice-sport')||!ids.length||title.length<3||body.length<3){
    feedback('public-notice-feedback','Selezionare torneo, almeno una classe, titolo e messaggio (minimo 3 caratteri).',true);
    return;
  }
  if(button)button.disabled=true;
  feedback('public-notice-feedback','Pubblicazione in corso…');
  try {
    await sendClassNotice(selectedSport('class-notice-sport'),title,body,ids);
    el('public-notification-title').value='';
    el('public-notification-body').value='';
    feedback('public-notice-feedback','Avviso inviato alle classi selezionate.');
    await refreshNoticeHistory();
  } catch(error) { feedback('public-notice-feedback',error.message,true); }
  finally {if(button)button.disabled=false;}
}
function prepareNotifications() {
  const audience=el('public-notification-audience');
  if(!audience)return;
  if(!fullAccess(state.role)){
    const everyone=audience.querySelector('option[value="public"]');
    if(everyone)everyone.disabled=true;
    audience.value='classes';
  }
  audience.addEventListener('change',updateAudience);
  el('class-notice-sport')?.addEventListener('change',()=>{
    refreshNoticeInvites();
    refreshNoticeHistory();
  });
  el('btn-all-class-notice-recipients')?.addEventListener('click',()=>{
    for(const o of el('class-notice-recipients').options)o.selected=true;
  });
  el('btn-refresh-class-notices')?.addEventListener('click',refreshNoticeHistory);
  el('form-public-notification')?.addEventListener('submit',handleClassNotification,true);
  el('btn-reset-public-notification')?.addEventListener('click',()=>{
    window.setTimeout(()=>{if(!fullAccess(state.role)) audience.value='classes';updateAudience();feedback('public-notice-feedback','');},0);
  });
  el('public-notifications-admin-list')?.addEventListener('click',e=>{
    if(e.target.closest('[data-action="edit-public-notification"]')){
      audience.value='public';updateAudience();
    }
  });
  updateAudience();
}
function renderMetrics() {
  const target=el('event-analytics-kpis'),m=state.analytics;
  if(!target)return;
  if(!m){target.innerHTML=empty('Seleziona un torneo.');return;}
  const metrics=[
    ['Partite',m.total],['Concluse',m.completed],
    ['Da completare',m.pending],['Avvii in ritardo',m.lateStarts],
    ['Inizi monitorati',m.measuredStarts],
    ['Ritardo medio',m.averageDelay==null?'ND':m.averageDelay+' min'],
    ['Durata media',m.averageDuration==null?'ND':m.averageDuration+' min'],
    ['Riprogrammazioni',m.reschedules],['Riaperture',m.corrections]
  ];
  target.innerHTML=metrics.map(([name,value])=>`<div class="itsos-flow-metric"><strong>${safeLabel(value)}</strong><span>${safeLabel(name)}</span></div>`).join('');
}
async function refreshAnalytics() {
  const sportId=selectedSport('report-sport-select');
  state.analytics=null;
  renderMetrics();
  if(!sportId)return;
  feedback('event-analytics-feedback','Aggiornamento indicatori…');
  try {
    state.analytics=await loadEventAnalytics(sportId);
    renderMetrics();
    feedback('event-analytics-feedback',state.analytics.measuredStarts===0?'Ritardo medio ND: nessun orario di inizio misurato.':'');
  } catch(error) {feedback('event-analytics-feedback',error.message,true);}
}
function exportAnalytics(){
  if(!state.analytics){feedback('event-analytics-feedback','Seleziona un torneo e attendi il caricamento.',true);return;}
  const csv=analyticsCsv(state.analytics);
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='itsoscup-analisi-'+selectedSport('report-sport-select')+'.csv';
  document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export async function initIntegratedAdmin({role,sports=[]}={}){
  state.role=role||'';
  state.sports=Array.isArray(sports)?sports.filter(s=>s && Number(s.id)>0):[];
  if(!state.sports.length){
    try{
      const {loadSports}=await import('./matches.js');
      state.sports=await loadSports({includeInactive:true});
    }catch(error){
      feedback('class-registration-feedback','Tornei non caricati: '+error.message,true);
    }
  }
  setSportOptions('class-registration-sport');
  setSportOptions('class-notice-sport');
  prepareNotifications();
  el('public-notification-audience')?.addEventListener('change',()=>{
    feedback('public-notice-feedback',
      el('public-notification-audience').value==='classes'
        ? 'Seleziona un torneo e una o più classi qui sotto. Le classi senza invito si possono importare dalle squadre già presenti.'
        : '');
  });
  if(fullAccess(role)){
    el('class-registration-sport')?.addEventListener('change',refreshRegistrations);
    el('btn-refresh-class-registrations')?.addEventListener('click',refreshRegistrations);
    el('form-create-class-invite')?.addEventListener('submit',handleInviteSubmit);
    el('class-invite-list')?.addEventListener('click',onInviteListClick);
    el('class-registration-list')?.addEventListener('click',onRegistrationClick);
    await refreshRegistrations();
  }
  if(canEdit(role)){
    await Promise.all([refreshNoticeInvites(),refreshNoticeHistory()]);
  } else {
    const history=el('class-notification-history');
    if(history)history.innerHTML=empty('Area riservata ai responsabili.');
  }
  el('report-sport-select')?.addEventListener('change',refreshAnalytics);
  el('btn-export-event-analytics')?.addEventListener('click',exportAnalytics);
  await refreshAnalytics();
}
