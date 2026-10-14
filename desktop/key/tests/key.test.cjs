'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Vault } = require('../vault.cjs');
const { Engine } = require('../engine.cjs');
const crypto = require('../crypto.cjs');
const { PNG, PASSWORD, prepared, receipt } = require('./fixtures.cjs');
async function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'itsoscup-key-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = new Vault(path.join(root, 'USB-data'), options); await vault.unlock(PASSWORD, { create: true });
  const engine = new Engine(vault, options); engine.setupSupervisor({ name: 'Responsabile Test', pin: '11223344' });
  engine.login({ operator_id: vault.read().operators[0].id, pin: '11223344' });
  t.after(() => { if (vault.db) { vault.dirty = false; vault.lock(); } });
  return { root, vault, engine };
}
function update(engine, action, args = {}, match_id = 17) { return engine.change({ match_id, expected_revision: engine.state().matches[match_id].local_revision, action, ...args }); }
function signAndFinish(engine) {
  let match = engine.state().matches[17]; engine.prepareSignatures({ match_id: 17, expected_revision: match.local_revision });
  for (const side of ['home', 'away']) { match = engine.state().matches[17]; engine.sign({ match_id: 17, expected_revision: match.local_revision, side, signature_data_url: PNG, consent: true }); }
  match = engine.state().matches[17]; engine.finalize({ match_id: 17, expected_revision: match.local_revision });
  return engine.state().matches[17].operation;
}
test('browser and desktop share exact canonical, AES-GCM envelope, report HMAC and PBKDF2 PINs', async () => {
  const browser = await import(pathToFileURL(path.resolve(__dirname, '../../../js/key-transfer.js')).href);
  const p = prepared();
  assert.equal(browser.canonicalJson({ z:[1,0,'è'], a:{ c:true,b:null } }), crypto.canonical({ z:[1,0,'è'], a:{ c:true,b:null } }));
  assert.throws(() => crypto.canonical({ n:0.5 })); assert.throws(() => crypto.canonical({ n:Number.MAX_SAFE_INTEGER + 1 }));
  assert.throws(() => crypto.canonical({ 'è':1 }), /non canonica/);
  assert.deepEqual(await browser.decryptKeyPackage(crypto.encryptPackage(p, PASSWORD), PASSWORD), p);
  assert.deepEqual(crypto.decryptPackage(await browser.encryptKeyPackage(p, PASSWORD), PASSWORD), p);
  const operator = await browser.createKeyOperator({ name:'Test',role:'operator',pin:'12345678',matchIds:[17] });
  assert.equal(crypto.verifyPin('12345678', operator), true); assert.equal(crypto.verifyPin('00000000', operator), false);
});
test('wrong passwords and corrupt transfer bytes are rejected before import', () => {
  const encrypted = crypto.encryptPackage(prepared(), PASSWORD);
  assert.throws(() => crypto.decryptPackage(encrypted, 'wrong-password-123'), /Password/);
  const body=JSON.parse(encrypted);body.ciphertext=(body.ciphertext[0]==='A'?'B':'A')+body.ciphertext.slice(1);
  assert.throws(() => crypto.decryptPackage(JSON.stringify(body), PASSWORD), /danneggiato/);
});
test('encrypted SQLite persists after process-like reopen, no student names/PIN in archive or backup', async t => {
  const { vault, engine } = await setup(t); const p=prepared();engine.importPrepared(p);update(engine,'score',{ side:'home',points:2 });
  for (const file of [vault.filename, vault.filename+'.bak']) {
    const bytes=fs.readFileSync(file,'utf8');assert.equal(bytes.includes('Capitano Test'),false);assert.equal(bytes.includes('11223344'),false);assert.equal(bytes.includes('SQLite format'),false);
  }
  vault.lock();await vault.unlock(PASSWORD);assert.equal(vault.read().matches[17].payload.home_score,2);
});
test('assigned match authorization, supervisor permissions, PIN throttle and stale revision', async t => {
  let now=1000000;const { engine }=await setup(t,{now:()=>now});const p=prepared({operator:true});engine.importPrepared(p);
  engine.login({operator_id:p.operators[1].id,pin:'87654321'});assert.throws(()=>engine.results(p.preparation_id),/supervisore/);
  update(engine,'score',{side:'home',points:1});assert.throws(()=>engine.change({match_id:17,expected_revision:0,action:'score',side:'home',points:1}),/cambiata/);
  engine.logout();for(let i=0;i<5;i++)assert.throws(()=>engine.login({operator_id:p.operators[1].id,pin:'00000000'}));
  assert.throws(()=>engine.login({operator_id:p.operators[1].id,pin:'87654321'}),/un minuto/);now+=60001;assert.ok(engine.login({operator_id:p.operators[1].id,pin:'87654321'}).user);
});
test('removed/wrong USB blocks success, retains pending RAM and retry saves same operation once', async t => {
  const { root,vault,engine }=await setup(t);engine.importPrepared(prepared());const detached=path.join(root,'detached');fs.renameSync(vault.directory,detached);
  assert.throws(()=>update(engine,'score',{side:'home',points:3}),/Chiavetta assente/);assert.equal(vault.dirty,true);assert.equal(fs.existsSync(vault.directory),false);
  assert.equal(vault.read().matches[17].payload.home_score,3);assert.throws(()=>update(engine,'score',{side:'home',points:1}),/sospeso/);assert.throws(()=>vault.lock(),/non salvati/);
  fs.renameSync(detached,vault.directory);vault.persist();assert.equal(vault.dirty,false);vault.lock();await vault.unlock(PASSWORD);assert.equal(vault.read().matches[17].payload.home_score,3);
});
test('abrupt atomic rename failure recovers highest encrypted SQLite generation', async t => {
  let fail=false;const io={...fs,renameSync:(from,to)=>{if(fail&&to.endsWith('archive.keyvault'))throw new Error('synthetic power interruption');return fs.renameSync(from,to);}};
  const {vault,engine}=await setup(t,{io});engine.importPrepared(prepared());fail=true;assert.throws(()=>update(engine,'score',{side:'away',points:2}),/interruption/);
  // Simulate RAM lost in abrupt power failure; the encrypted pending file survives.
  vault.dirty=false;vault.lock();fail=false;await vault.unlock(PASSWORD,{recover:true});assert.equal(vault.read().matches[17].payload.away_score,2);
});
test('external encrypted backup restores new drive and refuses overwrite/wrong password', async t => {
  const { root,vault,engine }=await setup(t);engine.importPrepared(prepared());update(engine,'score',{side:'home',points:2});
  const backup=path.join(root,'backup.keyvault');vault.backup(backup);const second=new Vault(path.join(root,'other-drive'));
  assert.throws(()=>vault.backup(vault.filename),/non può sostituire/);assert.throws(()=>vault.backup(path.join(vault.directory,'volume.id')),/non può sostituire/);
  await assert.rejects(second.restoreBackup(fs.readFileSync(backup,'utf8'),'bad-password-123'),/Password/);assert.equal(second.exists(),false);
  await second.restoreBackup(fs.readFileSync(backup,'utf8'),PASSWORD);assert.equal(second.read().matches[17].payload.home_score,2);assert.notEqual(second.marker,vault.marker);
  await assert.rejects(second.restoreBackup(fs.readFileSync(backup,'utf8'),PASSWORD),/Nessun archivio/);second.lock();
});
test('sport config enforces cards, timeout limits, player presence and substitutions', async t => {
  const {engine}=await setup(t);engine.importPrepared(prepared({sport:'calcio'}));assert.throws(()=>update(engine,'timeout',{side:'home'}),/disponibile/);
  assert.throws(()=>update(engine,'yellow_card',{player_id:201}),/presente/);update(engine,'presence',{player_id:201,played:true});update(engine,'yellow_card',{player_id:201});update(engine,'yellow_card',{player_id:201});
  assert.throws(()=>update(engine,'score',{side:'home',points:1,player_id:201}),/espulso/);assert.throws(()=>update(engine,'score',{side:'home',points:3}),/regolamento/);
  update(engine,'substitution',{player_id:201,incoming_id:203});assert.equal(engine.state().matches[17].payload.stats_snapshot.find(s=>s.player_id===203).played,true);
});
test('monotonic timer checkpoints restart paused at last saved duration', async t => {
  let now=1000000;const {vault,engine}=await setup(t,{now:()=>now,monotonic:()=>now});engine.importPrepared(prepared());update(engine,'timer_start');now+=12345;engine.checkpoint();
  assert.equal(engine.state().matches[17].payload.duration,12);vault.lock();await vault.unlock(PASSWORD);engine.recoverTimers();assert.equal(engine.state().matches[17].timer.running,false);assert.equal(engine.state().matches[17].payload.duration,12);
});
test('wall clock adjustments cannot jump the running game timer', async t => {
  let wall=1000000,mono=0;const {engine}=await setup(t,{now:()=>wall,monotonic:()=>mono});engine.importPrepared(prepared());update(engine,'timer_start');
  mono=10200;wall+=3600000;assert.equal(engine.elapsed(engine.state().matches[17]),10);wall-=7200000;assert.equal(engine.elapsed(engine.state().matches[17]),10);
});
test('report hash freezes snapshot, binds signatures, supervisor reason invalidates both', async t => {
  const {engine}=await setup(t);const p=prepared();engine.importPrepared(p);const op=signAndFinish(engine);
  assert.equal(op.report_hash,crypto.hash({match_id:17,payload:op.payload,report_revision:op.report_revision}));assert.ok(crypto.verifyTag(op,p.authorization_secret));assert.ok(op.signatures_payload.every(s=>s.report_hash===op.report_hash));
  assert.throws(()=>update(engine,'score',{side:'home',points:1}),/bloccato/);assert.throws(()=>engine.reopen({match_id:17,expected_revision:engine.state().matches[17].local_revision,reason:'short'}),/Motivazione/);
  engine.reopen({match_id:17,expected_revision:engine.state().matches[17].local_revision,reason:'Correzione punteggio verificata dal supervisore'});
  assert.equal(engine.state().matches[17].signatures.length,0);assert.equal(engine.state().matches[17].report_revision,2);assert.equal(engine.state().matches[17].operation,null);
});
test('idempotent imports/exports, receipt authenticity and content binding reject replay mismatch', async t => {
  const {engine}=await setup(t);const p=prepared();engine.importPrepared(p);assert.equal(engine.importPrepared(p).duplicate,true);const op=signAndFinish(engine);
  const pack=engine.results(p.preparation_id);assert.equal(engine.results(p.preparation_id).operations[0].id,op.id);engine.markExported(pack);
  assert.throws(()=>engine.results(p.preparation_id),/Nessun referto/);assert.equal(engine.results(p.preparation_id,{reexport:true}).operations[0].id,op.id);
  assert.throws(()=>engine.reopen({match_id:17,expected_revision:engine.state().matches[17].local_revision,reason:'Correzione successiva al trasferimento'}),/esportato/);
  const r=receipt(op,p,pack.package_id),wrong=copy(r);wrong.results[0].report_hash='0'.repeat(64);wrong.auth_tag=crypto.tag(wrong,p.authorization_secret);assert.throws(()=>engine.importReceipt(wrong),/versione diversa/);
  const tamper=copy(r);tamper.results[0].status='conflict';assert.throws(()=>engine.importReceipt(tamper),/autentica/);
  engine.importReceipt(r);assert.equal(engine.state().matches[17].acknowledged,true);assert.equal(engine.importReceipt(r).duplicate,true);assert.throws(()=>engine.results(p.preparation_id),/Nessun referto/);
});
test('legacy v1 prepared package opens without granting v2 finalization authority', async t => {
  const {engine}=await setup(t);const p=prepared();p.version=1;delete p.preparation_id;delete p.station_id;delete p.authorization_secret;delete p.operators;
  engine.importPrepared(p);update(engine,'score',{side:'home',points:1});assert.throws(()=>engine.prepareSignatures({match_id:17,expected_revision:1}),/Key v2/);
});
test('permanent archive capacity failure rolls back the proposed state without stranding retry/export', async t => {
  const {vault,engine}=await setup(t);engine.importPrepared(prepared());const before=engine.state(),generation=vault.generation;
  vault.maxBytes=vault.db.export().length;assert.throws(()=>update(engine,'notes',{notes:'x'.repeat(4000)}),/Archivio pieno/);
  assert.equal(vault.dirty,false);assert.equal(vault.generation,generation);assert.deepEqual(engine.state(),before);
  assert.equal(vault.db.export().length<=vault.maxBytes,true);vault.maxBytes=256*1024*1024;update(engine,'score',{side:'home',points:1});assert.equal(engine.state().matches[17].payload.home_score,1);
});
test('report capacity is checked before freezing and transfer batching never clips operations', async t => {
  const {vault,engine}=await setup(t),p=prepared();engine.importPrepared(p);
  const s=engine.state();s.matches[17].payload.event_log=Array.from({length:2000},(_,i)=>({id:String(i),event_type:'note',notes:'x'.repeat(1000)}));vault.write(s);
  assert.throws(()=>engine.prepareSignatures({match_id:17,expected_revision:0}),/limite di trasferimento/);assert.equal(engine.state().matches[17].signing,false);
  const state=engine.state(),fakeOp={...signableTinyOp(p),payload:{offline_notes:'x'.repeat(1200000)}};
  state.matches=Object.fromEntries(Array.from({length:12},(_,i)=>[17+i,{preparation_id:p.preparation_id,operation:{...fakeOp,id:require('node:crypto').randomUUID(),match_id:17+i},acknowledged:false}]));
  const batched=new Engine({read:()=>state});batched.user={id:state.operators[0].id,role:'supervisor'};const pack=batched.results(p.preparation_id);
  assert.ok(Buffer.byteLength(JSON.stringify(pack))<12*1024*1024);assert.ok(pack.operations.length>0&&pack.operations.length<12);assert.equal(pack.remaining_operations,12-pack.operations.length);
  for(const op of pack.operations)assert.equal(op.payload.offline_notes.length,1200000);
  for(const op of pack.operations)state.matches[op.match_id].exported=true;
  const next=batched.results(p.preparation_id);assert.equal(next.operations.length,pack.remaining_operations);assert.equal(next.remaining_operations,0);
  assert.ok(next.operations.every(op=>!pack.operations.some(old=>old.id===op.id)));
});
function signableTinyOp(p){return{id:require('node:crypto').randomUUID(),type:'key_report',match_id:17,base_version:3,preparation_id:p.preparation_id,station_id:p.station_id,report_revision:1,report_hash:'0'.repeat(64),signatures_payload:[],audit_log:[],auth_tag:'AAAA'};}
function copy(value) { return JSON.parse(JSON.stringify(value)); }
