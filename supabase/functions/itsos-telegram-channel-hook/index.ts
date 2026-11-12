import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return json({error:'Not configured'},503);
 const db=createClient(url,key,{auth:{persistSession:false}});
 const {data:cfg,error:configError}=await db.rpc('itsos_push_runtime_config');
 if(configError||!cfg?.telegram)return json({error:'Webhook verification not configured'},503);
 if(req.method==='GET'){
   if(!cfg.cron||req.headers.get('x-itsos-cron')!==cfg.cron)return json({error:'Not authorized'},403);
   const bot=Deno.env.get('TELEGRAM_BOT_TOKEN');
   if(!bot)return json({configured:false,reason:'Telegram bot token missing'},503);
   const target=url+'/functions/v1/itsos-telegram-channel-hook';
   const info=await fetch('https://api.telegram.org/bot'+bot+'/getWebhookInfo').then(r=>r.json()).catch(()=>({}));
   if(info?.ok!==true)return json({configured:false,reason:'Unable to inspect Telegram webhook'},503);
   const existing=String(info?.result?.url||'');
   if(existing && existing!==target) return json({configured:false,reason:'Existing webhook belongs to another integration; not overwritten'},409);
   if(existing===target)return json({configured:true});
   const r=await fetch('https://api.telegram.org/bot'+bot+'/setWebhook',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({url:target,secret_token:cfg.telegram,allowed_updates:['channel_post','edited_channel_post'],drop_pending_updates:false})
   }).then(r=>r.json()).catch(()=>({}));
   return r?.ok?json({configured:true}):json({configured:false,reason:'Telegram rejected webhook'},503);
 }
 if(req.method!=='POST')return json({error:'Method Not Allowed'},405);
 if(req.headers.get('x-telegram-bot-api-secret-token')!==cfg.telegram)return json({error:'Unauthorized'},401);
 const channelId=Deno.env.get('TELEGRAM_CHAT_ID');
 if(!channelId)return json({error:'Telegram channel id not configured'},503);
 let message:any;
 try{const update=await req.json();message=update?.channel_post||update?.edited_channel_post}catch{return json({error:'Invalid JSON'},400)}
 if(!message||String(message.chat?.id)!==String(channelId))return json({ok:true});
 const messageId=Number(message.message_id||0);
 if(!messageId)return json({ok:true});
 const raw=String(message.text||message.caption||'Comunicazione ufficiale ITSOSCup');
 const parts=raw.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
 const title=(parts[0]||'Telegram ITSOSCup').slice(0,100);
 const body=(parts.slice(1).join(' · ')||title).slice(0,210);
 const changed=message.edit_date||message.date||0;
 const eventKey=`telegram-${message.chat.id}-${messageId}-${changed}`;
 const {error}=await db.from('itsos_push_events').upsert({
   source:'telegram',event_key:eventKey,title,body,href:'/',team_ids:[]
 },{onConflict:'event_key',ignoreDuplicates:true});
 return error?json({error:'Queue unavailable'},503):json({ok:true});
});
