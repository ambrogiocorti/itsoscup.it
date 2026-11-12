-- ITSOSCup security: remove legacy permissive RLS rules without dropping public reads.
-- This migration is safe to re-run. Existing admin RPCs already enforce roles.
begin;
drop policy if exists "Allow all" on public.sports;
drop policy if exists "Allow all" on public.teams;
drop policy if exists "Allow all" on public.players;
drop policy if exists "Allow all" on public.matches;
drop policy if exists "Allow all" on public.match_stats;

-- These historical policies let a report_viewer write tournament metadata.
drop policy if exists "Admin only insert" on public.sports;
drop policy if exists "Admin only update" on public.sports;
drop policy if exists "Admin only delete" on public.sports;

-- Keep public SELECT policies (schedule/results/teams/players) intact.
-- Explicitly remove anonymous write privileges for high-value tables.
revoke insert, update, delete, truncate, trigger, references
  on public.sports, public.teams, public.players, public.matches, public.match_stats
  from anon;
-- Authenticated users still need table privileges for role-checked RLS writes.
-- Defense-in-depth: prevent direct table privilege escalation by authenticated viewers.
-- RLS policies limit match writing to match_manager/super_admin,
-- and sports/teams/players writing to super_admin.
commit;