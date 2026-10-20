-- 053: validate the *final* tournament schedule, including unchanged fixtures.
-- Server-side checks complement (not replace) existing overlap, role and version guards.
CREATE OR REPLACE FUNCTION public.assert_smart_schedule_fairness(p_sport_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_max_duration interval;
BEGIN
  -- This internal validator is intentionally only callable by the privileged
  -- publication RPC and uses the batch already checked against original versions.
  -- Include unchanged games, not merely the incoming edits.
  IF EXISTS (
    WITH final AS (
      SELECT m.id,m.round_name,
             CASE WHEN b.match_id IS NOT NULL THEN b.scheduled_start ELSE m.scheduled_start END AS starts,
             CASE WHEN b.match_id IS NOT NULL THEN b.scheduled_end ELSE m.scheduled_end END AS ends
      FROM public.matches m LEFT JOIN pg_temp.smart_schedule_batch b ON b.match_id=m.id
      WHERE m.sport_id=p_sport_id AND m.status <> 'cancelled'
    ),
    returns AS (SELECT min(starts) first_return FROM final WHERE round_name ~* 'ritorno' AND starts IS NOT NULL)
    SELECT 1 FROM final f CROSS JOIN returns r
    WHERE r.first_return IS NOT NULL
      AND coalesce(f.round_name,'') !~* 'ritorno'
      AND (f.starts IS NULL OR f.ends IS NULL OR f.ends>r.first_return)
  ) THEN
    RAISE EXCEPTION 'Calendario non pubblicabile: tutte le gare di andata devono terminare prima del ritorno';
  END IF;

  -- A wave is a distinct start time within the same school day, regardless
  -- of venue. A team may appear in at most two adjacent waves; distant slots
  -- separated by a real recovery period are not considered consecutive.
  IF EXISTS (
    WITH final AS (
      SELECT m.id,m.home_team_id,m.away_team_id,
        CASE WHEN b.match_id IS NOT NULL THEN b.scheduled_start ELSE m.scheduled_start END AS starts,
        CASE WHEN b.match_id IS NOT NULL THEN b.scheduled_end ELSE m.scheduled_end END AS ends
      FROM public.matches m LEFT JOIN pg_temp.smart_schedule_batch b ON b.match_id=m.id
      WHERE m.sport_id=p_sport_id AND m.status <> 'cancelled'
    ), slots AS (
      SELECT DISTINCT (starts AT TIME ZONE 'Europe/Rome')::date AS game_day,starts
      FROM final WHERE starts IS NOT NULL AND ends IS NOT NULL
    ), numbered AS (
      SELECT game_day,starts,
        row_number() OVER(PARTITION BY game_day ORDER BY starts) AS wave
      FROM slots
    ), appearances AS (
      SELECT f.home_team_id team_id,n.game_day,n.wave,n.starts,
        extract(epoch FROM(f.ends-f.starts)) AS duration_sec
      FROM final f JOIN numbered n ON n.starts=f.starts
      WHERE f.home_team_id IS NOT NULL
      UNION ALL
      SELECT f.away_team_id team_id,n.game_day,n.wave,n.starts,
        extract(epoch FROM(f.ends-f.starts)) AS duration_sec
      FROM final f JOIN numbered n ON n.starts=f.starts
      WHERE f.away_team_id IS NOT NULL
    ), trailing AS (
      SELECT team_id,game_day,wave,starts,duration_sec,
        lag(wave) OVER (PARTITION BY team_id,game_day ORDER BY starts) prev_wave,
        lag(wave,2) OVER (PARTITION BY team_id,game_day ORDER BY starts) prev2_wave,
        lag(starts) OVER (PARTITION BY team_id,game_day ORDER BY starts) prev_start,
        lag(starts,2) OVER (PARTITION BY team_id,game_day ORDER BY starts) prev2_start,
        lag(duration_sec) OVER (PARTITION BY team_id,game_day ORDER BY starts) prev_duration,
        lag(duration_sec,2) OVER (PARTITION BY team_id,game_day ORDER BY starts) prev2_duration
      FROM appearances
    )
    SELECT 1 FROM trailing
    WHERE prev_wave=wave-1 AND prev2_wave=wave-2
      AND starts-prev_start <= make_interval(secs=>greatest(duration_sec,prev_duration)*2+900)
      AND prev_start-prev2_start <= make_interval(secs=>greatest(prev_duration,prev2_duration)*2+900)
  ) THEN
    RAISE EXCEPTION 'Calendario non pubblicabile: una squadra giocherebbe tre turni consecutivi anche considerando campi diversi';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_smart_schedule_fairness(bigint) FROM PUBLIC,anon,authenticated;

-- Refuse to guess or overwrite a different RPC definition. This leaves all
-- existing optimistic locking, per-match checks and transaction boundaries intact.
DO $migration$
DECLARE original text;
BEGIN
 SELECT pg_get_functiondef('public.apply_smart_schedule(bigint,jsonb)'::regprocedure) INTO original;
 IF original IS NULL THEN RAISE EXCEPTION 'RPC apply_smart_schedule non trovata'; END IF;
 IF position('perform public.assert_smart_schedule_fairness(p_sport_id)' in original)>0 THEN RETURN; END IF;
 IF position('  -- Gli spostamenti piu' in original)=0 THEN RAISE EXCEPTION 'RPC modificata: controllare manualmente prima di applicare'; END IF;
 original:=replace(original,
   '  -- Gli spostamenti piu',
   '  perform public.assert_smart_schedule_fairness(p_sport_id);'||chr(10)||'  -- Gli spostamenti piu');
 EXECUTE original;
END $migration$;
COMMENT ON FUNCTION public.assert_smart_schedule_fairness(bigint) IS 'Validator interno: andata prima del ritorno e max due turni consecutivi nello stesso giorno anche su campi differenti.';
