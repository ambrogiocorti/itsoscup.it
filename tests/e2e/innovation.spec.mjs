import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('class portal uses ITSOSCup styling and can submit roster and read notices', async ({ page }) => {
  await page.addInitScript(() => {
    let registration=null, read=false;
    window.supabase={createClient:()=>({
      rpc:async(name,args)=>{
        if(name==='class_portal')return {data:{
          class_name:'4A',sport_id:1,registration,
          notices:[{id:17,title:'Cambio orario',body:'Partita alle 11:00',created_at:'2026-10-14T10:00:00Z',read_at:read?'2026-10-14T10:05:00Z':null}]
        },error:null};
        if(name==='class_registration_deadline')return {data:'2099-11-30T18:00:00Z',error:null};
        if(name==='submit_class_registration'){registration={status:'pending',roster:args.p_roster,captain:args.p_captain};return {data:'pending',error:null};}
        if(name==='acknowledge_class_notice'){read=true;return {data:true,error:null};}
        return {data:null,error:{message:'RPC inattesa: '+name}};
      }
    })};
  });
  await page.goto('/class.html?code=codice-di-prova');
  await expect(page.getByRole('heading',{name:'Area della classe'})).toBeVisible();
  await expect(page.locator('#class-title')).toHaveText('4A');
  await expect(page.locator('#notices')).toContainText('Cambio orario');
  await page.locator('#roster').fill('Mario Rossi\nGiulia Bianchi');
  await page.locator('#captain').selectOption('Giulia Bianchi');
  await page.getByRole('button',{name:'Invia iscrizione'}).click();
  await expect(page.locator('#registration-status')).toContainText('In attesa');
  await page.getByRole('button',{name:'Conferma lettura'}).click();
  await expect(page.locator('#notices')).toContainText('Lettura confermata');
});

test('class invites, targeted notices and analytics are integrated into existing admin sections',async ({page})=>{
  await page.route('**/js/main-admin.js*',async route=>route.fulfill({status:200,contentType:'text/javascript',body:'export {};'}));
  await page.addInitScript(()=>{
    const seeded={
      class_invites:[{id:'11111111-1111-1111-1111-111111111111',sport_id:1,class_name:'4A',access_code:'token-prova',is_active:true}],
      class_registrations:[{id:22,invite_id:'11111111-1111-1111-1111-111111111111',sport_id:1,class_name:'4A',roster:['Mario Rossi'],captain_name:'Mario Rossi',status:'pending',submitted_at:'2026-10-14T10:00:00Z'}],
      class_notices:[],class_notice_recipients:[],
      matches:[{id:17,sport_id:1,status:'finished',is_finished:true,
        scheduled_start:'2026-10-14T10:00:00Z',started_at:'2026-10-14T10:05:00Z',
        finished_at:'2026-10-14T11:00:00Z'}],
      match_reschedule_history:[]
    };
    window.__fakeRows=seeded;
    window.__noticeSent=null;
    function queryFor(name) {
      const q={_filters:[],_limit:0,
        select(){return this;},
        eq(field,value){this._filters.push([field,value]);return this;},
        in(field,list){this._filters.push([field,list]);return this;},
        order(){return this;},limit(value){this._limit=value;return this;},
        insert(values){
          const payload=Array.isArray(values)?values[0]:values;
          seeded[name]??=[];
          const row={id:1000+seeded[name].length,...payload,access_code:'created-token'};
          seeded[name].push(row);
          this._inserted=row;
          return this;
        },
        single(){return Promise.resolve({data:this._inserted||null,error:null});},
        then(resolve,reject){
          let rows=[...(seeded[name]||[])];
          for(const [field,value] of this._filters) rows=rows.filter(row=>Array.isArray(value)?value.includes(row[field]):row[field]===value);
          if(this._limit)rows=rows.slice(0,this._limit);
          return Promise.resolve({data:rows,error:null}).then(resolve,reject);
        }
      };
      return q;
    }
    window.__mockSupabase={createClient:()=>({
      from:queryFor,
      rpc:async(name,args)=>{
        if(name==='send_team_class_notice'){
          window.__noticeSent=args;
          seeded.class_notices.unshift({id:33,sport_id:args.p_sport_id,title:args.p_title,body:args.p_body,created_at:'2026-10-14T12:00:00Z'});
          seeded.class_notice_recipients.push({notice_id:33,invite_id:args.p_invite_ids[0],read_at:null});
          return {data:33,error:null};
        }
        if(name==='decide_class_registration'){
          const item=seeded.class_registrations.find(row=>row.id===args.p_registration_id);
          item.status=args.p_approve?'approved':'rejected';
          return {data:45,error:null};
        }
        return {data:null,error:{message:'Unexpected RPC '+name}};
      }
    })};
  });
  await page.goto('/admin/');
  await page.evaluate(async()=>{
    window.supabase=window.__mockSupabase;
    document.body.classList.remove('auth-pending');
    const report=document.getElementById('report-sport-select');
    report.replaceChildren(new Option('Calcio','1'));
    const {initIntegratedAdmin}=await import('/js/admin-integrated-workflows.js');
    await initIntegratedAdmin({role:'super_admin',sports:[{id:1,name:'Calcio',year:4,sport_type:'calcio'}]});
    for(const id of ['view-teams','view-telegram','view-reports']){
      document.getElementById(id).classList.add('active');
    }
  });
  await expect(page.locator('#class-registration-sport')).toHaveValue('1');
  await expect(page.locator('#class-notice-sport')).toHaveValue('1');
  await expect(page.locator('#class-invite-list')).toContainText('4A');
  await expect(page.locator('#class-registration-list')).toContainText('Mario Rossi');
  await page.locator('#public-notification-audience').selectOption('classes');
  await expect(page.locator('#public-notification-target-fields')).toBeVisible();
  await page.locator('#class-notice-publish-team').check();
  await expect(page.locator('#class-notice-recipients option')).toHaveCount(1);
  await page.locator('#class-notice-recipients').selectOption(['11111111-1111-1111-1111-111111111111']);
  await expect(page.locator('#class-notice-recipient-count')).toContainText('1 classi selezionate');
  await page.locator('#public-notification-title').fill('Nuovo orario');
  await page.locator('#public-notification-body').fill('Controllare il nuovo orario.');
  await page.locator('#form-public-notification button[type="submit"]').click();
  await expect(page.locator('#public-notice-feedback')).toContainText('Avviso pubblicato');
  const submitted=await page.evaluate(()=>window.__noticeSent);
  expect(submitted.p_invite_ids).toEqual(['11111111-1111-1111-1111-111111111111']);
  expect(submitted.p_publish_to_team).toBe(true);
  await expect(page.locator('#class-notification-history')).toContainText('Nuovo orario');
  await expect(page.locator('#event-analytics-kpis')).toHaveCount(0);
});
