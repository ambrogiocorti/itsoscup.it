const links=[["Tornei","./","fa-house"],["Le mie squadre","./#my-teams-card","fa-star"],["Schermo palestra","gym.html","fa-tv"],["Area classe","class.html","fa-users"],["Amministrazione","admin?view=dashboard","fa-shield-halved"]];
function init(){
 if(document.getElementById('itsos-public-rail'))return;
 const path=location.pathname;
 const active=path.endsWith('/team.html')?1:path.endsWith('/gym.html')?2:path.endsWith('/class.html')?3:0;
 const aside=document.createElement('aside');aside.id='itsos-public-rail';aside.className='itsos-public-rail';aside.setAttribute('aria-label','Navigazione ITSOSCup');
 const nav=document.createElement('nav');nav.setAttribute('aria-label','Sezioni della piattaforma');
 nav.innerHTML='<a class="itsos-rail-brand" href="./"><i class="fa-solid fa-trophy" aria-hidden="true"></i><span>ITSOSCup</span></a><div class="itsos-rail-heading">Esplora</div>'+
 links.map(([title,href,icon],i)=>'<a class="itsos-rail-link'+(active===i?' active':'')+'" href="'+href+'"'+(active===i?' aria-current="page"':'')+'><i class="fa-solid '+icon+'" aria-hidden="true"></i><span>'+title+'</span></a>').join('');
 aside.append(nav);
 const toggle=document.createElement('button');toggle.className='itsos-rail-toggle';toggle.type='button';toggle.setAttribute('aria-label','Apri menu laterale');toggle.setAttribute('aria-expanded','false');
 toggle.innerHTML='<i class="fa-solid fa-bars" aria-hidden="true"></i> Menu';
 const backdrop=document.createElement('div');backdrop.className='itsos-rail-shade';backdrop.setAttribute('aria-hidden','true');
 const setOpen=x=>{document.body.classList.toggle('itsos-rail-open',x);toggle.setAttribute('aria-expanded',String(x))};
 toggle.addEventListener('click',()=>setOpen(!document.body.classList.contains('itsos-rail-open')));
 backdrop.addEventListener('click',()=>setOpen(false));
 document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});
 aside.addEventListener('click',e=>{if(e.target.closest('a'))setOpen(false)});
 document.body.prepend(backdrop,aside,toggle);document.body.classList.add('has-itsos-public-rail');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
