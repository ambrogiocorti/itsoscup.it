export const APP_CONFIG = {
  supabaseUrl: 'https://nalxfsbjeinptjflvndp.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5hbHhmc2JqZWlucHRqZmx2bmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1ODQxNDYsImV4cCI6MjA5MTE2MDE0Nn0.VfSsd_KeeTdS2bxqF-MGm8JgandjZF3J8a4PS5NL6kk',
  lockTtlSeconds: 90,
  lockRefreshSeconds: 30,
  liveAutosaveDebounceMs: 800,
};

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MATCH_MANAGER: 'match_manager',
  REPORT_VIEWER: 'report_viewer',
};

export const TEAM_SPORTS = ['calcio', 'basket', 'pallavolo'];

export const SPORT_LABELS = {
  calcio: 'Calcio',
  basket: 'Basket',
  pallavolo: 'Pallavolo',
  atletica: 'Atletica',
};

export const TOURNAMENT_FORMATS = {
  gironi: 'Gironi',
  eliminazione: 'Eliminazione Diretta',
};

