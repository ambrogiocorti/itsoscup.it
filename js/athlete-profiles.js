import {requireAdmin} from './auth.js';
import {db,run} from './db.js';
import {mountOperationalSidebar} from './operational-sidebar.js';
import {formatAthleticsValue,initials,UNIT_LABELS} from './athletics-quick-core.js';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let profiles=[],shown=24;
const PAGE=24;
const status=(s)=>{$('athlete-status').textContent=s};
const fmt=(value,unit)=>value==null||value==='Non registrato'||!Number.isFinite(Number(value))?String(value??'—'):formatAthleticsValue(value,unit);
function eventHtml(e){
 const unit=e.event.unit;
 const head='<header><h3>'+esc(e.event.name)+'</h3><span class="athlete-event-unit">'+esc(UNIT_LABELS[unit]||unit||'')+'</span></header>';
 if(!e.attempts.length)return '<section class="athlete-event is-empty">'+head+'<p class="athlete-event-empty"><i class="fa-regular fa-clock" aria-hidden="true"></i> Iscritto · nessun tentativo ancora registrato</p></section>';
 return '<section class="athlete-event">'+head+
  '<ol class="athlete-attempts">'+e.attempts.map((val,i)=>'<li class="'+(String(val)!=='Non registrato'&&String(val)===String(e.best)?'best':'')+'"><span class="attempt-number">'+(i+1)+'°</span><span class="attempt-value">'+esc(fmt(val,unit))+'</span></li>').join('')+'</ol>'+
  '<p class="athlete-best"><i class="fa-solid fa-trophy" aria-hidden="true"></i> Migliore: <strong>'+esc(fmt(e.best,unit))+'</strong></p></section>';
}
function cardHtml(p){
 const attempts=p.events.reduce((n,e)=>n+e.attempts.length,0);
 return '<details class="athlete-card" data-athlete-id="'+p.id+'"><summary><span class="athlete-avatar" aria-hidden="true">'+esc(initials(p.name))+'</span>'+
  '<span class="athlete-identity"><strong>'+esc(p.name)+'</strong><small><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i> Classe '+esc(p.className)+'</small></span>'+
  '<span class="athlete-profile-metrics"><span><strong>'+p.events.length+'</strong> eventi</span><span><strong>'+attempts+'</strong> tentativi</span></span>'+
  '<i class="fa-solid fa-chevron-down athlete-chevron" aria-hidden="true"></i></summary>'+
  '<div class="athlete-events">'+(p.events.map(eventHtml).join('')||'<p class="athlete-event-empty">Nessun evento.</p>')+'</div></details>';
}
function render({resetPage=false}={}){
 if(resetPage)shown=PAGE;
 const query=$('athlete-search').value.trim().toLocaleLowerCase('it');
 const visible=profiles.filter(p=>(p.name+' '+p.className).toLocaleLowerCase('it').includes(query));
 const page=visible.slice(0,shown);
 $('athlete-cards').innerHTML=page.map(cardHtml).join('')||'<p class="athlete-empty">Nessun atleta corrispondente.</p>';
 const more=$('athlete-more');
 if(more){more.hidden=visible.length<=shown;more.textContent='Mostra altri '+Math.min(PAGE,visible.length-shown)+' atleti';}
 status(visible.length?('Mostrati '+page.length+' di '+visible.length+' atleti'):'Nessun atleta');
}
async function load(){
 const sportId=Number($('athlete-sport').value);
 if(!sportId)return;
 status('Caricamento atleti…');
 try{
 const {data:events}=await run(db.from('events').select('id,name,unit,sort_order').eq('sport_id',sportId),'Eventi atletica');
 const ids=(events||[]).map(x=>x.id);
 if(!ids.length){profiles=[];render();return}
 const [{data:results},{data:enrollments}]=await Promise.all([
  run(db.from('event_results').select('event_id,player_id,value,attempt_count,attempt_values').in('event_id',ids),'Tentativi atletica'),
  run(db.from('athletics_entries').select('event_id,player_id,status').eq('sport_id',sportId),'Iscrizioni atletica')
 ]);
 const activeEntries=(enrollments||[]).filter(x=>x.status==='registered');
 const playerIds=[...new Set([...(results||[]).map(x=>x.player_id),...activeEntries.map(x=>x.player_id)].filter(Boolean))];
 const {data:players}=playerIds.length?await run(db.from('players').select('id,full_name,team_id').in('id',playerIds),'Atleti'): {data:[]};
 const teamIds=[...new Set((players||[]).map(x=>x.team_id).filter(Boolean))];
 const {data:teams}=teamIds.length?await run(db.from('teams').select('id,name').in('id',teamIds),'Classi'): {data:[]};
 const teamMap=new Map((teams||[]).map(x=>[x.id,x.name])), eventMap=new Map((events||[]).map(x=>[x.id,x]));
 const rows=new Map((players||[]).map(p=>[p.id,{id:p.id,name:p.full_name||'Atleta',className:teamMap.get(p.team_id)||'Da definire',events:[]}]));
 for(const r of results||[]){
 const athlete=rows.get(r.player_id),event=eventMap.get(r.event_id);if(!athlete||!event)continue;
 // Zero, falli e tentativi non validi rimangono visibili: non alterare la cronologia.
 const recorded=Array.isArray(r.attempt_values)?r.attempt_values:[];
 const total=Math.max(recorded.length,Math.min(100,Math.max(0,Number(r.attempt_count)||0)));
 const attempts=Array.from({length:total},(_,i)=>recorded[i]??'Non registrato');
 if(!attempts.length&&r.value!=null&&String(r.value).trim())attempts.push(r.value);
 athlete.events.push({event,attempts,best:r.value,registered:activeEntries.some(x=>Number(x.player_id)===Number(r.player_id)&&Number(x.event_id)===Number(r.event_id))});
 }
 for(const entry of activeEntries){
  const athlete=rows.get(entry.player_id),event=eventMap.get(entry.event_id);if(!athlete||!event)continue;
  if(!athlete.events.some(e=>Number(e.event.id)===Number(entry.event_id)))
    athlete.events.push({event,attempts:[],best:null,registered:true});
 }
 for(const athlete of rows.values())athlete.events.sort((a,b)=>(a.event.name||'').localeCompare(b.event.name||'','it'));
 profiles=[...rows.values()].sort((a,b)=>a.name.localeCompare(b.name,'it'));
 render({resetPage:true});
 }catch(e){status('Caricamento non riuscito: '+e.message)}
}
async function init(){
 const session=await requireAdmin({redirectTo:'./'});if(!session.allowed)return;
 await mountOperationalSidebar({active:'athletes',role:session.admin?.ruolo,admin:session.admin});
 const {data:sports}=await run(db.from('sports').select('id,name').eq('sport_type','atletica').order('name'),'Tornei atletica');
 $('athlete-sport').replaceChildren(...(sports||[]).map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o}));
 $('athlete-sport').addEventListener('change',load);$('athlete-search').addEventListener('input',()=>render({resetPage:true}));
 $('athlete-more')?.addEventListener('click',()=>{shown+=PAGE;render()});
 $('athlete-toggle-all')?.addEventListener('click',e=>{const open=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',String(open));e.currentTarget.textContent=open?'Comprimi tutte':'Espandi tutte';document.querySelectorAll('#athlete-cards details').forEach(d=>{d.open=open})});
 await load();
}
init().catch(e=>status(e.message));
