import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('a class can propose a roster and acknowledge its notice', async ({ page }) => {
  await page.addInitScript(() => {
    let registration = null;
    let read = false;
    const notices=[{id:17,title:'Cambio orario',body:'Partita alle 11:00',created_at:'2026-10-14T10:00:00Z'}];
    window.supabase={ createClient:()=>({
      rpc: async (name,args) => {
        if(name==='class_portal')return {data:{
          class_name:'4A',sport_id:1,registration,
          notices:notices.map(n=>({...n,read_at:read?'2026-10-14T10:05:00Z':null}))
        },error:null};
        if(name==='submit_class_registration'){
          registration={status:'pending',roster:args.p_roster,captain:args.p_captain};
          return {data:'pending',error:null};
        }
        if(name==='acknowledge_class_notice'){read=true;return {data:true,error:null};}
        return {data:null,error:{message:'RPC inattesa: '+name}};
      }
    })};
  });
  await page.goto('/class.html?code=codice-di-prova');
  await expect(page.locator('#class-title')).toHaveText('4A');
  await expect(page.locator('#notices')).toContainText('Cambio orario');
  await page.locator('#roster').fill('Mario Rossi\nGiulia Bianchi');
  await page.locator('#captain').selectOption('Giulia Bianchi');
  await page.getByRole('button',{name:'Invia proposta ai docenti'}).click();
  await expect(page.locator('#registration-status')).toContainText('In attesa');
  await page.getByRole('button',{name:'Conferma lettura'}).click();
  await expect(page.locator('#notices')).toContainText('Lettura confermata');
});

test('authorized staff can open administration analytics', async ({page})=>{
  await page.addInitScript(()=>{
    const fakeRows={
      sports:[{id:1,name:'Calcio',year:3}],class_invites:[],class_registrations:[],
      class_notices:[],class_notice_recipients:[],matches:[],match_reschedule_history:[]
    };
    const makeQuery=(name)=>{
      const query={
        select(){return this},eq(){return this},order(){return this},
        limit(){return this},in(){return this},
        maybeSingle(){return Promise.resolve({data:{id:'test-user',nome:'Operatore',email:'demo@example.test',ruolo:'super_admin'},error:null})},
        then(resolve,reject){return Promise.resolve({data:fakeRows[name]??[],error:null}).then(resolve,reject)}
      };
      return query;
    };
    window.supabase={createClient:()=>({
      auth:{getUser:async()=>({data:{user:{id:'test-user',email:'demo@example.test'}},error:null})},
      from:makeQuery
    })};
  });
  await page.goto('/admin/innovation.html');
  await expect(page.getByRole('heading',{name:'Gestione classi, avvisi e analisi'})).toBeVisible();
  await expect(page.locator('#sport')).toContainText('Calcio');
  await expect(page.locator('#metrics')).toContainText('Partite');
  await expect(page.locator('#status')).not.toContainText('Errore');
});
