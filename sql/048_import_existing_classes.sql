-- Bridge tournaments already containing teams with the new class-based notices.
-- Explicit administrator action; existing registrations are never overwritten.
begin;
create or replace function public.import_existing_teams_as_classes(p_sport_id bigint)
returns integer language plpgsql security definer set search_path='' as $$
declare v_added integer;
begin
  if auth.uid() is null or public.current_admin_role() <> 'super_admin' then
    raise exception 'Solo il super admin puo collegare le squadre esistenti';
  end if;
  if not exists(select 1 from public.sports where id=p_sport_id) then
    raise exception 'Torneo non trovato';
  end if;
  with distinct_teams as (
    select distinct on (lower(btrim(t.name))) t.id, t.name
    from public.teams t where t.sport_id=p_sport_id
      and char_length(btrim(t.name)) between 2 and 48
    order by lower(btrim(t.name)), t.id
  )
  insert into public.class_invites(sport_id,class_name)
  select p_sport_id,btrim(dt.name) from distinct_teams dt
  on conflict do nothing;
  get diagnostics v_added = row_count;

  with distinct_teams as (
    select distinct on (lower(btrim(t.name))) t.id, t.name
    from public.teams t where t.sport_id=p_sport_id
      and char_length(btrim(t.name)) between 2 and 48
    order by lower(btrim(t.name)),t.id
  ),
  rosters as (
    select dt.id as team_id, dt.name,
      coalesce(jsonb_agg(p.full_name order by p.id)
        filter(where p.id is not null),'[]'::jsonb) as roster,
      coalesce(max(p.full_name) filter(where p.is_captain),max(p.full_name),'Da indicare') as captain
    from distinct_teams dt
    left join public.players p on p.team_id=dt.id
    group by dt.id,dt.name
  )
  insert into public.class_registrations(invite_id,sport_id,class_name,roster,captain_name,status,team_id,decided_by,decided_at)
  select ci.id,p_sport_id,ci.class_name,r.roster,r.captain,'approved',r.team_id,auth.uid(),now()
  from rosters r join public.class_invites ci on ci.sport_id=p_sport_id
    and lower(btrim(ci.class_name))=lower(btrim(r.name))
  where not exists (select 1 from public.class_registrations cr where cr.invite_id=ci.id)
  on conflict(invite_id) do nothing;
  return v_added;
end $$;
revoke all on function public.import_existing_teams_as_classes(bigint) from public,anon;
grant execute on function public.import_existing_teams_as_classes(bigint) to authenticated;
commit;