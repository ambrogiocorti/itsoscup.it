-- 063: Small covering indexes for newly introduced registration and handoff flows.
-- Both tables are new, so index creation is expected to be fast.
CREATE INDEX IF NOT EXISTS athletics_entries_player_id_idx
  ON public.athletics_entries(player_id);
CREATE INDEX IF NOT EXISTS roster_confirmation_events_sport_created_idx
  ON public.roster_confirmation_events(sport_id,created_at DESC);
