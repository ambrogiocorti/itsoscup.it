import { db, run, runRpc } from './db.js';
import { escapeHtml } from './utils.js';
import { summarizeEvent, analyticsCsv } from './event-analytics.js';
export { analyticsCsv };

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
export async function importExistingTeamsAsClasses(sportId){
 return runRpc('import_existing_teams_as_classes',{p_sport_id:Number(sportId)},'Importa squadre esistenti');
}
export async function rotateClassInvite(inviteId){
 return runRpc('rotate_class_invite',{p_invite_id:inviteId},'Rigenerazione codice classe');
}
export async function listClassRegistrations(sportId){
 const {data}=await run(db.from('class_registrations').select('*').eq('sport_id',Number(sportId)).order('submitted_at',{ascending:false}),'Iscrizioni');
 return data||[];
}
export async function decideClassRegistration(id,approve,reason=''){
 return runRpc('decide_class_registration',{p_registration_id:Number(id),p_approve:!!approve,p_reason:reason},'Conferma iscrizione');
}
export async function sendClassNotice(sportId,title,body,inviteIds,{publishToTeam=false}={}){
 return runRpc('send_team_class_notice',{
  p_sport_id:Number(sportId),p_title:title,p_body:body,p_invite_ids:inviteIds,
  p_publish_to_team:Boolean(publishToTeam)
 },'Invio avviso');
}
export async function listClassNoticeHistory(sportId){
 const {data:notices}=await run(db.from('class_notices').select('id,title,body,created_at,published_to_team').eq('sport_id',Number(sportId)).order('created_at',{ascending:false}).limit(100),'Cronologia avvisi');
 const ids=(notices||[]).map(n=>n.id);
 if(!ids.length)return [];
 const {data:receipts}=await run(db.from('class_notice_recipients').select('notice_id,invite_id,read_at').in('notice_id',ids),'Conferme lettura');
 return (notices||[]).map(n=>({...n,recipients:(receipts||[]).filter(r=>r.notice_id===n.id)}));
}
export async function loadEventAnalytics(sportId){
 const {data:matches}=await run(db.from('matches').select('id,status,is_finished,scheduled_start,scheduled_end,started_at,finished_at,created_at,updated_at,reopened_at').eq('sport_id',Number(sportId)),'Partite');
 let changes=[];
 try{
 const {data}=await run(db.from('match_reschedule_history').select('id,match_id,created_at').in('match_id',(matches||[]).map(x=>x.id).length?(matches||[]).map(x=>x.id):[-1]),'Modifiche calendario');
 changes=data||[];
 }catch(e){console.warn('Storico calendario non disponibile',e);}
 return summarizeEvent(matches||[],changes);
}
export function safeLabel(value){return escapeHtml(String(value??''));}
