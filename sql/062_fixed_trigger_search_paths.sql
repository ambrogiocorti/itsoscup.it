-- 062: immutable function resolution for two existing UPDATE triggers.
-- Only pg_catalog built-ins and explicitly-qualified auth.uid() are used.
ALTER FUNCTION public.touch_updated_at() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.touch_urgent_announcements_updated_at() SET search_path = pg_catalog, pg_temp;
