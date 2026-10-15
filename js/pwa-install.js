// ITSOSCup PWA installation: one prompt on the first visit, never a permanent download button.
const KEY='itsoscup_pwa_install_seen_v2';
let deferred=null;
const installed=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function seen(){try{return localStorage.getItem(KEY)==='1'}catch{return false}}
function markSeen(){try{localStorage.setItem(KEY,'1')}catch{}}
function showInstallBanner(){
  if(seen()||installed()||document.getElementById('pwa-first-visit'))return;
  const banner=document.createElement('section');
  banner.id='pwa-first-visit';banner.className='pwa-first-visit';
  banner.setAttribute('aria-label','Installa ITSOSCup sul dispositivo');
  const mobile=/iPhone|iPad|iPod/i.test(navigator.userAgent);
  banner.innerHTML=`<div><strong>Installa ITSOSCup</strong><p>Apri i tornei dalla schermata Home o dal desktop, senza scaricare un file EXE.</p></div>
  <div class="pwa-banner-actions"><button type="button" class="btn btn-primary" id="pwa-install-once">Installa</button><button type="button" class="btn btn-ghost" id="pwa-install-dismiss">Non ora</button></div>`;
  document.body.appendChild(banner);
  // Showing it once is the first visit. Subsequent visits use the browser menu.
  markSeen();
  const close=()=>{banner.remove();window.dispatchEvent(new Event('itsos:pwa-install-closed'))};
  banner.querySelector('#pwa-install-dismiss').addEventListener('click',close);
  banner.querySelector('#pwa-install-once').addEventListener('click',async()=>{
    // Prompt only in direct response to this button click.
    if(deferred){const prompt=deferred;deferred=null;await prompt.prompt();try{await prompt.userChoice}catch{};close();return}
    banner.querySelector('p').textContent=mobile
      ? 'In Safari: Condividi → Aggiungi alla schermata Home. Su iPhone puoi ricevere notifiche push dopo aver installato ITSOSCup.'
      : 'Apri il menu del browser (⋮ o …), quindi scegli Installa ITSOSCup oppure App → Installa questo sito come app.';
    markSeen();banner.querySelector('#pwa-install-once').remove();
    banner.querySelector('#pwa-install-dismiss').textContent='Chiudi';
  });
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e});
window.addEventListener('appinstalled',()=>{markSeen();document.getElementById('pwa-first-visit')?.remove();deferred=null});
document.addEventListener('DOMContentLoaded',()=>{if(!seen()&&!installed())showInstallBanner()});
