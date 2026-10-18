-- ITSOSCup: pubblicazione atomica di un'anteprima di calendario (solo Super Admin).
-- Non modifica i dati finche' l'amministratore non conferma la proposta.
create or replace function public.apply_smart_schedule(p_sport_id bigint, p_changes jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  r record;
begin
  if auth.uid() is null or not public.can_manage_all() then
    raise exception 'Solo il Super Admin puo pubblicare un calendario';
  end if;
  if p_sport_id is null or jsonb_typeof(p_changes) is distinct from 'array'
    or jsonb_array_length(p_changes) < 1 or jsonb_array_length(p_changes) > 200 then
    raise exception 'Proposta non valida (1-200 incontri)';
  end if;
  -- Serializza la pubblicazione rispetto ad altre modifiche delle partite.
  lock table public.matches in share row exclusive mode;
  create temporary table if not exists smart_schedule_batch (
    match_id bigint primary key,
    venue_id bigint not null,
    scheduled_start timestamptz not null,
    scheduled_end timestamptz not null,
    original_start timestamptz,
    original_end timestamptz,
    original_venue_id bigint
  ) on commit drop;
  truncate table pg_temp.smart_schedule_batch;
  insert into pg_temp.smart_schedule_batch
  select match_id, venue_id, scheduled_start, scheduled_end,
         original_start, original_end, original_venue_id
  from jsonb_to_recordset(p_changes) as x(
    match_id bigint, venue_id bigint,
    scheduled_start timestamptz, scheduled_end timestamptz,
    original_start timestamptz, original_end timestamptz,
    original_venue_id bigint
  );
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_changes) then
    raise exception 'La proposta contiene incontri ripetuti';
  end if;
  if exists (
    select 1
    from pg_temp.smart_schedule_batch b
    left join public.matches m on m.id = b.match_id
    left join public.venues v on v.id = b.venue_id
    where m.id is null or m.sport_id <> p_sport_id
      or coalesce(m.is_finished, false)
      or m.status in ('live', 'in_progress', 'cancelled', 'finished')
      or m.started_at is not null
      or m.home_team_id is null or m.away_team_id is null
      or m.home_team_id = m.away_team_id
      or m.scheduled_start is distinct from b.original_start
      or m.scheduled_end is distinct from b.original_end
      or m.venue_id is distinct from b.original_venue_id
      or v.id is null or not v.is_active
      or b.scheduled_end <= b.scheduled_start
      or b.scheduled_start < now() - interval '1 minute'
  ) then
    raise exception 'Incontri, campi, orari o versione del calendario non validi: aggiorna anteprima';
  end if;
  -- Validazione globale: conflitti interni al batch.
  if exists (
    select 1
    from pg_temp.smart_schedule_batch a
    join pg_temp.smart_schedule_batch b on a.match_id < b.match_id
    join public.matches ma on ma.id = a.match_id
    join public.matches mb on mb.id = b.match_id
    where tstzrange(a.scheduled_start,a.scheduled_end,'[)') &&
          tstzrange(b.scheduled_start,b.scheduled_end,'[)')
      and (a.venue_id = b.venue_id
        or ma.home_team_id in (mb.home_team_id,mb.away_team_id)
        or ma.away_team_id in (mb.home_team_id,mb.away_team_id))
  ) then
    raise exception 'La proposta contiene sovrapposizioni di squadra o campo';
  end if;
  -- Validazione globale: conflitti con gli incontri non modificati.
  if exists (
    select 1
    from pg_temp.smart_schedule_batch b
    join public.matches target on target.id = b.match_id
    join public.matches other on other.id <> b.match_id
      and other.status <> 'cancelled'
      and other.scheduled_start is not null and other.scheduled_end is not null
      and not exists (
        select 1 from pg_temp.smart_schedule_batch sub where sub.match_id = other.id
      )
      and tstzrange(b.scheduled_start,b.scheduled_end,'[)') &&
          tstzrange(other.scheduled_start,other.scheduled_end,'[)')
      and (b.venue_id = other.venue_id
        or target.home_team_id in (other.home_team_id,other.away_team_id)
        or target.away_team_id in (other.home_team_id,other.away_team_id))
  ) then
    raise exception 'Conflitto con incontri esterni alla proposta: rigenera anteprima';
  end if;
  -- Gli spostamenti piu' in avanti si applicano per primi: un solo UPDATE
  -- per match, cosi' audit e notifiche vedono il calendario definitivo.
  -- Se un trigger rifiuta uno spostamento, l'intera transazione viene annullata.
  for r in
    select * from pg_temp.smart_schedule_batch
    order by scheduled_start desc, match_id desc
  loop
    update public.matches
      set venue_id = r.venue_id,
          scheduled_start = r.scheduled_start,
          scheduled_end = r.scheduled_end
    where id = r.match_id;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.apply_smart_schedule(bigint,jsonb) from public, anon;
grant execute on function public.apply_smart_schedule(bigint,jsonb) to authenticated;
comment on function public.apply_smart_schedule(bigint,jsonb)
 is 'Pubblica in modo atomico una proposta validata, con controllo ruoli e optimistic locking.';
