'use strict';
const { _electron }=require('../../../node_modules/playwright-core');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {encryptPackage}=require('../crypto.cjs');const {prepared,PASSWORD}=require('./fixtures.cjs');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'itsoscup-key-ui-')),p=prepared(),file=path.join(root,'prepared.keypack');fs.writeFileSync(file,encryptPackage(p,PASSWORD));let application;
  try{
    application=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env:{...process.env,ITSOSCUP_KEY_DATA_DIR:path.join(root,'USB-data')}});
    const page=await application.firstWindow();page.setDefaultTimeout(20000);
    await page.locator('#vault-password').fill(PASSWORD);await page.locator('#create-vault').check();await page.locator('#unlock-form button[type="submit"]').click();
    await page.locator('#setup-name').fill('Responsabile sintetico');await page.locator('#setup-pin').fill('11223344');await page.locator('#setup-form button').click();
    await page.locator('#login-pin').fill('11223344');await page.locator('#login-form button').click();
    await application.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    await page.locator('#package-password').fill(PASSWORD);await page.locator('#import').click();await page.locator('[data-open="17"]').click();
    await page.locator('[data-action="presence"][data-player="201"]').click();await page.waitForFunction(()=>state.current.payload.stats_snapshot.find(s=>s.player_id===201).played===true);
    await page.locator('[data-action="score"][data-side="home"][data-points="2"]').click();await page.waitForFunction(()=>state.current.payload.home_score===2);
    await page.locator('[data-prepare]').click();await page.locator('#signature-home').waitFor();
    for(const side of ['home','away']){
      const canvas=page.locator('#signature-'+side);await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert.ok(box);await page.mouse.move(box.x+20,box.y+40);await page.mouse.down();await page.mouse.move(box.x+120,box.y+80,{steps:8});await page.mouse.up();await page.locator('#consent-'+side).check();await page.locator('[data-sign="'+side+'"]').click();await page.waitForFunction(side=>state.current.signatures.some(s=>s.team_side===side),side);
    }
    await page.locator('[data-finalize]').click();await page.waitForFunction(()=>state.current.finalized===true);await page.locator('#print-report').waitFor({state:'attached'});
    assert.equal(await page.locator('#print-report').getByText('Capitano Test Alfa',{exact:false}).count()>0,true);
    await page.locator('#package-password').fill(PASSWORD);await page.locator('#export').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('referti cifrati esportati'));
    const transfers=fs.readdirSync(path.join(root,'USB-data/exchange')).filter(name=>name.endsWith('.keypack'));assert.equal(transfers.length,1);
    await page.locator('#logout').click();assert.equal(await page.locator('#print-report').textContent(),'');assert.equal(await page.locator('#editor').textContent(),'');assert.equal(await page.locator('#new-matches').textContent(),'');
    await page.locator('#login-pin').fill('11223344');await page.locator('#login-form button').click();await page.locator('#lock').click();assert.equal(await page.locator('#print-report').textContent(),'');assert.equal(await page.locator('#operator').textContent(),'');
    await application.close();application=null;
    process.stdout.write('Native renderer workflow passed: archive, local login, dialog import, sport score, captain canvas signatures, finalized encrypted export, logout/lock privacy clearing.\n');
  }finally{if(application)await application.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
