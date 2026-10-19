import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSmartSchedule,verifyTournamentSchedule,isReturnMatch} from '../js/smart-scheduler.js';
const base='2027-03-10T08:00:00Z';
const date=t=>new Date(Date.parse(base)+t*60_000).toISOString();
const teams=[1,2,3,4,5,6];
const games=[];
let id=1;
for(let i=0;i<teams.length;i++)for(let j=i+1;j<teams.length;j++){
 games.push({id:id++,home_team_id:teams[i],away_team_id:teams[j],round_name:'Girone (Andata)',status:'scheduled'});
 games.push({id:id++,home_team_id:teams[j],away_team_id:teams[i],round_name:'Girone (Ritorno)',status:'scheduled'});
}
const options={matches:games,venues:[{id:11},{id:12}],start:date(0),end:date(720),durationMinutes:30,restMinutes:20};
test('two fields, consecutive matches across fields never exceed two rounds',()=>{
 const result=buildSmartSchedule(options);
 const ordered=[...result.scheduled].sort((a,b)=>a.scheduled_start.localeCompare(b.scheduled_start));
 for(const team of teams){
  const indexes=ordered.filter(m=>m.home_team_id===team||m.away_team_id===team).map(m=>(Date.parse(m.scheduled_start)-Date.parse(base))/1800000);
  for(let i=2;i<indexes.length;i++)assert.ok(indexes[i]-indexes[i-2]>2,'three consecutive waves '+team);
 }
 assert.deepEqual(verifyTournamentSchedule(ordered,20),[]);
});
test('all first-leg fixtures precede return-leg fixtures',()=>{
 const result=buildSmartSchedule({...options,end:date(1500)});
 const first=result.scheduled.filter(m=>!isReturnMatch(m));
 const ret=result.scheduled.filter(isReturnMatch);
 if(ret.length)assert.ok(Math.max(...first.map(m=>Date.parse(m.scheduled_end)))<=Math.min(...ret.map(m=>Date.parse(m.scheduled_start))));
 assert.equal(result.total,games.length);
});
test('short time windows leave games unassigned rather than break fairness',()=>{
 const result=buildSmartSchedule({...options,end:date(90)});
 assert.ok(result.missed.length>0);
 assert.equal(result.scheduled.filter(isReturnMatch).length,0);
});
test('different teams may play simultaneously, not same team',()=>{
 const result=buildSmartSchedule({...options,end:date(400)});
 for(const a of result.scheduled)for(const b of result.scheduled){
  if(a.id>=b.id)continue;
  const common=[a.home_team_id,a.away_team_id].some(id=>[b.home_team_id,b.away_team_id].includes(id));
  if(common)assert.notEqual(a.scheduled_start,b.scheduled_start);
 }
});

test('returns are blocked when the first leg cannot fit',()=>{
 const result=buildSmartSchedule({...options,end:date(180),venues:[{id:11}]});
 assert.ok(result.missed.some(x=>isReturnMatch(x.match)));
 assert.equal(result.scheduled.filter(isReturnMatch).length,0);
});
test('a fixed first-leg match holds back return fixtures',()=>{
 const fixed={...games[0],scheduled_start:date(540),scheduled_end:date(570),venue_id:11};
 const pending=games.filter(x=>x.id!==fixed.id);
 const result=buildSmartSchedule({...options,matches:[fixed,...pending],end:date(840)});
 const returns=result.scheduled.filter(isReturnMatch);
 for(const match of returns)assert.ok(Date.parse(match.scheduled_start)>=Date.parse(fixed.scheduled_end));
});
