import { db, run } from './db.js';
import { ROLES } from './app-config.js';

const ADMIN_OFFLINE_CACHE_KEY = 'tornei_admin_offline_profile';
const ADMIN_OFFLINE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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
    const cached = raw ? JSON.parse(raw) : null;
    const cachedAt = cached?.cached_at ? new Date(cached.cached_at).getTime() : 0;
    if (!cachedAt || Date.now() - cachedAt > ADMIN_OFFLINE_CACHE_TTL_MS) {
      window.localStorage.removeItem(ADMIN_OFFLINE_CACHE_KEY);
      return null;
    }
    return cached;
  } catch (_error) {
    return null;
  }
}

function clearCachedAdminSession() {
  try {
    window.localStorage.removeItem(ADMIN_OFFLINE_CACHE_KEY);
  } catch (_error) {
    // Best-effort cleanup.
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
  try {
    const { data } = await run(
      db
        .from('admins')
        .select('id, nome, email, ruolo')
        .eq('id', userId)
        .maybeSingle(),
      'Caricamento profilo admin'
    );
    if (data) return data;
  } catch (error) {
    if (!isNetworkLikeError(error)) throw error;
  }
  return null;
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
      const message = admin
        ? `Ruolo admin non autorizzato: ${admin.ruolo ?? 'non assegnato'}.`
        : `Profilo admin non trovato per ${user.email ?? user.id}.`;
      try {
        window.sessionStorage.setItem('tornei_admin_login_error', message);
      } catch (_error) {
        // Session diagnostics are best-effort.
      }
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
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message);
  }
  const user = data?.user ?? (await getCurrentUser());
  const admin = await getAdminProfile(user?.id);
  const allowed = Boolean(
    admin &&
      [ROLES.SUPER_ADMIN, ROLES.MATCH_MANAGER, ROLES.REPORT_VIEWER].includes(admin.ruolo)
  );

  if (!allowed) {
    await db.auth.signOut();
    throw new Error('Accesso negato: il tuo UUID Auth non e assegnato a un ruolo admin.');
  }

  cacheAdminSession(user, admin);
  return { user, admin };
}

export async function signOutAdmin() {
  const { error } = await db.auth.signOut();
  clearCachedAdminSession();
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

