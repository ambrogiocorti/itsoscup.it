import {db,run} from './db.js';
import {requireAdmin} from './auth.js';
const $=id=>document.getElementById(id);
let initialized=false,role=null,busy=false;
const msg=(s)=>{$('roster-seal-status').textContent=s};
async function refresh(){
 const sid=Number($('class-registration-sport')?.value);
 const confirm=$('btn-roster-seal'),reopen=$('btn-roster-reopen');
 const reason=$('roster-reopen-reason');
 const label=document.querySelector('.roster-reopen-label');
 if(!sid){msg('Seleziona un torneo nella sezione Iscrizioni delle classi.');confirm.disabled=true;reopen.hidden=true;label.hidden=true;return}
 try{
  const [sport,teams,registrations,invites]=await Promise.all([
   run(db.from('sports').select('id,roster_confirmed_at,registration_deadline').eq('id',sid).single(),'Torneo'),
   run(db.from('teams').select('id').eq('sport_id',sid),'Squadre'),
   run(db.from('class_registrations').select('invite_id,status').eq('sport_id',sid),'Proposte'),
   run(db.from('class_invites').select('id,is_active').eq('sport_id',sid),'Inviti')
  ]);
  const activeInvites=(invites.data||[]).filter(i=>i.is_active);
  const incompleteInvites=activeInvites.filter(i=>!(registrations.data||[]).some(r=>Number(r.invite_id)===Number(i.id)&&r.status==='approved'));
  const incomplete=registrations.data?.some(r=>r.status!=='approved')||incompleteInvites.length>0;
  const sealed=Boolean(sport.data.roster_confirmed_at);
  $('roster-seal-badge').textContent=sealed?'Rose confermate':'Da confermare';
  $('roster-seal-badge').classList.toggle('sealed',sealed);
  confirm.hidden=sealed;reopen.hidden=!sealed;label.hidden=!sealed;
  confirm.disabled=role!=='super_admin'||busy||!sport.data.registration_deadline||!teams.data?.length||incomplete;
  reopen.disabled=role!=='super_admin'||busy;
  msg(sealed
   ?'Rose ufficialmente confermate il '+new Date(sport.data.roster_confirmed_at).toLocaleString('it-IT')+'. Modifiche bloccate fino a riapertura motivata.'
   :!sport.data.registration_deadline?'Prima imposta una scadenza per le iscrizioni.'
   :incompleteInvites.length?'Ci sono '+incompleteInvites.length+' inviti attivi senza una proposta approvata. Verifica tutte le classi prima della conferma.'
   :incomplete?'Ci sono proposte da approvare o correggere prima della conferma.'
   :!teams.data?.length?'Nessuna squadra presente.':'Tutte le condizioni preliminari risultano soddisfatte. Puoi confermare la rosa.');
 }catch(error){msg('Verifica rose non riuscita: '+error.message);confirm.disabled=true;reopen.hidden=true}
}
async function applySeal(confirmed){
 if(role!=='super_admin'||busy)return;
 const sid=Number($('class-registration-sport')?.value);
 if(!sid)return;
 const reason=$('roster-reopen-reason').value.trim();
 if(!confirmed&&reason.length<10){msg('Indica il motivo della riapertura (almeno 10 caratteri).');return}
 if(!window.confirm(confirmed?
   'Confermare definitivamente le rose del torneo? Le modifiche successive saranno bloccate fino a riapertura motivata.':
   'Riaprire le rose? La motivazione e l’utente saranno registrati.'))return;
 busy=true;$('btn-roster-seal').disabled=true;$('btn-roster-reopen').disabled=true;
 try{
  await run(db.rpc('set_tournament_roster_confirmation',{p_sport_id:sid,p_confirm:confirmed,p_reason:confirmed?null:reason}),'Conferma rose');
  if(!confirmed)$('roster-reopen-reason').value='';
  await refresh();msg(confirmed?'Rose confermate e protette dal database.':'Rose riaperte. Motivo registrato nel sistema.');
 }catch(error){msg('Operazione non completata: '+error.message)}
 finally{busy=false;await refresh()}
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
 await refresh();
}
