import {signOutAdmin} from './auth.js';
import {initAdminJotformAssistant} from './jotform-admin-assistant.js?v=20261021';
import {canAccessAdminView} from './admin-role-views.js';

const viewUrl=(id)=>'admin?view='+encodeURIComponent(id);
const displayRole={super_admin:'Super Admin',match_manager:'Gestione gare',report_viewer:'Consultazione'};

export async function mountOperationalSidebar({active='',role='',admin=null}={}){
 const aside=document.querySelector('[data-operational-sidebar]');
 const shell=document.querySelector('.admin-shell');
 if(!aside||!shell)return;
 const response=await fetch(new URL('admin/index.html',document.baseURI),{cache:'no-cache',credentials:'same-origin'});
 if(!response.ok)throw new Error('Navigazione amministrativa non disponibile ('+response.status+')');
 const html=new DOMParser().parseFromString(await response.text(),'text/html');
 const original=html.querySelector('#admin-sidebar');
 if(!original)throw new Error('Sidebar ufficiale non disponibile');
 // Reuse the actual sidebar source: same brand, icons, order, groups, user and footer.
 aside.innerHTML=original.innerHTML;
 aside.querySelector('#admin-name').textContent=admin?.nome||admin?.email||'Amministratore';
 aside.querySelector('#admin-role').textContent=displayRole[role]||'Ruolo amministrativo';
 const device=aside.querySelector('#sidebar-device-label');
 if(device)device.textContent='Postazione di gestione';
 aside.querySelectorAll('button.sidebar-link[data-view]').forEach(button=>{
  const view=button.dataset.view;
  const item=button.closest('li');
  if(!canAccessAdminView(role,view)){item?.remove();return}
  const a=document.createElement('a');
  a.className='sidebar-link';
  a.href=viewUrl(view);
  a.innerHTML=button.innerHTML;
  if((active===view)||(active==='live'&&view==='matches')){a.classList.add('active');a.setAttribute('aria-current','page')}
  button.replaceWith(a);
 });
 aside.querySelectorAll('a.sidebar-link').forEach(a=>{
  if(a.href.endsWith('tournament-tools.html')&&active==='tools'||a.href.endsWith('athletics-athletes.html')&&active==='athletes'){
    a.classList.add('active');a.setAttribute('aria-current','page');
  }
 });
 const preferences=aside.querySelector('[data-open-push-preferences]');
 if(preferences){
  const link=document.createElement('a');link.className='sidebar-link';
  link.href='admin?view=settings';link.innerHTML=preferences.innerHTML;
  preferences.replaceWith(link);
 }
 const logout=aside.querySelector('#btn-logout');
 logout?.addEventListener('click',async()=>{
  logout.disabled=true;
  try{await signOutAdmin();location.assign('./')}
  catch(error){logout.disabled=false;window.alert('Logout non riuscito: '+error.message)}
 });
 const toggle=document.querySelector('#btn-mobile-menu'),backdrop=document.querySelector('#sidebar-backdrop');
 const setOpen=open=>{
  const actual=Boolean(open)&&window.matchMedia('(max-width:1024px)').matches;
  shell.classList.toggle('menu-open',actual);
  document.body.classList.toggle('no-scroll',actual);
  toggle?.setAttribute('aria-expanded',String(actual));
  const icon=toggle?.querySelector('i');
  icon?.classList.toggle('fa-bars',!actual);icon?.classList.toggle('fa-xmark',actual);
 };
 toggle?.addEventListener('click',()=>setOpen(!shell.classList.contains('menu-open')));
 backdrop?.addEventListener('click',()=>setOpen(false));
 aside.addEventListener('click',e=>{if(e.target.closest('a'))setOpen(false)});
 window.addEventListener('resize',()=>{if(window.innerWidth>1024)setOpen(false)});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});
 // All callers reach this point only after successful requireAdmin authorization.
 initAdminJotformAssistant();
}
