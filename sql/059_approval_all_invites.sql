-- 059: an active class invite without approved registration blocks final roster sign-off.
DO $migration$
DECLARE def text;
BEGIN
 SELECT pg_get_functiondef('public.set_tournament_roster_confirmation(bigint,boolean,text)'::regprocedure) INTO def;
 IF def IS NULL THEN RAISE EXCEPTION 'Procedura di conferma rose non trovata'; END IF;
 IF position('Inviti di classe non completati' in def)>0 THEN RETURN; END IF;
 IF position('  update public.sports set roster_confirmed_at=now()' in def)=0 THEN
  RAISE EXCEPTION 'Procedura modificata: revisione necessaria';
 END IF;
 def:=replace(def,'  update public.sports set roster_confirmed_at=now()',
 '  if exists(select 1 from public.class_invites i left join public.class_registrations r on r.invite_id=i.id
    where i.sport_id=p_sport_id and i.is_active and (r.id is null or r.status<>''approved'')) then
    raise exception ''Inviti di classe non completati: verificare tutti gli inviti attivi prima della conferma'';
  end if;'||chr(10)||
 '  update public.sports set roster_confirmed_at=now()');
 EXECUTE def;
END $migration$;
