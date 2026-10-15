import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
// Telegram calls this webhook only when setWebhook was configured by the school bot owner.
// It must NOT replace an existing webhook without reviewing that bot integration.
Deno.serve(async req=>{
  if(req.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const token=Deno.env.get('ITSOS_TELEGRAM_WEBHOOK_SECRET');
  if(!token||req.headers.get('x-telegram-bot-api-secret-token')!==token)return new Response('Unauthorized',{status:401});
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const channelId=Deno.env.get('TELEGRAM_CHAT_ID');
  if(!url||!key||!channelId)return new Response('Not configured',{status:503});
  let message:any;
  try{const update=await req.json();message=update?.channel_post||update?.edited_channel_post}catch{return new Response('Invalid body',{status:400})}
  if(!message||String(message.chat?.id)!==String(channelId))return new Response('ok');
  const messageId=Number(message.message_id||0);
  if(!messageId)return new Response('ok');
  const raw=String(message.text||message.caption||'Comunicazione ufficiale ITSOSCup');
  const parts=raw.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
  const title=(parts[0]||'Telegram ITSOSCup').slice(0,100);
  const body=(parts.slice(1).join(' · ')||title).slice(0,210);
  // Deduplicate telegram retries, but create a new event if an existing message was edited.
  const changed=message.edit_date||message.date||0;
  const eventKey=`telegram-${message.chat.id}-${messageId}-${changed}`;
  const href=message.chat.username
    ? 'https://t.me/'+encodeURIComponent(message.chat.username)+'/'+messageId
    : '/';
  const db=createClient(url,key,{auth:{persistSession:false}});
  const {error}=await db.from('itsos_push_events').upsert({
      source:'telegram',event_key:eventKey,title,body,href,team_ids:[]
    },{onConflict:'event_key',ignoreDuplicates:true});
  return new Response(error?'Queue unavailable':'ok',{status:error?503:200});
});
