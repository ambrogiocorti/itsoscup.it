import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('existing team page shows only public notices of the selected team',async({page})=>{
 await page.route('**/cdn.jsdelivr.net/**',r=>r.abort());
 await page.addInitScript(()=>{
  const tables={
   sports:[{id:37,name:'Torneo di prova',sport_type:'calcio',format:'gironi',year:4,is_active:true}],
   teams:[{id:124,sport_id:37,name:'4A'},{id:125,sport_id:37,name:'4B'}],
   matches:[],players:[],sport_config:[],urgent_announcements:[],
   public_notifications:[],team_favorites:[]
  };
  function query(name){
   const obj={
    filters:[],
    select(){return this;},eq(field,value){this.filters.push([field,value]);return this;},
    or(){return this;},order(){return this;},limit(){return this;},
    maybeSingle(){const found=(tables[name]||[]).find(row=>this.filters.every(([field,v])=>row[field]===v));return Promise.resolve({data:found||null,error:null});},
    single(){return this.maybeSingle();},
    then(resolve,reject){
     const rows=(tables[name]||[]).filter(row=>this.filters.every(([field,v])=>row[field]===v));
     return Promise.resolve({data:rows,error:null}).then(resolve,reject);
    }
   };return obj;
  }
  window.supabase={createClient:()=>({
   from:query,
   rpc:async(name,args)=>{
    if(name==='public_team_notices'){
     window.__teamRpcArgs=args;
     return {data:args.p_sport_id===37&&args.p_team_id===124?[
      {id:9,title:'Cambio palestra',body:'Partita spostata al campo 2',created_at:'2026-10-14T08:00:00Z'},
      {id:10,title:'<img src=x onerror=alert(1)>',body:'<script>malicious</script>',created_at:'2026-10-14T08:01:00Z'}
     ]:[],error:null};
    }
    return {data:null,error:null};
   },
   channel(){return {on(){return this;},subscribe(){return this;}};},
   removeChannel:async()=>{}
  })};
 });
 await page.goto('/?sport=37&team=124');
 await expect(page.locator('#team-public-notices-list')).toContainText('Cambio palestra');
 await expect(page.locator('#team-public-notices-list')).toContainText('Partita spostata al campo 2');
 await expect(page.locator('#team-public-notices-list img')).toHaveCount(0);
 await expect(page.locator('#team-public-notices-list script')).toHaveCount(0);
 const rpc=await page.evaluate(()=>window.__teamRpcArgs);
 expect(rpc).toEqual({p_sport_id:37,p_team_id:124});
});

test('a different team does not receive other teams public notices',async({page})=>{
 await page.route('**/cdn.jsdelivr.net/**',r=>r.abort());
 await page.addInitScript(()=>{
  const tables={
   sports:[{id:37,name:'Torneo di prova',sport_type:'calcio',format:'gironi',year:4,is_active:true}],
   teams:[{id:124,sport_id:37,name:'4A'},{id:125,sport_id:37,name:'4B'}],
   matches:[],players:[],sport_config:[],urgent_announcements:[],public_notifications:[]
  };
  function from(n){return {
   _filters:[],select(){return this;},eq(k,v){this._filters.push([k,v]);return this;},
   order(){return this},limit(){return this},or(){return this},
   maybeSingle(){return Promise.resolve({data:(tables[n]||[]).find(x=>this._filters.every(([k,v])=>x[k]===v))||null,error:null})},
   then(ok,bad){return Promise.resolve({data:(tables[n]||[]).filter(x=>this._filters.every(([k,v])=>x[k]===v)),error:null}).then(ok,bad)}
  }}
  window.supabase={createClient:()=>({
   from,rpc:async(name,args)=>({data:name==='public_team_notices'&&args.p_team_id===125?[]:null,error:null}),
   channel(){return {on(){return this},subscribe(){return this}}},removeChannel:async()=>{}
  })};
 });
 await page.goto('/?sport=37&team=125');
 await expect(page.locator('#team-public-notices-list')).toContainText('Nessun avviso pubblico per questa squadra.');
});
