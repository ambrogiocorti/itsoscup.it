// Public navigation policy for the three existing Supabase admin roles.
// Backend RLS/RPC remain the security boundary; this controls which views can
// be opened from the menu or through ?view=... in the administrative SPA.
const ALL_VIEWS = Object.freeze([
  'dashboard', 'operations', 'reports', 'matches', 'venues', 'archive',
  'telegram', 'sports', 'teams', 'events', 'settings',
]);

const ROLE_VIEWS = Object.freeze({
  super_admin: ALL_VIEWS,
  match_manager: Object.freeze(['matches']),
  report_viewer: Object.freeze(['reports']),
});

export function allowedAdminViews(role) {
  return ROLE_VIEWS[role] || [];
}
export function canAccessAdminView(role, view) {
  return allowedAdminViews(role).includes(view);
}
export function defaultAdminView(role) {
  return role === 'super_admin' ? 'dashboard' : (allowedAdminViews(role)[0] || null);
}
