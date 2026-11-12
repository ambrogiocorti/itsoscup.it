-- 054: only labelled Andata fixtures block Ritorno. Knockout games are later phases,
-- not first-leg games. Protects mixed group/playoff tournaments.
DO $migration$
DECLARE source text;
BEGIN
 SELECT pg_get_functiondef('public.assert_smart_schedule_fairness(bigint)'::regprocedure) INTO source;
 IF source IS NULL THEN RAISE EXCEPTION 'Validator non trovato'; END IF;
 IF position('coalesce(f.round_name,'''') ~* ''andata''' in source)>0 THEN RETURN; END IF;
 IF position('coalesce(f.round_name,'''') !~* ''ritorno''' in source)=0 THEN
  RAISE EXCEPTION 'Validator modificato: evitare sovrascrittura';
 END IF;
 source:=replace(source,
  'coalesce(f.round_name,'''') !~* ''ritorno''',
  'coalesce(f.round_name,'''') ~* ''andata''');
 EXECUTE source;
END $migration$;
