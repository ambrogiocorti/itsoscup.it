import { db, run } from './db.js';
import { ROLES } from './app-config.js';

const ADMIN_OFFLINE_CACHE_KEY = 'tornei_admin_offline_profile';

function isNetworkLikeError(error) {
  const message = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
  return /failed to fetch|networkerror|load failed|non raggiungibile|sdk non raggiungibile|verifica connessione/.test(message);
}

function cacheAdminSession(user, admin) {
  try {
    window.localStorage.setItem(
      ADMIN_OFFLINE_CACHE_KEY,
      JSON.stringify({
        user: user ? { id: user.id, email: user.email ?? admin?.email ?? null } : null,
        admin,
        cached_at: new Date().toISOString(),
      })
    );
  } catch (_error) {
    // Offline auth cache is best-effort.
  }
}

function loadCachedAdminSession() {
  try {
    const raw = window.localStorage.getItem(ADMIN_OFFLINE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

export async function getSession() {
  const {
    data: { session },
    error,
  } = await db.auth.getSession();
  if (error) {
    throw new Error(`Errore sessione: ${error.message}`);
  }
  return session;
}

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error) {
    throw new Error(`Errore utente: ${error.message}`);
  }
  return user;
}

export async function getAdminProfile(userId) {
  if (!userId) return null;
  const { data } = await run(
    db
      .from('admins')
      .select('id, nome, email, ruolo')
      .eq('id', userId)
      .maybeSingle(),
    'Caricamento profilo admin'
  );
  return data;
}

export async function requireAdmin({
  redirectTo = './',
  allowedRoles = [ROLES.SUPER_ADMIN, ROLES.MATCH_MANAGER, ROLES.REPORT_VIEWER],
} = {}) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      window.location.href = redirectTo;
      return { user: null, admin: null, allowed: false };
    }

    const admin = await getAdminProfile(user.id);
    const allowed = Boolean(admin && allowedRoles.includes(admin.ruolo));

    if (!allowed) {
      await db.auth.signOut();
      window.location.href = redirectTo;
      return { user, admin, allowed: false };
    }

    cacheAdminSession(user, admin);
    return { user, admin, allowed: true, offline: false };
  } catch (error) {
    if (!isNetworkLikeError(error)) throw error;
    const cached = loadCachedAdminSession();
    const allowed = Boolean(cached?.admin && allowedRoles.includes(cached.admin.ruolo));
    if (!allowed) {
      window.location.href = redirectTo;
      return { user: null, admin: null, allowed: false, offline: true };
    }
    return {
      user: cached.user ?? { id: cached.admin.id, email: cached.admin.email },
      admin: cached.admin,
      allowed: true,
      offline: true,
    };
  }
}

export async function signInAdmin(email, password) {
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message);
  }
  return true;
}

export async function signOutAdmin() {
  const { error } = await db.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}

export function canEditMatches(role) {
  return role === ROLES.SUPER_ADMIN || role === ROLES.MATCH_MANAGER;
}

export function canManageAll(role) {
  return role === ROLES.SUPER_ADMIN;
}

export function canViewReports(role) {
  return (
    role === ROLES.SUPER_ADMIN ||
    role === ROLES.MATCH_MANAGER ||
    role === ROLES.REPORT_VIEWER
  );
}

