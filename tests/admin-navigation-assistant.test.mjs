import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isApprovedJotformUrl,isApprovedJotformEmbedScriptUrl} from '../js/jotform-admin-assistant.js';
import {JOTFORM_AGENT_SCRIPT_URL} from '../js/jotform-admin-config.js';
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
 for(const page of ['tournament-tools.html','athletics-athletes.html','guida-coordinatore.html']){
  assert.match(read(page),/data-operational-sidebar/,page);
 }
});
test('assistant only lives in the admin dashboard',()=>{
 const admin=read('admin/index.html');
 assert.match(admin,/id="view-dashboard"/);
 assert.doesNotMatch(admin,/id="btn-open-jotform-admin"|id="jotform-admin-panel"/);
 assert.match(read('js/main-admin.js'),/if\(viewId!=='dashboard'\)closeAdminJotformAssistant/);
 assert.equal(JOTFORM_AGENT_SCRIPT_URL,'https://cdn.jotfor.ms/agent/embedjs/01a158834f78700087a259d6a403ec77e377/embed.js');
 assert.doesNotMatch(admin,/cdn\.jotfor\.ms\/agent\/embedjs/);
 assert.doesNotMatch(read('index.html'),/jotform-admin-assistant/);
});
test('Jotform URLs are strictly restricted to HTTPS Jotform domains',()=>{
 assert.equal(isApprovedJotformUrl('https://agent.jotform.com/x'),true);
 assert.equal(isApprovedJotformUrl('https://cdn.jotfor.ms/y'),true);
 for(const url of ['http://agent.jotform.com/x','https://jotform.com.evil.test/agent','javascript:alert(1)','https://evil.org/x']){
  assert.equal(isApprovedJotformUrl(url),false,url);
 }
});

test('Jotform uses its own floating launcher instead of a custom chat button',()=>{
 assert.equal(isApprovedJotformEmbedScriptUrl(JOTFORM_AGENT_SCRIPT_URL),true);
 const loader=read('js/jotform-admin-assistant.js');
 assert.match(loader,/document.createElement\\('script'\\)/);
 assert.match(loader,/script.src=JOTFORM_AGENT_SCRIPT_URL/);
 assert.doesNotMatch(loader,/document.createElement\\('iframe'\\)|buildJotformFrameDocument/);
 assert.match(loader,/if\\(!isDashboard\\(\\)\\)return/);
 assert.match(loader,/widgetRoots/);
 assert.doesNotMatch(read('admin/index.html'),/btn-open-jotform-admin/);
});
test('rejects untrusted or incorrectly shaped scripts',()=>{
 for(const url of [
  'http://cdn.jotfor.ms/agent/embedjs/agent/embed.js',
  'https://cdn.jotfor.ms/agent/embedjs/../../redirect',
  'https://cdn.jotfor.ms/agent/embedjs/xyz/embed.js?callback=evil',
  'https://evil.example/agent/embedjs/abc/embed.js',
  'https://cdn.jotfor.ms/something-else/abc.js'
 ])assert.equal(isApprovedJotformEmbedScriptUrl(url),false,url);
});

test('live scorekeeper page has no sidebar but retains return to admin',()=>{
 const page=read('live.html');
 assert.doesNotMatch(page,/data-operational-sidebar|id="admin-sidebar"|admin-shell operational-shell/);
 assert.match(page,/id="btn-back-admin"/);
 assert.doesNotMatch(read('js/main-live.js'),/mountOperationalSidebar/);
});
test('sidebar omits planning and athlete cards, but their contexts still link to tools',()=>{
 const html=read('admin/index.html');
 const nav=html.slice(html.indexOf('<ul class="sidebar-menu">'),html.indexOf('</ul>',html.indexOf('<ul class="sidebar-menu">')));
 assert.doesNotMatch(nav,/athletics-athletes.html|tournament-tools.html/);
 assert.match(html,/href="athletics-athletes.html" title="Schede atleti e tentativi" aria-label="Apri schede atleti e tentativi"/);
});
test('homepage overview heading has explicit white-on-dark contrast',()=>{
 const css=read('css/redesign.css');
 assert.match(css,/public-overview-heading\{color:#fff!important/);
 assert.match(css,/#public-overview \.card-header\{[\s\S]*?background:transparent!important/);
});
