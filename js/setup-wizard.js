import {inspectExistingCalendar} from './calendar-quality-analysis.js';
import {loadSportConfig} from './matches.js';
import {requireAdmin} from './auth.js';
import {mountOperationalSidebar} from './operational-sidebar.js';
import {loadSports,saveSport,loadTeamsBySport,loadMatchesBySport,generateMatchesForSport} from './matches.js';
const $=id=>document.getElementById(id);
let sports=[],sportId=null,step=0,role='';
const message=(s,bad=false)=>{const el=$('setup-status');el.textContent=s;el.classList.toggle('error',bad)};
const active=()=>sports.find(s=>Number(s.id)===sportId);
function paint(){
 document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=Number(p.dataset.panel)!==step);
 document.querySelectorAll('[data-step]').forEach(b=>{if(Number(b.dataset.step)===step)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current')});
 $('setup-back').disabled=step===0;
 $('setup-next').disabled=step===4||!sportId;
 $('setup-create-form').hidden=Boolean(sportId);
 $('setup-plan').href='tournament-tools.html?sport='+encodeURIComponent(sportId||'');
 if(sportId){void refresh();if(step===4)void previewCalendar();}
}
async function refresh(){
 const s=active();if(!s)return;
 try{
 const [teams,matches]=await Promise.all([loadTeamsBySport(sportId),loadMatchesBySport(sportId)]);
 $('setup-deadline').textContent=s.registration_deadline?'Scadenza: '+new Date(s.registration_deadline).toLocaleString('it-IT'):'Scadenza non impostata: configurala prima di distribuire gli inviti.';
 $('setup-team-count').textContent=teams.length+' squadre registrate. Controlla eventuali proposte ancora da approvare.';
 $('setup-match-count').textContent=matches.length+' incontri esistenti; '+teams.length+' squadre.';
 $('setup-generate').disabled=teams.length<2||s.sport_type==='atletica'||role!=='super_admin'||!s.roster_confirmed_at;
 if(!s.roster_confirmed_at)message('Conferma le rose definitive in Squadre → Iscrizioni prima di creare gli incontri.');
 $('setup-scheduled-count').textContent=matches.filter(m=>m.scheduled_start&&m.scheduled_end&&m.venue_id).length+' su '+matches.length+' incontri pianificati.';
 }catch(e){message('Verifica dati non riuscita: '+e.message,true)}
}
async function previewCalendar(){
 const target=$('setup-calendar-report'),issues=$('setup-calendar-issues');
 if(!sportId){target.textContent='Seleziona un torneo.';return}
 target.textContent='Analisi in corso…';issues.replaceChildren();
 try{
  const [matches,config]=await Promise.all([loadMatchesBySport(sportId),loadSportConfig(sportId)]);
  const rest=Number($('setup-rest').value)||Number(config.min_rest_minutes)||0;
  const report=inspectExistingCalendar(matches,rest);
  target.textContent=report.scheduled+' partite programmate su '+report.total+' · '+report.issues.length+' criticità · riposo minimo osservato: '+(report.minimumRestMinutes??'—')+' min';
  for(const issue of report.issues.slice(0,20)){const li=document.createElement('li');li.textContent=issue.description;issues.append(li)}
 }catch(e){target.textContent='Analisi non disponibile: '+e.message}
}
async function init(){
 const auth=await requireAdmin({redirectTo:'./'});if(!auth.allowed)return;
 role=auth.admin?.ruolo;await mountOperationalSidebar({role,admin:auth.admin});
 if(role!=='super_admin'){message('Procedura guidata riservata al Super Admin.',true);return}
 sports=await loadSports();const picker=$('setup-existing');
 for(const s of sports)picker.append(new Option(s.name+' · '+s.year+'°',s.id));
 const q=Number(new URLSearchParams(location.search).get('sport'));
 if(sports.some(s=>Number(s.id)===q)){sportId=q;picker.value=String(q)}
 picker.addEventListener('change',()=>{sportId=Number(picker.value)||null;paint()});
 $('setup-create-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=$('setup-save');button.disabled=true;
  try{
   const created=await saveSport({name:$('setup-name').value.trim(),year:Number($('setup-year').value),sport_type:$('setup-sport').value,format:$('setup-format').value,gender:$('setup-gender').value,has_return_match:$('setup-return').checked,is_active:true});
   sports=await loadSports();sportId=created.id;
   picker.replaceChildren(new Option('Crea nuovo torneo',''),...sports.map(s=>new Option(s.name+' · '+s.year+'°',s.id)));
   picker.value=String(sportId);paint();message('Torneo creato. Procedi con le iscrizioni.');
  }catch(error){message(error.message,true)}finally{button.disabled=false}
 });
 $('setup-back').addEventListener('click',()=>{if(step){step--;paint()}});
 $('setup-next').addEventListener('click',()=>{if(sportId&&step<4){step++;paint()}});
 document.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>{const target=Number(b.dataset.step);if(target===0||sportId){step=target;paint()}}));
 $('setup-generate').addEventListener('click',async()=>{
  if(!sportId||role!=='super_admin'||!confirm('Creare gli accoppiamenti ufficiali del torneo selezionato?'))return;
  const button=$('setup-generate');button.disabled=true;
  try{const r=await generateMatchesForSport(sportId,Boolean(active()?.has_return_match));message('Incontri aggiunti: '+r.inserted);await refresh()}
  catch(e){message(e.message,true)}finally{button.disabled=false}
 });
 $('setup-calendar-refresh').addEventListener('click',()=>void previewCalendar());
 $('setup-rest').addEventListener('change',()=>void previewCalendar());
 paint();message('Seleziona un torneo o creane uno nuovo.');
}
init().catch(e=>message('Errore di avvio: '+e.message,true));