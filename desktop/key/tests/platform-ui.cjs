'use strict';
const { _electron }=require('../../../node_modules/playwright-core');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const { appPage }=require('./electron-pages.cjs');
const PASSWORD='Synthetic central archive password 2026',PIN='22334455',EMAIL='central-synthetic@school.test';
async function finishWelcome(page) { if(await page.evaluate(()=>document.getElementById('app-dialog-title')?.textContent==='Nome postazione')) { await page.locator('#app-dialog-input').fill('Centrale sintetica');await page.locator('[data-app-dialog-confirm]').click(); } try { await page.locator('[data-tour-skip]').waitFor({timeout:5000});await page.locator('[data-tour-skip]').click(); }catch{} }
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'itsoscup-platform-ui-'));let application;
 const executable=process.argv[2]?path.resolve(process.argv[2]):require('electron');
 const packaged=Boolean(process.argv[2]);
 const central=packaged?path.join(path.dirname(executable),'ITSOSCup-Platform-data'):path.join(root,'Platform-data');
 if(fs.existsSync(central))throw new Error('The workflow requires an empty central archive path; existing data was left untouched');
 const launch={executablePath:executable,args:packaged?[]:[path.resolve(__dirname,'..')],env:{...process.env,ITSOSCUP_KEY_DATA_DIR:path.join(root,'Key-data'),ITSOSCUP_PLATFORM_DATA_DIR:central}};
 try {
  application=await _electron.launch(launch); const page=await appPage(application,'platform');page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);process.stderr.write('Platform page error: '+e.message+'\n');});page.on('console',event=>{if(event.type()==='error')process.stderr.write('Platform console: '+event.text()+'\n');});
  await application.context().setOffline(true);assert.equal(await page.evaluate(()=>navigator.onLine),false);
  await page.locator('#central-password').fill(PASSWORD);await page.locator('#central-name').fill('Responsabile sintetico');await page.locator('#central-email').fill(EMAIL);await page.locator('#central-pin').fill(PIN);await page.locator('#central-submit').click();await page.locator('#link-sports').waitFor();
  assert.match(page.url(), /^platform:\/\/app\/admin\/?$/, 'Unlock must open original administration, not a desktop duplicate');
  const initialShell=await appPage(application,'shell');
  assert.equal(await initialShell.locator('#desktop-print').count(),0,'No unsafe global print button');
  assert.equal(await initialShell.locator('#open-site').count(),1,'Public ITSOSCup entry is present');
  await finishWelcome(page);
  for(const [id,label] of [['link-dashboard','Dashboard'],['link-operations','Centro di controllo'],['link-reports','Report'],['link-matches','Calendario'],['link-venues','Campi'],['link-archive','Albo'],['link-telegram','Telegram'],['link-sports','Tornei'],['link-teams','Squadre'],['link-events','Atletica'],['link-settings','Impostazioni']]) {
    assert.equal((await page.locator('#'+id).innerText()).trim(),label,'Native platform menu must match site: '+id);
  }
  await page.locator('#link-dashboard').click();
  assert.equal(await page.locator('#view-dashboard').isVisible(),true);
  await page.locator('#link-reports').click();
  assert.equal(await page.locator('#view-reports').isVisible(),true);
  await page.locator('#link-matches').click();
  assert.equal(await page.locator('#view-matches').isVisible(),true);
  await page.locator('#link-sports').click();
  assert.equal(await page.locator('#view-sports').isVisible(),true);await finishWelcome(page);await page.locator('#link-sports').click();await page.locator('#btn-new-sport').click();
  await page.locator('#input-sport-name').fill('Torneo desktop sintetico');await page.locator('#input-sport-year').fill('3');await page.locator('#input-sport-type').selectOption('basket');await page.locator('#form-sport button[type=submit]').click();await page.locator('#modal-sport').waitFor({state:'hidden'});
  await page.locator('#link-teams').click();
  for(const [name,players,captain]of [['3A Sintetica','Capitano Alfa\nGiocatore Alfa Uno\nGiocatore Alfa Due\nGiocatore Alfa Tre\nGiocatore Alfa Quattro','Capitano Alfa'],['3B Sintetica','Capitano Beta\nGiocatore Beta Uno\nGiocatore Beta Due\nGiocatore Beta Tre\nGiocatore Beta Quattro','Capitano Beta']]){
   await page.locator('#btn-new-team-alt').click();await page.locator('#select-sport-team').selectOption({label:'Torneo desktop sintetico'});await page.locator('#input-team-name').fill(name);await page.locator('#input-players-list').fill(players);await page.locator('#select-team-captain').selectOption({label:captain});await page.locator('#form-team button[type=submit]').click();await page.locator('#modal-team').waitFor({state:'hidden'});
  }
  await page.locator('#link-matches').click();await page.locator('#view-matches [data-open-match-modal]').click();await page.locator('#select-sport-match').selectOption({label:'Torneo desktop sintetico'});await page.locator('#select-home-team').selectOption({label:'3A Sintetica'});await page.locator('#select-away-team').selectOption({label:'3B Sintetica'});await page.locator('#input-match-date').fill('2026-10-14');await page.locator('#input-match-start').fill('10:00');await page.locator('#input-match-end').fill('10:30');await page.locator('#btn-submit-match').click();await page.locator('#modal-match').waitFor({state:'hidden'});
  await page.locator('[data-action="toggle-match-menu"]').first().click();await page.locator('[data-action="start-live"]').first().click();await page.locator('#live-home-name').waitFor();await finishWelcome(page);
  for (const checkbox of await page.locator('[data-action="toggle-played"]').all()) await checkbox.check();
  await page.locator('[data-score-team="home"][data-score-delta="2"]').click();await page.locator('#btn-save-snapshot').click();
  await page.waitForFunction(async()=>{const r=await window.itsoscupPlatform.call({type:'query',table:'matches',calls:[{method:'select',args:['*']}]});return r.data?.[0]?.home_score===2;});
  await page.locator('#btn-finalize-match').click();await page.locator('#modal-finalize-signatures').waitFor();
  for(const side of ['home','away']){const canvas=page.locator('[data-signature-side="'+side+'"]');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert.ok(box);await page.mouse.move(box.x+20,box.y+40);await page.mouse.down();await page.mouse.move(box.x+140,box.y+95,{steps:10});await page.mouse.up();}
  await page.locator('#btn-confirm-finalize-signatures').click();
  await page.waitForFunction(async()=>{const r=await window.itsoscupPlatform.call({type:'query',table:'matches',calls:[{method:'select',args:['*']}]});return r.data?.[0]?.is_finished===true;});
  const results=await page.evaluate(async()=>({matches:await window.itsoscupPlatform.call({type:'query',table:'matches',calls:[{method:'select',args:['*']}] }),signatures:await window.itsoscupPlatform.call({type:'query',table:'match_captain_signatures',calls:[{method:'select',args:['*']}]})}));assert.equal(results.matches.data[0].home_score,2);assert.equal(results.signatures.data.length,2);
  await page.locator('#btn-back-admin').click();await page.locator('#link-reports').click();assert.equal(await page.locator('#view-reports').isVisible(),true);
  await page.evaluate(async()=>{const {teamFollowStore}=await import('/js/team-follow-store.js');teamFollowStore.follow(1,1,{consent:true});});
  await page.waitForFunction(async()=>{const r=await window.itsoscupPlatform.call({type:'status'});return JSON.parse(r.data?.preferences?.tornei_team_follows_v1||'{}').favorites?.length===1;});
  assert.equal(errors.length,0,errors.join('\n'));
  await application.close();application=null;
  const ciphertext=fs.readFileSync(path.join(central,'archive.keyvault'),'utf8');assert.ok(ciphertext.includes('itsoscup-key-vault'));assert.equal(ciphertext.includes('Capitano Alfa'),false);
  application=await _electron.launch(launch);const reopened=await appPage(application,'platform');await application.context().setOffline(true);await reopened.locator('#central-password').fill(PASSWORD);await reopened.locator('#central-submit').click();
  const shell=await appPage(application,'shell');
  await shell.locator('#open-site').click();
  await reopened.locator('#admin-access-btn').waitFor();await finishWelcome(reopened);await reopened.locator('#admin-access-btn').click();await reopened.locator('#login-email').fill(EMAIL);await reopened.locator('#login-pass').fill(PIN);await reopened.locator('#login-submit-btn').click();await reopened.locator('#link-reports').waitFor();await finishWelcome(reopened);
  const persisted=await reopened.evaluate(async()=>({matches:await window.itsoscupPlatform.call({type:'query',table:'matches',calls:[{method:'select',args:['*']}] }),signatures:await window.itsoscupPlatform.call({type:'query',table:'match_captain_signatures',calls:[{method:'select',args:['*']}]})}));assert.equal(persisted.matches.data[0].home_score,2);assert.equal(persisted.matches.data[0].is_finished,true);assert.equal(persisted.signatures.data.length,2);
  assert.equal(await reopened.evaluate(async()=>{const {teamFollowStore}=await import('/js/team-follow-store.js');return teamFollowStore.read().favorites.length;}),1);
  await shell.locator('#open-key').click();const key=await appPage(application,'key');assert.equal(await key.locator('#unlock-panel').isVisible(),true);await shell.locator('#open-platform').click();assert.equal(await reopened.locator('#link-reports').isVisible(),true);
  await shell.locator('#open-site').click();await reopened.locator('#admin-access-btn').waitFor();
  await shell.locator('#open-platform').click();await reopened.locator('#link-dashboard').waitFor();
  assert.equal(await reopened.locator('#view-dashboard').isVisible(),true);
  process.stdout.write('Native whole-platform offline flow passed: first setup, tournament, two teams/captains, calendar, live score, two drawn signatures, reports, encrypted persistence after restart, local PIN login and Key switching.\n');
 }catch(error){if(application){const page=application.context().pages().find(p=>p.url().startsWith('platform://'));if(page){process.stderr.write('Failure view '+page.url()+'\n'+await page.locator('body').innerText()+'\n');const output=path.resolve(__dirname,'../../../tmp');fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'platform-ui-error.png')});}}throw error;}finally{if(application)await application.close();if(packaged&&fs.existsSync(central)){assert.equal(path.resolve(central),path.join(path.dirname(executable),'ITSOSCup-Platform-data'));fs.rmSync(central,{recursive:true,force:true});}fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
