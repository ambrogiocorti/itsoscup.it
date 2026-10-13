-- ITSOSCup | Funzioni per classi, comunicazioni e analisi.
-- Applicare con Supabase SQL Editor DOPO le migrazioni applicative esistenti.
-- Il frontend non deve contenere service_role keys.
begin;
create extension if not exists pgcrypto;
create table if not exists public.class_invites (
 id uuid primary key default gen_random_uuid(),
 sport_id bigint not null references public.sports(id) on delete cascade,
 class_name text not null check (char_length(btrim(class_name)) between 2 and 48),
 access_code text not null unique default encode(gen_random_bytes(24),'hex'),
 is_active boolean not null default true,
 expires_at timestamptz,
 created_by uuid references public.admins(id) on delete set null default auth.uid(),
 created_at timestamptz not null default now()
);
create unique index if not exists class_invites_sport_class_idx on public.class_invites(sport_id, lower(btrim(class_name)));
create index if not exists class_invites_sport_idx on public.class_invites(sport_id);
create table if not exists public.class_registrations (
 id bigserial primary key,
 invite_id uuid not null unique references public.class_invites(id) on delete cascade,
 sport_id bigint not null references public.sports(id) on delete cascade,
 class_name text not null,
 roster jsonb not null default '[]'::jsonb,
 captain_name text not null,
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 team_id bigint references public.teams(id) on delete set null,
 submitted_at timestamptz not null default now(),
 decided_by uuid references public.admins(id) on delete set null,
 decided_at timestamptz,
 decision_note text
);
create index if not exists class_registrations_sport_idx on public.class_registrations(sport_id,status);
create table if not exists public.class_notices (
 id bigserial primary key,
 sport_id bigint not null references public.sports(id) on delete cascade,
 title text not null check (char_length(btrim(title)) between 3 and 120),
 body text not null check (char_length(btrim(body)) between 3 and 3000),
 created_by uuid references public.admins(id) on delete set null default auth.uid(),
 created_at timestamptz not null default now()
);
create table if not exists public.class_notice_recipients (
 notice_id bigint not null references public.class_notices(id) on delete cascade,
 invite_id uuid not null references public.class_invites(id) on delete cascade,
 read_at timestamptz,
 primary key(notice_id,invite_id)
);
create index if not exists class_notice_recipients_invite_idx on public.class_notice_recipients(invite_id,read_at);
alter table public.class_invites enable row level security;
alter table public.class_registrations enable row level security;
alter table public.class_notices enable row level security;
alter table public.class_notice_recipients enable row level security;
drop policy if exists invites_admin on public.class_invites;
create policy invites_admin on public.class_invites for all to authenticated
 using (public.current_admin_role() in ('super_admin','match_manager'))
 with check (public.current_admin_role() in ('super_admin','match_manager'));
drop policy if exists registrations_admin on public.class_registrations;
create policy registrations_admin on public.class_registrations for select to authenticated
 using (public.current_admin_role() in ('super_admin','match_manager'));
drop policy if exists notices_admin on public.class_notices;
create policy notices_admin on public.class_notices for select to authenticated
 using (public.current_admin_role() in ('super_admin','match_manager'));
drop policy if exists recipients_admin on public.class_notice_recipients;
create policy recipients_admin on public.class_notice_recipients for select to authenticated
 using (public.current_admin_role() in ('super_admin','match_manager'));
revoke all on public.class_invites, public.class_registrations, public.class_notices, public.class_notice_recipients from anon;
grant select,insert,update,delete on public.class_invites to authenticated;
grant select on public.class_registrations, public.class_notices, public.class_notice_recipients to authenticated;
grant usage,select on sequence public.class_registrations_id_seq, public.class_notices_id_seq to authenticated;

-- Un codice casuale di 192 bit identifica una sola classe; non vi sono letture anonime delle tabelle.
create or replace function public.submit_class_registration(p_code text, p_roster jsonb, p_captain text)
returns text language plpgsql security definer set search_path = '' as $$
declare
 v_inv public.class_invites%rowtype;
 v_names text[];
 v_name text;
 v_captain text := btrim(coalesce(p_captain,''));
 v_n integer;
 v_existing public.class_registrations%rowtype;
begin
 select * into v_inv from public.class_invites
 where access_code = lower(btrim(coalesce(p_code,''))) and is_active
 and (expires_at is null or expires_at>now()) for update;
 if not found then raise exception 'Codice classe non valido o scaduto'; end if;
 if jsonb_typeof(p_roster) <> 'array' or jsonb_array_length(p_roster) not between 1 and 40
 then raise exception 'La squadra deve avere da 1 a 40 componenti'; end if;
 if exists(select 1 from jsonb_array_elements(p_roster) x where jsonb_typeof(x.value)<>'string'
   or char_length(btrim(x.value #>> '{}')) not between 2 and 100)
 then raise exception 'Nomi dei componenti non validi'; end if;
 select array_agg(btrim(value #>> '{}')) into v_names from jsonb_array_elements(p_roster);
 select count(distinct lower(t)) into v_n from unnest(v_names) t;
 if v_n <> array_length(v_names,1) then raise exception 'Non sono ammessi nominativi duplicati'; end if;
 if v_captain = '' or not exists(select 1 from unnest(v_names) t where lower(t)=lower(v_captain))
 then raise exception 'Seleziona come capitano un componente della squadra'; end if;
 select * into v_existing from public.class_registrations where invite_id=v_inv.id for update;
 if found and v_existing.status='approved' then raise exception 'Iscrizione gia confermata dai docenti'; end if;
 if found and v_existing.submitted_at > now()-interval '20 seconds'
 then raise exception 'Attendi qualche secondo prima di inviare nuovamente'; end if;
 insert into public.class_registrations(invite_id,sport_id,class_name,roster,captain_name)
 values (v_inv.id,v_inv.sport_id,v_inv.class_name,to_jsonb(v_names),v_captain)
 on conflict(invite_id) do update set roster=excluded.roster,captain_name=excluded.captain_name,
   submitted_at=now(),status='pending',decision_note=null,decided_by=null,decided_at=null;
 return 'pending';
end $$;
revoke all on function public.submit_class_registration(text,jsonb,text) from public;
grant execute on function public.submit_class_registration(text,jsonb,text) to anon,authenticated;

create or replace function public.decide_class_registration(p_registration_id bigint,p_approve boolean,p_reason text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_row public.class_registrations%rowtype; v_team_id bigint;
begin
 if public.current_admin_role() not in ('super_admin','match_manager')
 then raise exception 'Accesso non autorizzato'; end if;
 select * into v_row from public.class_registrations where id=p_registration_id for update;
 if not found or v_row.status<>'pending' then raise exception 'Iscrizione non in attesa'; end if;
 if p_approve then
   insert into public.teams(sport_id,name) values(v_row.sport_id,v_row.class_name) returning id into v_team_id;
   insert into public.players(team_id,full_name,is_captain)
     select v_team_id, value #>> '{}',lower(value #>> '{}')=lower(v_row.captain_name)
     from jsonb_array_elements(v_row.roster);
 else v_team_id := null; end if;
 update public.class_registrations
 set status=case when p_approve then 'approved' else 'rejected' end,
     team_id=v_team_id,decided_by=auth.uid(),decided_at=now(),
     decision_note=nullif(left(btrim(coalesce(p_reason,'')),500),'')
 where id=p_registration_id;
 return v_team_id;
end $$;
revoke all on function public.decide_class_registration(bigint,boolean,text) from public;
grant execute on function public.decide_class_registration(bigint,boolean,text) to authenticated;

create or replace function public.send_class_notice(p_sport_id bigint,p_title text,p_body text,p_invite_ids uuid[])
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_notice bigint; v_count integer;
begin
 if public.current_admin_role() not in ('super_admin','match_manager') then raise exception 'Accesso non autorizzato'; end if;
 if char_length(btrim(coalesce(p_title,''))) not between 3 and 120 or
    char_length(btrim(coalesce(p_body,''))) not between 3 and 3000
 then raise exception 'Titolo o testo non valido'; end if;
 select count(*) into v_count from public.class_invites
 where id=any(p_invite_ids) and sport_id=p_sport_id and is_active;
 if coalesce(array_length(p_invite_ids,1),0)=0 or
   v_count<>(select count(distinct x) from unnest(p_invite_ids) x)
 then raise exception 'Seleziona soltanto classi valide del torneo'; end if;
 insert into public.class_notices(sport_id,title,body) values(p_sport_id,btrim(p_title),btrim(p_body))
 returning id into v_notice;
 insert into public.class_notice_recipients(notice_id,invite_id)
 select v_notice,id from public.class_invites where id=any(p_invite_ids) and sport_id=p_sport_id;
 return v_notice;
end $$;
revoke all on function public.send_class_notice(bigint,text,text,uuid[]) from public;
grant execute on function public.send_class_notice(bigint,text,text,uuid[]) to authenticated;

create or replace function public.class_portal(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.class_invites%rowtype; v_reg jsonb; v_notices jsonb;
begin
 select * into v_inv from public.class_invites
 where access_code=lower(btrim(coalesce(p_code,''))) and is_active and
 (expires_at is null or expires_at>now());
 if not found then raise exception 'Codice classe non valido o scaduto'; end if;
 select jsonb_build_object('status',status,'roster',roster,'captain',captain_name,
     'decision_note',decision_note) into v_reg
 from public.class_registrations where invite_id=v_inv.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'body',n.body,
     'created_at',n.created_at,'read_at',r.read_at) order by n.created_at desc),'[]'::jsonb)
 into v_notices from public.class_notice_recipients r
 join public.class_notices n on n.id=r.notice_id where r.invite_id=v_inv.id;
 return jsonb_build_object('class_name',v_inv.class_name,'sport_id',v_inv.sport_id,
 'registration',v_reg,'notices',v_notices);
end $$;
revoke all on function public.class_portal(text) from public;
grant execute on function public.class_portal(text) to anon,authenticated;

create or replace function public.acknowledge_class_notice(p_code text,p_notice_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_inv uuid;
begin
 select id into v_inv from public.class_invites where
 access_code=lower(btrim(coalesce(p_code,''))) and is_active and
 (expires_at is null or expires_at>now());
 if v_inv is null then raise exception 'Codice non valido'; end if;
 update public.class_notice_recipients set read_at=coalesce(read_at,now())
 where notice_id=p_notice_id and invite_id=v_inv;
 return found;
end $$;
revoke all on function public.acknowledge_class_notice(text,bigint) from public;
grant execute on function public.acknowledge_class_notice(text,bigint) to anon,authenticated;

create table if not exists public.platform_migrations (
 version text primary key, description text, applied_at timestamptz not null default now()
);
insert into public.platform_migrations(version,description)
values ('040','Iscrizioni guidate, avvisi mirati e conferme lettura')
on conflict(version) do update set description=excluded.description,applied_at=now();
notify pgrst,'reload schema';
commit;
