import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMatchClosure,createUndoSnapshot,applyUndoSnapshot} from '../js/live-safety.js';
import {buildDailyRecap,renderDailyRecap} from '../js/daily-recap.js';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('role-scoped assignment: no admin writes without a Super Admin, and no match-manager writes without membership',()=>{
 const sql=source('sql/itsos_match_staff_scoped_access.sql');
 assert.match(sql,/Solo Super Admin può assegnare gli operatori/);
 assert.match(sql,/private\.itsos_can_operate_match\(old\.id\)/);
 assert.match(sql,/create trigger itsos_guard_matches/);
 for(const t of ['match_stats','match_captain_signatures','live_match_events','match_checkins'])assert.ok(sql.includes("'"+t+"'"));
 assert.match(source('js/main-admin.js'),/myAssignedMatches\(\)/);
 assert.match(source('js/main-live.js'),/canOperateMatch\(state\.matchId/);
});

test('scorekeeper cannot erase assigned staff on signature closure',()=>{
 const match=source('js/matches.js');
 assert.match(match,/protectedRoles/);
 assert.match(match,/\.is\('admin_id',null\)/);
});

test('closure checklist validates score, presences, captain and signatures',()=>{
 const fixture={sportType:'basket',homeScore:12,awayScore:9,homePlayers:[{id:1}],awayPlayers:[{id:2}],entries:[{player_id:1,played:true},{player_id:2,played:true,is_mvp_vote:true}],config:{min_players:1,allow_mvp:true},homeCaptain:{id:1},awayCaptain:{id:2},signatures:{home:'sig',away:'sig'}};
 const good=validateMatchClosure(fixture);assert.equal(good.ready,true);assert.equal(good.warnings.length,0);
 const missing=validateMatchClosure({...fixture,signatures:{home:null,away:null},awayScore:-1});
 assert.equal(missing.ready,false);assert.ok(missing.blockers.some(x=>x.includes('firme')));assert.ok(missing.blockers.some(x=>x.includes('punteggio')));
 const warning=validateMatchClosure({...fixture,entries:fixture.entries.map(e=>({...e,is_mvp_vote:false}))});
 assert.ok(warning.warnings.some(x=>x.includes('MVP')));
});

test('undo restores player state, points, timeouts and events by value, not by reference',()=>{
 const state={homeScore:3,awayScore:2,duration:44,quarter:2,timeouts:{home:1,away:0},playerState:new Map([[1,{played:true}]]),eventLog:[{notes:'goal'}]};
 const original=createUndoSnapshot(state);state.playerState.get(1).played=false;state.eventLog[0].notes='updated';state.homeScore=4;
 applyUndoSnapshot(state,original);
 assert.equal(state.homeScore,3);assert.equal(state.playerState.get(1).played,true);assert.equal(state.eventLog[0].notes,'goal');
});

test('daily recap filters Rome-local date and orders closest matches and next fixtures',()=>{
 const rows=[{id:1,is_finished:true,finished_at:'2026-10-15T12:00:00+02:00',home_score:2,away_score:1,home:{id:1,name:'4A'},away:{id:2,name:'4B'},sport:{name:'Calcio'}},{id:2,is_finished:false,scheduled_start:'2026-10-16T12:00:00+02:00',home:{name:'5A'},away:{name:'5B'}}];
 const summary=buildDailyRecap(rows,'2026-10-15');assert.equal(summary.matchCount,1);assert.equal(summary.upcoming.length,1);assert.equal(summary.closest.length,1);
 const html=renderDailyRecap(summary);assert.match(html,/Partite più combattute/);assert.match(html,/Prossimi incontri/);
 assert.doesNotMatch(html,/<script>/);
});
