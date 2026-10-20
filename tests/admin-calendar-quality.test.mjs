import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectExistingCalendar} from '../js/calendar-quality-analysis.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const base='2026-10-20T';
const match=(id,home,away,start,end,venue,round='Girone (Andata)')=>({
 id,home_team_id:home,away_team_id:away,
 home:{name:'Squadra '+home},away:{name:'Squadra '+away},
 scheduled_start:base+start+':00Z',scheduled_end:base+end+':00Z',
 venue_id:venue,venue:{id:venue,name:'Campo '+venue},round_name:round,status:'scheduled'
});
test('full tournament detects triple consecutive waves across different venues',()=>{
 const rows=[
  match(1,1,2,'08:00','08:30',1),
  match(2,3,4,'08:00','08:30',2),
  match(3,1,3,'08:30','09:00',2),
  match(4,2,4,'08:30','09:00',1),
  match(5,1,4,'09:00','09:30',1)
 ];
 const report=inspectExistingCalendar(rows,20);
 assert.equal(report.scheduled,5);
 assert.equal(report.issues.filter(i=>i.type==='consecutive'&&i.teamId===1).length,1);
 assert.equal(report.minimumRestMinutes,0);
 assert.ok(report.issues.some(i=>i.type==='rest'&&i.teamId===1));
 assert.equal(report.days.length,1);
});
test('detects same-time overlap and phase-order violations without writing',()=>{
 const rows=[
  match(11,1,2,'09:00','09:30',1),
  match(12,3,4,'09:15','09:45',1),
  match(13,2,4,'08:00','08:30',2,'Girone (Ritorno)')
 ];
 const report=inspectExistingCalendar(rows,0);
 assert.ok(report.issues.some(i=>i.type==='conflict'&&i.description.includes('campo')));
 assert.ok(report.issues.some(i=>i.type==='phase'));
});
test('unscheduled fixtures and multi-day gaps do not fake minutes of rest',()=>{
 const rows=[match(1,1,2,'08:00','08:30',1),{id:2,status:'scheduled',home_team_id:1,away_team_id:3,scheduled_start:null,venue_id:null}];
 const r=inspectExistingCalendar(rows,20);
 assert.equal(r.unscheduled,1);
 assert.equal(r.scheduled,1);
 assert.equal(r.minimumRestMinutes,null);
 assert.equal(r.gaps.length,0);
});
test('calendar quality is available next to existing calendar view, with independent tournament selection',()=>{
 const html=read('admin/index.html'),admin=read('js/main-admin.js'),module=read('js/admin-calendar-quality.js');
 assert.match(html,/id="btn-toggle-matches-view"/);
 assert.match(html,/id="btn-toggle-calendar-quality"/);
 assert.match(html,/id="matches-quality-sport"/);
 assert.match(html,/id="matches-quality-grid"/);
 assert.match(admin,/scheduleCalendarQualityRefresh/);
 assert.match(module,/listMatchesForAdmin\(\{sportId\}\)/);
 assert.match(module,/myAssignedMatches/);
 assert.doesNotMatch(module,/\.update\(|\.insert\(|\.delete\(|\.rpc\(/);
});
