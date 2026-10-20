import {db,run} from './db.js';
import {loadPlayersBySport} from './teams.js';
import {requireAdmin} from './auth.js';
const $=id=>document.getElementById(id);
let initialized=false,role='',busy=false;
const msg=text=>{if($('ath-entry-status'))$('ath-entry-status').textContent=text};
async function load(){
 const id=Number($('athletics-sport-select')?.value);
 if(!id){msg('Seleziona un torneo di atletica.');return}
 msg('Caricamento iscrizioni…');
 try{
  const [events,players,entries]=await Promise.all([
   run(db.from('events').select('id,name').eq('sport_id',id).order('name'),'Eventi'),
   loadPlayersBySport(id),
   run(db.from('athletics_entries').select('id,event_id,player_id,status').eq('sport_id',id),'Iscrizioni')
  ]);
  const e=events.data||[],p=players||[],items=(entries.data||[]).filter(x=>x.status==='registered');
  $('ath-entry-event').replaceChildren(...e.map(x=>new Option(x.name,x.id)));
  $('ath-entry-player').replaceChildren(...p.map(x=>new Option(x.full_name+' · '+(x.teams?.name||'Classe'),x.id)));
  $('ath-entry-form').querySelector('[type=submit]').disabled=!(e.length&&p.length)||role!=='super_admin';
  const target=$('ath-entry-list');target.replaceChildren();
  const eventMap=new Map(e.map(x=>[Number(x.id),x.name])),playerMap=new Map(p.map(x=>[Number(x.id),x.full_name]));
  for(const item of items){
   const row=document.createElement('div');row.className='ath-entry-item';
   const name=document.createElement('div');const strong=document.createElement('strong');strong.textContent=playerMap.get(Number(item.player_id))||'Atleta';
   const small=document.createElement('small');small.textContent=eventMap.get(Number(item.event_id))||'Evento';
   name.append(strong,small);row.append(name);
   if(role==='super_admin'){
    const button=document.createElement('button');button.type='button';button.className='btn btn-ghost btn-compact';
    button.textContent='Ritira';button.addEventListener('click',async()=>{
     if(!confirm('Ritirare questo atleta dall’evento? La rimozione non è consentita se sono già presenti risultati.'))return;
     button.disabled=true;
     try{await run(db.rpc('set_athletics_entry',{p_sport_id:id,p_event_id:item.event_id,p_player_id:item.player_id,p_registered:false}),'Ritiro evento');await load()}
     catch(error){msg(error.message);button.disabled=false}
    });row.append(button);
   }target.append(row);
  }
  if(!items.length)target.textContent='Nessun atleta iscritto agli eventi di questo torneo.';
  msg(items.length+' iscrizioni agli eventi registrate.');
 }catch(error){msg('Impossibile leggere le iscrizioni: '+error.message)}
}
export async function initAthleticsEnrollment(){
 if(initialized){await load();return}
 if(!$('ath-entry-form'))return;
 initialized=true;
 const access=await requireAdmin({redirectTo:'./'});if(!access.allowed)return;
 role=access.admin?.ruolo;
 $('athletics-sport-select')?.addEventListener('change',()=>void load());
 $('ath-entry-refresh').addEventListener('click',()=>void load());
 $('ath-entry-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||role!=='super_admin')return;
  const id=Number($('athletics-sport-select').value),ev=Number($('ath-entry-event').value),player=Number($('ath-entry-player').value);
  if(!id||!ev||!player){msg('Seleziona evento e atleta.');return}
  busy=true;
  try{await run(db.rpc('set_athletics_entry',{p_sport_id:id,p_event_id:ev,p_player_id:player,p_registered:true}),'Iscrizione atletica');await load()}
  catch(e){msg(e.message)}finally{busy=false}
 });
 await load();
}
