/* Shared navigation for authenticated operational screens; links keep permission checks in /admin. */
const sections=[
 ['Panoramica',[['dashboard','Dashboard','fa-house'],['operations','Centro di controllo','fa-tower-broadcast']]],
 ['Organizzazione',[['sports','Tornei','fa-trophy'],['teams','Squadre','fa-users'],['venues','Campi','fa-location-dot'],['matches','Calendario','fa-calendar-days']]],
 ['Gestione partite',[['tools','Pianificazione','fa-wand-magic-sparkles'],['live','Match Live','fa-stopwatch']]],
 ['Atletica',[['events','Eventi','fa-person-running'],['athletes','Schede atleti','fa-address-card']]],
 ['Comunicazioni',[['telegram','Telegram','fa-paper-plane']]],
 ['Analisi e sistema',[['reports','Report','fa-chart-line'],['archive','Albo','fa-landmark'],['settings','Impostazioni','fa-gears']]]
];
const baseLink=view=>['tools','athletes','live'].includes(view)
 ? ({tools:'tournament-tools.html',athletes:'athletics-athletes.html',live:'admin?view=matches'})[view]
 : 'admin?view='+view;
export function mountOperationalSidebar({active='',role=''}={}){
 const aside=document.querySelector('[data-operational-sidebar]');
 if(!aside)return;
 const isManager=role==='match_manager',isViewer=role==='report_viewer';
 const usable=link=>link[0]!=='operations'||role==='super_admin';
 aside.innerHTML='<a class="sidebar-brand" href="admin?view=dashboard"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> ITSOSCup.it</a>'+
   '<div class="sidebar-user"><strong>Area di gestione</strong><small>'+({super_admin:'Super Admin',match_manager:'Gestione gare',report_viewer:'Consultazione'}[role]||'Account autorizzato')+'</small></div>'+
   '<nav aria-label="Navigazione amministrativa"><ul class="sidebar-menu">'+sections.map(([label,items])=>
    '<li class="sidebar-group-label">'+label+'</li>'+items.filter(usable).map(([id,title,icon])=>
    '<li><a class="sidebar-link'+(active===id?' active':'')+'"'+(active===id?' aria-current="page"':'')+
    ' href="'+baseLink(id)+'"><i class="fa-solid '+icon+'" aria-hidden="true"></i> '+title+'</a></li>').join('')).join('')+'</ul></nav>'+
   '<div class="sidebar-logout"><a href="./" class="btn btn-ghost">Sito pubblico</a></div>';
 const toggle=document.querySelector('#btn-mobile-menu'),backdrop=document.querySelector('#sidebar-backdrop');
 const setOpen=open=>{aside.classList.toggle('open',open);document.body.classList.toggle('sidebar-open',open);toggle?.setAttribute('aria-expanded',String(open))};
 toggle?.addEventListener('click',()=>setOpen(!aside.classList.contains('open')));
 backdrop?.addEventListener('click',()=>setOpen(false));
 window.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});
 aside.addEventListener('click',e=>{if(e.target.closest('a'))setOpen(false)});
}
