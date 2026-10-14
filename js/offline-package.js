import {
 addOfflineOperationIfAbsent, getLiveCacheEntry, getMeta, listLiveCacheEntries,
 listOfflineOperations, putLiveCacheEntry, putMeta, updateOfflineOperation,
} from './offline-db.js';

const FORMAT='itsoscup-offline-transfer';
const VERSION=1;
const LIMIT_BYTES=12*1024*1024;
const encoder=new TextEncoder();
const decoder=new TextDecoder();
function checkCrypto(){
 if(!globalThis.crypto?.subtle||!globalThis.crypto?.getRandomValues)throw new Error('WebCrypto non disponibile: usare HTTPS o la PWA installata');
}
function toBase64(bytes){
 let output='';
 for(let i=0;i<bytes.length;i+=32768) output+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(output);
}
function fromBase64(str){
 if(typeof str!=='string'||str.length>LIMIT_BYTES*2)throw new Error('Pacchetto troppo grande');
 return Uint8Array.from(atob(str),c=>c.charCodeAt(0));
}
async function keyFromPassphrase(passphrase,salt){
 const key=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:260000,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export function validateOfflinePayload(value){
 if(!value||value.schema!==FORMAT||value.version!==VERSION||!['prepared','results'].includes(value.kind)
 ||!Array.isArray(value.matches)||!Array.isArray(value.operations)||value.matches.length>250||value.operations.length>2500)
 throw new Error('Formato pacchetto non riconosciuto');
 const matchIds=new Set();
 for(const entry of value.matches){
  const id=Number(entry?.match_id);
  if(!Number.isSafeInteger(id)||id<=0||!entry.match||Number(entry.match.id)!==id||matchIds.has(id))
    throw new Error('Partita o ID duplicato non valido nel pacchetto');
  matchIds.add(id);
 }
 const ids=new Set();
 for(const op of value.operations){
  if(typeof op?.id!=='string'||op.id.length>100||ids.has(op.id)||
    op.type!=='live_snapshot'||!Number.isSafeInteger(Number(op.match_id))||Number(op.match_id)<=0||
    !op.payload||typeof op.payload!=='object'||Array.isArray(op.payload)||
    !Number.isSafeInteger(Number(op.base_version))||Number(op.base_version)<0)
    throw new Error('Operazione del pacchetto non valida');
  ids.add(op.id);
 }
 return value;
}
export async function createEncryptedPackage({kind='prepared',passphrase}={}){
 checkCrypto();
 if(typeof passphrase!=='string'||passphrase.length<12)throw new Error('La password del pacchetto deve avere almeno 12 caratteri');
 const matches=await listLiveCacheEntries();
 const index=new Map(matches.map(entry=>[Number(entry.match_id),entry]));
 const all=await listOfflineOperations();
 const operations=kind==='results'
  ?all.filter(o=>o.type==='live_snapshot'&&['queued','conflict'].includes(o.status)).map(o=>{
    const version=Number.isSafeInteger(Number(o.base_version))&&o.base_version!=null
      ?Number(o.base_version):Number(index.get(Number(o.match_id))?.match?.lock_version);
    if(!Number.isSafeInteger(version)||version<0)
      throw new Error('Bozza match '+o.match_id+' senza versione di riferimento: esportazione non sicura. Preparare nuovamente il match.');
    return {...o,base_version:version};
  }):[];
 if(kind==='prepared'&&!matches.length)throw new Error('Non ci sono partite preparate da esportare');
 if(kind==='results'&&!operations.length)throw new Error('Nessun risultato registrato da esportare');
 const deviceId=await getOfflineDeviceId();
 const payload={schema:FORMAT,version:VERSION,kind,device_id:deviceId,created_at:new Date().toISOString(),matches,operations};
 validateOfflinePayload(payload);
 const plain=encoder.encode(JSON.stringify(payload));
 if(plain.byteLength>LIMIT_BYTES)throw new Error('Troppi dati: preparare pacchetti separati o ridurre il numero delle partite');
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await keyFromPassphrase(passphrase,salt);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);
 return JSON.stringify({format:FORMAT,version:VERSION,encrypted:true,kdf:'PBKDF2-SHA256-260000',salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(cipher))},null,2);
}
export async function decryptPackage(text,passphrase){
 checkCrypto();
 if(typeof text!=='string'||text.length>LIMIT_BYTES*2.1)throw new Error('File troppo grande');
 let envelope;
 try{envelope=JSON.parse(text)}catch{throw new Error('Il file selezionato non è JSON valido');}
 if(envelope?.format!==FORMAT||envelope?.version!==VERSION||!envelope?.encrypted
 ||envelope.kdf!=='PBKDF2-SHA256-260000')throw new Error('Formato cifrato non riconosciuto');
 try{
  const salt=fromBase64(envelope.salt),iv=fromBase64(envelope.iv);
  if(salt.length!==16||iv.length!==12)throw new Error('Parametri cifratura non validi');
  const key=await keyFromPassphrase(passphrase,salt);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,fromBase64(envelope.ciphertext));
  if(plain.byteLength>LIMIT_BYTES)throw new Error('Pacchetto troppo grande');
  return validateOfflinePayload(JSON.parse(decoder.decode(plain)));
 }catch(error){
  if(error?.message?.includes('non valido')||error?.message?.includes('troppo grande'))throw error;
  throw new Error('Password errata o pacchetto danneggiato');
 }
}
export async function getOfflineDeviceId(){
 const old=await getMeta('offline_device_id');
 if(old)return old;
 checkCrypto();
 const created=crypto.randomUUID();
 const saved=await putMeta('offline_device_id',created);
 if(!saved)throw new Error('Archivio locale non disponibile');
 return created;
}
export async function importEncryptedPackage(text,passphrase){
 const payload=await decryptPackage(text,passphrase);
 const localId=await getOfflineDeviceId();
 let importedMatches=0,importedOperations=0,conflicts=0,skipped=0;
 for(const entry of payload.matches){
  const id=Number(entry.match_id);
  const previous=await getLiveCacheEntry(id);
  const unfinished=(await listOfflineOperations()).some(o=>o.match_id===id&&['queued','conflict'].includes(o.status));
  if(unfinished||previous && String(previous.cached_at)>=String(entry.cached_at)){
   skipped++;continue;
  }
  if(!(await putLiveCacheEntry(entry)))throw new Error('Impossibile salvare la partita '+id+' nel dispositivo');
  importedMatches++;
 }
 for(const row of payload.operations){
  const existing=(await listOfflineOperations()).filter(o=>Number(o.match_id)===Number(row.match_id)&&['queued','conflict'].includes(o.status));
  const collision=existing.some(o=>o.id!==row.id);
  const op={
   ...row,
   status:collision||row.status==='conflict'?'conflict':'queued',
   source_device:row.source_device||payload.device_id,
   updated_at:new Date().toISOString(),
   last_error:collision?'Lo stesso match è stato modificato su dispositivi diversi: confronto manuale necessario':row.last_error,
  };
  if(await addOfflineOperationIfAbsent(op)){
   importedOperations++;
   if(collision||op.status==='conflict')conflicts++;
   if(collision){
    for(const item of existing)await updateOfflineOperation(item.id,{
      status:'conflict',
      last_error:'Versioni provenienti da dispositivi diversi: riconciliazione manuale necessaria',
    });
   }
  }else skipped++;
 }
 return {kind:payload.kind,device_id:payload.device_id,local_device_id:localId,importedMatches,importedOperations,conflicts,skipped};
}
