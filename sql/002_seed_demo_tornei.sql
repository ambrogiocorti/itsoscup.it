-- 002_seed_demo_tornei.sql
-- Seed demo idempotente per test funzionale completo (calcio, basket, atletica)

begin;

-- 1) Tornei demo
insert into public.sports (name, year, sport_type, format, gender, has_return_match, is_active)
select 'Demo Calcio Classi Prime 2026', 1, 'calcio', 'gironi', 'Misto', true, true
where not exists (
  select 1 from public.sports
  where name = 'Demo Calcio Classi Prime 2026' and year = 1
);

insert into public.sports (name, year, sport_type, format, gender, has_return_match, is_active)
select 'Demo Basket Biennio 2026', 2, 'basket', 'gironi', 'Misto', true, true
where not exists (
  select 1 from public.sports
  where name = 'Demo Basket Biennio 2026' and year = 2
);

insert into public.sports (name, year, sport_type, format, gender, has_return_match, is_active)
select 'Demo Atletica Istituto 2026', 3, 'atletica', 'gironi', 'Misto', false, true
where not exists (
  select 1 from public.sports
  where name = 'Demo Atletica Istituto 2026' and year = 3
);

-- 2) Configurazioni sport
insert into public.sport_config (
  sport_id,
  points_win,
  points_draw,
  points_loss,
  max_fouls,
  quarters_count,
  quarter_duration_sec,
  min_players,
  ranking_weight_presence,
  ranking_weight_fairplay,
  allow_yellow_cards,
  allow_red_cards,
  allow_mvp,
  volley_sets,
  timeouts_per_team
)
select
  s.id,
  case when s.sport_type = 'basket' then 2 else 3 end as points_win,
  1 as points_draw,
  0 as points_loss,
  case when s.sport_type = 'basket' then 5 else 3 end as max_fouls,
  case when s.sport_type = 'basket' then 4 else 2 end as quarters_count,
  case when s.sport_type = 'basket' then 600 else 900 end as quarter_duration_sec,
  case when s.sport_type = 'atletica' then 1 else 5 end as min_players,
  70,
  30,
  case when s.sport_type = 'calcio' then true else false end as allow_yellow_cards,
  case when s.sport_type = 'calcio' then true else false end as allow_red_cards,
  true as allow_mvp,
  3,
  2
from public.sports s
where s.name in (
  'Demo Calcio Classi Prime 2026',
  'Demo Basket Biennio 2026',
  'Demo Atletica Istituto 2026'
)
on conflict (sport_id) do update
set
  points_win = excluded.points_win,
  points_draw = excluded.points_draw,
  points_loss = excluded.points_loss,
  max_fouls = excluded.max_fouls,
  quarters_count = excluded.quarters_count,
  quarter_duration_sec = excluded.quarter_duration_sec,
  min_players = excluded.min_players,
  ranking_weight_presence = excluded.ranking_weight_presence,
  ranking_weight_fairplay = excluded.ranking_weight_fairplay,
  allow_yellow_cards = excluded.allow_yellow_cards,
  allow_red_cards = excluded.allow_red_cards,
  allow_mvp = excluded.allow_mvp,
  volley_sets = excluded.volley_sets,
  timeouts_per_team = excluded.timeouts_per_team,
  updated_at = now();

-- 3) Squadre demo
with target as (
  select id, name
  from public.sports
  where name in (
    'Demo Calcio Classi Prime 2026',
    'Demo Basket Biennio 2026',
    'Demo Atletica Istituto 2026'
  )
),
payload as (
  select t.id as sport_id, v.team_name
  from target t
  join lateral (
    values
      ('Demo Calcio Classi Prime 2026', '1A'),
      ('Demo Calcio Classi Prime 2026', '1B'),
      ('Demo Calcio Classi Prime 2026', '1C'),
      ('Demo Calcio Classi Prime 2026', '1D'),
      ('Demo Basket Biennio 2026', '2A'),
      ('Demo Basket Biennio 2026', '2B'),
      ('Demo Basket Biennio 2026', '2C'),
      ('Demo Basket Biennio 2026', '2D'),
      ('Demo Atletica Istituto 2026', '3A'),
      ('Demo Atletica Istituto 2026', '3B'),
      ('Demo Atletica Istituto 2026', '3C')
  ) as v(sport_name, team_name) on v.sport_name = t.name
)
insert into public.teams (sport_id, name)
select sport_id, team_name
from payload
on conflict (sport_id, name) do nothing;

-- 4) Giocatori demo (8 per squadra)
with demo_teams as (
  select t.id, t.name
  from public.teams t
  join public.sports s on s.id = t.sport_id
  where s.name in (
    'Demo Calcio Classi Prime 2026',
    'Demo Basket Biennio 2026',
    'Demo Atletica Istituto 2026'
  )
)
insert into public.players (team_id, full_name, student_code)
select
  dt.id,
  format('%s - Studente %s', dt.name, gs.n),
  format('%s-S%s', replace(dt.name, ' ', ''), lpad(gs.n::text, 2, '0'))
from demo_teams dt
cross join generate_series(1, 8) as gs(n)
on conflict (team_id, full_name) do nothing;

-- 5) Match demo (alcuni conclusi, alcuni da giocare)
with calcio as (
  select id as sport_id from public.sports
  where name = 'Demo Calcio Classi Prime 2026' and year = 1
  limit 1
),
basket as (
  select id as sport_id from public.sports
  where name = 'Demo Basket Biennio 2026' and year = 2
  limit 1
),
team_map as (
  select s.name as sport_name, t.name as team_name, t.id as team_id, s.id as sport_id
  from public.teams t
  join public.sports s on s.id = t.sport_id
  where s.name in ('Demo Calcio Classi Prime 2026', 'Demo Basket Biennio 2026')
),
payload as (
  select
    p.sport_id,
    h.team_id as home_team_id,
    a.team_id as away_team_id,
    p.round_name,
    p.is_finished,
    p.home_score,
    p.away_score,
    case when p.is_finished then 'finished' else 'scheduled' end as status,
    case when p.is_finished then now() else null end as finished_at
  from (
    values
      ('Demo Calcio Classi Prime 2026', '1A', '1B', 'Girone (Andata)', true, 2, 1),
      ('Demo Calcio Classi Prime 2026', '1C', '1D', 'Girone (Andata)', true, 0, 0),
      ('Demo Calcio Classi Prime 2026', '1A', '1C', 'Girone (Andata)', false, 0, 0),
      ('Demo Calcio Classi Prime 2026', '1B', '1D', 'Girone (Andata)', false, 0, 0),
      ('Demo Basket Biennio 2026', '2A', '2B', 'Girone (Andata)', true, 58, 52),
      ('Demo Basket Biennio 2026', '2C', '2D', 'Girone (Andata)', true, 61, 64),
      ('Demo Basket Biennio 2026', '2A', '2C', 'Girone (Andata)', false, 0, 0),
      ('Demo Basket Biennio 2026', '2B', '2D', 'Girone (Andata)', false, 0, 0)
  ) as p(sport_name, home_team_name, away_team_name, round_name, is_finished, home_score, away_score)
  join team_map h on h.sport_name = p.sport_name and h.team_name = p.home_team_name
  join team_map a on a.sport_name = p.sport_name and a.team_name = p.away_team_name
)
insert into public.matches (
  sport_id,
  home_team_id,
  away_team_id,
  round_name,
  is_finished,
  status,
  home_score,
  away_score,
  quarter,
  duration,
  live_payload,
  finished_at
)
select
  p.sport_id,
  p.home_team_id,
  p.away_team_id,
  p.round_name,
  p.is_finished,
  p.status,
  p.home_score,
  p.away_score,
  1,
  0,
  '{}'::jsonb,
  p.finished_at
from payload p
where not exists (
  select 1
  from public.matches m
  where m.sport_id = p.sport_id
    and m.round_name = p.round_name
    and least(m.home_team_id, m.away_team_id) = least(p.home_team_id, p.away_team_id)
    and greatest(m.home_team_id, m.away_team_id) = greatest(p.home_team_id, p.away_team_id)
    and m.status <> 'cancelled'
);

-- 6) Statistiche demo per i match conclusi
with finished_demo_matches as (
  select m.id as match_id, m.sport_id, m.home_team_id, m.away_team_id
  from public.matches m
  join public.sports s on s.id = m.sport_id
  where s.name in ('Demo Calcio Classi Prime 2026', 'Demo Basket Biennio 2026')
    and m.is_finished = true
),
players_for_match as (
  select
    fdm.match_id,
    fdm.sport_id,
    p.id as player_id
  from finished_demo_matches fdm
  join public.players p on p.team_id in (fdm.home_team_id, fdm.away_team_id)
)
insert into public.match_stats (
  match_id,
  player_id,
  played,
  fouls,
  is_mvp_vote,
  points_scored
)
select
  pfm.match_id,
  pfm.player_id,
  true,
  mod(abs(hashtextextended(pfm.player_id::text, 0)), 3),
  false,
  case
    when s.sport_type = 'basket' then 4 + mod(abs(hashtextextended((pfm.player_id::text || '-' || pfm.match_id::text), 0)), 18)
    else 0
  end
from players_for_match pfm
join public.sports s on s.id = pfm.sport_id
on conflict (match_id, player_id) do update
set
  played = excluded.played,
  fouls = excluded.fouls,
  points_scored = excluded.points_scored,
  updated_at = now();

-- Un MVP per match demo concluso (sceglie il primo con meno falli)
with pick_mvp as (
  select distinct on (ms.match_id)
    ms.id as match_stat_id
  from public.match_stats ms
  join public.matches m on m.id = ms.match_id and m.is_finished = true
  join public.sports s on s.id = m.sport_id
  where s.name in ('Demo Calcio Classi Prime 2026', 'Demo Basket Biennio 2026')
  order by ms.match_id, ms.fouls asc, ms.player_id asc
)
update public.match_stats ms
set is_mvp_vote = true,
    updated_at = now()
from pick_mvp pm
where ms.id = pm.match_stat_id;

-- 7) Eventi atletica demo
with ath_sport as (
  select id as sport_id
  from public.sports
  where name = 'Demo Atletica Istituto 2026' and year = 3
  limit 1
),
payload as (
  select
    sport_id,
    event_name,
    unit,
    sort_order
  from ath_sport
  cross join (
    values
      ('100m piani', 'time', 'asc'),
      ('Salto in lungo', 'distance', 'desc'),
      ('Lancio vortex', 'points', 'desc')
  ) as v(event_name, unit, sort_order)
)
insert into public.events (sport_id, name, unit, sort_order, is_active)
select sport_id, event_name, unit, sort_order, true
from payload
on conflict (sport_id, name) do update
set
  unit = excluded.unit,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- 8) Risultati atletica demo
with ath_sport as (
  select id
  from public.sports
  where name = 'Demo Atletica Istituto 2026' and year = 3
  limit 1
),
ath_events as (
  select e.id, e.name
  from public.events e
  join ath_sport s on s.id = e.sport_id
  where e.is_active = true
),
ath_players as (
  select
    p.id as player_id,
    row_number() over (order by t.name, p.full_name) as rn
  from public.players p
  join public.teams t on t.id = p.team_id
  join ath_sport s on s.id = t.sport_id
)
insert into public.event_results (event_id, player_id, value, notes)
select
  e.id as event_id,
  p.player_id,
  case
    when e.name = '100m piani' then round((12.500 + (p.rn * 0.170))::numeric, 3)
    when e.name = 'Salto in lungo' then round((4.000 + (p.rn * 0.130))::numeric, 3)
    else round((20.000 + (p.rn * 1.100))::numeric, 3)
  end as value,
  'Dato demo generato automaticamente' as notes
from ath_events e
join ath_players p on p.rn <= 12
on conflict (event_id, player_id) do update
set
  value = excluded.value,
  notes = excluded.notes,
  updated_at = now();

commit;
