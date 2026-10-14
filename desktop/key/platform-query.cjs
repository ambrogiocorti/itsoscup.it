'use strict';
const TABLES = ['sports','sport_config','teams','players','matches','match_stats','venues','match_staff_assignments','match_captain_signatures','live_match_events','events','event_results','athletics_heats','athletics_lane_assignments','athletics_school_records','athletics_relay_teams','athletics_relay_members','honor_roll_entries','urgent_announcements','issue_reports','registered_devices','admins','platform_settings','platform_migrations','platform_backups','audit_log','client_error_logs','sensitive_data_access_log','internal_notifications','system_health_checks','communication_templates','match_checkins','match_status_history','match_reschedule_history','class_invites','class_registrations','class_notices','class_notice_recipients','team_favorites'];
const PUBLIC = new Set(['sports','sport_config','teams','players','matches','venues','events','event_results','match_stats','honor_roll_entries','urgent_announcements','athletics_school_records']);
const MANAGER = new Set(['matches','match_stats','match_staff_assignments','match_captain_signatures','live_match_events','match_checkins','match_status_history','issue_reports']);
const IMMUTABLE = new Set(['admins','audit_log','platform_backups','platform_migrations','sensitive_data_access_log']);
const clone = value => JSON.parse(JSON.stringify(value));
function parts(text) { let depth=0,start=0,result=[]; for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;if(text[i]===')')depth--;if(text[i]===','&&!depth){result.push(text.slice(start,i).trim());start=i+1;}}result.push(text.slice(start).trim());return result.filter(Boolean); }
function relation(tables,table,row,target,hint) {
  const rows=tables[target]; if(!rows)throw new Error('Relazione locale non disponibile: '+target);
  let foreign=hint && !['inner','left'].includes(hint) ? hint.replace(/_fkey$/,'').replace(new RegExp('^'+table+'_'),'') : null;
  if(target==='registered_devices')foreign ||= 'assigned_device_id';
  const conventional={sports:'sport_id',teams:'team_id',players:'player_id',venues:'venue_id',matches:'match_id',events:'event_id',athletics_heats:'heat_id',athletics_relay_teams:'relay_team_id',class_invites:'invite_id',class_notices:'notice_id',admins:'assigned_admin_id'};
  foreign ||= conventional[target];
  if(foreign && Object.hasOwn(row,foreign))return {many:false,rows:rows.filter(r=>r[target==='registered_devices'?'device_id':'id']===row[foreign]).slice(0,1)};
  const back=conventional[table];
  if(back)return {many:true,rows:rows.filter(r=>r[back]===row.id)};
  throw new Error('Relazione non riconosciuta: '+table+'/'+target);
}
function assertReadSelection(table,select,user,depth=0) {
  if(depth>6)throw new Error('Selezione troppo annidata');
  if(!user&&!PUBLIC.has(table))throw new Error('Relazione riservata: '+table);
  for(const item of parts(select)) {
    const join=/^(?:(\w+):)?(\w+)(?:!([\w]+))?\((.*)\)$/.exec(item);
    if(join){assertReadSelection(join[2],join[4],user,depth+1);continue;}
    const field=/^(?:(\w+):)?([\w]+)$/.exec(item);
    if(!user&&table==='players'&&field?.[2]==='student_code')throw new Error('Colonna riservata: student_code');
  }
}
function project(state,table,row,select='*',depth=0,options={}) {
  if(depth>6)throw new Error('Selezione troppo annidata');
  const out={};for(const item of parts(select)) {
    if(item==='*'){const value=clone(row);if(options.public&&table==='players')delete value.student_code;Object.assign(out,value);continue;}
    const join=/^(?:(\w+):)?(\w+)(?:!([\w]+))?\((.*)\)$/.exec(item);
    if(join){const [,alias,target,hint,sub]=join,rel=relation(state.central.tables,table,row,target,hint),values=rel.rows.map(r=>project(state,target,r,sub,depth+1,options));out[alias||target]=rel.many?values:(values[0]??null);continue;}
    const field=/^(?:(\w+):)?([\w]+)$/.exec(item);if(!field)throw new Error('Colonna non supportata: '+item);out[field[1]||field[2]]=row[field[2]]??null;
  }return out;
}
function compare(a,b){return typeof a==='string'&&typeof b==='string'?a.localeCompare(b,'it',{numeric:true}):(a>b?1:a<b?-1:0);}
function literal(value){if(value==='null')return null;if(value==='true')return true;if(value==='false')return false;if(/^-?\d+(\.\d+)?$/.test(value))return Number(value);return value.replace(/^"|"$/g,'');}
function typedValue(actual,value){
  if(typeof actual==='number'&&typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value)))return Number(value);
  return value;
}
function test(row,method,field,value) {
  const actual=String(field).split('.').reduce((v,key)=>v?.[key],row);
  switch(method){case'eq':return actual===typedValue(actual,value);case'neq':return actual!==typedValue(actual,value);case'is':return (actual??null)===typedValue(actual,value);case'in':return Array.isArray(value)&&value.some(item=>typedValue(actual,item)===actual);case'gt':return actual>value;case'gte':return actual>=value;case'lt':return actual<value;case'lte':return actual<=value;case'contains':return Array.isArray(actual)?value.every(x=>actual.includes(x)):Object.entries(value).every(([k,v])=>actual?.[k]===v);case'like':case'ilike':{const pattern=String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.');return new RegExp('^'+pattern+'$',method==='ilike'?'i':'').test(String(actual??''));}default:throw new Error('Filtro non supportato: '+method);}
}
function orTest(row,expression){return parts(expression).some(condition=>{const group=/^(and|or)\((.*)\)$/.exec(condition);if(group)return group[1]==='or'?orTest(row,group[2]):parts(group[2]).every(x=>orTest(row,x));const m=/^([\w.]+)\.(\w+)\.(.*)$/.exec(condition);if(!m)throw new Error('Filtro OR non valido');const value=m[2]==='in'?parts(m[3].replace(/^\(|\)$/g,'')).map(literal):literal(m[3]);return test(row,m[2],m[1],value);});}
function query(api,state,request) {
  const {table,calls}=request;if(!TABLES.includes(table)||!Array.isArray(calls)||calls.length>80)throw new Error('Richiesta locale non valida');
  let select='*',options={},single=false,maybe=false,operation=null,values,conflict='id',offset=0,end=null,limit=null;const filters=[],orders=[];
  for(const call of calls){if(!call||!Array.isArray(call.args))throw new Error('Query non valida');const [a,b]=call.args;switch(call.method){
    case'select':select=a||'*';options=b||{};break;case'single':single=true;break;case'maybeSingle':maybe=true;break;
    case'insert':case'update':case'upsert':case'delete':if(operation)throw new Error('Una sola modifica per query');operation=call.method;values=a;conflict=b?.onConflict||'id';break;
    case'order':orders.push([a,b||{}]);break;case'limit':limit=a;break;case'range':offset=a;end=b;break;
    case'eq':case'neq':case'is':case'in':case'gt':case'gte':case'lt':case'lte':case'like':case'ilike':case'contains':filters.push(row=>test(row,call.method,a,b));break;
    case'or':filters.push(row=>orTest(row,a));break;case'not':{const [,operator,value]=call.args;filters.push(row=>!test(row,operator,a,value));break;}
    case'filter':{const [,operator,value]=call.args;filters.push(row=>test(row,operator,a,value));break;}
    default:throw new Error('Metodo locale non supportato: '+call.method);
  }}
  if(operation){api.requireRole(...(MANAGER.has(table)?['super_admin','match_manager']:['super_admin']));if(IMMUTABLE.has(table))throw new Error('Usare il comando autorizzato per questa tabella');}else if(!PUBLIC.has(table))api.requireRole('super_admin','match_manager','report_viewer');
  assertReadSelection(table,select,api.user);
  const projection=row=>project(state,table,row,select,0,{public:!api.user});
  const rows=state.central.tables[table],matches=rows.filter(row=>filters.every(fn=>fn({...row,...projection(row)})));let result=matches;
  const previousMatches=table==='matches'?new Map(matches.map(m=>[m.id,clone(m)])):null;
  if(table==='matches'&&operation){
    if(operation==='update'||operation==='upsert'){
      const protectedFields=['is_finished','lock_version','lock_owner','lock_expires_at','live_payload','home_score','away_score','duration','quarter','finished_at','official_at','official_by'];
      for(const row of Array.isArray(values)?values:[values])if(row&&protectedFields.some(field=>Object.hasOwn(row,field)))throw new Error('Punteggio e referto si modificano dalla gestione live autorizzata');
    }
    const protectedMatch=m=>m.is_finished||m.status==='live'||m.status==='finished'||m.operational_status==='official';
    if(operation==='update'||operation==='delete')for(const m of matches)if(protectedMatch(m))throw new Error('Riaprire la partita prima di modificarla');
    for(const incoming of Array.isArray(values)?values:[values]){
      if(!incoming)continue;
      if(['live','finished','official'].includes(incoming.status)||['live','ended','awaiting_signatures','official'].includes(incoming.operational_status))throw new Error('Stato del referto modificabile solo dal comando autorizzato');
      if(operation==='insert'){
        const nonzero=['home_score','away_score','duration','lock_version'].some(key=>incoming[key]!=null&&incoming[key]!==0);
        if(nonzero||incoming.quarter!=null&&incoming.quarter!==1||incoming.is_finished||incoming.lock_owner||incoming.lock_expires_at||incoming.finished_at||incoming.official_at||incoming.official_by||incoming.live_payload!=null&&Object.keys(incoming.live_payload).length)throw new Error('Chiudere il referto con entrambe le firme dei capitani');
      }
      if(operation==='upsert'){
        const keys=conflict.split(',').map(key=>key.trim());
        const existing=rows.find(row=>keys.every(key=>incoming[key]!=null&&incoming[key]===row[key]));
        if(existing&&protectedMatch(existing))throw new Error('Riaprire la partita prima di modificarla');
      }
    }
  }
  if(operation&&table==='match_captain_signatures')throw new Error('Le firme si salvano con la chiusura autorizzata del referto');
  if(operation&&['match_stats','match_staff_assignments','live_match_events'].includes(table)){
    const incoming=Array.isArray(values)?values:values?[values]:[];
    const keys=conflict.split(',').map(key=>key.trim());
    const existing=operation==='insert'?[]:operation==='upsert'?incoming.flatMap(value=>rows.filter(row=>keys.every(key=>value[key]!=null&&value[key]===row[key]))):matches;
    const affected=[...existing,...incoming];
    for(const row of affected){const match=state.central.tables.matches.find(match=>match.id===row.match_id);if(match&&(match.is_finished||match.status==='finished'||match.operational_status==='official'))throw new Error('Riaprire il referto prima di modificare statistiche, eventi o personale');}
  }
  if(operation==='insert'||operation==='upsert'){
    const incoming=Array.isArray(values)?values:[values];if(!incoming.length||incoming.length>5000)throw new Error('Numero righe non valido');
    result=incoming.map(row=>operation==='upsert'?api.upsert(state,table,row,conflict):api.insert(state,table,row));
    if(table==='matches'&&operation==='upsert')for(const row of result)if(previousMatches.has(row.id))row.lock_version=(row.lock_version||0)+1;
  }else if(operation==='update'){
    if(!filters.length)throw new Error('Seleziona le righe da modificare');if(!values||typeof values!=='object'||Array.isArray(values)||Object.hasOwn(values,'id'))throw new Error('Modifica non valida');
    result=matches.map(row=>{api.validateRow(state,table,{...row,...values},row.id);Object.assign(row,clone(values),{updated_at:api.now()});if(table==='matches')row.lock_version=(row.lock_version||0)+1;return row;});
  }else if(operation==='delete'){if(!filters.length)throw new Error('Seleziona le righe da eliminare');for(const row of matches)api.deleteRow(state,table,row);result=matches;}
  if(operation)api.audit(state,'query_'+operation,{table,ids:result.map(r=>r.id??r.device_id)});
  if(operation&&table==='matches'&&operation!=='delete')for(const match of result)require('./platform-ops.cjs').notifyClassScheduleChange({state,api,match,previous:previousMatches.get(match.id)||null});
  for(let i=orders.length-1;i>=0;i--){const [field,opt]=orders[i];result=[...result].sort((a,b)=>{const x=a[field],y=b[field];if(x==null||y==null)return x==null&&y==null?0:(x==null?(opt.nullsFirst? -1:1):(opt.nullsFirst?1:-1));return compare(x,y)*(opt.ascending===false?-1:1);});}
  const count=result.length;if(!Number.isSafeInteger(offset)||offset<0||limit!=null&&(!Number.isSafeInteger(limit)||limit<0)||end!=null&&(!Number.isSafeInteger(end)||end<offset))throw new Error('Intervallo non valido');
  result=result.slice(offset,end==null?undefined:end+1);if(limit!=null)result=result.slice(0,limit);
  result=result.map(projection);
  if(single&&result.length!==1||maybe&&result.length>1)throw Object.assign(new Error('Risultato singolo non disponibile'),{code:'PGRST116'});
  return {data:options.head?null:single||maybe?(result[0]??null):result,error:null,...(options.count?{count}:{})};
}
module.exports={TABLES,query,project};
