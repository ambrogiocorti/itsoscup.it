-- 060: Public standings and athlete rankings must obey the invoker's RLS.
-- PostgreSQL 15+ supports security_invoker=true on views; ITSOSCup uses PG17.
DO $guard$
BEGIN
 IF to_regclass('public.v_team_standings') IS NULL OR to_regclass('public.v_player_ranking') IS NULL THEN
  RAISE EXCEPTION 'Viste di classifica attese non trovate';
 END IF;
 IF NOT (has_table_privilege('anon','public.sport_config','SELECT')
    AND has_table_privilege('anon','public.matches','SELECT')
    AND has_table_privilege('anon','public.teams','SELECT')
    AND has_table_privilege('anon','public.players','SELECT')
    AND has_table_privilege('anon','public.match_stats','SELECT')) THEN
  RAISE EXCEPTION 'Permessi pubblici delle tabelle sottostanti non verificati';
 END IF;
END $guard$;
ALTER VIEW public.v_team_standings SET (security_invoker = true);
ALTER VIEW public.v_player_ranking SET (security_invoker = true);
COMMENT ON VIEW public.v_team_standings IS 'Classifica calcolata rispettando le policy RLS della sessione chiamante';
COMMENT ON VIEW public.v_player_ranking IS 'Classifica giocatori rispettando le policy RLS della sessione chiamante';
