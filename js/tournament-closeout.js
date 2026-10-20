import {requireAdmin} from './auth.js';
import {mountOperationalSidebar} from './operational-sidebar.js';
import {loadSports} from './matches.js';
import {db,run} from './db.js';
const $=id=>document.getElementById(id);
let sports=[];
const status=s=>{const el=$('closeout-status');if(el)el.textContent=s};
const showCheck=(good,title,detail)=>{
 const row=document.createElement('div');row.className='closeout-check';
 const icon=document.createElement('span');icon.className='closeout-check-icon '+(good?'good':'warning');
 icon.textContent=good?'✓':'!';icon.setAttribute('aria-label',good?'Verificato':'Da verificare');
 const copy=document.createElement('div'),label=document.createElement('strong'),desc=document.createElement('small');
 label.textContent=title;desc.textContent=detail;copy.append(label,desc);row.append(icon,copy);return row;
};
async function readAll(table,columns,configure){
 const all=[];for(let start=0;start<20000;start+=1000){
  let query=db.from(table).select(columns);if(configure)query=configure(query);
  const {data}=await run(query.range(start,start+999),'Controllo '+table);
  const page=data||[];all.push(...page);if(page.length<1000)return all;
 }
 throw new Error('Il controllo supera il limite consentito: richiedere una verifica amministrativa dedicata.');
}
function metric(title,value){
 const b=document.createElement('div'),label=document.createElement('small'),number=document.createElement('strong');
 label.textContent=title;number.textContent=String(value);b.append(number,label);return b;
}
async function refresh(){
 const id=Number($('closeout-sport').value);
 if(!id){status('Seleziona un torneo.');return}
 const sport=sports.find(x=>Number(x.id)===id);if(!sport)return;
 $('closeout-issues').textContent='Caricamento…';
 $('closeout-checks').replaceChildren();$('closeout-overview').replaceChildren();
 try{
  const athletics=String(sport.sport_type)==='atletica',issues=[],checks=[];
  if(athletics){
   const events=await readAll('events','id,name',q=>q.eq('sport_id',id).order('id'));
   const results=events.length?await readAll('event_results','event_id,id,value',q=>q.in('event_id',events.map(x=>x.id)).order('id')):[];
   const entries=await readAll('athletics_entries','event_id,player_id,status',q=>q.eq('sport_id',id).eq('status','registered').order('event_id'));
   const hasResult=new Set(results.map(r=>Number(r.event_id)+'|'+Number(r.player_id)));
   const pending=entries.filter(r=>!hasResult.has(Number(r.event_id)+'|'+Number(r.player_id)));
   const emptyEvents=events.filter(e=>!results.some(r=>Number(r.event_id)===Number(e.id)));
   checks.push([events.length>0,'Discipline configurate',events.length+' eventi atletici']);
   checks.push([results.length>0,'Risultati registrati',results.length+' risultati totali']);
   checks.push([emptyEvents.length===0&&events.length>0,'Risultati per ogni disciplina',emptyEvents.length+' discipline senza risultati']);
   checks.push([pending.length===0,'Tentativi degli iscritti',pending.length+' iscrizioni senza risultato registrato']);
   for(const e of emptyEvents)issues.push('Evento '+e.name+': nessun risultato registrato');
   for(const entry of pending.slice(0,80))issues.push('Evento #'+entry.event_id+' · atleta #'+entry.player_id+': nessun risultato registrato');
   $('closeout-overview').append(metric('Discipline',events.length),metric('Risultati',results.length),metric('Iscrizioni senza risultati',pending.length));
  }else{
   const matches=await readAll('matches','id,round_name,is_finished,status,home_score,away_score,venue_id,scheduled_start,scheduled_end',q=>q.eq('sport_id',id).order('id'));
   const scheduled=matches.filter(x=>x.status!=='cancelled');
   const pending=scheduled.filter(x=>!x.is_finished);
   const unscheduled=scheduled.filter(x=>!x.scheduled_start||!x.scheduled_end||!x.venue_id);
   const completed=scheduled.filter(x=>x.is_finished);
   const missingScores=completed.filter(x=>x.home_score==null||x.away_score==null);
   const ids=completed.map(x=>x.id);
   const signs=ids.length?await readAll('match_captain_signatures','match_id,team_side,signed_at',q=>q.in('match_id',ids).order('match_id')):[];
   const signatureSides=new Map();
   for(const s of signs){const x=signatureSides.get(Number(s.match_id))||new Set();if(s.signed_at)x.add(s.team_side);signatureSides.set(Number(s.match_id),x)}
   const unsigned=completed.filter(m=>!signatureSides.get(Number(m.id))?.has('home')||!signatureSides.get(Number(m.id))?.has('away'));
   checks.push([scheduled.length>0,'Incontri presenti',scheduled.length+' incontri non annullati']);
   checks.push([pending.length===0&&scheduled.length>0,'Partite concluse',pending.length+' partite ancora aperte']);
   checks.push([unscheduled.length===0,'Pianificazione completa',unscheduled.length+' partite senza campo o orario completo']);
   checks.push([missingScores.length===0,'Risultati disponibili',missingScores.length+' risultati mancanti']);
   checks.push([unsigned.length===0,'Firme dei capitani',unsigned.length+' referti conclusi con firme mancanti']);
   checks.push([Boolean(sport.roster_confirmed_at),'Rose approvate definitivamente',sport.roster_confirmed_at?'Confermate il '+new Date(sport.roster_confirmed_at).toLocaleString('it-IT'):'Non ancora sigillate']);
   for(const m of pending.slice(0,60))issues.push('Gara #'+m.id+': non ancora conclusa');
   for(const m of unscheduled.slice(0,60))issues.push('Gara #'+m.id+': orario o campo da completare');
   for(const m of unsigned.slice(0,60))issues.push('Gara #'+m.id+': verificare firme dei capitani');
   for(const m of missingScores.slice(0,60))issues.push('Gara #'+m.id+': punteggio non registrato');
   $('closeout-overview').append(metric('Incontri',scheduled.length),metric('Concluse',completed.length),metric('Da verificare',issues.length));
  }
  const completed=checks.filter(x=>x[0]).length;
  $('closeout-checks').replaceChildren(...checks.map(x=>showCheck(...x)));
  const holder=$('closeout-issues');holder.replaceChildren();
  if(issues.length){
   const ul=document.createElement('ul');for(const s of issues.slice(0,120)){const li=document.createElement('li');li.textContent=s;ul.append(li)}holder.append(ul);
   if(issues.length>120){const p=document.createElement('p');p.textContent='Ulteriori anomalie: '+(issues.length-120)+'.';holder.append(p)}
  }else holder.textContent='Nessuna anomalia individuata dai controlli automatici. La verifica manuale dei referti rimane necessaria.';
  status('Controlli completati: '+completed+' di '+checks.length+' soddisfatti. Report consultivo, senza modifiche ai dati.');
 }catch(error){status('Controllo non riuscito: '+error.message);$('closeout-issues').textContent='Alcune verifiche non sono disponibili: non considerare il torneo pronto.'}
}
async function init(){
 const auth=await requireAdmin({redirectTo:'./'});if(!auth.allowed)return;
 await mountOperationalSidebar({role:auth.admin?.ruolo,admin:auth.admin});
 sports=await loadSports({includeInactive:true});
 const selector=$('closeout-sport');selector.replaceChildren(new Option('Seleziona un torneo',''),...sports.map(s=>new Option(s.name+' · '+s.year+'° anno',s.id)));
 const prefill=Number(new URLSearchParams(location.search).get('sport'));
 if(sports.some(s=>Number(s.id)===prefill))selector.value=String(prefill);
 selector.addEventListener('change',()=>void refresh());
 $('closeout-refresh').addEventListener('click',()=>void refresh());
 $('closeout-print').addEventListener('click',()=>window.print());
 await refresh();
}
init().catch(e=>status('Errore di accesso: '+e.message));
