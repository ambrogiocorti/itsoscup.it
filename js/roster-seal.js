import {db,run} from './db.js';
import {requireAdmin} from './auth.js';
import {showAppConfirm,showToast} from './utils.js';
import {evaluateRosterReadiness} from './roster-readiness.js';
const $=id=>document.getElementById(id);
let initialized=false,role=null,busy=false,lastBlockers=[],lastWithoutProposal=[];
const msg=(s)=>{$('roster-seal-status').textContent=s};

function renderChecks(checks){
 const list=$('roster-seal-checks');
 if(!list)return;
 list.replaceChildren(...checks.map(check=>{
  const li=document.createElement('li');
  li.className='roster-check '+check.state;
  const icon=document.createElement('i');
  icon.className='fa-solid '+(check.state==='ok'?'fa-circle-check':check.state==='warn'?'fa-circle-exclamation':'fa-circle-xmark');
  icon.setAttribute('aria-hidden','true');
  const text=document.createElement('span');
  const strong=document.createElement('strong');strong.textContent=check.label;
  const small=document.createElement('small');small.textContent=check.detail;
  text.append(strong,small);li.append(icon,text);
  if(check.key==='invites'&&check.state==='error'&&role==='super_admin'){
   const button=document.createElement('button');button.type='button';button.className='btn btn-ghost btn-compact';
   button.innerHTML='<i class="fa-solid fa-user-slash" aria-hidden="true"></i> Escludi queste classi';
   button.addEventListener('click',()=>void excludeMissingClasses(button));
   li.append(button);
  }
  return li;
 }));
}

async function refresh(){
 const sid=Number($('class-registration-sport')?.value);
 const confirm=$('btn-roster-seal'),reopen=$('btn-roster-reopen');
 const label=document.querySelector('.roster-reopen-label');
 if(!sid){msg('Seleziona un torneo nella sezione Iscrizioni delle classi.');confirm.setAttribute('aria-disabled','true');reopen.hidden=true;label.hidden=true;renderChecks([]);return}
 try{
  const [sport,teams,registrations,invites]=await Promise.all([
   run(db.from('sports').select('id,roster_confirmed_at,registration_deadline').eq('id',sid).single(),'Torneo'),
   run(db.from('teams').select('id').eq('sport_id',sid),'Squadre'),
   run(db.from('class_registrations').select('invite_id,status,class_name').eq('sport_id',sid),'Proposte'),
   run(db.from('class_invites').select('id,is_active,class_name').eq('sport_id',sid),'Inviti')
  ]);
  const sealed=Boolean(sport.data.roster_confirmed_at);
  const readiness=evaluateRosterReadiness({sport:sport.data,teams:teams.data,registrations:registrations.data,invites:invites.data});
  lastBlockers=readiness.blockers;lastWithoutProposal=readiness.withoutProposal;
  $('roster-seal-badge').textContent=sealed?'Rose confermate':readiness.ready?'Pronte da confermare':'Da completare';
  $('roster-seal-badge').classList.toggle('sealed',sealed);
  $('roster-seal-badge').classList.toggle('ready',!sealed&&readiness.ready);
  confirm.hidden=sealed;reopen.hidden=!sealed;label.hidden=!sealed;
  // The button stays clickable: a click on a blocked roster explains what is missing
  // instead of silently doing nothing.
  const blocked=role!=='super_admin'||busy||!readiness.ready;
  confirm.setAttribute('aria-disabled',String(blocked));
  confirm.classList.toggle('is-blocked',blocked);
  reopen.disabled=role!=='super_admin'||busy;
  renderChecks(sealed?[]:readiness.checks);
  msg(sealed
   ?'Rose ufficialmente confermate il '+new Date(sport.data.roster_confirmed_at).toLocaleString('it-IT')+'. Modifiche bloccate fino a riapertura motivata.'
   :role!=='super_admin'?'Solo il Super Admin può confermare le rose.'
   :readiness.ready?'Tutte le condizioni sono soddisfatte: puoi confermare le rose.'
   :'Completa i punti segnati in rosso, poi conferma le rose.');
 }catch(error){msg('Verifica rose non riuscita: '+error.message);confirm.setAttribute('aria-disabled','true');reopen.hidden=true}
}

// Le classi invitate che non partecipano vanno escluse: il loro link smette di funzionare
// e non bloccano più la conferma. Si possono riattivare rigenerando l'invito.
async function excludeMissingClasses(button){
 const list=lastWithoutProposal.slice();
 if(!list.length)return;
 const names=list.map(i=>i.class_name).filter(Boolean).join(', ');
 const ok=await showAppConfirm('Le classi '+names+' non hanno inviato la rosa. Escluderle dal torneo? Il loro link di iscrizione verrà disattivato.',{title:'Escludi classi senza rosa',confirmLabel:'Escludi',tone:'warning'});
 if(!ok)return;
 button.disabled=true;
 try{
  await run(db.from('class_invites').update({is_active:false}).in('id',list.map(i=>i.id)),'Esclusione classi');
  showToast(list.length+(list.length===1?' classe esclusa.':' classi escluse.'),'success');
  document.dispatchEvent(new CustomEvent('itsos:class-registrations-changed'));
 }catch(error){showToast(error.message,'error');button.disabled=false}
}

async function applySeal(confirmed){
 if(busy)return;
 if(role!=='super_admin'){showToast('Solo il Super Admin può confermare o riaprire le rose.','error');return}
 const sid=Number($('class-registration-sport')?.value);
 if(!sid){showToast('Seleziona prima un torneo.','error');return}
 if(confirmed&&lastBlockers.length){
  msg('Non è ancora possibile confermare: '+lastBlockers.join(' '));
  showToast(lastBlockers[0],'error');
  $('roster-seal-checks')?.scrollIntoView({behavior:'smooth',block:'nearest'});
  return;
 }
 const reason=$('roster-reopen-reason').value.trim();
 if(!confirmed&&reason.length<10){msg('Indica il motivo della riapertura (almeno 10 caratteri).');$('roster-reopen-reason').focus();return}
 const ok=await showAppConfirm(confirmed?
   'Le rose del torneo diventano definitive: squadre, atleti e iscrizioni non si potranno più modificare fino a una riapertura motivata.':
   'Riaprire le rose? La motivazione e l’utente saranno registrati.',
   {title:confirmed?'Conferma rose definitive':'Riapri le rose',confirmLabel:confirmed?'Conferma rose':'Riapri',tone:confirmed?'warning':'danger'});
 if(!ok)return;
 busy=true;$('btn-roster-seal').setAttribute('aria-disabled','true');$('btn-roster-reopen').disabled=true;
 try{
  await run(db.rpc('set_tournament_roster_confirmation',{p_sport_id:sid,p_confirm:confirmed,p_reason:confirmed?null:reason}),'Conferma rose');
  if(!confirmed)$('roster-reopen-reason').value='';
  busy=false;await refresh();
  const text=confirmed?'Rose confermate e protette dal database.':'Rose riaperte. Motivo registrato nel sistema.';
  msg(text);showToast(text,'success');
 }catch(error){msg('Operazione non completata: '+error.message);showToast(error.message,'error')}
 finally{if(busy){busy=false;await refresh()}}
}
export async function initRosterSeal(){
 if(initialized){await refresh();return}
 if(!$('btn-roster-seal'))return;
 initialized=true;
 const access=await requireAdmin({redirectTo:'./'});if(!access.allowed)return;
 role=access.admin?.ruolo;
 $('class-registration-sport')?.addEventListener('change',()=>void refresh());
 $('btn-roster-refresh').addEventListener('click',()=>void refresh());
 $('btn-roster-seal').addEventListener('click',()=>void applySeal(true));
 $('btn-roster-reopen').addEventListener('click',()=>void applySeal(false));
 document.addEventListener('itsos:class-registrations-changed',()=>void refresh());
 await refresh();
}
