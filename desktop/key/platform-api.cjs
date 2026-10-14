'use strict';
const fs = require('node:fs');
const { randomUUID,randomBytes } = require('node:crypto');
const { Vault } = require('./vault.cjs');
const { pinCredential,verifyPin,hash,tag,verifyTag,canonical,decode64,decryptBytes,VAULT_LIMIT } = require('./crypto.cjs');
const { TABLES,query,project } = require('./platform-query.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy=value=>JSON.parse(JSON.stringify(value));
const clean=(value,max=200)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('Testo obbligatorio o troppo lungo');return value.trim();};
const integer=(value,min=0,max=999999)=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error('Valore numerico non valido');return value;};
const foreign={sport_id:'sports',team_id:'teams',player_id:'players',home_team_id:'teams',away_team_id:'teams',venue_id:'venues',match_id:'matches',event_id:'events',heat_id:'athletics_heats',invite_id:'class_invites',notice_id:'class_notices',relay_team_id:'athletics_relay_teams',assigned_device_id:'registered_devices',assigned_admin_id:'admins',assigned_venue_id:'venues'};
class PlatformApi {
  constructor({directory,now=()=>Date.now()}){this.directory=directory;this.vault=new Vault(directory);this.clock=now;this.user=null;this.token=null;this.queue=Promise.resolve();this.failures=new Map();}
  now(){return new Date(this.clock()).toISOString();}
  tables(state){return state.central.tables;}
  requireRole(...roles){if(!this.user||!roles.includes(this.user.ruolo))throw new Error('Accesso non autorizzato per questo ruolo');}
  row(state,table,id,key='id'){const row=this.tables(state)[table]?.find(r=>r[key]===id);if(!row)throw new Error('Elemento non trovato: '+table);return row;}
  project(state,table,row,select='*'){return project(state,table,row,select);}
  audit(state,action,details){this.insert(state,'audit_log',{actor_id:this.user?.id??null,action,entity_type:details.table??'platform',entity_id:details.match_id??null,details,created_at:this.now()});}
  validateRow(state,table,row,except=null){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>['__proto__','prototype','constructor','pin_hash','pin_salt'].includes(k)))throw new Error('Riga non valida');
    for(const [field,target]of Object.entries(foreign)){if(row[field]!=null&&!this.tables(state)[target].some(r=>r[target==='registered_devices'?'device_id':'id']===row[field]))throw new Error('Riferimento non valido: '+field);}
    if(['sports','teams','venues','events'].includes(table)&&!String(row.name||'').trim())throw new Error('Inserire un nome');
    if(table==='sports'&&!['calcio','basket','pallavolo','atletica'].includes(row.sport_type))throw new Error('Sport non valido');
    if(table==='players')clean(row.full_name,200);
    if(table==='matches'){
      if(row.home_team_id===row.away_team_id)throw new Error('Selezionare due squadre diverse');
      for(const field of ['home_team_id','away_team_id'])if(row[field]!=null&&this.row(state,'teams',row[field]).sport_id!==row.sport_id)throw new Error('Squadra di un altro torneo');
      if(row.scheduled_start&&row.scheduled_end&&new Date(row.scheduled_end)<=new Date(row.scheduled_start))throw new Error('La fine deve seguire l’inizio');
      if(row.venue_id&&row.scheduled_start&&row.scheduled_end&&this.tables(state).matches.some(m=>m.id!==except&&m.venue_id===row.venue_id&&m.status!=='cancelled'&&m.scheduled_start<row.scheduled_end&&m.scheduled_end>row.scheduled_start))throw new Error('Il campo è già occupato in questo orario');
    }
  }
  defaults(table){const base={created_at:this.now(),updated_at:this.now()};return {...base,...({sports:{is_active:true,has_return_match:false},teams:{},players:{is_captain:false},venues:{is_active:true,operational_status:'available'},matches:{home_score:0,away_score:0,duration:0,quarter:1,is_finished:false,status:'scheduled',lock_version:0,lock_owner:null,lock_expires_at:null,assigned_device_id:null,live_payload:{}},events:{is_active:true},registered_devices:{is_revoked:false,is_blocked:false,is_offline_ready:false},urgent_announcements:{is_active:true},issue_reports:{status:'open'},class_invites:{access_code:randomBytes(24).toString('hex').toUpperCase(),is_active:true}}[table]||{})};}
  insert(state,table,value){if(!TABLES.includes(table))throw new Error('Tabella non disponibile');const rows=this.tables(state)[table];let row={...this.defaults(table),...copy(value)};
    if(table==='registered_devices'){if(!row.device_id||rows.some(r=>r.device_id===row.device_id))throw new Error('Postazione già presente');}
    else {if(row.id==null)row.id=Math.max(state.central.counters[table]||0,...rows.filter(r=>typeof r.id==='number').map(r=>r.id),0)+1;if(rows.some(r=>r.id===row.id))throw new Error('ID già presente');if(typeof row.id==='number')state.central.counters[table]=Math.max(state.central.counters[table]||0,row.id);}
    this.validateRow(state,table,row);rows.push(row);return row;
  }
  upsert(state,table,value,key='id'){const fields=key.split(',').map(s=>s.trim()),row=this.tables(state)[table].find(r=>fields.every(k=>value[k]!=null&&r[k]===value[k]));if(!row)return this.insert(state,table,value);const merged={...row,...copy(value),updated_at:this.now()};this.validateRow(state,table,merged,row.id);Object.assign(row,merged);return row;}
  deleteRow(state,table,row){
    const id=row[table==='registered_devices'?'device_id':'id'];
    for(const [field,target]of Object.entries(foreign)){if(target===table&&TABLES.some(t=>t!==table&&this.tables(state)[t].some(r=>r[field]!=null&&r[field]===id)))throw new Error('Elemento collegato ad altri dati. Rimuovere prima le dipendenze');}
    this.tables(state)[table]=this.tables(state)[table].filter(r=>r!==row);
  }
  session(){return this.user?{user:{id:this.user.id,email:this.user.email},access_token:this.token,refresh_token:this.token,token_type:'local',expires_at:Math.floor(this.clock()/1000)+86400}:null;}
  publicUser(){return this.user?{id:this.user.id,email:this.user.email,user_metadata:{name:this.user.nome,offline:true}}:null;}
  call(request){const work=this.queue.then(()=>this.dispatch(request)).catch(error=>({data:null,error:{message:error.message||'Operazione non riuscita',code:error.code||'LOCAL_ERROR'}}));this.queue=work.then(()=>{});return work;}
  async dispatch(request){
    if(!request||typeof request!=='object'||Array.isArray(request))throw new Error('Richiesta non valida');
    if(request.type==='restore'){
      if(typeof request.encrypted!=='string'||Buffer.byteLength(request.encrypted)>VAULT_LIMIT*2.1)throw new Error('Backup troppo grande o non valido');
    }else if(Buffer.byteLength(JSON.stringify(request))>24*1024*1024)throw new Error('Richiesta non valida');
    if(request.type==='status')return {data:{unlocked:!!this.vault.db,exists:this.vault.exists(),directory:this.directory,user:this.publicUser(),station_id:this.vault.db?this.vault.read().station_id:null,preferences:this.vault.db?copy(this.vault.read().central?.metadata.preferences||{}):{},dirty:this.vault.dirty,mode:'offline'},error:null};
    if(request.type==='unlock'){
      let profile,credential;if(request.create){profile={id:randomUUID(),nome:clean(request.name,80),email:clean(request.email,200).toLowerCase(),ruolo:'super_admin'};if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))throw new Error('Email non valida');credential={id:profile.id,...pinCredential(request.pin)};}
      await this.vault.unlock(request.password,{create:request.create===true,recover:request.recover===true});let state=this.vault.read();
      if(request.create){state.central={version:1,tables:Object.fromEntries(TABLES.map(t=>[t,[]])),counters:{},credentials:[credential],keyPreparations:[],keyOperations:[],keyReceipts:[],metadata:{},backups:[]};this.insert(state,'admins',profile);this.insert(state,'platform_migrations',{migration_key:'local-platform-v1',description:'Archivio centrale offline',applied_at:this.now()});this.vault.write(state);this.user=copy(profile);this.token=randomUUID();}
      else if(!state.central||state.central.version!==1){this.vault.lock();throw new Error('Usare l’archivio della piattaforma centrale, distinto dalla postazione Key');}
      return {data:{unlocked:true,exists:true,directory:this.directory,user:this.publicUser(),station_id:state.station_id,dirty:this.vault.dirty,mode:'offline'},error:null};
    }
    if(request.type==='lock'){this.vault.lock();this.user=null;this.token=null;return {data:{unlocked:false},error:null};}
    if(request.type==='persist'){this.vault.persist();return {data:{saved:true},error:null};}
    if(request.type==='backup'){this.requireRole('super_admin');if(this.vault.dirty)throw new Error('Completare prima il salvataggio');return {data:{encrypted:fs.readFileSync(this.vault.filename,'utf8')},error:null};}
    if(request.type==='restore'){
      if(this.vault.db||this.vault.exists())throw new Error('Ripristinare su una nuova cartella, senza archivio esistente');
      await this.vault.init();const decrypted=decryptBytes(request.encrypted,request.password,'itsoscup-key-vault');let temporary;
      try{temporary=new this.vault.SQL.Database(new Uint8Array(decrypted.plain));const row=temporary.exec('SELECT state FROM vault WHERE id=1')[0]?.values?.[0];if(!row||JSON.parse(row[0]).central?.version!==1)throw new Error('Backup centrale non riconosciuto');}finally{temporary?.close();decrypted.key.fill(0);decrypted.plain.fill(0);}
      await this.vault.restoreBackup(request.encrypted,request.password);return {data:{restored:true},error:null};
    }
    if(!this.vault.db)throw new Error('Sbloccare l’archivio centrale dalla schermata iniziale');
    const state=this.vault.read(),before=JSON.stringify(state);let result;
    if(request.type==='auth')result=this.auth(state,request);
    else if(request.type==='query')result=query(this,state,request);
    else if(request.type==='rpc'){if(!['class_portal','submit_class_registration','acknowledge_class_notice','public_team_notices'].includes(request.name))this.requireRole('super_admin','match_manager','report_viewer');const data=await this.rpc(state,request.name,request.args||{});result={data,error:null};}
    else if(request.type==='function')result={data:this.functionCall(state,request.name,request.body||{}),error:null};
    else if(request.type==='preferences'){
      if(request.method!=='set'||request.key!=='tornei_team_follows_v1'||request.value!==null&&(typeof request.value!=='string'||Buffer.byteLength(request.value)>1024*1024))throw new Error('Preferenza non autorizzata');
      if(request.value!==null){const value=JSON.parse(request.value);if(value.version!==1||!Array.isArray(value.favorites)||value.favorites.length>20)throw new Error('Preferiti non validi');}
      state.central.metadata.preferences ||= {};if(request.value===null)delete state.central.metadata.preferences[request.key];else state.central.metadata.preferences[request.key]=request.value;result={data:true,error:null};
    }
    else if(request.type==='storage'){this.requireRole('super_admin','match_manager');if(request.key!=='itsoscup_key_encrypted_inbox_v2')throw new Error('Metadato non autorizzato');if(request.method==='get')result={data:copy(state.central.metadata[request.key]||[]),error:null};else if(request.method==='set'){if(!Array.isArray(request.value)||request.value.some(v=>typeof v.encrypted!=='string'||!JSON.parse(v.encrypted).encrypted))throw new Error('Conservare solo pacchetti cifrati');state.central.metadata[request.key]=copy(request.value);result={data:true,error:null};}else throw new Error('Metodo archivio non valido');}
    else throw new Error('Comando non disponibile');
    if(JSON.stringify(state)!==before){this.vault.write(state);}
    return result;
  }
  auth(state,{method,args=[]}){
    if(method==='getSession'||method==='refreshSession')return {data:{session:this.session(),user:this.publicUser()},error:null};
    if(method==='getUser')return {data:{user:this.publicUser()},error:null};
    if(method==='signOut'){this.user=null;this.token=null;return {data:{},error:null};}
    if(method==='signInWithPassword'){
      const {email,password}=args[0]||{},key=String(email||'').toLowerCase(),failure=this.failures.get(key)||{count:0,until:0};if(failure.until>this.clock())throw new Error('Troppi tentativi. Attendere un minuto');
      const profile=this.tables(state).admins.find(a=>a.email.toLowerCase()===key),credential=profile&&state.central.credentials.find(c=>c.id===profile.id);
      if(!credential||!verifyPin(password,credential)){failure.count++;if(failure.count>=5){failure.until=this.clock()+60000;failure.count=0;}this.failures.set(key,failure);throw new Error('Email o PIN errato');}
      this.failures.delete(key);this.user=copy(profile);this.token=randomUUID();this.audit(state,'local_login',{});return {data:{user:this.publicUser(),session:this.session()},error:null};
    }
    if(method==='updateUser'){this.requireRole('super_admin','match_manager','report_viewer');const input=args[0]||{},credential=state.central.credentials.find(c=>c.id===this.user.id);if(input.password)Object.assign(credential,pinCredential(input.password));this.audit(state,'local_update_credentials',{});return {data:{user:this.publicUser()},error:null};}
    throw new Error('Gestire gli account locali dalla sezione Utenti');
  }
  functionCall(state,name,body){
    this.requireRole('super_admin');if(!['manage-admin-user','admin-user-management'].includes(name))throw new Error('Questa integrazione richiede la connessione Internet del sito');
    if(body.action==='list')return {success:true,admins:this.tables(state).admins.map(a=>({...a,devices:this.tables(state).registered_devices.filter(d=>d.assigned_admin_id===a.id)})),devices:copy(this.tables(state).registered_devices)};
    if(body.action==='delete'){if(body.userId===this.user.id)throw new Error('Non puoi eliminare l’account attualmente in uso');this.row(state,'admins',body.userId);this.tables(state).admins=this.tables(state).admins.filter(a=>a.id!==body.userId);state.central.credentials=state.central.credentials.filter(c=>c.id!==body.userId);for(const device of this.tables(state).registered_devices)if(device.assigned_admin_id===body.userId)device.assigned_admin_id=null;this.audit(state,'local_delete_user',{id:body.userId});return {success:true};}
    if(body.action==='save'){
      const id=body.userId||body.id||randomUUID(),role=body.role||body.ruolo,nameValue=body.name||body.nome,email=clean(body.email,200).toLowerCase();if(!uuid.test(id)||!['super_admin','match_manager','report_viewer'].includes(role)||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Dati utente non validi');
      if(id===this.user.id&&role!=='super_admin')throw new Error('Non puoi rimuovere il tuo ruolo amministratore');if(this.tables(state).admins.some(a=>a.id!==id&&a.email===email))throw new Error('Email già utilizzata');
      const existing=this.tables(state).admins.find(a=>a.id===id),pin=body.password||body.pin;if(!existing&&!pin)throw new Error('Inserire un PIN di 8–20 cifre');if(pin){const credential={id,...pinCredential(pin)},index=state.central.credentials.findIndex(c=>c.id===id);if(index<0)state.central.credentials.push(credential);else state.central.credentials[index]=credential;}
      this.upsert(state,'admins',{id,nome:clean(nameValue,80),email,ruolo:role});
      if(body.deviceId)this.row(state,'registered_devices',body.deviceId,'device_id');
      for(const device of this.tables(state).registered_devices){if(device.assigned_admin_id===id)device.assigned_admin_id=null;if(device.device_id===body.deviceId)device.assigned_admin_id=id;}
      this.audit(state,'local_save_user',{id});return {success:true,userId:id};
    }throw new Error('Azione utenti non disponibile');
  }
  async rpc(state,name,a){
    if(name==='save_sport_admin'){this.requireRole('super_admin');const row=this.upsert(state,'sports',{...(a.p_sport_id?{id:a.p_sport_id}:{}),name:clean(a.p_name),year:integer(a.p_year,1,5),sport_type:a.p_sport_type,format:a.p_format,gender:a.p_gender,has_return_match:!!a.p_has_return_match,is_active:a.p_is_active!==false});this.audit(state,name,{sport_id:row.id});return {success:true,saved_sport_id:row.id};}
    if(name==='save_team_admin')return this.saveTeam(state,a);
    if(name==='save_manual_match_admin'){this.requireRole('super_admin','match_manager');const payload={...(a.p_match_id?{id:a.p_match_id}:{}),sport_id:a.p_sport_id,home_team_id:a.p_home_team_id,away_team_id:a.p_away_team_id,round_name:a.p_round_name||'Girone (Andata)',venue_id:a.p_venue_id||null,scheduled_start:a.p_scheduled_start||null,scheduled_end:a.p_scheduled_end||null,schedule_notes:a.p_schedule_notes||null};let previous=null;if(a.p_match_id){const m=this.row(state,'matches',a.p_match_id);if(m.is_finished||m.status==='live')throw new Error('La partita è già iniziata o conclusa');previous=copy(m);payload.lock_version=(m.lock_version||0)+1;}const row=this.upsert(state,'matches',payload);require('./platform-ops.cjs').notifyClassScheduleChange({state,api:this,match:row,previous});this.audit(state,name,{match_id:row.id});return {success:true,saved_match_id:row.id};}
    if(['acquire_match_lock','refresh_match_lock','release_match_lock','save_live_snapshot','finalize_match','finalize_match_with_signatures','reopen_match_for_correction'].includes(name))return this.liveRpc(state,name,a);
    if(name==='prepare_key_station')return this.prepareKey(state,a);
    if(name==='import_key_operation')return this.importKey(state,a.p_operation);
    if(name==='create_key_receipt')return this.keyReceipt(state,a);
    const {handlePlatformRpc}=require('./platform-ops.cjs');const result=await handlePlatformRpc({name,args:a,state,api:this});if(result!==undefined)return result;
    throw Object.assign(new Error('Comando offline non disponibile: '+name),{code:'LOCAL_UNSUPPORTED'});
  }
  saveTeam(state,a){
    this.requireRole('super_admin');this.row(state,'sports',a.p_sport_id);const names=(a.p_players||[]).map(p=>typeof p==='string'?p: p.full_name||p.name).map(n=>clean(n,200));const captain=clean(a.p_captain_name,200);if(!names.includes(captain)||new Set(names.map(n=>n.toLowerCase())).size!==names.length||names.length>100)throw new Error('Rosa o capitano non validi');
    const team=this.upsert(state,'teams',{...(a.p_team_id?{id:a.p_team_id}:{}),sport_id:a.p_sport_id,name:clean(a.p_name)}),existing=this.tables(state).players.filter(p=>p.team_id===team.id);
    const nameKey=name=>name.trim().toLocaleLowerCase('it-IT');
    for(const p of existing)if(!names.some(name=>nameKey(name)===nameKey(p.full_name)))this.deleteRow(state,'players',p);
    for(const name of names){const p=existing.find(p=>nameKey(p.full_name)===nameKey(name));this.upsert(state,'players',{...(p?{id:p.id}:{}),team_id:team.id,full_name:name,is_captain:name===captain});}this.audit(state,'save_team_admin',{team_id:team.id});return {success:true,saved_team_id:team.id};
  }
  validatePayload(state,m,p,stats,signatures,requireSignatures){
    if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('Referto incompleto');for(const key of ['home_score','away_score','duration','quarter'])integer(p[key],key==='quarter'?1:0);
    if(!Array.isArray(stats)||stats.length>200||new Set(stats.map(s=>s.player_id)).size!==stats.length)throw new Error('Statistiche non valide');
    for(const stat of stats){const player=this.row(state,'players',stat.player_id);if(![m.home_team_id,m.away_team_id].includes(player.team_id))throw new Error('Giocatore estraneo alla partita');for(const k of ['played','is_mvp_vote'])if(stat[k]!=null&&typeof stat[k]!=='boolean')throw new Error('Presenza/MVP non validi');for(const k of ['fouls','points_scored','yellow_cards','red_cards'])if(stat[k]!=null)integer(stat[k],0,9999);}
    if(!Array.isArray(p.event_log||[])||(p.event_log||[]).length>10000)throw new Error('Cronologia non valida');
    if(requireSignatures){if(!Array.isArray(signatures)||signatures.length!==2||new Set(signatures.map(s=>s.team_side)).size!==2)throw new Error('Servono entrambe le firme dei capitani');for(const side of ['home','away']){const s=signatures.find(s=>s.team_side===side),captain=this.tables(state).players.find(p=>p.team_id===m[side+'_team_id']&&p.is_captain);if(!s||!captain||s.player_id!==captain.id)throw new Error('Firma non coerente con il capitano');if(typeof s.signature_data_url!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(s.signature_data_url))throw new Error('Firma PNG non valida');const bytes=decode64(s.signature_data_url.slice(22),null,550000);if(bytes.length<67||bytes.length>400000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Immagine firma non valida');}}
  }
  commitFinal(state,m,p,stats,signatures){
    this.validatePayload(state,m,p,stats,signatures,true);Object.assign(m,{home_score:p.home_score,away_score:p.away_score,duration:p.duration,quarter:p.quarter,live_payload:copy({...p,is_finished:true}),is_finished:true,status:'finished',finished_at:this.now(),updated_at:this.now(),lock_version:(m.lock_version||0)+1,lock_owner:null,lock_expires_at:null});
    for(const stat of stats)this.upsert(state,'match_stats',{...stat,match_id:m.id},'match_id,player_id');
    for(const s of signatures){const captain=this.row(state,'players',s.player_id);this.upsert(state,'match_captain_signatures',{match_id:m.id,team_side:s.team_side,team_id:captain.team_id,player_id:captain.id,captain_name:captain.full_name,signature_data_url:s.signature_data_url,signature_payload:copy(s),signed_by:this.user.id,signed_at:s.signed_at||this.now()},'match_id,team_side');}
    this.tables(state).live_match_events=this.tables(state).live_match_events.filter(e=>e.match_id!==m.id);for(const event of p.event_log||[])this.insert(state,'live_match_events',{...event,match_id:m.id});this.audit(state,'finalize_match',{match_id:m.id});return {success:true,new_version:m.lock_version,lock_version:m.lock_version,message:'Referto salvato nell’archivio centrale'};
  }
  liveRpc(state,name,a){
    this.requireRole('super_admin','match_manager');const m=this.row(state,'matches',a.match_id??a.p_match_id),active=m.lock_owner&&(m.lock_expires_at==null||new Date(m.lock_expires_at).getTime()>this.clock());
    if(name==='reopen_match_for_correction'){clean(a.p_reason,1000);if(!m.is_finished)throw new Error('La partita non è conclusa');this.audit(state,name,{match_id:m.id,reason:a.p_reason,previous:copy(m)});Object.assign(m,{is_finished:false,status:'scheduled',lock_owner:null,lock_expires_at:null,lock_version:m.lock_version+1,reopened_at:this.now(),reopen_reason:a.p_reason,live_payload:{...m.live_payload,is_finished:false}});this.tables(state).match_captain_signatures=this.tables(state).match_captain_signatures.filter(s=>s.match_id!==m.id);return {success:true,new_version:m.lock_version};}
    if(name==='release_match_lock'){if(m.lock_owner&&m.lock_owner!==this.user.id)throw new Error('Sessione live di un altro utente');m.lock_owner=null;m.lock_expires_at=null;return {success:true,lock_version:m.lock_version};}
    if(m.is_finished)throw new Error('Partita già conclusa');if(m.assigned_device_id&&name==='acquire_match_lock')throw new Error('Partita assegnata a una postazione Key. Rimuovere l’assegnazione prima del live centrale');
    if(active&&m.lock_owner!==this.user.id)throw new Error('Partita già gestita da un altro operatore');
    if(name==='acquire_match_lock'||name==='refresh_match_lock'){if(name==='refresh_match_lock'&&m.lock_owner!==this.user.id)throw new Error('Sessione live scaduta');Object.assign(m,{lock_owner:this.user.id,lock_expires_at:new Date(this.clock()+integer(a.ttl_seconds||90,15,300)*1000).toISOString(),status:'live',started_at:m.started_at||this.now()});return {success:true,lock_owner:m.lock_owner,lock_expires_at:m.lock_expires_at,lock_version:m.lock_version,status:m.status};}
    if(m.lock_owner!==this.user.id||m.lock_version!==a.expected_version)throw new Error('La versione della partita è cambiata. Ricarica prima di salvare');
    const p=a.payload,stats=a.stats_payload||p?.stats_snapshot||[];
    if(name==='save_live_snapshot'){this.validatePayload(state,m,p,stats,[],false);Object.assign(m,{home_score:p.home_score,away_score:p.away_score,duration:p.duration,quarter:p.quarter,live_payload:copy(p),lock_version:m.lock_version+1,updated_at:this.now()});return {success:true,new_version:m.lock_version,lock_version:m.lock_version};}
    if(name==='finalize_match')throw new Error('Chiudere il referto con entrambe le firme dei capitani');return this.commitFinal(state,m,p,stats,a.signatures_payload);
  }
  prepareKey(state,a){
    this.requireRole('super_admin','match_manager');if(!uuid.test(a.p_station_id)||!Array.isArray(a.p_match_ids)||a.p_match_ids.length<1||a.p_match_ids.length>250||new Set(a.p_match_ids).size!==a.p_match_ids.length)throw new Error('Preparazione non valida');clean(a.p_label,80);if(!this.row(state,'sports',a.p_sport_id).is_active)throw new Error('Torneo non attivo');if(a.p_venue_id&&!this.row(state,'venues',a.p_venue_id).is_active)throw new Error('Campo non disponibile');
    const device=this.tables(state).registered_devices.find(d=>d.device_id===a.p_station_id)||this.insert(state,'registered_devices',{device_id:a.p_station_id,label:a.p_label,assigned_venue_id:a.p_venue_id||null,assigned_admin_id:this.user.id});if(device.is_revoked||device.is_blocked||device.assigned_admin_id&&device.assigned_admin_id!==this.user.id&&this.user.ruolo!=='super_admin')throw new Error('Postazione non autorizzata');if(device.assigned_venue_id&&device.assigned_venue_id!==a.p_venue_id)throw new Error('Campo diverso dalla postazione');
    const matches=a.p_match_ids.map(id=>this.row(state,'matches',id));for(const m of matches){if(m.sport_id!==a.p_sport_id||m.is_finished||m.status==='cancelled'||a.p_venue_id&&m.venue_id!==a.p_venue_id)throw new Error('Partita non preparabile');if(m.assigned_device_id&&m.assigned_device_id!==a.p_station_id||m.lock_owner&&(!m.lock_expires_at||new Date(m.lock_expires_at).getTime()>this.clock()))throw new Error('Partita assegnata o in gestione live');}
    const preparation={preparation_id:randomUUID(),station_id:a.p_station_id,sport_id:a.p_sport_id,authorization_secret:randomBytes(32).toString('base64'),created_by:this.user.id,created_at:this.now(),expires_at:new Date(this.clock()+30*86400000).toISOString(),match_versions:matches.map(m=>({match_id:m.id,base_version:m.lock_version})),is_revoked:false};for(const m of matches)m.assigned_device_id=a.p_station_id;state.central.keyPreparations.push(preparation);this.audit(state,'prepare_key_station',{preparation_id:preparation.preparation_id,ids:a.p_match_ids});return copy(preparation);
  }
  importKey(state,op){
    this.requireRole('super_admin','match_manager');if(!op||op.type!=='key_report'||!uuid.test(op.id)||!uuid.test(op.preparation_id)||!uuid.test(op.station_id))throw new Error('Operazione Key non valida');integer(op.match_id,1);integer(op.base_version);integer(op.report_revision,1);if(Buffer.byteLength(canonical(op))>2*1024*1024)throw new Error('Referto troppo grande');
    const prep=state.central.keyPreparations.find(p=>p.preparation_id===op.preparation_id&&p.station_id===op.station_id);if(!prep||!verifyTag(op,prep.authorization_secret))throw new Error('Preparazione o autenticazione non valida');if(prep.revocation_reason==='platform_backup_restore')throw new Error('Archivio centrale ripristinato: questa preparazione richiede una nuova verifica e assegnazione');const {auth_tag,...body}=op,contentHash=hash(body),old=state.central.keyOperations.find(o=>o.operation_id===op.id);if(old){if(old.content_hash!==contentHash)return {operation_id:op.id,match_id:op.match_id,status:'rejected',message:'UUID operazione riutilizzato con contenuto diverso'};return {...copy(old.result),status:old.result.status==='imported'?'duplicate':old.result.status};}
    const device=this.row(state,'registered_devices',op.station_id,'device_id');if(device.is_revoked||device.is_blocked||prep.is_revoked||new Date(prep.expires_at).getTime()<this.clock())throw new Error('Preparazione scaduta o revocata');if(!prep.match_versions.some(v=>v.match_id===op.match_id&&v.base_version===op.base_version))throw new Error('Partita/versione non assegnata');const m=this.row(state,'matches',op.match_id);if(m.sport_id!==prep.sport_id||m.assigned_device_id!==prep.station_id)throw new Error('Assegnazione partita cambiata');
    let result={operation_id:op.id,match_id:m.id,status:'imported',remote_version:null,message:'Referto importato'};
    if(m.is_finished||m.lock_version!==op.base_version||m.lock_owner&&m.lock_owner!==this.user.id&&(!m.lock_expires_at||new Date(m.lock_expires_at).getTime()>this.clock()))result={...result,status:'conflict',message:'Partita conclusa, versione cambiata o sessione live occupata: richiesta revisione'};
    else {
      const p=op.payload;if(p?.is_finished!==true||!Array.isArray(p?.stats_snapshot)||!Array.isArray(p?.event_log)||!Array.isArray(op.audit_log)||op.audit_log.length<1||op.audit_log.length>10000)throw new Error('Referto incompleto');const reportHash=hash({match_id:m.id,payload:p,report_revision:op.report_revision});if(op.report_hash!==reportHash)throw new Error('Integrità referto non valida');let previous=null,revision=0;for(const entry of op.audit_log){const {hash:entryHash,...auditBody}=entry;if(entryHash!==hash(auditBody)||entry.previous_hash!==previous||entry.local_revision!==++revision)throw new Error('Storico modifiche non integro');previous=entryHash;}const last=op.audit_log.at(-1);if(last.action!=='finalize'||last.after_hash!==hash(p))throw new Error('Storico non associato al referto');if(!Array.isArray(op.signatures_payload)||op.signatures_payload.some(s=>s.report_hash!==reportHash))throw new Error('Firme non associate al referto');result.remote_version=this.commitFinal(state,m,p,p.stats_snapshot,op.signatures_payload).new_version;
    }
    state.central.keyOperations.push({operation_id:op.id,preparation_id:op.preparation_id,content_hash:contentHash,report_hash:op.report_hash,operation:copy(op),result,created_at:this.now(),imported_by:this.user.id});return result;
  }
  keyReceipt(state,a){
    this.requireRole('super_admin','match_manager');if(!uuid.test(a.p_results_package_id)||!Array.isArray(a.p_operation_ids)||!a.p_operation_ids.length||a.p_operation_ids.length>2500||a.p_operation_ids.some(id=>!uuid.test(id))||new Set(a.p_operation_ids).size!==a.p_operation_ids.length)throw new Error('Ricevuta non valida');const prep=state.central.keyPreparations.find(p=>p.preparation_id===a.p_preparation_id);if(!prep)throw new Error('Preparazione non trovata');if(prep.revocation_reason==='platform_backup_restore')throw new Error('Archivio centrale ripristinato: verificare il referto prima di emettere nuove ricevute');const old=state.central.keyReceipts.find(r=>r.preparation_id===a.p_preparation_id&&r.results_package_id===a.p_results_package_id);if(old){if(JSON.stringify(old.payload.results.map(r=>r.operation_id).sort())!==JSON.stringify([...a.p_operation_ids].sort()))throw new Error('Ricevuta già emessa per un insieme diverso di operazioni');return copy(old.payload);}
    const results=a.p_operation_ids.map(id=>{const row=state.central.keyOperations.find(o=>o.operation_id===id&&o.preparation_id===a.p_preparation_id);if(!row)throw new Error('Operazione non registrata');return {...copy(row.result),report_hash:row.report_hash,content_hash:row.content_hash};});const payload={schema:'itsoscup-offline-transfer',version:2,kind:'receipt',receipt_id:randomUUID(),preparation_id:a.p_preparation_id,station_id:prep.station_id,package_id:a.p_results_package_id,created_at:this.now(),results};payload.auth_tag=tag(payload,prep.authorization_secret);state.central.keyReceipts.push({preparation_id:a.p_preparation_id,results_package_id:a.p_results_package_id,payload});return copy(payload);
  }
}
module.exports={PlatformApi};
