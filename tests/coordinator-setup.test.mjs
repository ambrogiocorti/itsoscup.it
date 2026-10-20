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
