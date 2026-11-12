-- 061: stop unauthenticated callers invoking privileged SECURITY DEFINER RPCs.
-- Public class-portal and public notification functions intentionally remain anonymous.
DO $guard$
DECLARE f record; altered integer:=0;
BEGIN
 FOR f IN
  SELECT p.oid::regprocedure signature FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND p.proname = ANY(ARRAY['acquire_match_lock','apply_late_finish_autoshift','approve_match_official_admin','assign_match_device_admin','confirm_disciplinary_suspension','create_live_event','create_platform_backup','detect_match_delays','finalize_match','finalize_match_with_signatures','generate_internal_notifications','get_admin_today_overview','get_current_admin_profile','get_regia_operational_snapshot','list_issue_reports','refresh_match_lock','register_device','release_match_lock','reopen_match_for_correction','restore_platform_backup','resume_emergency_regia','save_live_snapshot','save_manual_match_admin','save_sport_admin','save_team_admin','set_match_operational_status','set_platform_setting_admin','set_registered_device_admin','set_venue_operational_status','suspend_all_matches_regia','upsert_match_checkin','validate_pre_event'])
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.signature);
  altered:=altered+1;
 END LOOP;
 IF altered<30 THEN
  RAISE EXCEPTION 'Solo % funzioni trovate: verificare le firme SQL prima di applicare',altered;
 END IF;
END $guard$;
