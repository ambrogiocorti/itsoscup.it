import {test,expect} from '@playwright/test';

test.use({serviceWorkers:'block'});

async function mockAdmin(page,role='super_admin'){
 await page.addInitScript(({role})=>{
  const now='2026-10-20T08:00:00Z';
  const rows={
   admins:[{id:'demo-admin',nome:'Coordinatore prova',email:'prova@scuola.example',ruolo:role}],
   sports:[{id:42,name:'Basket Quarte',year:4,format:'gironi',sport_type:'basket',
     has_return_match:true,is_active:true,created_at:now,registration_deadline:now,roster_confirmed_at:now}],
   teams:[{id:1,sport_id:42,name:'4A'},{id:2,sport_id:42,name:'4B'}],
   matches:[{id:11,sport_id:42,home_team_id:1,away_team_id:2,round_name:'Girone (Andata)',
     status:'finished',is_finished:true,home_score:2,away_score:1,venue_id:1,
     sport:{sport_type:'basket',name:'Basket Quarte'},home:{name:'4A'},away:{name:'4B'},venue:{id:1,name:'Campo 1'},
     scheduled_start:'2026-10-20T08:30:00Z',scheduled_end:'2026-10-20T09:00:00Z'}],
   class_invites:[{id:15,sport_id:42,is_active:true}],
   class_registrations:[{invite_id:15,sport_id:42,status:'approved'}],
   match_captain_signatures:[
    {match_id:11,team_side:'home',signed_at:now},
    {match_id:11,team_side:'away',signed_at:now}],
   events:[],event_results:[],athletics_entries:[],
  };
  window.__testWrites=[];
  function from(table){
   return {
    filters:[],limitRange:null,one:false,
    select(){return this},
    eq(k,v){this.filters.push([k,v]);return this},
    in(k,v){this.filters.push([k,v]);return this},
    order(){return this},
    range(a,b){this.limitRange=[a,b];return this},
    single(){this.one=true;return this},
    maybeSingle(){this.one=true;return this},
    insert(){window.__testWrites.push('insert');return this},
    update(){window.__testWrites.push('update');return this},
    delete(){window.__testWrites.push('delete');return this},
    then(resolve,reject){
     let items=[...(rows[table]||[])];
     for(const [key,value] of this.filters)items=items.filter(x=>
      Array.isArray(value)?value.includes(x[key]):x[key]===value);
     if(this.limitRange)items=items.slice(this.limitRange[0],this.limitRange[1]+1);
     return Promise.resolve({data:this.one?(items[0]||null):items,error:null}).then(resolve,reject);
    }
   };
  }
  window.supabase={createClient:()=>({
   auth:{getUser:async()=>({data:{user:{id:'demo-admin',email:'prova@scuola.example'}},error:null}),
         getSession:async()=>({data:{session:{user:{id:'demo-admin'}}},error:null}),
         signOut:async()=>({error:null})},
   from,
   rpc:async name=>{window.__testWrites.push('rpc:'+name);return {data:null,error:{message:'Non previsto nel test'}}}
  })};
 },{role});
}

test('setup wizard reuses the canonical sidebar and navigates the five real workflows',async({page})=>{
 await mockAdmin(page);
 await page.goto('/tournament-setup.html');
 await expect(page.locator('#admin-sidebar .sidebar-link').first()).toBeVisible();
 await expect(page.getByRole('heading',{name:'Prepara un nuovo torneo'})).toBeVisible();
 await page.locator('#setup-existing').selectOption('42');
 await expect(page.locator('#setup-create-form')).toBeHidden();
 await page.locator('#setup-next').click();
 await expect(page.locator('[data-panel="1"]')).toBeVisible();
 await expect(page.locator('#setup-deadline')).toContainText('Scadenza');
 await page.locator('#setup-next').click();
 await expect(page.locator('#setup-team-count')).toContainText('2 squadre');
 await page.locator('#setup-next').click();
 await expect(page.locator('#setup-match-count')).toContainText('1 incontri');
 await page.locator('#setup-next').click();
 await expect(page.locator('#setup-scheduled-count')).toContainText('1 su 1');
 expect(await page.evaluate(()=>window.__testWrites)).toEqual([]);
});

test('training simulator calculates illustrative data without creating database writes',async({page})=>{
 await mockAdmin(page);
 await page.goto('/tournament-demo.html');
 await expect(page.getByRole('heading',{name:'Prova ITSOSCup senza rischi'})).toBeVisible();
 await expect(page.locator('#demo-metrics > div')).toHaveCount(4);
 await page.locator('#demo-teams').selectOption('4');
 await page.locator('#demo-config button[type="submit"]').click();
 await expect(page.locator('#demo-schedule table')).toBeVisible();
 await page.locator('#demo-score button').click();
 await expect(page.locator('#demo-score-output')).toContainText('dimostrativo');
 expect(await page.evaluate(()=>window.__testWrites)).toEqual([]);
});

test('historical analytics and closeout are read only for a scoped admin',async({page})=>{
 await mockAdmin(page);
 await page.goto('/tournament-insights.html');
 await expect(page.locator('#insights-metrics>div')).toHaveCount(4);
 await expect(page.locator('#insights-rows')).toContainText('Basket');
 await page.goto('/tournament-closeout.html?sport=42');
 await expect(page.getByRole('heading',{name:'Controllo finale del torneo'})).toBeVisible();
 await expect(page.locator('#closeout-overview > div')).toHaveCount(3);
 await expect(page.locator('#closeout-issues')).toContainText('Nessuna anomalia');
 expect(await page.evaluate(()=>window.__testWrites)).toEqual([]);
});

test('non-privileged role cannot create new tournaments in the wizard',async({page})=>{
 await mockAdmin(page,'report_viewer');
 await page.goto('/tournament-setup.html');
 await expect(page.locator('#setup-status')).toContainText('riservata al Super Admin');
});

test('existing admin calendar exposes read-only quality matrix beside the calendar button',async({page})=>{
 // Isolate the calendar component and block the CDN from replacing the fake Supabase client.
 await page.route('**/js/main-admin.js*',route=>route.fulfill({status:200,contentType:'text/javascript',body:'export {};'}));
 await page.route('**/cdn.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
 await mockAdmin(page);
 await page.goto('/admin?view=matches');
 await page.evaluate(async()=>{
  document.body.classList.remove('auth-pending');
  document.getElementById('view-matches').classList.add('active');
  const {initCalendarQuality}=await import('/js/admin-calendar-quality.js?v=1');
  await initCalendarQuality({adminRole:'super_admin',onMatchDetail:()=>{}});
 });
 await expect(page.locator('#btn-toggle-matches-view')).toBeVisible();
 await expect(page.locator('#btn-toggle-calendar-quality')).toBeVisible();
 await page.locator('#btn-toggle-calendar-quality').click();
 await expect(page.locator('#matches-calendar-quality')).toBeVisible();
 await expect(page.locator('#matches-quality-status')).toContainText('partite esaminate');
 await expect(page.locator('.mcq-grid-table')).toBeVisible();
 await expect(page.locator('.mcq-game')).toContainText('4A');
 expect(await page.evaluate(()=>window.__testWrites)).toEqual([]);
});
