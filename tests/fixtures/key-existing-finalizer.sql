-- Existing production finalizer definition inspected as metadata only on 2026-10-14.
-- Tests create only synthetic roster/match rows in an ephemeral PostgreSQL database.
CREATE OR REPLACE FUNCTION public.finalize_match_with_signatures(match_id bigint, payload jsonb, stats_payload jsonb, signatures_payload jsonb, expected_version integer)
 RETURNS TABLE(success boolean, new_version integer, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_match record;
  v_home_signature jsonb;
  v_away_signature jsonb;
  v_home_captain record;
  v_away_captain record;
  v_version integer;
begin
  if v_uid is null or not public.can_manage_matches() then
    return query select false, null::integer, 'Permessi insufficienti';
    return;
  end if;

  select m.*
  into v_match
  from public.matches as m
  where m.id = $1
  for update;

  if not found then
    return query select false, null::integer, 'Match non trovato';
    return;
  end if;

  if v_match.is_finished then
    return query select false, null::integer, 'Match gia finalizzato';
    return;
  end if;

  if v_match.lock_owner is distinct from v_uid or v_match.lock_version <> $5 then
    return query select false, null::integer, 'Finalizzazione fallita: lock/version non validi';
    return;
  end if;

  select p.id, p.full_name
  into v_home_captain
  from public.players as p
  where p.team_id = v_match.home_team_id
    and p.is_captain = true
  limit 1;

  select p.id, p.full_name
  into v_away_captain
  from public.players as p
  where p.team_id = v_match.away_team_id
    and p.is_captain = true
  limit 1;

  if v_home_captain.id is null or v_away_captain.id is null then
    return query select false, null::integer, 'Imposta un capitano per entrambe le squadre prima di chiudere il match';
    return;
  end if;

  if jsonb_typeof($4) is distinct from 'array' then
    return query select false, null::integer, 'Firme capitani mancanti';
    return;
  end if;

  select signature_entry.entry
  into v_home_signature
  from jsonb_array_elements($4) as signature_entry(entry)
  where signature_entry.entry ->> 'team_side' = 'home'
  limit 1;

  select signature_entry.entry
  into v_away_signature
  from jsonb_array_elements($4) as signature_entry(entry)
  where signature_entry.entry ->> 'team_side' = 'away'
  limit 1;

  if v_home_signature is null or v_away_signature is null then
    return query select false, null::integer, 'Servono entrambe le firme dei capitani';
    return;
  end if;

  if (v_home_signature ->> 'player_id')::bigint is distinct from v_home_captain.id then
    return query select false, null::integer, 'Firma capitano casa non coerente con il roster';
    return;
  end if;

  if (v_away_signature ->> 'player_id')::bigint is distinct from v_away_captain.id then
    return query select false, null::integer, 'Firma capitano ospite non coerente con il roster';
    return;
  end if;

  if length(coalesce(v_home_signature ->> 'signature_data_url', '')) < 80
     or length(coalesce(v_away_signature ->> 'signature_data_url', '')) < 80 then
    return query select false, null::integer, 'Firma elettronica non valida';
    return;
  end if;

  update public.matches as m
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
    and m.lock_version = $5
  returning m.lock_version into v_version;

  if not found then
    return query select false, null::integer, 'Finalizzazione fallita: lock/version non validi';
    return;
  end if;

  insert into public.match_captain_signatures (
    match_id,
    team_side,
    team_id,
    player_id,
    captain_name,
    signature_data_url,
    signature_payload,
    signed_by,
    signed_at
  )
  values
    (
      $1,
      'home',
      v_match.home_team_id,
      v_home_captain.id,
      v_home_captain.full_name,
      v_home_signature ->> 'signature_data_url',
      v_home_signature,
      v_uid,
      coalesce((v_home_signature ->> 'signed_at')::timestamptz, now())
    ),
    (
      $1,
      'away',
      v_match.away_team_id,
      v_away_captain.id,
      v_away_captain.full_name,
      v_away_signature ->> 'signature_data_url',
      v_away_signature,
      v_uid,
      coalesce((v_away_signature ->> 'signed_at')::timestamptz, now())
    )
  on conflict (match_id, team_side)
  do update
  set team_id = excluded.team_id,
      player_id = excluded.player_id,
      captain_name = excluded.captain_name,
      signature_data_url = excluded.signature_data_url,
      signature_payload = excluded.signature_payload,
      signed_by = excluded.signed_by,
      signed_at = excluded.signed_at;

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
      (stat_entry.entry ->> 'player_id')::bigint,
      coalesce((stat_entry.entry ->> 'played')::boolean, false),
      coalesce((stat_entry.entry ->> 'fouls')::integer, 0),
      coalesce((stat_entry.entry ->> 'is_mvp_vote')::boolean, false),
      coalesce((stat_entry.entry ->> 'points_scored')::integer, 0),
      coalesce((stat_entry.entry ->> 'yellow_cards')::integer, 0),
      coalesce((stat_entry.entry ->> 'red_cards')::integer, 0)
    from jsonb_array_elements($3) as stat_entry(entry)
    where stat_entry.entry ? 'player_id'
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

  return query select true, v_version, 'Match finalizzato con firme capitani';
end;
$function$

