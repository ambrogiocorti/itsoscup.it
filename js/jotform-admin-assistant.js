import {JOTFORM_AGENT_SCRIPT_URL} from './jotform-admin-config.js';

let configured=false;
let initialized=false;

export function isApprovedJotformUrl(source){
 try{
  const url=new URL(String(source));
  if(url.protocol!=='https:'||url.username||url.password)return false;
  return /(?:^|\.)(?:jotform\.com|jotfor\.ms)$/.test(url.hostname);
 }catch{return false}
}

// Only Jotform's AI-Agent embed scripts can execute inside the isolated frame.
export function isApprovedJotformEmbedScriptUrl(source){
 if(!isApprovedJotformUrl(source))return false;
 const url=new URL(source);
 return url.hostname==='cdn.jotfor.ms' &&
  /^\/agent\/embedjs\/[a-zA-Z0-9_-]+\/embed\.js$/.test(url.pathname) &&
  !url.search && !url.hash;
}

// An HTML string that stays inside a script-enabled *opaque-origin* frame.
// The parent dashboard never runs the third-party script directly.
export function buildJotformFrameDocument(source){
 if(!isApprovedJotformEmbedScriptUrl(source))throw new Error('Script Jotform non consentito');
 return '<!doctype html><html lang="it"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width, initial-scale=1">'+
  '<meta name="referrer" content="no-referrer">'+
  '<style>html,body{box-sizing:border-box;width:100%;height:100%;margin:0;padding:0;background:#f8fafc;overflow:hidden}'+
  'body{font-family:system-ui,sans-serif}#agent-status{padding:18px 20px;color:#64748b;font-size:14px}'+
  '</style></head><body><div id="agent-status" role="status">Caricamento assistente Jotform…</div>'+
  '<script src="'+source+'" async referrerpolicy="no-referrer"></script>'+
  '<script>window.addEventListener("load",function(){'+
  'var n=document.getElementById("agent-status");if(n)n.remove();'+
  '});</script></body></html>';
}

export function closeAdminJotformAssistant(){
 const panel=document.getElementById('jotform-admin-panel');
 const container=document.getElementById('jotform-admin-frame');
 if(panel)panel.hidden=true;
 // Disposing the frame removes the third-party chatbot on section changes.
 container?.replaceChildren();
 const trigger=document.getElementById('btn-open-jotform-admin');
 trigger?.setAttribute('aria-expanded','false');
}

export function initAdminJotformAssistant(){
 if(initialized)return;
 const status=document.getElementById('jotform-admin-status');
 const trigger=document.getElementById('btn-open-jotform-admin');
 const panel=document.getElementById('jotform-admin-panel');
 const container=document.getElementById('jotform-admin-frame');
 if(!status||!trigger||!panel||!container)return;
 initialized=true;
 configured=isApprovedJotformEmbedScriptUrl(JOTFORM_AGENT_SCRIPT_URL);
 if(!configured){
  status.textContent='Script Jotform non configurato o non valido. La guida operativa resta disponibile.';
  trigger.hidden=true;return;
 }
 status.textContent='Assistente collegato. Aprilo per ottenere indicazioni sulle procedure ITSOSCup. Non riceve automaticamente dati da Supabase.';
 trigger.hidden=false;
 trigger.setAttribute('aria-controls','jotform-admin-panel');
 trigger.setAttribute('aria-expanded','false');
 trigger.addEventListener('click',()=>{
  // No embed is ever rendered outside the dashboard view.
  if(!document.getElementById('view-dashboard')?.classList.contains('active'))return;
  if(!panel.hidden){closeAdminJotformAssistant();return}
  const iframe=document.createElement('iframe');
  iframe.title='Assistente Jotform per i coordinatori ITSOSCup';
  iframe.setAttribute('sandbox','allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
  iframe.setAttribute('allow','microphone');
  iframe.referrerPolicy='no-referrer';
  iframe.srcdoc=buildJotformFrameDocument(JOTFORM_AGENT_SCRIPT_URL);
  container.replaceChildren(iframe);
  panel.hidden=false;
  trigger.setAttribute('aria-expanded','true');
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
 });
 document.getElementById('btn-close-jotform-admin')?.addEventListener('click',closeAdminJotformAssistant);
}
