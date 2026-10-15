import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
const origin='https://itsoscup.it';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'content-type,apikey,authorization','Vary':'Origin'};
const respond=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const validPushEndpoint=(value:string)=>{
  try{const u=new URL(value);return u.protocol==='https:'&&(
    u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||
    u.hostname.endsWith('.push.apple.com')||u.hostname.endsWith('.notify.windows.com')
  )}catch{return false}
};
const hash=async(secret:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)))].map(x=>x.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.headers.get('origin')!==origin)return respond({error:'Origin non consentita'},403);
 if(req.method!=='POST'&&req.method!=='GET')return respond({error:'Metodo non consentito'},405);
 const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!key)return respond({error:'Servizio non configurato'},503);
 if(req.method==='GET'){
   const api=createClient(base,key,{auth:{persistSession:false}});
   const {data}=await api.rpc('itsos_push_runtime_config');
   const publicKey=data?.public||Deno.env.get('VAPID_PUBLIC_KEY');
   return publicKey?respond({publicKey}):respond({error:'Servizio push in attivazione'},503);
 }
 let input:any;try{input=await req.json()}catch{return respond({error:'Richiesta non valida'},400)}
 const secret=String(input.secret||'');
 const endpoint=String(input.subscription?.endpoint||input.endpoint||'');
 if(secret.length<40||secret.length>256||endpoint.length>2048||!validPushEndpoint(endpoint))return respond({error:'Sottoscrizione non valida'},400);
 const mode=String(input.mode||'none');
 if(!['all','limited','none'].includes(mode))return respond({error:'Preferenza non valida'},400);
 const teams=[...new Set((Array.isArray(input.teams)?input.teams:[]).map(Number).filter(v=>Number.isSafeInteger(v)&&v>0))].slice(0,20);
 const db=createClient(base,key,{auth:{persistSession:false}});
 const digest=await hash(secret);
 const {data:old,error:lookupError}=await db.from('itsos_push_subscriptions').select('id,client_token_hash,p256dh,auth_secret').eq('endpoint',endpoint).maybeSingle();
 if(lookupError)return respond({error:'Servizio indisponibile'},503);
 const keys=input.subscription?.keys||{};
 const p256dh=String(keys.p256dh||''),auth=String(keys.auth||'');
 const proof=Boolean(old&&p256dh&&auth&&old.p256dh===p256dh&&old.auth_secret===auth);
 if(old&&old.client_token_hash!==digest&&!proof)return respond({error:'Sottoscrizione già registrata, verifica le chiavi del dispositivo'},403);
 if(mode==='none') {
   if(old)await db.from('itsos_push_subscriptions').delete().eq('id',old.id);
   return respond({ok:true,mode:'none'});
 }
 if(p256dh.length<30||auth.length<8)return respond({error:'Chiavi push non valide'},400);
 const {error}=await db.from('itsos_push_subscriptions').upsert({
    endpoint,p256dh,auth_secret:auth,client_token_hash:digest,preference:mode,team_ids:mode==='limited'?teams:[],updated_at:new Date().toISOString()
 },{onConflict:'endpoint'});
 if(error)return respond({error:'Sottoscrizione non salvata'},503);
 return respond({ok:true,mode});
});
