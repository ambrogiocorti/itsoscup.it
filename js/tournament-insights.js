import {requireAdmin} from './auth.js';
import {mountOperationalSidebar} from './operational-sidebar.js';
import {db,run} from './db.js';
const $=id=>document.getElementById(id),fmt=n=>Number(n||0).toLocaleString('it-IT');
let sports=[],teams=[],matches=[],summary=[];
const status=message=>{$('insights-status').textContent=message};
const labels={calcio:'Calcio',basket:'Basket',pallavolo:'Pallavolo',pallamano:'Pallamano',atletica:'Atletica'};
function aggregate(){
 const year=$('insights-year').value,type=$('insights-type').value;
 const filtered=sports.filter(s=>(year==='all'||String(new Date(s.created_at).getFullYear())===year)&&(type==='all'||s.sport_type===type));
 const ids=new Set(filtered.map(s=>Number(s.id))), groups=new Map();
 for(const s of filtered){
  const yy=new Date(s.created_at).getFullYear(),key=yy+'|'+s.sport_type;
  if(!groups.has(key))groups.set(key,{year:yy,type:s.sport_type,tournaments:0,teams:0,matches:0,finished:0});
  groups.get(key).tournaments++;
 }
 const bySport=new Map(filtered.map(s=>[Number(s.id),new Date(s.created_at).getFullYear()+'|'+s.sport_type]));
 for(const t of teams){const key=bySport.get(Number(t.sport_id));if(key)groups.get(key).teams++}
 for(const m of matches){const key=bySport.get(Number(m.sport_id));if(!key)continue;groups.get(key).matches++;if(m.is_finished)groups.get(key).finished++}
 summary=[...groups.values()].sort((a,b)=>b.year-a.year||a.type.localeCompare(b.type));
 const totals=summary.reduce((t,s)=>({tournaments:t.tournaments+s.tournaments,teams:t.teams+s.teams,matches:t.matches+s.matches,finished:t.finished+s.finished}),{tournaments:0,teams:0,matches:0,finished:0});
 const metrics=$('insights-metrics');metrics.replaceChildren();
 for(const [name,val] of [['Tornei',totals.tournaments],['Squadre',totals.teams],['Partite',totals.matches],['Concluse',totals.finished]]){
  const card=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');
  strong.textContent=fmt(val);small.textContent=name;card.append(strong,small);metrics.append(card);
 }
 const tbody=$('insights-rows');tbody.replaceChildren();
 for(const row of summary){
  const tr=document.createElement('tr');
  for(const val of [row.year,labels[row.type]||row.type,row.tournaments,row.teams,row.matches,row.finished,row.matches?Math.round(row.finished*100/row.matches)+'%':'—']){
   const cell=document.createElement('td');cell.textContent=String(val);tr.append(cell);
  }tbody.append(tr);
 }
 if(!summary.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='Nessun dato disponibile per questi filtri.';tr.append(td);tbody.append(tr)}
 const all=[...new Set(summary.map(s=>s.type))].map(type=>({type,finished:summary.filter(s=>s.type===type).reduce((a,s)=>a+s.finished,0)})).sort((a,b)=>b.finished-a.finished);
 const max=Math.max(1,...all.map(s=>s.finished)),chart=$('insights-bars');chart.replaceChildren();
 for(const item of all){
  const row=document.createElement('div');row.className='insights-bar-row';
  const title=document.createElement('span');title.textContent=labels[item.type]||item.type;
  const track=document.createElement('div');track.className='insights-bar-track';
  const fill=document.createElement('div');fill.className='insights-bar-fill';fill.style.width=(item.finished/max*100)+'%';track.append(fill);
  const value=document.createElement('strong');value.textContent=fmt(item.finished);
  row.append(title,track,value);chart.append(row);
 }
 if(!all.length)chart.textContent='Nessun incontro concluso per i filtri selezionati.';
 status('Analisi aggiornata: '+fmt(filtered.length)+' tornei visibili.');
}
function download(){
 const cells=[['Anno creazione','Sport','Tornei','Squadre','Partite','Concluse','Percentuale'],...summary.map(s=>[s.year,labels[s.type]||s.type,s.tournaments,s.teams,s.matches,s.finished,s.matches?(s.finished*100/s.matches).toFixed(1)+'%':''])];
 const csv='\ufeff'+cells.map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='itsoscup-analisi-tornei.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function reload(){
 status('Caricamento statistiche…');
 const [a,b,c]=await Promise.all([
  run(db.from('sports').select('id,name,sport_type,created_at'),'Tornei'),
  run(db.from('teams').select('sport_id'),'Squadre'),
  run(db.from('matches').select('sport_id,is_finished'),'Partite')
 ]);
 sports=a.data||[];teams=b.data||[];matches=c.data||[];
 $('insights-year').replaceChildren(new Option('Tutti gli anni','all'),...[...new Set(sports.map(s=>new Date(s.created_at).getFullYear()))].sort((a,b)=>b-a).map(x=>new Option(String(x),x)));
 $('insights-type').replaceChildren(new Option('Tutti gli sport','all'),...[...new Set(sports.map(s=>s.sport_type))].sort().map(x=>new Option(labels[x]||x,x)));
 aggregate();
}
async function init(){
 const access=await requireAdmin({redirectTo:'./'});if(!access.allowed)return;
 await mountOperationalSidebar({role:access.admin?.ruolo,admin:access.admin});
 $('insights-refresh').addEventListener('click',()=>void reload().catch(e=>status(e.message)));
 $('insights-year').addEventListener('change',aggregate);$('insights-type').addEventListener('change',aggregate);
 $('insights-export').addEventListener('click',download);
 await reload();
}
init().catch(e=>status('Analisi non disponibile: '+e.message));
