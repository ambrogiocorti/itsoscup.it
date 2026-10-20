import {requireAdmin} from './auth.js';
import {mountOperationalSidebar} from './operational-sidebar.js';
import {buildSmartSchedule,analyzeScheduleQuality,isReturnMatch} from './smart-scheduler.js';
const $=id=>document.getElementById(id);
const date=new Date(Date.now()+7*86400000);date.setHours(8,0,0,0);
const start=date.toISOString();
function matchesFor(n,returns){
 const games=[];let id=1;for(let i=1;i<=n;i++)for(let j=i+1;j<=n;j++){
  games.push({id:id++,home_team_id:i,away_team_id:j,round_name:'Girone (Andata)',status:'scheduled'});
 }
 if(returns){const first=[...games];for(const g of first)games.push({id:id++,home_team_id:g.away_team_id,away_team_id:g.home_team_id,round_name:'Girone (Ritorno)',status:'scheduled'})}
 return games;
}
const printTime=when=>new Date(when).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'});
function render(){
 const n=Number($('demo-teams').value),fields=Number($('demo-fields').value),
 duration=Number($('demo-duration').value),hours=Number($('demo-window').value);
 const result=buildSmartSchedule({matches:matchesFor(n,$('demo-return').checked),venues:Array.from({length:fields},(_,i)=>({id:i+1})),start,
 end:new Date(Date.parse(start)+hours*3600000).toISOString(),durationMinutes:duration,restMinutes:Math.ceil(duration*.6)});
 const q=analyzeScheduleQuality(result.scheduled);
 const metrics=$('demo-metrics');metrics.replaceChildren();
 for(const [label,value] of [['Collocate',result.scheduled.length],['Non collocate',result.missed.length],['Squadre',q.teams],['Riposo minimo',q.minimumRestMinutes===null?'—':Math.round(q.minimumRestMinutes)+' min']]){
  const item=document.createElement('div');const small=document.createElement('small'),strong=document.createElement('strong');
  small.textContent=label;strong.textContent=String(value);item.append(strong,small);metrics.append(item);
 }
 const slots=[...new Set(result.scheduled.map(m=>m.scheduled_start))].sort();
 const table=document.createElement('table'),head=document.createElement('thead'),r=document.createElement('tr');
 for(const title of ['Ora',...Array.from({length:fields},(_,i)=>'Campo '+(i+1))]){const th=document.createElement('th');th.textContent=title;r.append(th)}head.append(r);table.append(head);
 const body=document.createElement('tbody');
 for(const slot of slots){
  const row=document.createElement('tr'),th=document.createElement('th');th.textContent=printTime(slot);row.append(th);
  for(let f=1;f<=fields;f++){
   const cell=document.createElement('td'),match=result.scheduled.find(m=>m.scheduled_start===slot&&m.venue_id===f);
   if(match){const label=document.createElement('strong'),round=document.createElement('small');
    label.textContent='Squadra '+match.home_team_id+' – Squadra '+match.away_team_id;
    round.textContent=isReturnMatch(match)?'Ritorno':'Andata';cell.append(label,round);}
   else cell.textContent='Libero';
   row.append(cell);
  }body.append(row);
 }
 table.append(body);$('demo-schedule').replaceChildren(table);
 $('demo-status').textContent=result.missed.length
  ?'Simulazione incompleta: '+result.missed.length+' incontri non collocabili. Allarga la fascia o aggiungi campi.'
  :'Simulazione riuscita: nessun conflitto e tutte le partite collocate.';
}
async function init(){
 const access=await requireAdmin({redirectTo:'./'});if(!access.allowed)return;
 await mountOperationalSidebar({role:access.admin?.ruolo,admin:access.admin});
 $('demo-config').addEventListener('submit',e=>{e.preventDefault();try{render()}catch(error){$('demo-status').textContent=error.message}});
 $('demo-score').addEventListener('submit',e=>{
  e.preventDefault();const home=Number($('demo-home').value),away=Number($('demo-away').value);
  if(!Number.isSafeInteger(home)||!Number.isSafeInteger(away)||home<0||away<0){$('demo-score-output').textContent='Inserisci punteggi interi non negativi.';return}
  $('demo-score-output').textContent=home===away?'Pareggio nel punteggio. Verifica il regolamento dello sport.':
  (home>away?'Vincerebbe la squadra casa.':'Vincerebbe la squadra ospite.')+' Risultato dimostrativo, non salvato.';
 });
 render();
}
init().catch(e=>{$('demo-status').textContent='Impossibile avviare il laboratorio: '+e.message});