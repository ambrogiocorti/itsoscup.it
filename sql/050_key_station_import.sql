-- ITSOSCup Key v2. Additive: never changes existing student rows or legacy grants.
-- Apply only after the synthetic PostgreSQL and Windows build checks pass.
begin;
create schema if not exists itsoscup_key;
revoke all on schema itsoscup_key from public, anon, authenticated;

create table itsoscup_key.preparations (
  id uuid primary key default gen_random_uuid(),
  station_id text not null references public.registered_devices(device_id),
  sport_id bigint not null references public.sports(id),
  authorization_secret bytea not null check (octet_length(authorization_secret)=32),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days',
  is_revoked boolean not null default false
);
create table itsoscup_key.prepared_matches (
  preparation_id uuid not null references itsoscup_key.preparations(id),
  match_id bigint not null references public.matches(id),
  base_version integer not null check (base_version>=0),
  primary key(preparation_id,match_id)
);
create index key_prepared_match_idx on itsoscup_key.prepared_matches(match_id);
create table itsoscup_key.import_operations (
  id uuid primary key,
  preparation_id uuid not null references itsoscup_key.preparations(id),
  match_id bigint not null references public.matches(id),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  report_hash text not null,
  operation jsonb not null,
  status text not null check(status in ('imported','conflict','rejected')),
  remote_version integer,
  message text not null,
  imported_by uuid not null references public.admins(id),
  created_at timestamptz not null default now()
);
create index key_operations_preparation_idx on itsoscup_key.import_operations(preparation_id,created_at);
create table itsoscup_key.receipts (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null references itsoscup_key.preparations(id),
  results_package_id uuid not null,
  payload jsonb not null,
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  unique(preparation_id,results_package_id)
);
alter table itsoscup_key.preparations enable row level security;
alter table itsoscup_key.prepared_matches enable row level security;
alter table itsoscup_key.import_operations enable row level security;
alter table itsoscup_key.receipts enable row level security;
revoke all on all tables in schema itsoscup_key from public,anon,authenticated;

-- The v2 wire protocol uses sorted ASCII object keys and safe integer numbers.
-- Rejecting fractions avoids JSON.stringify/PostgreSQL exponent discrepancies.
create function itsoscup_key.canonical_json(value jsonb) returns text
language plpgsql immutable strict set search_path='' as $$
declare result text; number_value numeric;
begin
  case jsonb_typeof(value)
  when 'object' then
    if exists(select 1 from jsonb_object_keys(value) k where k !~ '^[ -~]+$') then
      raise exception 'Protocol object keys must be ASCII';
    end if;
    select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||itsoscup_key.canonical_json(v),',' order by k collate "C"),'')||'}'
      into result from jsonb_each(value) e(k,v);
  when 'array' then
    select '['||coalesce(string_agg(itsoscup_key.canonical_json(v),',' order by ord),'')||']'
      into result from jsonb_array_elements(value) with ordinality e(v,ord);
  when 'number' then
    number_value:=(value::text)::numeric;
    if number_value<>trunc(number_value) or abs(number_value)>9007199254740991 then
      raise exception 'Protocol numbers must be safe integers';
    end if;
    result:=trunc(number_value)::text;
  else result:=value::text;
  end case;
  return result;
end $$;
revoke all on function itsoscup_key.canonical_json(jsonb) from public,anon,authenticated;

create function public.prepare_key_station(
  p_station_id uuid,p_sport_id bigint,p_match_ids bigint[],p_label text,p_venue_id bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare preparation itsoscup_key.preparations%rowtype; station public.registered_devices%rowtype; versions jsonb;
begin
  if auth.uid() is null or not coalesce(public.can_manage_matches(),false) then raise exception 'Accesso non autorizzato'; end if;
  if p_station_id is null or p_sport_id is null or coalesce(cardinality(p_match_ids),0) not between 1 and 250
    or nullif(trim(p_label),'') is null or length(p_label)>80 then raise exception 'Preparazione non valida'; end if;
  if cardinality(p_match_ids)<>(select count(distinct i) from unnest(p_match_ids) i) then raise exception 'Partite duplicate'; end if;
  if not exists(select 1 from public.sports s where s.id=p_sport_id and s.is_active) then raise exception 'Torneo non attivo'; end if;
  if p_venue_id is not null and not exists(select 1 from public.venues v where v.id=p_venue_id and v.is_active) then raise exception 'Campo non disponibile'; end if;
  -- Safe registration replaces the unauthenticated legacy register_device endpoint.
  insert into public.registered_devices(device_id,label,assigned_venue_id,assigned_admin_id,is_offline_ready)
    values(p_station_id::text,trim(p_label),p_venue_id,auth.uid(),false) on conflict(device_id) do nothing;
  select d.* into station from public.registered_devices d where d.device_id=p_station_id::text for update;
  if station.is_revoked or station.is_blocked then raise exception 'Postazione revocata o bloccata'; end if;
  if station.assigned_admin_id is not null and station.assigned_admin_id<>auth.uid() and public.current_admin_role()<>'super_admin' then
    raise exception 'Postazione assegnata a un altro responsabile';
  end if;
  if station.assigned_venue_id is distinct from p_venue_id and station.assigned_venue_id is not null then raise exception 'Campo diverso dalla postazione'; end if;
  perform 1 from public.matches m where m.id=any(p_match_ids) order by m.id for update;
  if (select count(*) from public.matches m where m.id=any(p_match_ids) and m.sport_id=p_sport_id and not m.is_finished
    and (p_venue_id is null or m.venue_id=p_venue_id))<>cardinality(p_match_ids) then raise exception 'Partite non valide per torneo/campo'; end if;
  if exists(select 1 from public.matches m where m.id=any(p_match_ids)
    and ((m.assigned_device_id is not null and m.assigned_device_id<>p_station_id::text)
      or (m.lock_owner is not null and (m.lock_expires_at is null or m.lock_expires_at>now())))) then
    raise exception 'Partita assegnata a un altro dispositivo o in gestione live';
  end if;
  update public.matches set assigned_device_id=p_station_id::text where id=any(p_match_ids);
  insert into itsoscup_key.preparations(station_id,sport_id,authorization_secret,created_by)
    values(p_station_id::text,p_sport_id,extensions.gen_random_bytes(32),auth.uid()) returning * into preparation;
  insert into itsoscup_key.prepared_matches(preparation_id,match_id,base_version)
    select preparation.id,m.id,m.lock_version from public.matches m where m.id=any(p_match_ids);
  select jsonb_agg(jsonb_build_object('match_id',pm.match_id,'base_version',pm.base_version) order by pm.match_id)
    into versions from itsoscup_key.prepared_matches pm where pm.preparation_id=preparation.id;
  return jsonb_build_object('preparation_id',preparation.id,'station_id',preparation.station_id,'sport_id',preparation.sport_id,
    'authorization_secret',encode(preparation.authorization_secret,'base64'),'created_at',preparation.created_at,
    'expires_at',preparation.expires_at,'match_versions',versions);
end $$;
revoke all on function public.prepare_key_station(uuid,bigint,bigint[],text,bigint) from public,anon;
grant execute on function public.prepare_key_station(uuid,bigint,bigint[],text,bigint) to authenticated;

create function public.import_key_operation(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  preparation itsoscup_key.preparations%rowtype; previous itsoscup_key.import_operations%rowtype;
  match_row public.matches%rowtype; operation_id uuid; match_id bigint; base_version integer;
  content text; content_hash text; calculated_report_hash text; signature jsonb; stat jsonb; image bytea;
  audit_entry jsonb; previous_audit_hash text; audit_hash text; audit_revision integer:=0;
  result record; status text:='imported'; message text:='Referto importato'; remote_version integer;
begin
  if auth.uid() is null or not coalesce(public.can_manage_matches(),false) then raise exception 'Accesso non autorizzato'; end if;
  if jsonb_typeof(p_operation) is distinct from 'object' or octet_length(p_operation::text)>2097152
    or p_operation->>'type' is distinct from 'key_report'
    or jsonb_typeof(p_operation->'match_id') is distinct from 'number'
    or jsonb_typeof(p_operation->'base_version') is distinct from 'number'
    or jsonb_typeof(p_operation->'report_revision') is distinct from 'number'
    or jsonb_typeof(p_operation->'id') is distinct from 'string'
    or jsonb_typeof(p_operation->'preparation_id') is distinct from 'string'
    or jsonb_typeof(p_operation->'station_id') is distinct from 'string' then raise exception 'Operazione non valida'; end if;
  operation_id:=(p_operation->>'id')::uuid; match_id:=(p_operation->>'match_id')::bigint; base_version:=(p_operation->>'base_version')::integer;
  select p.* into preparation from itsoscup_key.preparations p where p.id=(p_operation->>'preparation_id')::uuid for update;
  if not found or preparation.station_id is distinct from p_operation->>'station_id' then raise exception 'Preparazione non riconosciuta'; end if;
  content:=itsoscup_key.canonical_json(p_operation-'auth_tag');
  if decode(coalesce(p_operation->>'auth_tag',''),'base64') is distinct from extensions.hmac(convert_to(content,'UTF8'),preparation.authorization_secret,'sha256') then
    raise exception 'Autenticazione del pacchetto non valida';
  end if;
  content_hash:=encode(extensions.digest(convert_to(content,'UTF8'),'sha256'),'hex');
  -- Global operation lock also serializes an accidentally reused UUID across preparations.
  perform pg_advisory_xact_lock(hashtextextended(operation_id::text,0));
  select o.* into previous from itsoscup_key.import_operations o where o.id=operation_id;
  if found then
    if previous.content_hash<>content_hash then return jsonb_build_object('operation_id',operation_id,'match_id',match_id,'status','rejected','message','UUID operazione riutilizzato con contenuto diverso'); end if;
    return jsonb_build_object('operation_id',operation_id,'match_id',previous.match_id,'status',case when previous.status='imported' then 'duplicate' else previous.status end,
      'remote_version',previous.remote_version,'message',previous.message);
  end if;
  perform 1 from public.registered_devices d where d.device_id=preparation.station_id and not d.is_revoked and not d.is_blocked for share;
  if not found or preparation.is_revoked or preparation.expires_at<now() then raise exception 'Preparazione scaduta o postazione revocata'; end if;
  if not exists(select 1 from itsoscup_key.prepared_matches pm where pm.preparation_id=preparation.id and pm.match_id=match_id and pm.base_version=base_version) then
    raise exception 'Partita/versione non assegnata alla preparazione';
  end if;
  select m.* into match_row from public.matches m where m.id=match_id for update;
  if match_row.sport_id is distinct from preparation.sport_id or match_row.assigned_device_id is distinct from preparation.station_id then raise exception 'Assegnazione partita cambiata'; end if;
  if match_row.is_finished or match_row.lock_version<>base_version
    or (match_row.lock_owner is not null and match_row.lock_owner<>auth.uid() and (match_row.lock_expires_at is null or match_row.lock_expires_at>now())) then
    status:='conflict'; message:='Partita conclusa, versione cambiata o lock occupato: richiesta revisione';
  else
    if jsonb_typeof(p_operation->'payload') is distinct from 'object'
      or (p_operation->'payload'->'is_finished') is distinct from 'true'::jsonb
      or coalesce((p_operation->>'report_revision')::integer,0)<1
      or jsonb_typeof(p_operation->'signatures_payload') is distinct from 'array'
      or jsonb_array_length(p_operation->'signatures_payload')<>2
      or jsonb_typeof(p_operation->'payload'->'stats_snapshot') is distinct from 'array'
      or jsonb_array_length(p_operation->'payload'->'stats_snapshot')>200
      or jsonb_typeof(p_operation->'audit_log') is distinct from 'array'
      or jsonb_array_length(p_operation->'audit_log') not between 1 and 10000
      or jsonb_typeof(p_operation->'payload'->'event_log') is distinct from 'array'
      or jsonb_array_length(p_operation->'payload'->'event_log')>10000
      or not (p_operation->'payload' ?& array['home_score','away_score','duration','quarter']) then raise exception 'Referto incompleto'; end if;
    calculated_report_hash:=encode(extensions.digest(convert_to(itsoscup_key.canonical_json(jsonb_build_object(
      'match_id',match_id,'payload',p_operation->'payload','report_revision',(p_operation->>'report_revision')::integer)),'UTF8'),'sha256'),'hex');
    if calculated_report_hash is distinct from p_operation->>'report_hash' then raise exception 'Integrità referto non valida'; end if;
    for audit_entry in select * from jsonb_array_elements(p_operation->'audit_log') loop
      audit_hash:=encode(extensions.digest(convert_to(itsoscup_key.canonical_json(audit_entry-'hash'),'UTF8'),'sha256'),'hex');
      if audit_entry->>'hash' is distinct from audit_hash or audit_entry->>'previous_hash' is distinct from previous_audit_hash
        or jsonb_typeof(audit_entry->'local_revision') is distinct from 'number'
        or (audit_entry->>'local_revision')::integer is distinct from audit_revision+1 then raise exception 'Storico modifiche non integro'; end if;
      previous_audit_hash:=audit_hash; audit_revision:=audit_revision+1;
    end loop;
    if audit_entry->>'action' is distinct from 'finalize' or audit_entry->>'after_hash' is distinct from
      encode(extensions.digest(convert_to(itsoscup_key.canonical_json(p_operation->'payload'),'UTF8'),'sha256'),'hex') then
      raise exception 'Storico non associato al referto finale';
    end if;
    if (select count(distinct s->>'team_side') from jsonb_array_elements(p_operation->'signatures_payload') s)<>2 then raise exception 'Firme duplicate'; end if;
    for signature in select * from jsonb_array_elements(p_operation->'signatures_payload') loop
      if signature->>'report_hash' is distinct from calculated_report_hash or signature->>'team_side' not in ('home','away')
        or coalesce(signature->>'signature_data_url','') !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then raise exception 'Firma non associata al referto'; end if;
      image:=decode(substr(signature->>'signature_data_url',23),'base64');
      if octet_length(image) not between 67 and 400000 or substring(image from 1 for 8)<>decode('89504e470d0a1a0a','hex') then raise exception 'Immagine firma non valida'; end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_operation->'payload'->'stats_snapshot'))<>
      (select count(distinct s->>'player_id') from jsonb_array_elements(p_operation->'payload'->'stats_snapshot') s) then raise exception 'Statistiche duplicate'; end if;
    for stat in select * from jsonb_array_elements(p_operation->'payload'->'stats_snapshot') loop
      if not exists(select 1 from public.players p where p.id=(stat->>'player_id')::bigint and p.team_id in (match_row.home_team_id,match_row.away_team_id)) then
        raise exception 'Giocatore estraneo alla partita';
      end if;
      if exists(select 1 from jsonb_each(stat) e(k,v) where k in ('fouls','points_scored','yellow_cards','red_cards')
        and (jsonb_typeof(v)<>'number' or (v::text)::numeric not between 0 and 9999)) then raise exception 'Statistiche non valide'; end if;
      if exists(select 1 from jsonb_each(stat) e(k,v) where k in ('played','is_mvp_vote') and jsonb_typeof(v)<>'boolean') then raise exception 'Booleani statistiche non validi'; end if;
    end loop;
    if exists(select 1 from jsonb_each(p_operation->'payload') e(k,v) where k in ('home_score','away_score','duration','quarter')
      and (jsonb_typeof(v)<>'number' or (v::text)::numeric not between 0 and 999999)) then raise exception 'Punteggio o durata non valido'; end if;
    -- Reuse the proven finalizer under one transaction; no partial match/stat/signature writes.
    update public.matches set lock_owner=auth.uid(),lock_expires_at=now()+interval '90 seconds' where id=match_id;
    select * into result from public.finalize_match_with_signatures(match_id,p_operation->'payload',
      p_operation->'payload'->'stats_snapshot',p_operation->'signatures_payload',base_version);
    if not coalesce(result.success,false) then raise exception 'Finalizzazione rifiutata: %',result.message; end if;
    remote_version:=result.new_version;
  end if;
  insert into itsoscup_key.import_operations(id,preparation_id,match_id,content_hash,report_hash,operation,status,remote_version,message,imported_by)
    values(operation_id,preparation.id,match_id,content_hash,coalesce(p_operation->>'report_hash',''),p_operation,status,remote_version,message,auth.uid());
  return jsonb_build_object('operation_id',operation_id,'match_id',match_id,'status',status,'remote_version',remote_version,'message',message);
end $$;
revoke all on function public.import_key_operation(jsonb) from public,anon;
grant execute on function public.import_key_operation(jsonb) to authenticated;

create function public.create_key_receipt(p_preparation_id uuid,p_results_package_id uuid,p_operation_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preparation itsoscup_key.preparations%rowtype; receipt jsonb; results jsonb; receipt_id uuid:=gen_random_uuid();
begin
  if auth.uid() is null or not coalesce(public.can_manage_matches(),false) then raise exception 'Accesso non autorizzato'; end if;
  if p_results_package_id is null or coalesce(cardinality(p_operation_ids),0) not between 1 and 2500 then raise exception 'Ricevuta non valida'; end if;
  if cardinality(p_operation_ids)<>(select count(distinct i) from unnest(p_operation_ids) i) then raise exception 'ID operazioni nulli o duplicati nella ricevuta'; end if;
  select p.* into preparation from itsoscup_key.preparations p where p.id=p_preparation_id for update;
  if not found then raise exception 'Preparazione non trovata'; end if;
  select r.payload into receipt from itsoscup_key.receipts r where r.preparation_id=p_preparation_id and r.results_package_id=p_results_package_id;
  if found then
    if (select array_agg((entry->>'operation_id')::uuid order by (entry->>'operation_id')::uuid) from jsonb_array_elements(receipt->'results') entry)
      is distinct from (select array_agg(i order by i) from unnest(p_operation_ids) i) then
      raise exception 'UUID pacchetto riutilizzato con operazioni diverse';
    end if;
    return receipt;
  end if;
  if (select count(*) from itsoscup_key.import_operations o where o.preparation_id=p_preparation_id and o.id=any(p_operation_ids))<>
    (select count(distinct i) from unnest(p_operation_ids) i) then raise exception 'Operazioni non registrate: ricevuta non emessa'; end if;
  select jsonb_agg(jsonb_build_object('operation_id',o.id,'status',o.status,'remote_version',o.remote_version,'message',o.message,
    'report_hash',o.report_hash,'content_hash',o.content_hash) order by o.id)
    into results from itsoscup_key.import_operations o where o.preparation_id=p_preparation_id and o.id=any(p_operation_ids);
  receipt:=jsonb_build_object('schema','itsoscup-offline-transfer','version',2,'kind','receipt','station_id',preparation.station_id,
    'preparation_id',preparation.id,'package_id',p_results_package_id,'receipt_id',receipt_id,'created_at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'results',results);
  receipt:=receipt||jsonb_build_object('auth_tag',encode(extensions.hmac(convert_to(itsoscup_key.canonical_json(receipt),'UTF8'),preparation.authorization_secret,'sha256'),'base64'));
  insert into itsoscup_key.receipts(id,preparation_id,results_package_id,payload,created_by) values(receipt_id,preparation.id,p_results_package_id,receipt,auth.uid());
  return receipt;
end $$;
revoke all on function public.create_key_receipt(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.create_key_receipt(uuid,uuid,uuid[]) to authenticated;
commit;
