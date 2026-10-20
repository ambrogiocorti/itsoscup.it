import {JOTFORM_AGENT_EMBED_URL} from './jotform-admin-config.js';
let configured=false;
export function isApprovedJotformUrl(source){
 try{
  const url=new URL(String(source));
  if(url.protocol!=='https:'||url.username||url.password)return false;
  return /(?:^|\.)(?:jotform\.com|jotfor\.ms)$/.test(url.hostname);
 }catch{return false}
}
export function closeAdminJotformAssistant(){
 const pane=document.getElementById('jotform-admin-panel');
 const frame=document.getElementById('jotform-admin-frame');
 if(pane)pane.hidden=true;
 // Remove the third-party iframe when changing section or closing.
 if(frame)frame.replaceChildren();
 const btn=document.getElementById('btn-open-jotform-admin');
 if(btn&&configured)btn.setAttribute('aria-expanded','false');
}
export function initAdminJotformAssistant(){
 const status=document.getElementById('jotform-admin-status');
 const btn=document.getElementById('btn-open-jotform-admin');
 const panel=document.getElementById('jotform-admin-panel');
 const frame=document.getElementById('jotform-admin-frame');
 if(!status||!btn||!panel||!frame)return;
 configured=isApprovedJotformUrl(JOTFORM_AGENT_EMBED_URL);
 if(!configured){
  status.textContent=JOTFORM_AGENT_EMBED_URL
   ? 'Indirizzo Jotform non valido: contattare il coordinatore.'
   : 'L’assistente non è ancora collegato. La guida operativa è già disponibile.';
  btn.hidden=true;
  return;
 }
 status.textContent='Un aiuto sulle procedure ITSOSCup. Non condivide automaticamente i dati della piattaforma.';
 btn.hidden=false;
 btn.setAttribute('aria-controls','jotform-admin-panel');
 btn.setAttribute('aria-expanded','false');
 btn.addEventListener('click',()=>{
  if(!document.getElementById('view-dashboard')?.classList.contains('active'))return;
  if(!panel.hidden){closeAdminJotformAssistant();return}
  const iframe=document.createElement('iframe');
  iframe.src=JOTFORM_AGENT_EMBED_URL;
  iframe.title='Assistente Jotform per i coordinatori ITSOSCup';
  iframe.loading='lazy';
  iframe.referrerPolicy='no-referrer';
  iframe.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups');
  iframe.setAttribute('allow','microphone *');
  frame.replaceChildren(iframe);panel.hidden=false;btn.setAttribute('aria-expanded','true');
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
 });
 document.getElementById('btn-close-jotform-admin')?.addEventListener('click',closeAdminJotformAssistant);
}
