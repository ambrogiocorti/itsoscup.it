import {requireAdmin} from './auth.js';
import {db,run} from './db.js';
import {mountOperationalSidebar} from './operational-sidebar.js';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let profiles=[];
const status=(s)=>{$('athlete-status').textContent=s};
function render(){
 const query=$('athlete-search').value.trim().toLocaleLowerCase('it');
 const visible=profiles.filter(p=>(p.name+' '+p.className).toLocaleLowerCase('it').includes(query));
 $('athlete-cards').innerHTML=visible.map(p=>'<article class="athlete-card"><header><div class="athlete-person-row"><span class="athlete-avatar" aria-hidden="true">'+esc(p.name.split(/\s+/).filter(Boolean).slice(0,2).map(v=>v[0]||'').join('').toUpperCase())+'</span><div><p class="athlete-kicker">Scheda atleta</p><h2>'+esc(p.name)+'</h2><p>Classe '+esc(p.className)+'</p></div></div><div class="athlete-profile-metrics"><span><strong>'+p.events.length+'</strong> eventi</span><span><strong>'+p.events.reduce((n,e)=>n+e.attempts.length,0)+'</strong> tentativi</span></div></header>'+
 p.events.map(e=>'<section class="athlete-event"><h3>'+esc(e.event.name)+'</h3><small>'+e.attempts.length+' tentativi registrati'+(e.event.unit?' · '+esc(e.event.unit):'')+'</small>'+
 '<ol class="athlete-attempts">'+e.attempts.map((val,i)=>'<li class="'+(String(val)!=='Non registrato'&&String(val)===String(e.best)?'best':'')+'"><span class="attempt-number">Tentativo '+(i+1)+'</span><span class="attempt-value">'+esc(val)+'</span></li>').join('')+'</ol>'+
 '<p class="athlete-best">Migliore: '+esc(e.best??'—')+'</p></section>').join('')+'</article>').join('')||'<p>Nessun atleta corrispondente.</p>';
 status(visible.length+' atleti visualizzati');
}
async function load(){
 const sportId=Number($('athlete-sport').value);
 if(!sportId)return;
 status('Caricamento atleti…');
 try{
 const {data:events}=await run(db.from('events').select('id,name,unit,sort_order').eq('sport_id',sportId),'Eventi atletica');
 const ids=(events||[]).map(x=>x.id);
 if(!ids.length){profiles=[];render();return}
 const {data:results}=await run(db.from('event_results').select('event_id,player_id,value,attempt_count,attempt_values').in('event_id',ids),'Tentativi atletica');
 const playerIds=[...new Set((results||[]).map(x=>x.player_id).filter(Boolean))];
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
 athlete.events.push({event,attempts,best:r.value});
 }
 profiles=[...rows.values()].sort((a,b)=>a.name.localeCompare(b.name,'it'));
 render();
 }catch(e){status('Caricamento non riuscito: '+e.message)}
}
async function init(){
 const session=await requireAdmin({redirectTo:'./'});if(!session.allowed)return;
 await mountOperationalSidebar({active:'athletes',role:session.admin?.ruolo,admin:session.admin});
 const {data:sports}=await run(db.from('sports').select('id,name').eq('sport_type','atletica').order('name'),'Tornei atletica');
 $('athlete-sport').replaceChildren(...(sports||[]).map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o}));
 $('athlete-sport').addEventListener('change',load);$('athlete-search').addEventListener('input',render);
 await load();
}
init().catch(e=>status(e.message));
