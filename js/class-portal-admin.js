import { db, run, runRpc } from './db.js';
import { escapeHtml } from './utils.js';

export async function listClassInvites(sportId) {
 const {data}=await run(db.from('class_invites').select('id,sport_id,class_name,access_code,is_active,created_at').eq('sport_id',Number(sportId)).order('class_name'), 'Inviti classe');
 return data||[];
}
export async function createClassInvite(sportId,className){
 const name=String(className||'').trim();
 if(!name || name.length>48) throw new Error('Classe non valida');
 const {data}=await run(db.from('class_invites').insert({sport_id:Number(sportId),class_name:name}).select().single(),'Creazione invito');
 return data;
}
export async function listClassRegistrations(sportId){
 const {data}=await run(db.from('class_registrations').select('*').eq('sport_id',Number(sportId)).order('submitted_at',{ascending:false}),'Iscrizioni');
 return data||[];
}
export async function decideClassRegistration(id,approve,reason=''){
 return runRpc('decide_class_registration',{p_registration_id:Number(id),p_approve:!!approve,p_reason:reason},'Conferma iscrizione');
}
export async function sendClassNotice(sportId,title,body,inviteIds){
 return runRpc('send_class_notice',{p_sport_id:Number(sportId),p_title:title,p_body:body,p_invite_ids:inviteIds},'Invio avviso');
}
export async function listClassNoticeHistory(sportId){
 const {data:notices}=await run(db.from('class_notices').select('id,title,body,created_at').eq('sport_id',Number(sportId)).order('created_at',{ascending:false}).limit(100),'Cronologia avvisi');
 const ids=(notices||[]).map(n=>n.id);
 if(!ids.length)return [];
 const {data:receipts}=await run(db.from('class_notice_recipients').select('notice_id,invite_id,read_at').in('notice_id',ids),'Conferme lettura');
 return (notices||[]).map(n=>({...n,recipients:(receipts||[]).filter(r=>r.notice_id===n.id)}));
}
export async function loadEventAnalytics(sportId){
 const {data:matches}=await run(db.from('matches').select('id,status,is_finished,scheduled_start,scheduled_end,started_at,finished_at,created_at,updated_at').eq('sport_id',Number(sportId)),'Partite');
 let changes=[];
 try{
 const {data}=await run(db.from('match_reschedule_history').select('id,match_id,created_at').in('match_id',(matches||[]).map(x=>x.id).length?(matches||[]).map(x=>x.id):[-1]),'Modifiche calendario');
 changes=data||[];
 }catch(e){console.warn('Storico calendario non disponibile',e);}
 const completed=(matches||[]).filter(m=>m.is_finished);
 const delays=(matches||[]).filter(m=>m.started_at && m.scheduled_start)
  .map(m=>Math.round((Date.parse(m.started_at)-Date.parse(m.scheduled_start))/60000))
  .filter(Number.isFinite);
 const durations=completed.filter(m=>m.finished_at && m.started_at)
  .map(m=>Math.round((Date.parse(m.finished_at)-Date.parse(m.started_at))/60000)).filter(n=>Number.isFinite(n)&&n>=0);
 const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null;
 return {total:(matches||[]).length,completed:completed.length,pending:(matches||[]).filter(m=>!m.is_finished && m.status!=='cancelled').length,
  lateStarts:delays.filter(n=>n>0).length,averageDelay:avg(delays),averageDuration:avg(durations),
  reschedules:changes.length,measuredStarts:delays.length,measuredDurations:durations.length,
  matches:matches||[]};
}
export function analyticsCsv(data){
 const rows=[['Indicatore','Valore'],['Partite',data.total],['Concluse',data.completed],
 ['Da completare',data.pending],['Avvii in ritardo',data.lateStarts],
 ['Avvii monitorati',data.measuredStarts],['Ritardo medio (min)',data.averageDelay??'ND'],
 ['Durata media (min)',data.averageDuration??'ND'],['Riprogrammazioni',data.reschedules]];
 return '\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
}
export function safeLabel(value){return escapeHtml(String(value??''));}
