import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { encryptKeyPackage, decryptKeyPackage, createKeyOperator } from '../js/key-transfer.js';

const require = createRequire(import.meta.url);
const { Vault } = require('../desktop/key/vault.cjs');
const { Engine } = require('../desktop/key/engine.cjs');
const { encryptPackage, decryptPackage } = require('../desktop/key/crypto.cjs');

const admin = '01000000-0000-4000-8000-000000000001';
const other = '01000000-0000-4000-8000-000000000002';
const viewer = '01000000-0000-4000-8000-000000000003';
const station = '02000000-0000-4000-8000-000000000001';
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' :
  value && typeof value === 'object' ? '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}' : JSON.stringify(value);
const sign = (value, secret) => createHmac('sha256',Buffer.from(secret,'base64')).update(canonical(value)).digest('base64');
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
function bindPayload(op){
 op.report_hash=hash({match_id:op.match_id,payload:op.payload,report_revision:op.report_revision});
 op.signatures_payload.forEach(s=>s.report_hash=op.report_hash);
 const audit=op.audit_log.at(-1);delete audit.hash;audit.after_hash=hash(op.payload);audit.hash=hash(audit);
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5n8AAAAASUVORK5CYII=';
let pg, preparation;
const rpc = async (name, params) => (await pg.query(`select public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) result`,params)).rows[0].result;
const user = uid => pg.query("select set_config('test.uid',$1,false)",[uid]);
function operation(matchId, mutate = null) {
 const op = { id:randomUUID(),type:'key_report',match_id:matchId,base_version:0,preparation_id:preparation.preparation_id,station_id:station,
  payload:{home_score:2,away_score:1,duration:3600,quarter:2,timeouts:{home:0,away:0},is_finished:true,
   stats_snapshot:[{player_id:101,played:true,fouls:0,is_mvp_vote:false,points_scored:2,yellow_cards:0,red_cards:0}],event_log:[],device:{id:station,label:'Key sintetica'},updated_at:'2026-10-14T10:00:00.000Z'},
  report_revision:1,audit_log:[] };
 op.report_hash=hash({match_id:op.match_id,payload:op.payload,report_revision:op.report_revision});
 op.signatures_payload=[{team_side:'home',player_id:101,signature_data_url:png,signed_at:'2026-10-14T10:00:00.000Z',report_hash:op.report_hash},
  {team_side:'away',player_id:201,signature_data_url:png,signed_at:'2026-10-14T10:00:00.000Z',report_hash:op.report_hash}];
 const audit={action:'finalize',at:'2026-10-14T10:00:00.000Z',previous_hash:null,local_revision:1,after_hash:hash(op.payload)};
 audit.hash=hash(audit);op.audit_log.push(audit);
 if(mutate)mutate(op);
 op.auth_tag=sign(op,preparation.authorization_secret);
 return op;
}
before(async()=>{
 pg=new PGlite({extensions:{pgcrypto}});
 await pg.exec(readFileSync(new URL('./fixtures/key-schema.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('./fixtures/key-existing-finalizer.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261014092322_key_station_import.sql',import.meta.url),'utf8'));
 await pg.query('insert into admins values ($1,$2),($3,$4),($5,$6)',[admin,'super_admin',other,'match_manager',viewer,'report_viewer']);
 await pg.exec("insert into sports values (1,true),(2,true); insert into venues values (1,true); insert into teams values (10,1,'3A sintetica'),(20,1,'3B sintetica'); insert into players values (101,'Capitano Test A',10,true),(201,'Capitano Test B',20,true),(301,'Estraneo Test',30,false); insert into matches(id,sport_id,home_team_id,away_team_id,venue_id) select i,1,10,20,1 from generate_series(1,15) i;");
 await user(admin);
 preparation=await rpc('prepare_key_station',[station,1,Array.from({length:14},(_,i)=>i+1),'Postazione test',1]);
});
after(async()=>pg?.close());

test('real PostgreSQL migration preserves deny-by-default private tables and RPC role grants',async()=>{
 const {rows}=await pg.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='itsoscup_key' and c.relkind='r'");
 assert.equal(rows.length,4);assert(rows.every(r=>r.relrowsecurity));
 for(const role of ['anon','authenticated']){
  assert.equal((await pg.query("select has_schema_privilege($1,'itsoscup_key','USAGE') ok",[role])).rows[0].ok,false);
 }
 assert.equal((await pg.query("select has_function_privilege('anon','public.import_key_operation(jsonb)','EXECUTE') ok")).rows[0].ok,false);
 await pg.exec('set role anon');
 try{await assert.rejects(rpc('import_key_operation',[operation(1)]),/permission denied/);}finally{await pg.exec('reset role');}
 await pg.exec('set role authenticated');
 try{await assert.rejects(pg.query('select * from itsoscup_key.preparations'),/permission denied/);}finally{await pg.exec('reset role');}
 await user(viewer);await assert.rejects(rpc('import_key_operation',[operation(1)]),/Accesso non autorizzato/);
 await user('');await assert.rejects(rpc('prepare_key_station',[randomUUID(),1,[15],'Non autorizzata',1]),/Accesso non autorizzato/);await user(admin);
});
test('canonical JSON matches JS for nested, reordered, escaped and Unicode string content',async()=>{
 const value={z:[null,2,true,'È una firma\n"test" 💙'],a:{z:9007199254740991,a:-4}};
 assert.equal((await pg.query('select itsoscup_key.canonical_json($1::jsonb) value',[value])).rows[0].value,canonical(value));
 await assert.rejects(pg.query('select itsoscup_key.canonical_json($1::jsonb)',[{n:0.3}]),/safe integers/);
});
test('preparation validates assignment and changes atomically',async()=>{
 assert.equal(preparation.match_versions.length,14);assert.equal(Buffer.from(preparation.authorization_secret,'base64').length,32);
 const anotherStation=randomUUID();
 await assert.rejects(rpc('prepare_key_station',[anotherStation,1,[1,15],'Campo concorrente',1]),/assegnata/);
 assert.equal((await pg.query('select count(*) n from registered_devices where device_id=$1',[anotherStation])).rows[0].n,0);
 assert.equal((await pg.query('select assigned_device_id from matches where id=15')).rows[0].assigned_device_id,null);
 await user(other);await assert.rejects(rpc('prepare_key_station',[station,1,[15],'Stazione altrui',1]),/altro responsabile/);await user(admin);
});
test('authorized operation finalizes match, statistics and both bound captain signatures exactly once',async()=>{
 const op=operation(1);const imported=await rpc('import_key_operation',[op]);assert.equal(imported.status,'imported');assert.equal(imported.remote_version,1);
 const duplicate=await rpc('import_key_operation',[op]);assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.remote_version,1);
 const row=(await pg.query('select * from matches where id=1')).rows[0];assert(row.is_finished);assert.equal(row.home_score,2);assert.equal(row.lock_version,1);assert.equal(row.lock_owner,null);
 assert.equal((await pg.query('select count(*) n from match_captain_signatures where match_id=1')).rows[0].n,2);
 assert.equal((await pg.query('select points_scored from match_stats where match_id=1')).rows[0].points_scored,2);
 const recorded=(await pg.query('select operation from itsoscup_key.import_operations where id=$1',[op.id])).rows[0].operation;
 assert.deepEqual(recorded.audit_log,op.audit_log);assert.equal(recorded.auth_tag,op.auth_tag);
 const altered=structuredClone(op);altered.payload.home_score=8;delete altered.auth_tag;altered.auth_tag=sign(altered,preparation.authorization_secret);
 assert.equal((await rpc('import_key_operation',[altered])).status,'rejected');
 const packageId=randomUUID();const receipt=await rpc('create_key_receipt',[preparation.preparation_id,packageId,[op.id]]);
 assert.equal(receipt.results[0].operation_id,op.id);assert.equal(receipt.results[0].status,'imported');
 assert.equal(receipt.results[0].report_hash,op.report_hash);
 const {auth_tag:operationTag,...unsignedOperation}=op;
 assert.equal(receipt.results[0].content_hash,hash(unsignedOperation));
 const {auth_tag,...unsigned}=receipt;assert.equal(auth_tag,sign(unsigned,preparation.authorization_secret));
 assert.deepEqual(await rpc('create_key_receipt',[preparation.preparation_id,packageId,[op.id]]),receipt);
 await assert.rejects(rpc('create_key_receipt',[preparation.preparation_id,randomUUID(),[null]]),/nulli o duplicati/);
 await assert.rejects(rpc('create_key_receipt',[preparation.preparation_id,randomUUID(),[op.id,op.id]]),/nulli o duplicati/);
 await assert.rejects(rpc('create_key_receipt',[preparation.preparation_id,packageId,[randomUUID()]]),/operazioni diverse/);
});
test('changed remote version, other admin lock and closed match produce recorded conflicts without writes',async()=>{
 await pg.exec(`update matches set lock_version=1 where id=2;update matches set lock_owner='${other}',lock_expires_at=now()+interval '10 minutes' where id=3;update matches set is_finished=true where id=4`);
 for(const id of [2,3,4]){const op=operation(id);assert.equal((await rpc('import_key_operation',[op])).status,'conflict');assert.equal((await rpc('import_key_operation',[op])).status,'conflict');assert.equal((await pg.query('select home_score from matches where id=$1',[id])).rows[0].home_score,0);}
});
test('tampering, unassigned match, foreign player, corrupt PNG and captain mismatch all roll back',async()=>{
 const tampered=operation(5);tampered.payload.home_score=7;await assert.rejects(rpc('import_key_operation',[tampered]),/Autenticazione/);
 await assert.rejects(rpc('import_key_operation',[operation(15)]),/non assegnata/);
 await assert.rejects(rpc('import_key_operation',[operation(6,op=>op.payload.stats_snapshot[0].player_id=301)]),/Integrità/);
 const foreign=operation(6,op=>{op.payload.stats_snapshot[0].player_id=301;bindPayload(op)});
 await assert.rejects(rpc('import_key_operation',[foreign]),/estraneo/);
 await assert.rejects(rpc('import_key_operation',[operation(7,op=>op.signatures_payload[0].signature_data_url='data:image/png;base64,'+Buffer.alloc(100).toString('base64'))]),/Immagine/);
 await assert.rejects(rpc('import_key_operation',[operation(8,op=>op.signatures_payload[0].player_id=201)]),/Finalizzazione rifiutata/);
 for(const id of [5,6,7,8,15]){const row=(await pg.query('select home_score,lock_owner,is_finished from matches where id=$1',[id])).rows[0];assert.equal(row.home_score,0);assert.equal(row.lock_owner,null);assert.equal(row.is_finished,false);}
 assert.equal((await pg.query('select count(*) n from match_captain_signatures where match_id=8')).rows[0].n,0);
 await assert.rejects(rpc('import_key_operation',[operation(12,op=>op.audit_log[0].action='altered')]),/Storico modifiche/);
 await assert.rejects(rpc('import_key_operation',[operation(13,op=>{op.payload.is_finished='true';bindPayload(op)})]),/Referto incompleto/);
 for(const field of ['played','is_mvp_vote']){
  await assert.rejects(rpc('import_key_operation',[operation(13,op=>{op.payload.stats_snapshot[0][field]='yes';bindPayload(op)})]),/Booleani statistiche/);
 }
 await assert.rejects(rpc('import_key_operation',[operation(13,op=>{op.audit_log[0].local_revision='1';delete op.audit_log[0].hash;op.audit_log[0].hash=hash(op.audit_log[0])})]),/Storico modifiche/);
 const untouched=(await pg.query('select home_score,is_finished,lock_owner from matches where id=13')).rows[0];assert.equal(untouched.home_score,0);assert.equal(untouched.is_finished,false);assert.equal(untouched.lock_owner,null);
});
test('revocation and assignment changes reject results; receipt cannot confirm nonexistent operations',async()=>{
 await pg.exec("update registered_devices set is_revoked=true where device_id='"+station+"'");
 await assert.rejects(rpc('import_key_operation',[operation(9)]),/revocata/);
 await pg.exec("update registered_devices set is_revoked=false where device_id='"+station+"';update matches set assigned_device_id=null where id=10");
 await assert.rejects(rpc('import_key_operation',[operation(10)]),/Assegnazione/);
 await assert.rejects(rpc('create_key_receipt',[preparation.preparation_id,randomUUID(),[randomUUID()]]),/non registrate/);
});

test('near-limit canonical wire operation is accepted despite JSONB presentation whitespace',async()=>{
 const op=operation(14);op.audit_log=[];let previous=null;
 for(let i=1;i<=4000;i++){
  const entry={action:i===4000?'finalize':'note',local_revision:i,previous_hash:previous,after_hash:hash(op.payload)};
  entry.hash=hash(entry);previous=entry.hash;op.audit_log.push(entry);
 }
 delete op.auth_tag;op.auth_tag=sign(op,preparation.authorization_secret);
 const remaining=2*1024*1024-1000-Buffer.byteLength(JSON.stringify(op));
 op.payload.offline_notes='x'.repeat(remaining);
 bindPayload(op);delete op.auth_tag;op.auth_tag=sign(op,preparation.authorization_secret);
 assert(Buffer.byteLength(JSON.stringify(op))<2*1024*1024);
 assert((await pg.query('select octet_length($1::jsonb::text) bytes',[op])).rows[0].bytes>2*1024*1024);
 assert.equal((await rpc('import_key_operation',[op])).status,'imported');
});

test('actual portable SQLite engine, browser encryption and PostgreSQL complete a signed two-device round trip',async()=>{
 const temporary=mkdtempSync(join(tmpdir(),'itsoscup-key-integration-'));
 const directory=join(temporary,'KeyData');
 const vault=new Vault(directory);
 const password='USBTestPassword260000';
 try {
  await vault.unlock(password,{create:true});
  const engine=new Engine(vault);
  engine.setupSupervisor({name:'Supervisore locale test',pin:'12345678'});
  const localId=engine.view().operators[0].id;
  engine.login({operator_id:localId,pin:'12345678'});
  const prepared={schema:'itsoscup-offline-transfer',version:2,kind:'prepared',station_id:station,preparation_id:preparation.preparation_id,
   authorization_secret:preparation.authorization_secret,package_id:randomUUID(),device_id:station,created_at:'2026-10-14T10:00:00.000Z',operations:[],
   operators:[await createKeyOperator({name:'Supervisore preparato test',role:'supervisor',pin:'87654321',matchIds:[11]})],
   matches:[{match_id:11,match:{id:11,sport_id:1,home_team_id:10,away_team_id:20,lock_version:0,home:{name:'3A test'},away:{name:'3B test'},sport:{sport_type:'calcio',name:'Calcio test'}},
    homePlayers:[{id:101,team_id:10,full_name:'Capitano Test A',is_captain:true}],awayPlayers:[{id:201,team_id:20,full_name:'Capitano Test B',is_captain:true}],config:{allow_yellow_cards:true,allow_red_cards:true},stats:[]}]};
  const preparedText=await encryptKeyPackage(prepared,password);
  engine.importPrepared(decryptPackage(preparedText,password));
  engine.change({match_id:11,action:'score',side:'home',points:1});
  engine.change({match_id:11,action:'notes',notes:'Partita sintetica: nessun dato reale'});
  engine.prepareSignatures({match_id:11});
  engine.sign({match_id:11,side:'home',signature_data_url:png,consent:true});
  engine.sign({match_id:11,side:'away',signature_data_url:png,consent:true});
  engine.finalize({match_id:11});
  const outgoing=engine.results(preparation.preparation_id);
  engine.markExported(outgoing);
  const encrypted=encryptPackage(outgoing,password);
  const browserResults=await decryptKeyPackage(encrypted,password);
  const imported=await rpc('import_key_operation',[browserResults.operations[0]]);
  assert.equal(imported.status,'imported');
  const recorded=(await pg.query('select operation from itsoscup_key.import_operations where id=$1',[outgoing.operations[0].id])).rows[0].operation;
  assert.deepEqual(recorded.audit_log,outgoing.operations[0].audit_log);
  assert(recorded.audit_log.some(row=>row.action==='captain_signature'));
  const receipt=await rpc('create_key_receipt',[preparation.preparation_id,browserResults.package_id,[browserResults.operations[0].id]]);
  const receiptText=await encryptKeyPackage(receipt,password);
  engine.importReceipt(decryptPackage(receiptText,password));
  assert.equal(engine.view().matches[0].acknowledged,true);
  assert.equal(engine.importReceipt(decryptPackage(receiptText,password)).duplicate,true);
  const {auth_tag,...unsigned}=receipt;
  assert.equal(auth_tag,sign(unsigned,preparation.authorization_secret));
  vault.lock();
  const reopened=new Vault(directory);await reopened.unlock(password);
  assert.equal(reopened.read().matches[11].acknowledged,true);
  assert.equal(reopened.read().receipts[0].receipt_id,receipt.receipt_id);
  reopened.lock();
 } finally {
  if(vault.db && !vault.dirty)vault.lock();
  // Windows cleanup stays within this test's explicitly-created temporary folder.
  const target=resolve(temporary),parent=resolve(tmpdir());
  assert(target.startsWith(parent+'\\')||target.startsWith(parent+'/'));
  assert(basename(target).startsWith('itsoscup-key-integration-'));
  rmSync(target,{recursive:true,force:true});
 }
});
