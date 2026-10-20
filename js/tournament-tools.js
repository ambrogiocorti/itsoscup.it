import { requireAdmin } from './auth.js';
import { db, run } from './db.js';
import { loadSports, loadMatchesBySport, loadTeamsBySport, loadSportConfig, computeStandings } from './matches.js';
import { loadVenues } from './schedule.js';
import { escapeHtml } from './utils.js';
import {buildSmartSchedule,isReturnMatch} from './smart-scheduler.js';
import {mountOperationalSidebar} from './operational-sidebar.js';

const $ = id => document.getElementById(id);
const state = { sports: [], venues: [], matches: [], teams: [], config: {}, proposal: [], sportId: null, admin: null };
const minute = 60000;
const when = value => new Date(value).getTime();
const format = value => new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(value));
const name = id => state.teams.find(t=>Number(t.id)===Number(id))?.name || 'Squadra '+id;
const status = (message,bad=false) => { $('tt-status').textContent=message; $('tt-status').className=bad?'tt-problem':'tt-muted'; };
const rows = () => state.matches.map(m=>({...m}));
const active = m => !m.is_finished && !['finished','cancelled'].includes(m.status);
const matchesFor = id => state.matches.filter(m=>Number(m.sport_id)===Number(id));
const teamOverlap = (a,b) => [a.home_team_id,a.away_team_id].some(id=>id && (Number(id)===Number(b.home_team_id)||Number(id)===Number(b.away_team_id)));
const conflict = (candidate,other,rest=0) => {
  if (Number(candidate.id)===Number(other.id) || other.status==='cancelled' || !other.scheduled_start||!other.scheduled_end) return false;
  const a=when(candidate.scheduled_start), b=when(candidate.scheduled_end), c=when(other.scheduled_start),d=when(other.scheduled_end);
  return (a<d && c<b && Number(candidate.venue_id)===Number(other.venue_id)) ||
    (a<d+rest*minute && c<b+rest*minute && teamOverlap(candidate,other));
};
function busyMatch(m){return !active(m)||m.started_at||m.status==='live'||m.status==='in_progress';}
async function reload(){
  state.sportId=Number($('tt-sport').value);
  state.proposal=[];$('tt-publish').disabled=true;
  for(const id of ['tt-count-planned','tt-count-missed','tt-count-fields'])if($(id))$(id).textContent='0';
  [state.matches,state.teams,state.config]=await Promise.all([
    loadMatchesBySport(state.sportId,{includeUnfinished:true}),
    loadTeamsBySport(state.sportId),
    loadSportConfig(state.sportId)
  ]);
  $('tt-overview').textContent=state.matches.length+' partite disponibili. Non verranno modificati i risultati.';
  $('tt-preview-list').replaceChildren();
  status('Dati aggiornati dal database.');
}
function checkedVenues(){return [...document.querySelectorAll('[data-tt-venue]:checked')].map(x=>state.venues.find(v=>Number(v.id)===Number(x.value))).filter(Boolean);}
function makeProposal(mode){
 const selected=checkedVenues();
 const date=$('tt-date').value,start=$('tt-start').value,end=$('tt-end').value;
 if(!date||!start||!end)throw new Error('Imposta data e fascia oraria');
 const draft=buildSmartSchedule({
  matches:state.matches,venues:selected,start:new Date(date+'T'+start).toISOString(),
  end:new Date(date+'T'+end).toISOString(),
  durationMinutes:Number($('tt-duration').value),restMinutes:Number($('tt-rest').value),mode
 });
 state.proposal=draft.proposal;
 $('tt-count-planned').textContent=String(draft.scheduled.length);
 $('tt-count-missed').textContent=String(draft.missed.length);
 $('tt-count-fields').textContent=String(draft.fields);
 $('tt-overview').textContent=draft.scheduled.length+' incontri collocati su '+draft.total+'. '+
  (draft.missed.length?'Partite non collocate: modifica la fascia oraria, i campi o la durata.':'Vincoli rispettati: anteprima pronta.');
 const field=id=>state.venues.find(v=>Number(v.id)===Number(id))?.name||'Campo';
 $('tt-preview-list').innerHTML='<div class="tt-preview-advice">Le partite di andata terminano prima dell’inizio dei ritorni. Nessuna squadra può occupare tre turni consecutivi.</div>'+
  (draft.scheduled.length?'<table class="tt-table"><thead><tr><th>Fase</th><th>Incontro</th><th>Data e ora</th><th>Campo</th></tr></thead><tbody>'+
   [...draft.scheduled].sort((a,b)=>a.scheduled_start.localeCompare(b.scheduled_start)).map(m=>
    '<tr><td><span class="tt-phase-tag'+(isReturnMatch(m)?' return':'')+'">'+escapeHtml(m.round_name||'Andata')+'</span></td><td>'+
    escapeHtml(name(m.home_team_id)+' – '+name(m.away_team_id))+'</td><td>'+
    escapeHtml(format(m.scheduled_start))+'</td><td>'+escapeHtml(field(m.venue_id))+'</td></tr>').join('')+'</tbody></table>':'<p>Nessuno slot compatibile.</p>')+
  (draft.missed.length?'<div class="tt-unassigned"><h3>Da ripianificare ('+draft.missed.length+')</h3><ul>'+
   draft.missed.map(x=>'<li><strong>'+escapeHtml(name(x.match.home_team_id)+' – '+name(x.match.away_team_id))+
   '</strong> · '+escapeHtml(x.reason)+'</li>').join('')+'</ul></div>':'');
 $('tt-publish').disabled=!draft.proposal.length||draft.missed.length>0||state.admin?.ruolo!=='super_admin';
}

async function checks(){
  const ids=state.matches.filter(active).map(m=>Number(m.id));
  const [{data:checkins}, {data:suspensions}] = await Promise.all([
    run(db.from('match_checkins').select('match_id,role,checked_in').in('match_id',ids.length?ids:[-1]),'Check-in partita'),
    run(db.from('disciplinary_suspensions').select('status,player_id,next_match_id').in('next_match_id',ids.length?ids:[-1]),'Provvedimenti')
  ]);
  const out=[];
  for(const m of state.matches.filter(active)){
    const problems=[];
    if(!m.home_team_id||!m.away_team_id||Number(m.home_team_id)===Number(m.away_team_id))problems.push('Squadre non definite o identiche');
    if(!m.venue_id)problems.push('Campo non assegnato');
    if(!m.scheduled_start||!m.scheduled_end)problems.push('Orario non completo');
    if(m.venue_id && !state.venues.some(v=>Number(v.id)===Number(m.venue_id)))problems.push('Campo inattivo o inesistente');
    if(m.scheduled_start&&m.scheduled_end){
      if(when(m.scheduled_end)<=when(m.scheduled_start))problems.push('Orario non valido');
      for(const other of state.matches){
        if(Number(other.id)<Number(m.id) && conflict(m,other,0)) { problems.push('Sovrapposizione con la partita '+other.id);break; }
      }
    }
    const present=new Set((checkins||[]).filter(c=>Number(c.match_id)===Number(m.id)&&c.checked_in).map(c=>c.role));
    for(const role of ['home_team','away_team','referee','scorekeeper'])if(!present.has(role))problems.push('Check-in mancante: '+role);
    if((suspensions||[]).some(s=>Number(s.next_match_id)===Number(m.id)&&s.status==='confirmed'))problems.push('Squalifica confermata: controllare gli atleti');
    out.push({m,problems});
  }
  $('tt-checks').innerHTML='<p class="tt-muted">Verifica informativa: nessuna decisione disciplinare viene modificata.</p>'+
  out.map(({m,problems})=>'<p><strong>'+escapeHtml(name(m.home_team_id)+' – '+name(m.away_team_id))+'</strong> · '+(problems.length?'<span class="tt-problem">'+escapeHtml(problems.join(' • '))+'</span>':'<span class="tt-ok">Nessuna anomalia individuata</span>')+'</p>').join('');
}
function documentHtml(){
  const type=$('tt-document').value,sport=state.sports.find(s=>Number(s.id)===state.sportId);
  const finished=state.matches.filter(m=>m.is_finished), standings=computeStandings(state.teams,state.matches,state.config);
  const safe=x=>escapeHtml(String(x??''));
  const title=sport?.name||'Torneo';
  if(type==='winners'||type==='participants'){
    const recipients=type==='winners'?[standings[0]].filter(Boolean):standings;
    return recipients.map(t=>'<article style="min-height:65vh;border:4px double #1e40af;padding:38px;margin:18px 0;text-align:center;break-after:page"><h1>ITSOSCup</h1><h2>Attestato di '+(type==='winners'?'vittoria':'partecipazione')+'</h2><p>Si riconosce alla squadra</p><h1>'+safe(t.name)+'</h1><p>il risultato conseguito nel torneo</p><h2>'+safe(title)+'</h2><p>Data: '+safe(new Date().toLocaleDateString('it-IT'))+'</p><p>____________________<br>Firma del responsabile</p></article>').join('') || '<p>Classifica non disponibile.</p>';
  }
  return '<h3>'+safe(title)+'</h3><p>Relazione generata il '+safe(new Date().toLocaleString('it-IT'))+'. Dati aggiornati al momento della preparazione.</p>'+
    '<p>Squadre: '+state.teams.length+' · Partite: '+state.matches.length+' · Concluse: '+finished.length+'</p>'+
    '<h3>Classifica</h3><ol>'+standings.map(t=>'<li>'+safe(t.name)+' — '+safe(t.points)+' punti</li>').join('')+'</ol>'+
    '<h3>Risultati ufficiali</h3><ul>'+finished.map(m=>'<li>'+safe(name(m.home_team_id))+' '+safe(m.home_score)+' – '+safe(m.away_score)+' '+safe(name(m.away_team_id))+'</li>').join('')+'</ul>'+
    '<p>Per i referti firmati utilizzare «Tutti i referti» nel Calendario.</p>';
}
async function init(){
  const access=await requireAdmin({redirectTo:'./'});
  if(!access.allowed)return;
  state.admin=access.admin;
  await mountOperationalSidebar({active:'tools',role:state.admin?.ruolo,admin:state.admin});
  state.sports=await loadSports();state.venues=await loadVenues();
  $('tt-sport').innerHTML=state.sports.filter(s=>s.sport_type!=='atletica').map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join('');
  $('tt-date').value=new Date().toLocaleDateString('en-CA');
  $('tt-venues').innerHTML=state.venues.map(v=>'<label><input data-tt-venue type="checkbox" value="'+v.id+'" checked> '+escapeHtml(v.name)+'</label>').join('');
  $('tt-app').classList.remove('tt-hide');await reload();
  $('tt-sport').addEventListener('change',()=>reload().catch(e=>status(e.message,true)));
  for(const [button,mode] of [['tt-preview','new'],['tt-delay','delay']])$(button).addEventListener('click',()=>{
    try{makeProposal(mode);status('Anteprima generata: nessuna partita ancora modificata.')}catch(e){status(e.message,true)}
  });
  $('tt-check').addEventListener('click',()=>checks().catch(e=>status(e.message,true)));
  $('tt-publish').addEventListener('click',async()=>{
    if(state.admin?.ruolo!=='super_admin'||!state.proposal.length)return;
    if(!window.confirm('Pubblicare '+state.proposal.length+' modifiche al calendario ufficiale? Questa operazione avviserà gli iscritti.'))return;
    $('tt-publish').disabled=true;
    try{await run(db.rpc('apply_smart_schedule',{p_sport_id:state.sportId,p_changes:state.proposal}),'Pubblicazione calendario');await reload();status('Calendario pubblicato correttamente.')}
    catch(e){status(e.message,true);$('tt-publish').disabled=false}
  });
  $('tt-build-doc').addEventListener('click',()=>{$('tt-document-output').innerHTML=documentHtml();$('tt-print').disabled=false});
  $('tt-print').addEventListener('click',()=>window.print());
}
init().catch(e=>status(e.message,true));