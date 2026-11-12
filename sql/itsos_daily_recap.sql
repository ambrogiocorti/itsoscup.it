-- Nightly, privacy-preserving team-level recaps, Europe/Rome DST-safe.
create table if not exists public.itsos_daily_recaps (
 recap_date date primary key,
 match_count integer not null default 0,
 results jsonb not null default '[]'::jsonb,
 closest jsonb not null default '[]'::jsonb,
 upcoming jsonb not null default '[]'::jsonb,
 generated_at timestamptz not null default now()
);
alter table public.itsos_daily_recaps enable row level security;
revoke all on public.itsos_daily_recaps from anon;
grant select on public.itsos_daily_recaps to authenticated;
drop policy if exists itsos_daily_recaps_staff_read on public.itsos_daily_recaps;
create policy itsos_daily_recaps_staff_read on public.itsos_daily_recaps
for select to authenticated using (
 public.is_admin_role(array['super_admin','report_viewer'])
);
create or replace function public.itsos_generate_daily_recap(p_date date default null)
returns date language plpgsql security invoker set search_path='' as $$
declare
 v_day date := coalesce(p_date, (now() at time zone 'Europe/Rome')::date);
begin
 -- Cron runs every hour so local 21:05 is correct even when Italy enters/exits DST.
 if p_date is null and extract(hour from (now() at time zone 'Europe/Rome'))<>21 then
   return null;
 end if;
 insert into public.itsos_daily_recaps(recap_date,match_count,results,closest,upcoming,generated_at)
 select
 v_day,
 (select count(*)::integer from public.matches m where m.is_finished
   and (coalesce(m.finished_at,m.scheduled_start,m.updated_at) at time zone 'Europe/Rome')::date=v_day),
 coalesce((
    select jsonb_agg(r.item order by r.start_time nulls last,r.match_id)
    from (
      select m.id match_id,m.scheduled_start start_time,
        jsonb_build_object('match_id',m.id,'sport',coalesce(s.name,'Torneo'),
          'home',coalesce(h.name,'Casa'),'away',coalesce(a.name,'Ospiti'),
          'home_score',m.home_score,'away_score',m.away_score,
          'venue',coalesce(v.name,'Campo da definire'),'time',m.scheduled_start) item
      from public.matches m
      left join public.teams h on h.id=m.home_team_id
      left join public.teams a on a.id=m.away_team_id
      left join public.sports s on s.id=m.sport_id
      left join public.venues v on v.id=m.venue_id
      where m.is_finished and
        (coalesce(m.finished_at,m.scheduled_start,m.updated_at) at time zone 'Europe/Rome')::date=v_day
    ) r
 ),'[]'::jsonb),
 coalesce((
    select jsonb_agg(r.item order by r.margin,r.match_id)
    from (
      select m.id match_id,abs(coalesce(m.home_score,0)-coalesce(m.away_score,0)) margin,
        jsonb_build_object('match_id',m.id,'home',h.name,'away',a.name,
          'home_score',m.home_score,'away_score',m.away_score,'sport',s.name) item
      from public.matches m
      left join public.teams h on h.id=m.home_team_id
      left join public.teams a on a.id=m.away_team_id
      left join public.sports s on s.id=m.sport_id
      where m.is_finished and (coalesce(m.finished_at,m.scheduled_start,m.updated_at) at time zone 'Europe/Rome')::date=v_day
      order by margin,m.id limit 3
    ) r
 ),'[]'::jsonb),
 coalesce((
    select jsonb_agg(r.item order by r.start_time,r.match_id)
    from (
      select m.id match_id,m.scheduled_start start_time,
        jsonb_build_object('match_id',m.id,'sport',s.name,'home',h.name,'away',a.name,
          'venue',coalesce(v.name,'Campo da definire'),'time',m.scheduled_start) item
      from public.matches m
      left join public.teams h on h.id=m.home_team_id
      left join public.teams a on a.id=m.away_team_id
      left join public.sports s on s.id=m.sport_id
      left join public.venues v on v.id=m.venue_id
      where not m.is_finished and m.scheduled_start is not null
        and (m.scheduled_start at time zone 'Europe/Rome')::date>v_day
      order by m.scheduled_start,m.id limit 10
    ) r
 ),'[]'::jsonb),
 now()
 on conflict (recap_date) do update
 set match_count=excluded.match_count,results=excluded.results,
 closest=excluded.closest,upcoming=excluded.upcoming,generated_at=now();
 return v_day;
end;$$;
revoke all on function public.itsos_generate_daily_recap(date) from public,anon,authenticated;
-- The database cron worker executes the function as its privileged owner.
select cron.schedule('itsos-daily-recap-rome-21','5 * * * *',
  'select public.itsos_generate_daily_recap();');
