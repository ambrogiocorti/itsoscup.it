import {loadSports,loadSportConfig,listMatchesForAdmin} from './matches.js';
import {myAssignedMatches} from './match-assignments.js';
import {inspectExistingCalendar,calendarLocalDay} from './calendar-quality-analysis.js';

const $=id=>document.getElementById(id);
const fmtTime=value=>new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const txt=(tag,value,className)=>{const el=document.createElement(tag);el.textContent=String(value);if(className)el.className=className;return el};
const matchName=m=>(m.home?.name||'Squadra #'+m.home_team_id)+' – '+(m.away?.name||'Squadra #'+m.away_team_id);
let setup=false,opened=false,role='',onMatchClick=null,job=0,lastSchedule=null,pending=null,restThreshold=0,lastMatches=[];
export function getQualityMatch(id){return lastMatches.find(m=>Number(m.id)===Number(id))||null}
const indicator=(title,value,detail)=>{
 const box=document.createElement('div');box.className='mcq-metric';box.append(txt('strong',value),txt('span',title),txt('small',detail));return box;
};
function drawSummary(report){
 const numbers=$('matches-quality-metrics');numbers.replaceChildren(
  indicator('Partite collocate',report.scheduled+' / '+report.total,'Nel torneo selezionato'),
  indicator('Da programmare',report.unscheduled,'Senza orario, fine o campo'),
  indicator('Riposo minimo',report.minimumRestMinutes===null?'—':report.minimumRestMinutes+' min','Tra gare della stessa squadra, nello stesso giorno'),
  indicator('Segnalazioni',report.issues.length,report.issues.length?'Da controllare':'Nessuna anomalia rilevata')
 );
 const summary=$('matches-quality-overview');
 const parts=[];
 if(report.expectedRestMinutes>0)parts.push('Riposo richiesto: '+report.expectedRestMinutes+' minuti');
 else parts.push('Riposo minimo non configurato: le pause sono informative');
 parts.push(report.closeGaps.length+' pause fino a 45 minuti');
 parts.push(report.longGaps.length+' attese da 150 minuti');
 summary.textContent=parts.join(' · ');
 const warning=$('matches-quality-warnings');warning.replaceChildren();
 if(!report.issues.length){warning.append(txt('p','Nessun conflitto rilevato. Controlla comunque manualmente la programmazione.','mcq-ok'));return}
 const ul=document.createElement('ul');
 for(const item of report.issues.slice(0,16)){
  const li=txt('li',item.description);
  li.className='mcq-issue mcq-'+item.type;ul.append(li);
 }
 warning.append(ul);
 if(report.issues.length>16)warning.append(txt('p','Altre '+(report.issues.length-16)+' segnalazioni non visualizzate.','mcq-more'));
}
function displayDay(report){
 const panel=$('matches-quality-grid');panel.replaceChildren();
 const selected=$('matches-quality-day').value;
 if(!selected){panel.append(txt('p','Seleziona una giornata per visualizzare la griglia.','mcq-empty'));return}
 const matches=report.daysMatches.get(selected)||[];
 const venues=[...new Map(matches.filter(m=>m.venue_id).map(m=>[Number(m.venue_id),{id:Number(m.venue_id),name:m.venue?.name||'Campo #'+m.venue_id}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'it'));
 const times=[...new Set(matches.map(m=>Date.parse(m.scheduled_start)))].sort((a,b)=>a-b);
 const wrap=document.createElement('div');wrap.className='mcq-grid-scroll';
 const table=document.createElement('table');table.className='mcq-grid-table';
 table.append(txt('caption','Le partite mostrate sono già presenti nel calendario. Seleziona una gara per aprire il dettaglio.'));
 const thead=document.createElement('thead'),head=document.createElement('tr');
 for(const title of ['Ora',...venues.map(v=>v.name)])head.append(txt('th',title));
 thead.append(head);table.append(thead);
 const body=document.createElement('tbody');
 for(const t of times){
  const row=document.createElement('tr');row.append(txt('th',fmtTime(t)));
  for(const venue of venues){
   const cell=document.createElement('td');
   const games=matches.filter(m=>Date.parse(m.scheduled_start)===t&&Number(m.venue_id)===venue.id);
   for(const game of games){
    const button=document.createElement('button');button.className='mcq-game';button.type='button';
    button.dataset.matchId=String(game.id);
    button.append(txt('small',(game.round_name||'Girone')+' · '+fmtTime(game.scheduled_start)+'–'+fmtTime(game.scheduled_end)),
      txt('strong',matchName(game)));
    if(game.is_finished)button.append(txt('span','Conclusa','mcq-game-status'));
    cell.append(button);
   }
   if(!games.length)cell.append(txt('span','Disponibile','mcq-free'));
   row.append(cell);
  }
  body.append(row);
 }
 table.append(body);wrap.append(table);panel.append(wrap);
 const dayGaps=report.gaps.filter(g=>g.day===selected).sort((a,b)=>a.minutes-b.minutes);
 const rest=$('matches-quality-team-rest');rest.replaceChildren();
 rest.append(txt('h3','Pause delle squadre · '+selected));
 if(!dayGaps.length)rest.append(txt('p','Nessuna pausa tra più gare della stessa squadra in questa giornata.','mcq-empty'));
 else{
  const list=document.createElement('div');list.className='mcq-rest-list';
  for(const gap of dayGaps.slice(0,24)){
   const row=document.createElement('div');row.className='mcq-rest-item'+(restThreshold>0&&gap.minutes<restThreshold?' mcq-rest-warning':'');
   row.append(txt('span',gap.teamName),txt('strong',Math.round(gap.minutes)+' min'));
   list.append(row);
  }
  rest.append(list);
  if(dayGaps.length>24)rest.append(txt('small','Mostrate 24 pause su '+dayGaps.length+'.'));
 }
}
async function refresh(){
 if(!opened)return;
 const sportId=Number($('matches-quality-sport')?.value);
 if(!sportId){$('matches-quality-status').textContent='Seleziona il torneo da analizzare.';return}
 const thisJob=++job;
 const status=$('matches-quality-status');status.textContent='Analisi del calendario in corso…';
 try{
  const [data,config,mine]=await Promise.all([
   listMatchesForAdmin({sportId}),
   loadSportConfig(sportId),
   role==='match_manager'?myAssignedMatches():Promise.resolve(null)
  ]);
  if(thisJob!==job||!opened)return;
  const fixtures=mine?data.filter(m=>mine.has(Number(m.id))):data;
  lastMatches=fixtures;
  restThreshold=Number(config.min_rest_minutes)||0;
  const report=inspectExistingCalendar(fixtures,restThreshold);
  lastSchedule=report;drawSummary(report);
  const day=$('matches-quality-day'),oldDay=day.value;
  day.replaceChildren(new Option('Seleziona giornata',''),...report.days.map(d=>new Option(new Date(d+'T12:00:00Z').toLocaleDateString('it-IT',{day:'2-digit',month:'long',year:'numeric',timeZone:'Europe/Rome'}),d)));
  day.value=report.days.includes(oldDay)?oldDay:(report.days[0]||'');
  displayDay(report);
  const scope=role==='match_manager'?' (solo partite assegnate al tuo account)':'';
  status.textContent=fixtures.length+' partite esaminate'+scope+'. Anteprima di sola lettura, aggiornata dai dati salvati.';
 }catch(error){
  if(thisJob!==job)return;
  lastSchedule=null;status.textContent='Non è stato possibile analizzare il calendario: '+error.message;
  $('matches-quality-grid').replaceChildren();$('matches-quality-metrics').replaceChildren();
  $('matches-quality-warnings').replaceChildren();
 }
}
export function scheduleCalendarQualityRefresh(){
 if(!opened)return;
 if(pending)clearTimeout(pending);
 pending=setTimeout(()=>{pending=null;void refresh()},250);
}
export async function initCalendarQuality({adminRole,onMatchDetail}={}){
 if(setup)return;setup=true;role=String(adminRole||'');onMatchClick=onMatchDetail;
 const trigger=$('btn-toggle-calendar-quality'),panel=$('matches-calendar-quality');
 if(!trigger||!panel)return;
 trigger.addEventListener('click',async()=>{
  opened=!opened;panel.hidden=!opened;
  trigger.setAttribute('aria-expanded',String(opened));
  trigger.setAttribute('aria-pressed',String(opened));
  if(!opened){++job;return}
  await refresh();
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
 });
 $('matches-quality-sport').addEventListener('change',()=>void refresh());
 $('matches-quality-day').addEventListener('change',()=>{if(lastSchedule)displayDay(lastSchedule)});
 $('matches-quality-refresh').addEventListener('click',()=>void refresh());
 $('matches-quality-grid').addEventListener('click',event=>{
  const button=event.target.closest('button[data-match-id]');
  if(button&&typeof onMatchClick==='function')onMatchClick(Number(button.dataset.matchId));
 });
 try{
  const sports=(await loadSports()).filter(s=>s.sport_type!=='atletica');
  const picker=$('matches-quality-sport');
  picker.replaceChildren(new Option('Seleziona torneo',''),...sports.map(s=>new Option(s.name+' · '+s.year+'° anno',s.id)));
  const selected=$('filter-match-sport')?.value;
  if(selected&&sports.some(s=>String(s.id)===String(selected)))picker.value=String(selected);
  else if(sports.length)picker.value=String(sports[0].id);
 }catch(error){$('matches-quality-status').textContent='Tornei non disponibili: '+error.message}
}
