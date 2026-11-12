-- 058: serialize roster edits with the final confirmation transaction.
-- A share-lock on the sport row prevents confirmation from racing an in-flight edit.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.guard_tournament_roster_lock()'::regprocedure) INTO definition;
 IF definition IS NULL THEN RAISE EXCEPTION 'Roster guard non trovata'; END IF;
 IF position('FOR SHARE' in definition)>0 THEN RETURN; END IF;
 IF position('select exists(select 1 from public.sports' in definition)=0 THEN
  RAISE EXCEPTION 'Guard modificata: revisione manuale richiesta';
 END IF;
 definition:=replace(definition,
  ' select exists(select 1 from public.sports',
  ' perform 1 from public.sports where id in (sport_a,coalesce(sport_b,sport_a)) for share;'||chr(10)||
  ' select exists(select 1 from public.sports');
 EXECUTE definition;
END $migration$;
