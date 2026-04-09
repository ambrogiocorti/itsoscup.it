-- 001_refactor_hybrid_rollback.sql
-- Rollback conservativo: rimuove funzioni/vista/policy introdotte senza distruggere dati esistenti.

drop view if exists public.v_player_ranking;
drop view if exists public.v_team_standings;

drop function if exists public.finalize_match(bigint, jsonb, jsonb, integer);
drop function if exists public.save_live_snapshot(bigint, jsonb, integer);
drop function if exists public.release_match_lock(bigint);
drop function if exists public.refresh_match_lock(bigint, integer);
drop function if exists public.acquire_match_lock(bigint, integer);
drop function if exists public.can_view_reports();
drop function if exists public.can_manage_matches();
drop function if exists public.is_admin();
drop function if exists public.current_admin_role();

drop policy if exists admins_select_own on public.admins;
drop policy if exists admins_write_super on public.admins;
drop policy if exists sports_public_read on public.sports;
drop policy if exists sports_admin_write on public.sports;
drop policy if exists teams_public_read on public.teams;
drop policy if exists teams_admin_write on public.teams;
drop policy if exists players_public_read on public.players;
drop policy if exists players_admin_write on public.players;
drop policy if exists matches_public_read on public.matches;
drop policy if exists matches_manage on public.matches;
drop policy if exists match_stats_public_read on public.match_stats;
drop policy if exists match_stats_manage on public.match_stats;
drop policy if exists sport_config_read on public.sport_config;
drop policy if exists sport_config_manage on public.sport_config;
drop policy if exists events_public_read on public.events;
drop policy if exists events_manage on public.events;
drop policy if exists event_results_public_read on public.event_results;
drop policy if exists event_results_manage on public.event_results;

alter table if exists public.admins disable row level security;
alter table if exists public.sports disable row level security;
alter table if exists public.teams disable row level security;
alter table if exists public.players disable row level security;
alter table if exists public.matches disable row level security;
alter table if exists public.match_stats disable row level security;
alter table if exists public.sport_config disable row level security;
alter table if exists public.events disable row level security;
alter table if exists public.event_results disable row level security;

