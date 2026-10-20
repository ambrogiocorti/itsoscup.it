import {JOTFORM_AGENT_SCRIPT_URL} from './jotform-admin-config.js?v=20261020';

let started=false;
let observer=null;
const widgetRoots=new Set();

export function isApprovedJotformUrl(source){
 try{
  const url=new URL(String(source));
  return url.protocol==='https:'&&!url.username&&!url.password &&
    /(?:^|\.)(?:jotform\.com|jotfor\.ms)$/.test(url.hostname);
 }catch{return false}
}
export function isApprovedJotformEmbedScriptUrl(source){
 if(!isApprovedJotformUrl(source))return false;
 const url=new URL(source);
 return url.hostname==='cdn.jotfor.ms' &&
  /^\/agent\/embedjs\/[a-zA-Z0-9_-]+\/embed\.js$/.test(url.pathname) &&
  !url.search&&!url.hash;
}
function isAssistantEnabled(){
 return document.body.classList.contains('itsos-jotform-enabled');
}
function widgetMarker(node){
 if(!(node instanceof Element))return false;
 if(node.id==='itsos-jotform-loader')return false;
 const descriptor=[node.id,typeof node.className==='string'?node.className:'',node.getAttribute('src')||''].join(' ').toLowerCase();
 // Inspect only the exact Jotform provider IDs/frames. Do not hide arbitrary admin UI.
 return /jotform|jotfor\.ms|jotfor_|jotformagent|jotform-agent/.test(descriptor);
}
function trackWidget(node){
 if(!(node instanceof Element))return;
 const probe=[node,...node.querySelectorAll('iframe,[class*="jotform"],[id*="jotform"],[src*="jotfor.ms"]')];
 for(const found of probe){
  if(!widgetMarker(found))continue;
  let root=found;
  while(root.parentElement&&root.parentElement!==document.body){
   // The admin shell is always legitimate first-party content; never mark it.
   if(root.parentElement.classList.contains('admin-shell'))break;
   root=root.parentElement;
  }
  if(root.classList?.contains('admin-shell'))continue;
  if(root.closest('.admin-shell'))root=found;
  if(root===document.body||widgetRoots.has(root))continue;
  widgetRoots.add(root);
  root.setAttribute('data-itsos-jotform-widget','');
  if(!isAssistantEnabled())root.style.setProperty('display','none','important');
 }
}
function watchProviderNodes(){
 if(observer)return;
 observer=new MutationObserver(records=>{
  for(const record of records)for(const node of record.addedNodes)trackWidget(node);
 });
 observer.observe(document.body,{childList:true,subtree:true});
}
export function closeAdminJotformAssistant(){
 document.body.classList.remove('itsos-jotform-enabled');
 for(const element of widgetRoots)if(element.isConnected)element.style.setProperty('display','none','important');
}
// Jotform's own embed creates its *round chat launcher*. No first-party launcher.
export function initAdminJotformAssistant(){
 if(!document.body.classList.contains('admin-page'))return;
 const status=document.getElementById('jotform-admin-status');
 if(!isApprovedJotformEmbedScriptUrl(JOTFORM_AGENT_SCRIPT_URL)){
  if(status)status.textContent='Script Jotform non disponibile. Il manuale operativo rimane consultabile.';
  return;
 }
 document.body.classList.add('itsos-jotform-enabled');
 for(const element of widgetRoots)if(element.isConnected)element.style.removeProperty('display');
 if(started)return;
 started=true;
 watchProviderNodes();
 const script=document.createElement('script');
 script.id='itsos-jotform-loader';
 script.src=JOTFORM_AGENT_SCRIPT_URL;
 script.async=true;
 script.referrerPolicy='no-referrer';
 script.addEventListener('load',()=>{
  if(status)status.textContent='Assistente disponibile nel pulsante circolare in basso a destra.';
  // Retry identification once after script load, for nodes created synchronously.
  [...document.body.children].forEach(trackWidget);
 });
 script.addEventListener('error',()=>{
  if(status)status.textContent='Il chatbot non si è caricato. Verifica la connessione o consulta il manuale.';
 });
 document.body.appendChild(script);
 if(status)status.textContent='Caricamento assistente Jotform…';
}
