'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PlatformApi}=require('../platform-api.cjs');
const {TABLES,query}=require('../platform-query.cjs');
function setup(role='super_admin'){
 const state={central:{tables:Object.fromEntries(TABLES.map(table=>[table,[]])),counters:{}}};
 Object.assign(state.central.tables,{sports:[{id:1,name:'Basket test',sport_type:'basket'}],teams:[{id:10,sport_id:1,name:'A'},{id:20,sport_id:1,name:'B'}],
  players:[{id:101,team_id:10,full_name:'Capitano sintetico',student_code:'CODICE_PRIVATO'}],class_invites:[{id:1,sport_id:1,access_code:'ACCESSO_PRIVATO'}],
  matches:[{id:1,sport_id:1,home_team_id:10,away_team_id:20,home_score:0,away_score:0,lock_version:0,is_finished:false,status:'scheduled',live_payload:{}},
   {id:2,sport_id:1,home_team_id:10,away_team_id:20,home_score:2,away_score:1,lock_version:3,is_finished:true,status:'finished',live_payload:{}}],
  match_stats:[{id:1,match_id:2,player_id:101,points_scored:1}],match_staff_assignments:[{id:1,match_id:2,role:'referee',name:'Arbitro'}]});
 const api=Object.create(PlatformApi.prototype);api.user=role?{id:'local-test',ruolo:role}:null;api.clock=()=>Date.parse('2026-10-14T10:00:00Z');api.audit=()=>{};
 return {api,state,run:(table,calls)=>query(api,state,{table,calls})};
}
const call=(method,...args)=>({method,args});
test('unauthenticated joins cannot expose class codes, and nested or aliased student codes are never returned',()=>{
 const {run}=setup(null);
 assert.throws(()=>run('sports',[call('select','*,class_invites(*)')]),/Relazione riservata/);
 assert.throws(()=>run('sports',[call('select','teams(players(code:student_code))')]),/Colonna riservata/);
 assert.throws(()=>run('players',[call('select','code:student_code')]),/Colonna riservata/);
 assert.doesNotMatch(JSON.stringify(run('sports',[call('select','teams(players(*))')])),/CODICE_PRIVATO|student_code/);
 assert.equal(run('sports',[call('select','teams(players(full_name))')]).data[0].teams[0].players[0].full_name,'Capitano sintetico');
});
test('direct inserts accept an unplayed zero score but cannot manufacture a played or official match',()=>{
 for(const payload of [{home_score:8},{live_payload:{home_score:8}},{operational_status:'official'},{status:'finished'},{lock_version:3},{is_finished:true}]){
  const {run}=setup();assert.throws(()=>run('matches',[call('insert',{sport_id:1,home_team_id:10,away_team_id:20,...payload})]),/referto|Stato/i);
 }
 const {run}=setup();assert.equal(run('matches',[call('insert',{sport_id:1,home_team_id:10,away_team_id:20,home_score:0,away_score:0,is_finished:false})]).data[0].home_score,0);
});
test('upserts cannot change a finalized match or bypass publication rules; scheduled edits increment the version',()=>{
 const {run,state}=setup();
 assert.throws(()=>run('matches',[call('upsert',{id:2,round_name:'Alterata'})]),/Riaprire/);
 assert.throws(()=>run('matches',[call('update',{status:'finished'}),call('eq','id',1)]),/Stato/);
 run('matches',[call('upsert',{id:1,round_name:'Semifinale'})]);assert.equal(state.central.tables.matches[0].lock_version,1);
});
test('finalized statistics, events and staff cannot be mutated or moved onto another signed match',()=>{
 const {run}=setup();
 assert.throws(()=>run('match_stats',[call('update',{points_scored:9}),call('eq','match_id',2)]),/Riaprire/);
 assert.throws(()=>run('match_staff_assignments',[call('delete'),call('eq','match_id',2)]),/Riaprire/);
 assert.throws(()=>run('live_match_events',[call('insert',{match_id:2,event_type:'score'})]),/Riaprire/);
 assert.throws(()=>run('match_captain_signatures',[call('insert',{match_id:1,team_side:'home'})]),/chiusura autorizzata/);
 assert.equal(run('match_stats',[call('upsert',{match_id:1,player_id:101,points_scored:1},{onConflict:'match_id,player_id'})]).data[0].match_id,1);
 assert.equal(run('match_staff_assignments',[call('insert',{match_id:1,role:'referee',name:'Arbitro nuovo'})]).data[0].match_id,1);
});
test('report viewers cannot write tables even through upserts or joins',()=>{
 const {run}=setup('report_viewer');assert.throws(()=>run('matches',[call('upsert',{id:1,round_name:'Alterata'})]),/Accesso non autorizzato/);
});
test('numeric IDs from HTML selects match typed rows while string identifiers keep exact equality',()=>{
 const {run,state}=setup();
 assert.equal(run('teams',[call('eq','sport_id','1')]).data.length,2);
 assert.equal(run('teams',[call('in','id',['10','20'])]).data.length,2);
 assert.equal(run('teams',[call('neq','id','10')]).data[0].id,20);
 assert.equal(run('players',[call('select','*,teams(sport_id)'),call('eq','teams.sport_id','1')]).data.length,1);
 assert.equal(run('teams',[call('eq','id','')]).data.length,0);
 state.central.tables.registered_devices.push({device_id:'0001',label:'Test'});
 assert.equal(run('registered_devices',[call('eq','device_id',1)]).data.length,0);
 assert.equal(run('registered_devices',[call('eq','device_id','0001')]).data.length,1);
});
