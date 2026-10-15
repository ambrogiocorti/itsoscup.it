import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import webpush from 'npm:web-push@3.6.7';
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
  if(req.method!=='POST')return reply({error:'Metodo non consentito'},405);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return reply({error:'Servizio non configurato'},503);
  const db=createClient(url,key,{auth:{persistSession:false}});
  const {data:cfg,error:configError}=await db.rpc('itsos_push_runtime_config');
  if(configError)return reply({error:'Configurazione push non disponibile'},503);
  const expected=String(cfg?.cron||'');
  if(!expected||req.headers.get('x-itsos-cron')!==expected)return reply({error:'Non autorizzato'},403);
  let vapidPublic=cfg?.public||Deno.env.get('VAPID_PUBLIC_KEY');
  let vapidPrivate=cfg?.private||Deno.env.get('VAPID_PRIVATE_KEY');
  if(!vapidPublic||!vapidPrivate){
    const pair=webpush.generateVAPIDKeys();
    const {error:initError}=await db.rpc('itsos_push_initialize_vapid',{p_public:pair.publicKey,p_private:pair.privateKey});
    if(initError)return reply({error:'Impossibile inizializzare VAPID'},503);
    const {data:newConfig,error:readError}=await db.rpc('itsos_push_runtime_config');
    if(readError)return reply({error:'Verifica chiavi VAPID fallita'},503);
    vapidPublic=newConfig?.public;vapidPrivate=newConfig?.private;
  }
  if(!vapidPublic||!vapidPrivate)return reply({error:'Chiavi VAPID non disponibili'},503);
  webpush.setVapidDetails(cfg?.subject||'mailto:info@itsoscup.it',vapidPublic,vapidPrivate);
  const {data:events,error:eventsError}=await db.rpc('itsos_claim_push_events',{p_limit:10});
  if(eventsError)return reply({error:eventsError.message},500);
  let sent=0,failed=0;
  for(const event of events||[]){
    const {data:all,error:subsError}=await db.from('itsos_push_subscriptions').select('id,endpoint,p256dh,auth_secret,preference,team_ids').limit(1000);
    if(subsError){failed++;await db.from('itsos_push_events').update({claimed_at:null}).eq('id',event.id);continue}
    const targets=(all||[]).filter(s=>s.preference==='all'||(s.preference==='limited'&&event.source==='team'&&(event.team_ids||[]).some((t:number)=>s.team_ids?.includes(t))));
    const {data:processed}=await db.from('itsos_push_deliveries').select('subscription_id').eq('event_id',event.id);
    const seen=new Set((processed||[]).map(x=>x.subscription_id));
    let retry=false;
    for(const s of targets.filter(x=>!seen.has(x.id))){
      const sub={endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth_secret}};
      try{
        await webpush.sendNotification(sub,JSON.stringify({
          title:String(event.title).slice(0,80),
          body:String(event.body).slice(0,190),
          url:String(event.href||'/').startsWith('/')?event.href:'/',
          tag:'itsos-'+event.id
        }),{TTL:3600});
        await db.from('itsos_push_deliveries').insert({event_id:event.id,subscription_id:s.id});
        sent++;
      }catch(err){
        const status=Number((err as {statusCode?:number})?.statusCode||0);
        if(status===404||status===410){
          await db.from('itsos_push_subscriptions').delete().eq('id',s.id);
        }else{retry=true;failed++}
      }
    }
    await db.from('itsos_push_events').update(retry?{claimed_at:null}:{delivered_at:new Date().toISOString()}).eq('id',event.id);
  }
  return reply({processed:events?.length||0,sent,failed});
});
