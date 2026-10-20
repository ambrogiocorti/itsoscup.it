import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('guidance reuses real business operations with explicit confirmation',()=>{
 const js=read('js/setup-wizard.js');
 for(const name of ['requireAdmin','saveSport','generateMatchesForSport','loadMatchesBySport','mountOperationalSidebar'])assert.ok(js.includes(name));
 assert.match(js,/confirm\('Creare gli accoppiamenti ufficiali/);
 assert.match(read('tournament-setup.html'),/data-operational-sidebar/);
});
test('the dashboard checklist is read only and links to existing operations',()=>{
 const js=read('js/admin-preparation.js');
 assert.doesNotMatch(js,/\.update\(|\.insert\(|\.delete\(|\.rpc\(/);
 assert.match(read('admin/index.html'),/href="tournament-setup.html"/);
 assert.match(read('js/main-admin.js'),/initAdminPreparation/);
});

test('training and historical insights require authentication and expose no write API',()=>{
 for(const file of ['tournament-demo.html','tournament-insights.html']){
  assert.match(read(file),/data-operational-sidebar/);
 }
 assert.match(read('js/tournament-demo.js'),/requireAdmin/);
 assert.match(read('js/tournament-insights.js'),/requireAdmin/);
 for(const file of ['js/tournament-demo.js','js/tournament-insights.js']){
  assert.doesNotMatch(read(file),/\.insert\(|\.update\(|\.delete\(|db\.rpc\(/);
 }
 assert.match(read('admin/index.html'),/href="tournament-demo.html"/);
 assert.match(read('admin/index.html'),/href="tournament-insights.html"/);
});
test('final roster approval and athletics enrollment are independent guarded workflows',()=>{
 assert.match(read('js/roster-seal.js'),/set_tournament_roster_confirmation/);
 assert.match(read('js/athletics-enrollment.js'),/set_athletics_entry/);
 assert.match(read('js/athlete-profiles.js'),/athletics_entries/);
 assert.match(read('admin/index.html'),/id="btn-roster-seal"/);
});
