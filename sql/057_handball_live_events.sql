-- 057: event-type taxonomy for the school handball match report.
-- Existing live events remain unchanged.
DO $migration$
DECLARE def text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
 WHERE conrelid='public.live_match_events'::regclass AND conname='live_match_events_type_check';
 IF def IS NULL THEN RAISE EXCEPTION 'Vincolo live_match_events_type_check non trovato'; END IF;
 IF position('two_minute' in def)>0 THEN RETURN; END IF;
 IF position('starter' in def)=0 OR position('yellow_card' in def)=0 THEN
  RAISE EXCEPTION 'Tipi evento cambiati: controllare il vincolo originale';
 END IF;
 ALTER TABLE public.live_match_events DROP CONSTRAINT live_match_events_type_check;
 ALTER TABLE public.live_match_events ADD CONSTRAINT live_match_events_type_check
 CHECK(event_type IN ('starter','substitution','score','foul','yellow_card','red_card',
 'timeout','note','two_minute','seven_meter'));
END $migration$;
