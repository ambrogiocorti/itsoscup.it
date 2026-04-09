-- 003_mvp_config_per_torneo.sql
-- MVP configurabile a livello torneo (sport_config), non per singolo match.

begin;

alter table if exists public.sport_config
  add column if not exists allow_mvp boolean not null default true;

update public.sport_config
set allow_mvp = true
where allow_mvp is null;

drop policy if exists sport_config_manage on public.sport_config;
create policy sport_config_manage
on public.sport_config
for all
using (public.current_admin_role() = 'super_admin')
with check (public.current_admin_role() = 'super_admin');

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
  greatest(
    0,
    (
      sum(case when ms.played then 10 else 0 end) +
      sum(case when coalesce(sc.allow_mvp, true) and ms.is_mvp_vote then 15 else 0 end) -
      sum(coalesce(ms.fouls, 0) * 2)
    )
  )::int as score
from public.players p
join public.teams tm on tm.id = p.team_id
left join public.match_stats ms on ms.player_id = p.id
left join public.matches m on m.id = ms.match_id and m.is_finished = true
left join public.sport_config sc on sc.sport_id = m.sport_id
group by m.sport_id, p.id, p.full_name, tm.name;

commit;
