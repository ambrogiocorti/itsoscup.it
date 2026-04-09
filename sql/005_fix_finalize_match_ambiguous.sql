-- 005_fix_finalize_match_ambiguous.sql
-- Corregge errore RPC:
-- "Finalizzazione match live: column reference \"match_id\" is ambiguous"
--
-- Nota:
-- Manteniamo gli stessi nomi parametri (match_id, payload, stats_payload, expected_version)
-- per compatibilità con chiamata Supabase RPC dal frontend.

begin;

create or replace function public.finalize_match(
  match_id bigint,
  payload jsonb,
  stats_payload jsonb,
  expected_version integer
)
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
  set
    home_score = coalesce(($2 ->> 'home_score')::integer, m.home_score),
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
    set
      played = excluded.played,
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

grant execute on function public.finalize_match(bigint, jsonb, jsonb, integer) to authenticated;

-- refresh schema cache (best effort)
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then null;
end $$;

commit;
