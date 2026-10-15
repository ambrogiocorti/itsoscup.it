import { APP_CONFIG } from './app-config.js';
import { teamFollowStore } from './team-follow-store.js';

const PREF='itsoscup_push_choice_v1', SECRET='itsoscup_push_device_secret_v1';
const serviceUrl=APP_CONFIG.supabaseUrl+'/functions/v1/itsos-push-register';
const getMode=()=>{try{return localStorage.getItem(PREF)}catch{return null}};
const saveMode=value=>{try{localStorage.setItem(PREF,value)}catch{}};
const storeSecret=()=>{try{
  let secret=localStorage.getItem(SECRET);
  if(!secret){const bytes=crypto.getRandomValues(new Uint8Array(40));secret=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(SECRET,secret)}
  return secret;
}catch{return null}};
const teams=()=>teamFollowStore.read().favorites.map(f=>Number(f.teamId)).filter(Number.isSafeInteger);
const base64Bytes=value=>{const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,ch=>ch.charCodeAt(0))};
const isInstalled=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
let banner;
const status=message=>{const el=banner?.querySelector('[data-push-message]');if(el)el.textContent=message};
let publicKeyPromise;
function vapid(){return publicKeyPromise ||= fetch(serviceUrl,{cache:'no-store'}).then(async r=>{
 const data=await r.json().catch(()=>({}));if(!r.ok||!data.publicKey)throw Error(data.error||'Servizio push non configurato');
 return data.publicKey;
})}
async function updateSubscription(mode){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw Error('Questo browser non supporta le notifiche push');
  const reg=await navigator.serviceWorker.ready;
  let sub=await reg.pushManager.getSubscription();
  const secret=storeSecret();
  if(!secret)throw Error('Memoria locale non disponibile per l’iscrizione push');
  if(mode==='none'){
    if(sub){await fetch(serviceUrl,{method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({mode,subscription:sub.toJSON(),secret})}).catch(()=>undefined);await sub.unsubscribe()}
    return;
  }
  if(Notification.permission!=='granted')throw Error('Autorizza le notifiche nelle impostazioni del browser');
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64Bytes(await vapid())});
  const result=await fetch(serviceUrl,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({mode,subscription:sub.toJSON(),teams:mode==='limited'?teams():[],secret})});
  const data=await result.json().catch(()=>({}));
  if(!result.ok||!data.ok)throw Error(data.error||'Iscrizione push non confermata');
}
function close(){banner?.remove();banner=null}
function openPreferences({automatic=false}={}){
  if(banner)return;
  banner=document.createElement('section');banner.className='itsos-push-banner';
  banner.id='itsos-push-banner';banner.setAttribute('aria-label','Preferenze notifiche ITSOSCup');
  banner.innerHTML=`<div class="itsos-push-heading"><strong>Quali notifiche vuoi ricevere?</strong><button type="button" data-push-close aria-label="Chiudi">×</button></div>
 <p>La scelta riguarda solo le notifiche push su questo dispositivo. Puoi cambiarla in qualsiasi momento.</p>
 <div class="itsos-push-options">
   <button type="button" data-push-mode="all"><strong>Tutte</strong><small>Comunicazioni ufficiali e aggiornamenti della piattaforma</small></button>
   <button type="button" data-push-mode="limited"><strong>Solo squadre seguite</strong><small>Cambi campo/orario, inizio e risultati delle tue squadre</small></button>
   <button type="button" data-push-mode="none"><strong>Nessuna</strong><small>Restano le notifiche consultabili sul sito</small></button>
 </div><p data-push-message role="status" aria-live="polite"></p>`;
  document.body.appendChild(banner);
  banner.querySelector('[data-push-close]').addEventListener('click',()=>{if(automatic&&!getMode())saveMode('none');close()});
  banner.querySelectorAll('[data-push-mode]').forEach(button=>button.addEventListener('click',async()=>{
    const mode=button.dataset.pushMode;
    if(mode==='none'){saveMode(mode);try{await updateSubscription('none')}catch{};close();return}
    // Call requestPermission in the actual click handler (required by modern browsers).
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { status('Questo browser non supporta le notifiche push. Puoi continuare a consultare quelle del sito.'); return; }
    const permission=await Notification.requestPermission();
    if(permission!=='granted'){status('Permesso non concesso. Puoi scegliere Nessuna oppure abilitare le notifiche dal browser.');return}
    banner.querySelectorAll('button[data-push-mode]').forEach(x=>x.disabled=true);
    try{await updateSubscription(mode);saveMode(mode);close()}
    catch(error){status('Notifiche non ancora attive: '+error.message)}
    finally{banner?.querySelectorAll('button[data-push-mode]').forEach(x=>x.disabled=false)}
  }));
}
function offerFirstVisit(){
 if(getMode()||document.getElementById('pwa-first-visit'))return;
 openPreferences({automatic:true});
}
document.addEventListener('DOMContentLoaded',()=>{
 vapid().catch(()=>undefined);
 const prefsButton=document.querySelector('[data-open-push-preferences]');
 prefsButton?.addEventListener('click',()=>openPreferences());
 if(!getMode()){if(document.getElementById('pwa-first-visit'))window.addEventListener('itsos:pwa-install-closed',offerFirstVisit,{once:true});else offerFirstVisit()}
 else if(getMode()==='limited'&&'Notification' in window&&Notification.permission==='granted')
   updateSubscription('limited').catch(()=>undefined);
});
window.addEventListener('team-follows-changed',()=>{
 if(getMode()==='limited'&&'Notification' in window&&Notification.permission==='granted')updateSubscription('limited').catch(()=>undefined);
});
window.addEventListener('storage',event=>{
 if(event.key===PREF&&event.newValue==='none')updateSubscription('none').catch(()=>undefined);
 if(event.key==='tornei_team_follows_v1'&&getMode()==='limited'&&'Notification' in window&&Notification.permission==='granted')
   updateSubscription('limited').catch(()=>undefined);
});
