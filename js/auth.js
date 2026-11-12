import { db, run } from './db.js';
import { ROLES } from './app-config.js';

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
    // Never treat a network failure as a missing role: the database is authoritative.
    throw error;
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

    return { user, admin, allowed: true, offline: false };
  } catch (error) {
    // The online PWA must never authorize an administrator using stale local data.
    // Leave the active Supabase session intact so retry works when connectivity returns.
    throw new Error('ITSOSCup richiede Internet per verificare accesso e permessi. Controlla la connessione e riprova.', { cause: error });
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

  return { user, admin };
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

export function canAccessControlCenter(role) {
  return role === ROLES.SUPER_ADMIN;
}

export function canViewReports(role) {
  return (
    role === ROLES.SUPER_ADMIN ||
    role === ROLES.MATCH_MANAGER ||
    role === ROLES.REPORT_VIEWER
  );
}

