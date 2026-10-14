import {
  getLiveCacheEntry, listLiveCacheEntries, listOfflineOperations,
  enqueueOfflineOperation, updateOfflineOperation
} from './offline-db.js';
import {
  createEncryptedPackage, getOfflineDeviceId, importEncryptedPackage
} from './offline-package.js';
import { initializeKeyControl } from './key-control.js';

const $=id=>document.getElementById(id);
let currentMatch=null;
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
function info(msg,error=false){
 const node=$('offline-status');node.textContent=msg;node.classList.toggle('is-error',error);
}
function pending(ops){return ops.filter(o=>o.type==='live_snapshot'&&['queued','conflict'].includes(o.status));}
function latestForMatch(matchId,ops){
 return pending(ops).filter(o=>Number(o.match_id)===Number(matchId))
 .sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0]||null;
}
function label(entry){
 const m=entry?.match||{};
 return (m.home?.name||m.home_team_id||'Casa')+' – '+(m.away?.name||m.away_team_id||'Ospite');
}
async function render(){
 const [matches,ops]=await Promise.all([listLiveCacheEntries(),listOfflineOperations()]);
 const target=$('offline-matches');
 target.innerHTML=matches.length?matches.map(m=>{
  const work=latestForMatch(m.match_id,ops);
  const state=work?.status==='conflict'?'Conflitto':work?.status==='queued'?'Bozza in attesa':'Preparata';
  return `<div class="offline-match"><div><strong>${safe(label(m))}</strong>
  <small>ID ${Number(m.match_id)} · ${safe(state)}</small></div>
  <button type="button" class="btn btn-ghost" data-open-match="${Number(m.match_id)}">Apri</button></div>`;
 }).join(''):'<div class="empty-state">Non ci sono partite salvate su questo dispositivo. Importa un pacchetto preparato.</div>';
 const out=$('offline-operations');
 const pendingRows=pending(ops);
 out.innerHTML=pendingRows.length?pendingRows.map(op=>{
  const status=op.status==='conflict'?'Richiede revisione':'In attesa';
  return `<div class="offline-ops-row"><strong>Partita #${Number(op.match_id)} · ${safe(status)}</strong>
  <span> · ${safe(op.summary||'Risultato registrato')} · ${safe(op.updated_at?new Date(op.updated_at).toLocaleString('it-IT'):'')}</span>
  ${op.last_error?'<p class="offline-note">'+safe(op.last_error)+'</p>':''}
  </div>`;
 }).join(''):'<div class="empty-state">Nessuna operazione da sincronizzare.</div>';
}
async function openEditor(id){
 const entry=await getLiveCacheEntry(id);
 if(!entry?.match)throw new Error('Partita non trovata nella cache offline');
 if(entry.match.is_finished)throw new Error('La partita risulta già conclusa: non è modificabile qui');
 currentMatch=id;
 const op=latestForMatch(id,await listOfflineOperations());
 const match=entry.match, payload=op?.payload||match.live_payload||{};
 $('offline-home-label').textContent=match.home?.name||'Squadra casa';
 $('offline-away-label').textContent=match.away?.name||'Squadra ospite';
 $('offline-editor-label').textContent=label(entry);
 $('offline-home-score').value=Number(payload.home_score??match.home_score??0);
 $('offline-away-score').value=Number(payload.away_score??match.away_score??0);
 $('offline-minutes').value=Math.round(Number(payload.duration??match.duration??0)/60);
 $('offline-period').value=Number(payload.quarter||1);
 $('offline-notes').value=String(op?.offline_notes||'');
 $('offline-editor').hidden=false;
 $('offline-editor').scrollIntoView({behavior:'smooth'});
}
function requiredInt(id,min,max){
 const raw=$(id).value;
 const n=Number(raw);
 if(raw===''||!Number.isSafeInteger(n)||n<min||n>max)throw new Error('Valore non valido: '+id);
 return n;
}
async function saveEditor(){
 if(!currentMatch)throw new Error('Seleziona una partita');
 const entry=await getLiveCacheEntry(currentMatch);
 if(!entry?.match)throw new Error('Archivio locale incompleto');
 const ops=await listOfflineOperations();
 const draft=latestForMatch(currentMatch,ops);
 if(draft?.status==='conflict')throw new Error('Esistono modifiche in conflitto: non modificare finché non sono state revisionate');
 const home=requiredInt('offline-home-score',0,999),away=requiredInt('offline-away-score',0,999);
 const duration=requiredInt('offline-minutes',0,999)*60,quarter=requiredInt('offline-period',1,99);
 const notes=$('offline-notes').value.trim();
 const original=entry.match.live_payload||{};
 const payload={
  ...original,...(draft?.payload||{}),
  home_score:home,away_score:away,duration,quarter,
  timeouts:draft?.payload?.timeouts||original.timeouts||{home:0,away:0},
  stats_snapshot:draft?.payload?.stats_snapshot||original.stats_snapshot||entry.stats||[],
  event_log:draft?.payload?.event_log||original.event_log||[],
  offline_notes:notes,
  updated_at:new Date().toISOString(),
 };
 const device=await getOfflineDeviceId();
 const originalVersion=Number(entry.match.lock_version??0);
 if(draft && (draft.source_device||device)!==device)throw new Error('Bozza importata da un altro dispositivo: non può essere sovrascritta');
 let saved;
 if(draft){
  saved=await updateOfflineOperation(draft.id,{
   payload,offline_notes:notes,summary:'Bozza del risultato locale',
   base_version:Number(draft.base_version??originalVersion),
  });
 }else{
  saved=await enqueueOfflineOperation({type:'live_snapshot',matchId:currentMatch,payload,summary:'Bozza del risultato locale'});
  if(saved)saved=await updateOfflineOperation(saved.id,{source_device:device,base_version:originalVersion,offline_notes:notes});
 }
 if(!saved)throw new Error('Salvataggio locale non riuscito: nessun risultato è stato registrato');
 info('Bozza salvata sul dispositivo. Esporta i risultati tramite un pacchetto cifrato.');
 await render();
}
async function exportPack(kind){
 const passphrase=$('offline-package-password').value;
 const json=await createEncryptedPackage({kind,passphrase});
 const blob=new Blob([json],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;a.download='itsoscup-'+kind+'-'+new Date().toISOString().slice(0,10)+'.json';
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
 info('Pacchetto cifrato scaricato. Conserva separatamente la password.');
}
async function importPack(){
 const file=$('offline-package-file').files?.[0];
 if(!file)throw new Error('Seleziona un file .json');
 if(file.size>25*1024*1024)throw new Error('Il file supera il limite di 25 MB');
 const result=await importEncryptedPackage(await file.text(),$('offline-package-password').value);
 info('Importazione '+result.kind+': '+result.importedMatches+' partite, '+result.importedOperations+' operazioni. Conflitti: '+result.conflicts+'. Scartati: '+result.skipped+'.');
 $('offline-package-file').value='';
 await render();
}
async function syncPending(){
 if(!navigator.onLine)throw new Error('Impossibile sincronizzare senza Internet. I risultati rimangono salvati localmente.');
 const {requireAdmin,canEditMatches}=await import('./auth.js');
 const session=await requireAdmin({redirectTo:'./offline-workspace.html'});
 if(!session.allowed||session.offline||!canEditMatches(session.admin?.ruolo))throw new Error('Serve una sessione online di responsabile partite');
 const {loadLiveMatch,startLiveSession,releaseLiveSession,commitLiveUpdate}=await import('./live.js');
 const ops=pending(await listOfflineOperations());
 const eligible=ops.filter(o=>o.status==='queued');
 if(!eligible.length){info('Non ci sono risultati in attesa di sincronizzazione.');return;}
 const preview=eligible.map(o=>'#'+o.match_id+': '+Number(o.payload?.home_score??0)+'-'+Number(o.payload?.away_score??0)).join(', ');
 if(!window.confirm('Confermare la sincronizzazione delle bozze registrate?\\n'+preview+
 '\\nIl sistema bloccherà i conflitti e non sovrascriverà referti modificati da altri.'))return;
 let synced=0,conflicts=0,failed=0;
 const seen=new Set();
 for(const op of ops){
  const id=Number(op.match_id);
  if(op.status!=='queued')continue;
  if(!Number.isInteger(op.base_version)||op.base_version<0){
   await updateOfflineOperation(op.id,{status:'conflict',last_error:'Versione iniziale non disponibile: richiesta revisione manuale'});conflicts++;continue;
  }
  const sameMatch=ops.filter(x=>Number(x.match_id)===id);
  if(sameMatch.length>1||seen.has(id)){
   await updateOfflineOperation(op.id,{status:'conflict',last_error:'Operazioni concorrenti per la stessa partita'});conflicts++;continue;
  }
  seen.add(id);
  let hasLock=false;
  try{
   const remote=await loadLiveMatch(id);
   if(remote.match?.is_finished||Number(remote.match?.lock_version??-1)!==op.base_version){
    await updateOfflineOperation(op.id,{status:'conflict',last_error:'Il referto online è già stato modificato o concluso'});conflicts++;continue;
   }
   const lock=await startLiveSession(id);
   if(!lock?.success||lock.lock_owner!==session.user?.id){
    await updateOfflineOperation(op.id,{status:'conflict',last_error:'Lock remoto non disponibile per il responsabile attuale'});conflicts++;continue;
   }
   hasLock=true;
   if(Number(lock.lock_version)!==op.base_version){
    await updateOfflineOperation(op.id,{status:'conflict',last_error:'Versione cambiata durante l’acquisizione del lock'});conflicts++;continue;
   }
   const result=await commitLiveUpdate({matchId:id,payload:op.payload,expectedVersion:op.base_version});
   if(result?.success===false){
    await updateOfflineOperation(op.id,{status:'conflict',last_error:result.message||'Conflitto versione'});conflicts++;continue;
   }
   const saved=await updateOfflineOperation(op.id,{
    status:'synced',synced_at:new Date().toISOString(),
    remote_version:Number(result?.new_version??op.base_version+1),last_error:null,
   });
   if(!saved)throw new Error('Il cloud è stato aggiornato ma la conferma locale non è stata salvata: verificare manualmente prima di riprovare');
   synced++;
  }catch(e){
   failed++;
   await updateOfflineOperation(op.id,{last_error:e.message,attempts:Number(op.attempts||0)+1});
  }finally{
   if(hasLock)await releaseLiveSession(id).catch(()=>undefined);
  }
 }
 await render();
 info('Sincronizzazione conclusa: '+synced+' confermate, '+conflicts+' in conflitto, '+failed+' da riprovare.'+
 (conflicts? ' Le operazioni in conflitto non sono state sovrascritte.':''));
}
function wire(id,event,fn){
 $(id).addEventListener(event,async()=>{const button=$(id);button.disabled=true;try{await fn()}catch(e){info(e.message,true)}finally{button.disabled=false}});
}
document.addEventListener('click',event=>{
 const b=event.target.closest('[data-open-match]');
 if(b)openEditor(Number(b.dataset.openMatch)).catch(e=>info(e.message,true));
});
wire('offline-save','click',saveEditor);
wire('offline-export-prepared','click',()=>exportPack('prepared'));
wire('offline-export-results','click',()=>exportPack('results'));
wire('offline-import','click',importPack);
wire('offline-sync','click',syncPending);
wire('offline-refresh','click',render);
wire('offline-close','click',async()=>{$('offline-editor').hidden=true;currentMatch=null;});
render().catch(e=>info(e.message,true));
initializeKeyControl();
