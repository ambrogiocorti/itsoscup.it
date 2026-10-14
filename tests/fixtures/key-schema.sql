create schema extensions;
create extension pgcrypto with schema extensions;
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table public.admins(id uuid primary key,ruolo text not null);
create function public.current_admin_role() returns text language sql stable security definer set search_path='' as $$
 select ruolo from public.admins where id=auth.uid()
$$;
create function public.can_manage_matches() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.current_admin_role() in ('super_admin','match_manager'),false)
$$;
create table public.sports(id bigint primary key,is_active boolean default true);
create table public.venues(id bigint primary key,is_active boolean default true);
create table public.registered_devices(
 device_id text primary key,label text,assigned_venue_id bigint,assigned_admin_id uuid,
 is_offline_ready boolean default false,is_revoked boolean default false,is_blocked boolean default false
);
create table public.teams(id bigint primary key,sport_id bigint,name text);
create table public.players(id bigint primary key,full_name text,team_id bigint,is_captain boolean default false);
create table public.matches(
 id bigint primary key,sport_id bigint,home_team_id bigint,away_team_id bigint,
 home_score integer default 0,away_score integer default 0,duration integer default 0,quarter integer default 1,
 is_finished boolean default false,status text default 'scheduled',finished_at timestamptz,updated_at timestamptz default now(),
 live_payload jsonb default '{}',lock_owner uuid,lock_expires_at timestamptz,lock_version integer default 0,
 assigned_device_id text references public.registered_devices(device_id),venue_id bigint
);
create table public.match_stats(
 id bigserial primary key,match_id bigint,player_id bigint,played boolean,fouls integer,is_mvp_vote boolean,
 points_scored integer,yellow_cards integer,red_cards integer,updated_at timestamptz default now(),unique(match_id,player_id)
);
create table public.match_captain_signatures(
 id bigserial primary key,match_id bigint,team_side text,team_id bigint,player_id bigint,captain_name text,
 signature_data_url text,signature_payload jsonb,signed_by uuid,signed_at timestamptz,unique(match_id,team_side)
);
