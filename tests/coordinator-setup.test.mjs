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

test('the operational manual and PWA cannot claim supported offline scoring',()=>{
 const readme=read('README.md'),worker=read('sw.js'),guide=read('docs/offline-senza-rete.md');
 assert.match(readme,/online-first, NON una postazione/);
 assert.match(guide,/PWA ufficiale è \*\*online-first\*\*/);
 assert.match(worker,/ONLINE-ONLY navigation/);
 assert.match(worker,/status: 503/);
 assert.match(read('js/jotform-admin-config.js'),/NON dentro un frame sandbox/);
});

test('roster signoff preflight considers all active class invitations',()=>{
 const r=read('js/roster-seal.js'),dash=read('js/admin-preparation.js');
 assert.match(r,/class_invites/);
 assert.match(r,/incompleteInvites/);
 assert.match(dash,/missingInvites/);
 assert.match(read('sql/059_approval_all_invites.sql'),/Inviti di classe non completati/);
});

test('tournament closeout is an authenticated read-only administrative checklist',()=>{
 const p=read('tournament-closeout.html'),js=read('js/tournament-closeout.js');
 assert.match(p,/data-operational-sidebar/);
 assert.match(js,/requireAdmin/);
 assert.match(js,/match_captain_signatures/);
 assert.match(js,/athletics_entries/);
 assert.doesNotMatch(js,/\.update\(|\.insert\(|\.delete\(|db\.rpc\(/);
 assert.match(read('admin/index.html'),/href="tournament-closeout.html"/);
});

test('successor runbook documents staging, safe restoration and identity governance',()=>{
 const guide=read('docs/continuita-operativa.md');
 assert.match(guide,/Staging completo da predisporre/);
 assert.match(guide,/test di ripristino sovrascrivendo la produzione/);
 assert.match(guide,/RPO\/RTO/);
 assert.match(guide,/medesimo contesto JavaScript/);
});
