-- 001_refactor_hybrid.sql
-- Migrazione in-place compatibile per Tornei Scuola

create extension if not exists pgcrypto;

create table if not exists public.admins (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  ruolo text not null default 'match_manager',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admins_ruolo_check check (ruolo in ('super_admin', 'match_manager', 'report_viewer'))
);

alter table if exists public.admins add column if not exists nome text;
alter table if exists public.admins add column if not exists email text;
alter table if exists public.admins add column if not exists ruolo text not null default 'match_manager';
alter table if exists public.admins add column if not exists created_at timestamptz not null default now();
alter table if exists public.admins add column if not exists updated_at timestamptz not null default now();

create unique index if not exists admins_email_unique_idx on public.admins (lower(email));

create table if not exists public.sports (
  id bigserial primary key,
  name text not null,
  year smallint not null,
  sport_type text not null default 'calcio',
  format text not null default 'gironi',
  gender text not null default 'Misto',
  has_return_match boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sports_type_check check (sport_type in ('calcio', 'basket', 'pallavolo', 'atletica')),
  constraint sports_format_check check (format in ('gironi', 'eliminazione')),
  constraint sports_year_check check (year between 1 and 5)
);

alter table if exists public.sports add column if not exists sport_type text;
alter table if exists public.sports add column if not exists format text;
alter table if exists public.sports add column if not exists gender text;
alter table if exists public.sports add column if not exists has_return_match boolean not null default false;
alter table if exists public.sports add column if not exists is_active boolean not null default true;
alter table if exists public.sports add column if not exists created_at timestamptz not null default now();
alter table if exists public.sports add column if not exists updated_at timestamptz not null default now();
alter table if exists public.sports add column if not exists created_by uuid references public.admins(id);

update public.sports set sport_type = coalesce(sport_type, mode, 'calcio');
update public.sports set format = coalesce(format, type, 'gironi');
update public.sports set gender = coalesce(gender, 'Misto');
update public.sports set is_active = coalesce(is_active, true);

alter table if exists public.sports alter column sport_type set default 'calcio';
alter table if exists public.sports alter column format set default 'gironi';
alter table if exists public.sports alter column gender set default 'Misto';

create index if not exists sports_year_idx on public.sports (year);
create index if not exists sports_type_idx on public.sports (sport_type);

create table if not exists public.teams (
  id bigserial primary key,
  sport_id bigint not null references public.sports(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_unique_name_per_sport unique (sport_id, name)
);

alter table if exists public.teams add column if not exists sport_id bigint references public.sports(id) on delete cascade;
alter table if exists public.teams add column if not exists created_at timestamptz not null default now();
alter table if exists public.teams add column if not exists updated_at timestamptz not null default now();
create index if not exists teams_sport_idx on public.teams (sport_id);

create table if not exists public.players (
  id bigserial primary key,
  team_id bigint not null references public.teams(id) on delete cascade,
  full_name text not null,
  student_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_unique_team_name unique (team_id, full_name)
);

alter table if exists public.players add column if not exists team_id bigint references public.teams(id) on delete cascade;
alter table if exists public.players add column if not exists student_code text;
alter table if exists public.players add column if not exists created_at timestamptz not null default now();
alter table if exists public.players add column if not exists updated_at timestamptz not null default now();
create index if not exists players_team_idx on public.players (team_id);

create table if not exists public.matches (
  id bigserial primary key,
  sport_id bigint not null references public.sports(id) on delete cascade,
  home_team_id bigint references public.teams(id) on delete set null,
  away_team_id bigint references public.teams(id) on delete set null,
  round_name text not null default 'Girone (Andata)',
  status text not null default 'scheduled',
  is_finished boolean not null default false,
  home_score integer not null default 0,
  away_score integer not null default 0,
  quarter integer not null default 1,
  duration integer not null default 0,
  live_payload jsonb not null default '{}'::jsonb,
  lock_owner uuid references public.admins(id),
  lock_expires_at timestamptz,
  lock_version integer not null default 0,
  created_by uuid references public.admins(id),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_status_check check (status in ('scheduled', 'live', 'finished', 'cancelled')),
  constraint matches_not_same_team check (home_team_id is null or away_team_id is null or home_team_id <> away_team_id),
  constraint matches_non_negative_score check (home_score >= 0 and away_score >= 0),
  constraint matches_duration_check check (duration >= 0)
);

alter table if exists public.matches add column if not exists status text not null default 'scheduled';
alter table if exists public.matches add column if not exists quarter integer not null default 1;
alter table if exists public.matches add column if not exists duration integer not null default 0;
alter table if exists public.matches add column if not exists live_payload jsonb not null default '{}'::jsonb;
alter table if exists public.matches add column if not exists lock_owner uuid references public.admins(id);
alter table if exists public.matches add column if not exists lock_expires_at timestamptz;
alter table if exists public.matches add column if not exists lock_version integer not null default 0;
alter table if exists public.matches add column if not exists created_by uuid references public.admins(id);
alter table if exists public.matches add column if not exists started_at timestamptz;
alter table if exists public.matches add column if not exists finished_at timestamptz;
alter table if exists public.matches add column if not exists created_at timestamptz not null default now();
alter table if exists public.matches add column if not exists updated_at timestamptz not null default now();

create index if not exists matches_sport_idx on public.matches (sport_id);
create index if not exists matches_status_idx on public.matches (status, is_finished);
create index if not exists matches_lock_idx on public.matches (lock_owner, lock_expires_at);
create unique index if not exists matches_unique_round_pair_idx
  on public.matches (sport_id, least(home_team_id, away_team_id), greatest(home_team_id, away_team_id), round_name)
  where home_team_id is not null and away_team_id is not null and status <> 'cancelled';
create table if not exists public.match_stats (
  id bigserial primary key,
  match_id bigint not null references public.matches(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  played boolean not null default false,
  fouls integer not null default 0,
  is_mvp_vote boolean not null default false,
  points_scored integer not null default 0,
  yellow_cards integer not null default 0,
  red_cards integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint match_stats_unique_player_per_match unique (match_id, player_id),
  constraint match_stats_non_negative check (fouls >= 0 and points_scored >= 0 and yellow_cards >= 0 and red_cards >= 0)
);

alter table if exists public.match_stats add column if not exists played boolean not null default false;
alter table if exists public.match_stats add column if not exists fouls integer not null default 0;
alter table if exists public.match_stats add column if not exists is_mvp_vote boolean not null default false;
alter table if exists public.match_stats add column if not exists points_scored integer not null default 0;
alter table if exists public.match_stats add column if not exists yellow_cards integer not null default 0;
alter table if exists public.match_stats add column if not exists red_cards integer not null default 0;
alter table if exists public.match_stats add column if not exists created_at timestamptz not null default now();
alter table if exists public.match_stats add column if not exists updated_at timestamptz not null default now();

create index if not exists match_stats_match_idx on public.match_stats (match_id);
create index if not exists match_stats_player_idx on public.match_stats (player_id);

create table if not exists public.sport_config (
  id bigserial primary key,
  sport_id bigint unique references public.sports(id) on delete cascade,
  points_win integer not null default 3,
  points_draw integer not null default 1,
  points_loss integer not null default 0,
  volley_sets integer not null default 3,
  max_fouls integer not null default 3,
  quarters_count integer not null default 4,
  quarter_duration_sec integer not null default 600,
  timeouts_per_team integer not null default 2,
  allow_yellow_cards boolean not null default false,
  allow_red_cards boolean not null default false,
  allow_mvp boolean not null default true,
  min_players integer not null default 5,
  ranking_weight_presence integer not null default 70,
  ranking_weight_fairplay integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sport_config_weights_check check (ranking_weight_presence >= 0 and ranking_weight_fairplay >= 0 and ranking_weight_presence + ranking_weight_fairplay = 100)
);

alter table if exists public.sport_config add column if not exists sport_id bigint references public.sports(id) on delete cascade;
alter table if exists public.sport_config add column if not exists points_win integer not null default 3;
alter table if exists public.sport_config add column if not exists points_draw integer not null default 1;
alter table if exists public.sport_config add column if not exists points_loss integer not null default 0;
alter table if exists public.sport_config add column if not exists volley_sets integer not null default 3;
alter table if exists public.sport_config add column if not exists max_fouls integer not null default 3;
alter table if exists public.sport_config add column if not exists quarters_count integer not null default 4;
alter table if exists public.sport_config add column if not exists quarter_duration_sec integer not null default 600;
alter table if exists public.sport_config add column if not exists timeouts_per_team integer not null default 2;
alter table if exists public.sport_config add column if not exists allow_yellow_cards boolean not null default false;
alter table if exists public.sport_config add column if not exists allow_red_cards boolean not null default false;
alter table if exists public.sport_config add column if not exists allow_mvp boolean not null default true;
alter table if exists public.sport_config add column if not exists min_players integer not null default 5;
alter table if exists public.sport_config add column if not exists ranking_weight_presence integer not null default 70;
alter table if exists public.sport_config add column if not exists ranking_weight_fairplay integer not null default 30;
alter table if exists public.sport_config add column if not exists created_at timestamptz not null default now();
alter table if exists public.sport_config add column if not exists updated_at timestamptz not null default now();

create unique index if not exists sport_config_sport_unique_idx on public.sport_config (sport_id);

insert into public.sport_config (sport_id)
select s.id
from public.sports s
left join public.sport_config sc on sc.sport_id = s.id
where sc.sport_id is null;

create table if not exists public.events (
  id bigserial primary key,
  sport_id bigint not null references public.sports(id) on delete cascade,
  name text not null,
  unit text not null default 'points',
  sort_order text not null default 'desc',
  is_active boolean not null default true,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_unit_check check (unit in ('time', 'distance', 'points')),
  constraint events_order_check check (sort_order in ('asc', 'desc')),
  constraint events_unique_name_per_sport unique (sport_id, name)
);

alter table if exists public.events add column if not exists unit text not null default 'points';
alter table if exists public.events add column if not exists sort_order text not null default 'desc';
alter table if exists public.events add column if not exists is_active boolean not null default true;
alter table if exists public.events add column if not exists created_by uuid references public.admins(id);
alter table if exists public.events add column if not exists created_at timestamptz not null default now();
alter table if exists public.events add column if not exists updated_at timestamptz not null default now();
create index if not exists events_sport_idx on public.events (sport_id, is_active);

create table if not exists public.event_results (
  id bigserial primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  value numeric(10,3) not null,
  notes text,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_results_unique_per_player unique (event_id, player_id)
);

alter table if exists public.event_results add column if not exists value numeric(10,3);
alter table if exists public.event_results add column if not exists notes text;
alter table if exists public.event_results add column if not exists created_by uuid references public.admins(id);
alter table if exists public.event_results add column if not exists created_at timestamptz not null default now();
alter table if exists public.event_results add column if not exists updated_at timestamptz not null default now();
create index if not exists event_results_event_idx on public.event_results (event_id);
create index if not exists event_results_player_idx on public.event_results (player_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger trg_admins_touch_updated_at before update on public.admins for each row execute function public.touch_updated_at();
create or replace trigger trg_sports_touch_updated_at before update on public.sports for each row execute function public.touch_updated_at();
create or replace trigger trg_teams_touch_updated_at before update on public.teams for each row execute function public.touch_updated_at();
create or replace trigger trg_players_touch_updated_at before update on public.players for each row execute function public.touch_updated_at();
create or replace trigger trg_matches_touch_updated_at before update on public.matches for each row execute function public.touch_updated_at();
create or replace trigger trg_match_stats_touch_updated_at before update on public.match_stats for each row execute function public.touch_updated_at();
create or replace trigger trg_sport_config_touch_updated_at before update on public.sport_config for each row execute function public.touch_updated_at();
create or replace trigger trg_events_touch_updated_at before update on public.events for each row execute function public.touch_updated_at();
create or replace trigger trg_event_results_touch_updated_at before update on public.event_results for each row execute function public.touch_updated_at();

create or replace view public.v_team_standings as
with cfg as (
  select
    s.id as sport_id,
    coalesce(sc.points_win, 3) as points_win,
    coalesce(sc.points_draw, 1) as points_draw,
    coalesce(sc.points_loss, 0) as points_loss
  from public.sports s
  left join public.sport_config sc on sc.sport_id = s.id
),
rows_union as (
  select
    m.sport_id,
    m.home_team_id as team_id,
    m.away_team_id as opponent_id,
    m.home_score as gf,
    m.away_score as ga
  from public.matches m
  where m.is_finished = true and m.home_team_id is not null and m.away_team_id is not null
  union all
  select
    m.sport_id,
    m.away_team_id as team_id,
    m.home_team_id as opponent_id,
    m.away_score as gf,
    m.home_score as ga
  from public.matches m
  where m.is_finished = true and m.home_team_id is not null and m.away_team_id is not null
)
select
  ru.sport_id,
  ru.team_id,
  t.name as team_name,
  count(*)::int as played,
  sum(case when ru.gf > ru.ga then 1 else 0 end)::int as wins,
  sum(case when ru.gf = ru.ga then 1 else 0 end)::int as draws,
  sum(case when ru.gf < ru.ga then 1 else 0 end)::int as losses,
  sum(ru.gf)::int as goals_for,
  sum(ru.ga)::int as goals_against,
  (sum(ru.gf) - sum(ru.ga))::int as goal_diff,
  sum(case when ru.gf > ru.ga then cfg.points_win when ru.gf = ru.ga then cfg.points_draw else cfg.points_loss end)::int as points
from rows_union ru
join public.teams t on t.id = ru.team_id
join cfg on cfg.sport_id = ru.sport_id
group by ru.sport_id, ru.team_id, t.name;

create or replace view public.v_player_ranking as
select
  m.sport_id,
  p.id as player_id,
  p.full_name,
  tm.name as team_name,
  count(ms.id)::int as logs,
  sum(case when ms.played then 1 else 0 end)::int as presences,
  sum(coalesce(ms.fouls, 0))::int as fouls,
  sum(case when coalesce(sc.allow_mvp, true) and ms.is_mvp_vote then 1 else 0 end)::int as mvp_votes,
  greatest(0, (sum(case when ms.played then 10 else 0 end) + sum(case when coalesce(sc.allow_mvp, true) and ms.is_mvp_vote then 15 else 0 end) - sum(coalesce(ms.fouls,0) * 2)))::int as score
from public.players p
join public.teams tm on tm.id = p.team_id
left join public.match_stats ms on ms.player_id = p.id
left join public.matches m on m.id = ms.match_id and m.is_finished = true
left join public.sport_config sc on sc.sport_id = m.sport_id
group by m.sport_id, p.id, p.full_name, tm.name;
create or replace function public.current_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.ruolo from public.admins a where a.id = auth.uid() limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.admins a where a.id = auth.uid());
$$;

create or replace function public.can_manage_matches()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_admin_role() in ('super_admin', 'match_manager'), false);
$$;

create or replace function public.can_view_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_admin_role() in ('super_admin', 'match_manager', 'report_viewer'), false);
$$;

alter table public.admins enable row level security;
alter table public.sports enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_stats enable row level security;
alter table public.sport_config enable row level security;
alter table public.events enable row level security;
alter table public.event_results enable row level security;

drop policy if exists admins_select_own on public.admins;
create policy admins_select_own on public.admins for select using (id = auth.uid() or public.current_admin_role() = 'super_admin');
drop policy if exists admins_write_super on public.admins;
create policy admins_write_super on public.admins for all using (public.current_admin_role() = 'super_admin') with check (public.current_admin_role() = 'super_admin');

drop policy if exists sports_public_read on public.sports;
create policy sports_public_read on public.sports for select using (is_active = true or public.is_admin());
drop policy if exists sports_admin_write on public.sports;
create policy sports_admin_write on public.sports for all using (public.current_admin_role() = 'super_admin') with check (public.current_admin_role() = 'super_admin');

drop policy if exists teams_public_read on public.teams;
create policy teams_public_read on public.teams for select using (exists (select 1 from public.sports s where s.id = sport_id and s.is_active = true) or public.is_admin());
drop policy if exists teams_admin_write on public.teams;
create policy teams_admin_write on public.teams for all using (public.current_admin_role() = 'super_admin') with check (public.current_admin_role() = 'super_admin');

drop policy if exists players_public_read on public.players;
create policy players_public_read on public.players for select using (true);
drop policy if exists players_admin_write on public.players;
create policy players_admin_write on public.players for all using (public.current_admin_role() = 'super_admin') with check (public.current_admin_role() = 'super_admin');

drop policy if exists matches_public_read on public.matches;
create policy matches_public_read on public.matches for select using (is_finished = true or status = 'live' or public.is_admin());
drop policy if exists matches_manage on public.matches;
create policy matches_manage on public.matches for all using (public.can_manage_matches()) with check (public.can_manage_matches());

drop policy if exists match_stats_public_read on public.match_stats;
create policy match_stats_public_read on public.match_stats for select using (
  exists (
    select 1 from public.matches m
    where m.id = match_id and (m.is_finished = true or m.status = 'live' or public.is_admin())
  )
);
drop policy if exists match_stats_manage on public.match_stats;
create policy match_stats_manage on public.match_stats for all using (public.can_manage_matches()) with check (public.can_manage_matches());

drop policy if exists sport_config_read on public.sport_config;
create policy sport_config_read on public.sport_config for select using (true);
drop policy if exists sport_config_manage on public.sport_config;
create policy sport_config_manage on public.sport_config for all using (public.current_admin_role() = 'super_admin') with check (public.current_admin_role() = 'super_admin');

drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events for select using (is_active = true or public.is_admin());
drop policy if exists events_manage on public.events;
create policy events_manage on public.events for all using (public.current_admin_role() = 'super_admin') with check (public.current_admin_role() = 'super_admin');

drop policy if exists event_results_public_read on public.event_results;
create policy event_results_public_read on public.event_results for select using (true);
drop policy if exists event_results_manage on public.event_results;
create policy event_results_manage on public.event_results for all using (public.current_admin_role() in ('super_admin', 'match_manager')) with check (public.current_admin_role() in ('super_admin', 'match_manager'));

create or replace function public.acquire_match_lock(match_id bigint, ttl_seconds integer default 90)
returns table(success boolean, lock_owner uuid, lock_expires_at timestamptz, lock_version integer, status text, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return query select false, null::uuid, null::timestamptz, 0, 'scheduled'::text, 'Utente non autenticato';
    return;
  end if;

  if not public.can_manage_matches() then
    return query select false, null::uuid, null::timestamptz, 0, 'scheduled'::text, 'Permessi insufficienti';
    return;
  end if;

  update public.matches m
  set lock_owner = v_uid,
      lock_expires_at = v_now + make_interval(secs => greatest(ttl_seconds, 20)),
      status = case when m.status = 'finished' then 'finished' else 'live' end,
      started_at = coalesce(m.started_at, v_now)
  where m.id = match_id
    and (m.lock_owner is null or m.lock_expires_at is null or m.lock_expires_at < v_now or m.lock_owner = v_uid)
  returning true, m.lock_owner, m.lock_expires_at, m.lock_version, m.status, 'Lock acquisito'
  into success, lock_owner, lock_expires_at, lock_version, status, message;

  if found then
    return query select success, lock_owner, lock_expires_at, lock_version, status, message;
    return;
  end if;

  select m.lock_owner, m.lock_expires_at, m.lock_version, m.status
  into lock_owner, lock_expires_at, lock_version, status
  from public.matches m
  where m.id = match_id;

  return query select false, lock_owner, lock_expires_at, coalesce(lock_version, 0), coalesce(status, 'scheduled'::text), 'Match già in gestione da altro admin';
end;
$$;

create or replace function public.refresh_match_lock(match_id bigint, ttl_seconds integer default 90)
returns table(success boolean, lock_owner uuid, lock_expires_at timestamptz, lock_version integer, status text, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.matches m
  set lock_expires_at = now() + make_interval(secs => greatest(ttl_seconds, 20))
  where m.id = match_id and m.lock_owner = v_uid
  returning true, m.lock_owner, m.lock_expires_at, m.lock_version, m.status, 'Lock aggiornato'
  into success, lock_owner, lock_expires_at, lock_version, status, message;

  if found then
    return query select success, lock_owner, lock_expires_at, lock_version, status, message;
  else
    return query select false, null::uuid, null::timestamptz, 0, 'scheduled'::text, 'Lock non disponibile';
  end if;
end;
$$;

create or replace function public.release_match_lock(match_id bigint)
returns table(success boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.matches m
  set lock_owner = null,
      lock_expires_at = null,
      status = case when m.is_finished then 'finished' else 'scheduled' end
  where m.id = match_id and m.lock_owner = v_uid;

  if found then
    return query select true, 'Lock rilasciato';
  else
    return query select false, 'Nessun lock da rilasciare';
  end if;
end;
$$;
create or replace function public.save_live_snapshot(match_id bigint, payload jsonb, expected_version integer)
returns table(success boolean, new_version integer, updated_at timestamptz, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.matches m
  set home_score = coalesce((payload ->> 'home_score')::integer, m.home_score),
      away_score = coalesce((payload ->> 'away_score')::integer, m.away_score),
      duration = coalesce((payload ->> 'duration')::integer, m.duration),
      quarter = coalesce((payload ->> 'quarter')::integer, m.quarter),
      live_payload = coalesce(payload, '{}'::jsonb),
      status = 'live',
      lock_version = m.lock_version + 1,
      updated_at = now()
  where m.id = match_id
    and m.lock_owner = v_uid
    and (m.lock_expires_at is null or m.lock_expires_at > now())
    and m.lock_version = expected_version
  returning true, m.lock_version, m.updated_at, 'Snapshot salvato'
  into success, new_version, updated_at, message;

  if found then
    return query select success, new_version, updated_at, message;
  else
    return query select false, null::integer, null::timestamptz, 'Versione lock non valida o lock scaduto';
  end if;
end;
$$;

create or replace function public.finalize_match(match_id bigint, payload jsonb, stats_payload jsonb, expected_version integer)
returns table(success boolean, new_version integer, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_version integer;
begin
  update public.matches m
  set home_score = coalesce(($2 ->> 'home_score')::integer, m.home_score),
      away_score = coalesce(($2 ->> 'away_score')::integer, m.away_score),
      duration = coalesce(($2 ->> 'duration')::integer, m.duration),
      quarter = coalesce(($2 ->> 'quarter')::integer, m.quarter),
      is_finished = true,
      status = 'finished',
      finished_at = now(),
      live_payload = coalesce($2, m.live_payload),
      lock_owner = null,
      lock_expires_at = null,
      lock_version = m.lock_version + 1,
      updated_at = now()
  where m.id = $1
    and m.lock_owner = v_uid
    and m.lock_version = $4
  returning m.lock_version into v_version;

  if not found then
    return query select false, null::integer, 'Finalizzazione fallita: lock/version non validi';
    return;
  end if;

  if jsonb_typeof($3) = 'array' then
    insert into public.match_stats (
      match_id,
      player_id,
      played,
      fouls,
      is_mvp_vote,
      points_scored,
      yellow_cards,
      red_cards
    )
    select
      $1,
      (entry ->> 'player_id')::bigint,
      coalesce((entry ->> 'played')::boolean, false),
      coalesce((entry ->> 'fouls')::integer, 0),
      coalesce((entry ->> 'is_mvp_vote')::boolean, false),
      coalesce((entry ->> 'points_scored')::integer, 0),
      coalesce((entry ->> 'yellow_cards')::integer, 0),
      coalesce((entry ->> 'red_cards')::integer, 0)
    from jsonb_array_elements($3) as entry
    where entry ? 'player_id'
    on conflict (match_id, player_id)
    do update
    set played = excluded.played,
        fouls = excluded.fouls,
        is_mvp_vote = excluded.is_mvp_vote,
        points_scored = excluded.points_scored,
        yellow_cards = excluded.yellow_cards,
        red_cards = excluded.red_cards,
        updated_at = now();
  end if;

  return query select true, v_version, 'Match finalizzato';
end;
$$;

grant execute on function public.current_admin_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_manage_matches() to authenticated;
grant execute on function public.can_view_reports() to authenticated;
grant execute on function public.acquire_match_lock(bigint, integer) to authenticated;
grant execute on function public.refresh_match_lock(bigint, integer) to authenticated;
grant execute on function public.release_match_lock(bigint) to authenticated;
grant execute on function public.save_live_snapshot(bigint, jsonb, integer) to authenticated;
grant execute on function public.finalize_match(bigint, jsonb, jsonb, integer) to authenticated;

-- Compatibilità: copia configurazioni legacy da sport_settings, se presenti
DO $$
begin
  if to_regclass('public.sport_settings') is not null then
    insert into public.sport_config (sport_id, max_fouls, min_players, points_win, points_draw, points_loss)
    select
      s.id,
      coalesce((select ss.value_int from public.sport_settings ss where ss.id = 'max_fouls' limit 1), 3),
      coalesce((select ss.value_int from public.sport_settings ss where ss.id = 'min_players' limit 1), 5),
      coalesce((select ss.value_int from public.sport_settings ss where ss.id = 'points_win' limit 1), 3),
      coalesce((select ss.value_int from public.sport_settings ss where ss.id = 'points_draw' limit 1), 1),
      coalesce((select ss.value_int from public.sport_settings ss where ss.id = 'points_loss' limit 1), 0)
    from public.sports s
    where not exists (
      select 1 from public.sport_config sc where sc.sport_id = s.id
    )
    on conflict (sport_id) do nothing;
  end if;
end;
$$;
