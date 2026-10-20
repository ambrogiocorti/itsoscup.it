import {loadSports} from './matches.js';
import {db,run} from './db.js';
let initialized=false;
const $=id=>document.getElementById(id);
const action=(done,title,description,href)=>{
 const box=document.createElement('div');box.className='itsos-preparation-step';
 const icon=document.createElement('span');icon.className='itsos-preparation-indicator'+(done?' done':'');
 icon.textContent=done?'✓':'·';icon.setAttribute('aria-label',done?'Completato':'Da completare');
 const text=document.createElement('div'),heading=document.createElement('strong'),p=document.createElement('small');
 heading.textContent=title;p.textContent=description;text.append(heading,p);
 const a=document.createElement('a');a.href=href;a.className='btn btn-ghost btn-compact';a.textContent=done?'Verifica':'Apri';
 box.append(icon,text,a);return box;
};
async function refresh(){
 const id=Number($('itsos-preparation-sport')?.value);
 const target=$('itsos-preparation-checklist');
 if(!target)return;
 if(!id){target.textContent='Seleziona un torneo.';return}
 target.textContent='Verifica in corso…';
 try{
  const [sport,teams,matches,registrations]=await Promise.all([
    run(db.from('sports').select('id,name,registration_deadline,roster_confirmed_at').eq('id',id).single(),'Torneo'),
    run(db.from('teams').select('id').eq('sport_id',id),'Squadre'),
    run(db.from('matches').select('id,venue_id,scheduled_start,scheduled_end').eq('sport_id',id),'Incontri'),
    db.from('class_registrations').select('status').eq('sport_id',id)
  ]);
  // A permission error cannot be misrepresented as an approved roster.
  const registered=registrations.data||[];
  const approved=!registrations.error&&registered.length>0&&registered.every(x=>x.status==='approved');
  const count=(matches.data||[]).length,scheduled=(matches.data||[]).filter(m=>m.venue_id&&m.scheduled_start&&m.scheduled_end).length;
  const steps=[
   [Boolean(sport.data),'Torneo','Configurazione base verificata','admin?view=sports'],
   [Boolean(sport.data?.registration_deadline),'Scadenza iscrizioni',sport.data?.registration_deadline?new Date(sport.data.registration_deadline).toLocaleString('it-IT'):'Scadenza non definita','admin?view=teams'],
   [(teams.data||[]).length>=2,'Squadre',(teams.data||[]).length+' presenti','admin?view=teams'],
   [approved,'Proposte delle classi',registrations.error?'Stato non accessibile':registered.length?registered.filter(r=>r.status==='approved').length+'/'+registered.length+' approvate':'Nessuna proposta ricevuta','admin?view=teams'],
   [Boolean(sport.data?.roster_confirmed_at),'Rose definitive',sport.data?.roster_confirmed_at?'Confermate il '+new Date(sport.data.roster_confirmed_at).toLocaleString('it-IT'):'In attesa di conferma del Super Admin','admin?view=teams'],
   [count>0,'Accoppiamenti',count+' partite create','admin?view=matches'],
   [count>0&&scheduled===count,'Orari e campi',scheduled+'/'+count+' partite pianificate','tournament-tools.html?sport='+id]
  ];
  const grid=document.createElement('div');grid.className='itsos-preparation-steps';
  steps.forEach(s=>grid.append(action(...s)));
  const footer=document.createElement('p');footer.className='itsos-preparation-footnote';
  footer.textContent=steps.filter(x=>x[0]).length+' passaggi preliminari su '+steps.length+'. Prima della gara controlla comunque le rose e il calendario.';
  target.replaceChildren(grid,footer);
 }catch(error){target.textContent='Impossibile verificare la preparazione: '+error.message}
}
export async function initAdminPreparation(){
 if(initialized)return;
 const picker=$('itsos-preparation-sport');if(!picker)return;initialized=true;
 try{
  const sports=await loadSports();picker.replaceChildren();
  picker.append(new Option('Seleziona torneo',''));
  for(const s of sports)picker.append(new Option(s.name+' · '+s.year+'° anno',s.id));
  picker.addEventListener('change',()=>void refresh());
  if(sports.length){picker.value=String(sports[0].id);await refresh()}
  else $('itsos-preparation-checklist').textContent='Non ci sono tornei. Avvia la configurazione guidata.';
 }catch(e){$('itsos-preparation-checklist').textContent='Preparazione non disponibile: '+e.message}
}
