// ITSOSCup PWA installation: offered once inside the welcome dialog, never a permanent download button.
export const PWA_SEEN_KEY='itsoscup_pwa_install_seen_v2';
let deferred=null;
export const isAppInstalled=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
export function installOfferSeen(){try{return localStorage.getItem(PWA_SEEN_KEY)==='1'}catch{return false}}
export function markInstallOfferSeen(){try{localStorage.setItem(PWA_SEEN_KEY,'1')}catch{}}
export function shouldOfferInstall(){return !installOfferSeen()&&!isAppInstalled()}
// Must be called directly from a click handler. Returns null when the browser
// opened its own prompt, otherwise the manual instructions to show.
export async function installApp(){
  markInstallOfferSeen();
  if(deferred){
    const prompt=deferred;deferred=null;
    await prompt.prompt();
    try{await prompt.userChoice}catch{}
    return null;
  }
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? 'In Safari: Condividi → Aggiungi alla schermata Home. Su iPhone puoi ricevere notifiche push dopo aver installato ITSOSCup.'
    : 'Apri il menu del browser (⋮ o …), quindi scegli Installa ITSOSCup oppure App → Installa questo sito come app.';
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e});
window.addEventListener('appinstalled',()=>{markInstallOfferSeen();deferred=null});
