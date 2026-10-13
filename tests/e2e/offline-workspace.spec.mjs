import { test, expect } from '@playwright/test';

test('USB package encryption, zero-network startup and offline draft persistence', async ({page,context})=>{
  await page.goto('/offline-workspace.html');
  const prepared=await page.evaluate(async()=>{
    const {putLiveCacheEntry}=await import('/js/offline-db.js');
    const entry={match_id:9911001,cached_at:'2026-10-14T08:00:00Z',
      match:{id:9911001,lock_version:8,is_finished:false,home:{name:'4A'},away:{name:'4B'},
        home_score:0,away_score:0,live_payload:{}},
      config:{},homePlayers:[],awayPlayers:[],stats:[]};
    if(!(await putLiveCacheEntry(entry)))throw Error('indexedDB not available');
    const {createEncryptedPackage,decryptPackage}=await import('/js/offline-package.js');
    const encrypted=await createEncryptedPackage({kind:'prepared',passphrase:'ProvaOfflineLunga123'});
    if(encrypted.includes('4A'))throw Error('Encrypted package leaks readable team labels');
    const decoded=await decryptPackage(encrypted,'ProvaOfflineLunga123');
    let rejected=false;
    try{await decryptPackage(encrypted,'UnaPasswordSbagliata')}catch{rejected=true}
    return {ok:decoded.matches[0].match.id===9911001,rejected};
  });
  expect(prepared.ok).toBe(true);
  expect(prepared.rejected).toBe(true);
  // Direct IDB test setup does not dispatch a UI event; trigger the same refresh used by the operator.
  await page.locator('#offline-refresh').click();
  await expect(page.locator('#offline-matches')).toContainText('4A');
  await page.locator('[data-open-match="9911001"]').click();
  await page.locator('#offline-home-score').fill('2');
  await page.locator('#offline-away-score').fill('1');
  await page.locator('#offline-minutes').fill('45');
  await page.locator('#offline-save').click();
  await expect(page.locator('#offline-status')).toContainText('Bozza salvata');
  const result=await page.evaluate(async()=>{
    const {listOfflineOperations}=await import('/js/offline-db.js');
    const {createEncryptedPackage,decryptPackage}=await import('/js/offline-package.js');
    const operations=await listOfflineOperations({status:'queued'});
    const exportFile=await createEncryptedPackage({kind:'results',passphrase:'ProvaOfflineLunga123'});
    const decoded=await decryptPackage(exportFile,'ProvaOfflineLunga123');
    return {matches:decoded.matches.length,operations:decoded.operations.length,
      version:operations[0].base_version,score:operations[0].payload.home_score};
  });
  expect(result).toMatchObject({matches:1,operations:1,version:8,score:2});
  // The already installed app must survive a full network disconnect.
  await page.waitForFunction(()=>navigator.serviceWorker?.controller!=null,{timeout:12000});
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#offline-matches')).toContainText('4A');
  await expect(page.locator('#offline-operations')).toContainText('9911001');
  await context.setOffline(false);
});
