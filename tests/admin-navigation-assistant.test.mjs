import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isApprovedJotformUrl} from '../js/jotform-admin-assistant.js';
import {JOTFORM_AGENT_EMBED_URL} from '../js/jotform-admin-config.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('public pages no longer load a second sidebar',()=>{
 for(const file of ['index.html','team.html','class.html','gym.html','bracket-demo.html']){
  assert.doesNotMatch(read(file),/public-rail\.js|public-rail\.css/,file);
 }
});
test('admin sidebar is source for operational pages',()=>{
 const js=read('js/operational-sidebar.js');
 assert.match(js,/admin\/index\.html/);
 assert.match(js,/querySelector\('#admin-sidebar'\)/);
 for(const page of ['tournament-tools.html','live.html','athletics-athletes.html','guida-coordinatore.html']){
  assert.match(read(page),/data-operational-sidebar/,page);
 }
});
test('assistant only lives in the admin dashboard',()=>{
 const admin=read('admin/index.html');
 assert.match(admin,/id="view-dashboard"/);
 assert.match(admin,/id="jotform-admin-panel"/);
 assert.match(read('js/main-admin.js'),/if\(viewId!=='dashboard'\)closeAdminJotformAssistant/);
 assert.equal(JOTFORM_AGENT_EMBED_URL,'');
});
test('Jotform URLs are strictly restricted to HTTPS Jotform domains',()=>{
 assert.equal(isApprovedJotformUrl('https://agent.jotform.com/x'),true);
 assert.equal(isApprovedJotformUrl('https://cdn.jotfor.ms/y'),true);
 for(const url of ['http://agent.jotform.com/x','https://jotform.com.evil.test/agent','javascript:alert(1)','https://evil.org/x']){
  assert.equal(isApprovedJotformUrl(url),false,url);
 }
});
