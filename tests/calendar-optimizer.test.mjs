import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeCalendarOptimization} from '../js/calendar-optimizer.js';
const base=Date.now()+86400000;
const match=(id,a,b,start,venue=1)=>({id,home_team_id:a,away_team_id:b,venue_id:venue,scheduled_start:new Date(start).toISOString(),scheduled_end:new Date(start+30*60000).toISOString(),is_finished:false,status:'scheduled'});
test('moves overlapping fixture to preserve team rest',()=>{
 const at=new Date();at.setDate(at.getDate()+2);at.setHours(9,0,0,0);
 const a=match(1,1,2,at.getTime(),1),b=match(2,1,3,at.getTime()+30*60000,2);
 const plan=proposeCalendarOptimization([a,b],15,120);
 assert.equal(plan.changes.length,1);
 assert.equal(plan.changes[0].id,2);
 assert.equal(Date.parse(plan.changes[0].start)-Date.parse(b.scheduled_start),15*60000);
});
test('does not move finished matches',()=>{
 const at=new Date();at.setDate(at.getDate()+2);at.setHours(9,0,0,0);
 const a=match(1,1,2,at.getTime()),b={...match(2,1,3,at.getTime()+10*60000,2),is_finished:true};
 const plan=proposeCalendarOptimization([a,b],15,120);
 assert.equal(plan.changes.length,0);
 assert.ok(plan.unresolved.length);
});
test('does not move a fixture beyond same day',()=>{
 const at=new Date();at.setDate(at.getDate()+2);at.setHours(23,20,0,0);
 const a=match(1,1,2,at.getTime()),b=match(2,1,3,at.getTime()+10*60000,2);
 const plan=proposeCalendarOptimization([a,b],30,120);
 assert.equal(plan.changes.length,0);
});
