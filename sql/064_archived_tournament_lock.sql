-- 064: un torneo archiviato nell'Albo d'Oro è in sola lettura.
-- Finora l'archiviazione salvava solo la voce in honor_roll_entries: partite, squadre,
-- atleti ed eventi di atletica restavano modificabili. Ora il database rifiuta ogni
-- modifica finché la voce dell'Albo esiste. Per correggere un torneo: disarchiviarlo
-- dalla sezione Albo, correggere e archiviarlo di nuovo.
-- Nessun dato esistente viene modificato. Verificare prima in un ambiente di prova.
begin;

create or replace function public.is_sport_archived(p_sport_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
  select p_sport_id is not null
     and exists(select 1 from public.honor_roll_entries h where h.sport_id = p_sport_id);
$$;
revoke all on function public.is_sport_archived(bigint) from public;
grant execute on function public.is_sport_archived(bigint) to anon, authenticated;

create or replace function public.guard_archived_tournament()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  sid_new bigint;
  sid_old bigint;
begin
  if tg_table_name in ('events', 'teams', 'matches', 'athletics_entries') then
    if tg_op <> 'DELETE' then sid_new := new.sport_id; end if;
    if tg_op <> 'INSERT' then sid_old := old.sport_id; end if;
  elsif tg_table_name = 'event_results' then
    if tg_op <> 'DELETE' then select e.sport_id into sid_new from public.events e where e.id = new.event_id; end if;
    if tg_op <> 'INSERT' then select e.sport_id into sid_old from public.events e where e.id = old.event_id; end if;
  elsif tg_table_name = 'players' then
    if tg_op <> 'DELETE' then select t.sport_id into sid_new from public.teams t where t.id = new.team_id; end if;
    if tg_op <> 'INSERT' then select t.sport_id into sid_old from public.teams t where t.id = old.team_id; end if;
  else
    return coalesce(new, old);
  end if;

  if public.is_sport_archived(sid_new) or public.is_sport_archived(sid_old) then
    raise exception 'Torneo archiviato: è in sola lettura. Disarchivialo dalla sezione Albo per correggerlo.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['events', 'event_results', 'athletics_entries', 'teams', 'players', 'matches'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists guard_archived_tournament on public.%I', t);
      execute format('create trigger guard_archived_tournament before insert or update or delete on public.%I
                      for each row execute function public.guard_archived_tournament()', t);
    end if;
  end loop;
end $$;

commit;
