import { APP_CONFIG } from './app-config.js';
import { db, run } from './db.js';

const ADMIN_FUNCTION = 'manage-admin-user';

async function invokeAdminUserFunction(action, payload = {}) {
  const {
    data: { session },
    error,
  } = await db.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error('Sessione admin non valida. Effettua di nuovo il login.');
  }

  const response = await fetch(`${APP_CONFIG.supabaseUrl}/functions/v1/${ADMIN_FUNCTION}`, {
    method: 'POST',
    headers: {
      apikey: APP_CONFIG.supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || `Operazione admin non riuscita (${response.status}).`);
  }

  return data;
}

function isRecoverableAdminFunctionError(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return /failed to fetch|networkerror|load failed|404|401|403|edge function|cors|non riuscita/.test(message);
}

async function loadAdminUsersPanelDataFallback() {
  const [adminsResult, devicesResult] = await Promise.allSettled([
    run(
      db
        .from('admins')
        .select('id, nome, email, ruolo, created_at, updated_at')
        .order('nome', { ascending: true }),
      'Caricamento ruoli admin'
    ),
    run(
      db
        .from('registered_devices')
        .select('device_id, label, assigned_admin_id, assigned_venue_id, last_seen_at, last_sync_at, is_offline_ready, is_revoked')
        .order('last_seen_at', { ascending: false }),
      'Caricamento postazioni'
    ).catch(() => ({ data: [] })),
  ]);

  if (adminsResult.status !== 'fulfilled') {
    throw adminsResult.reason;
  }

  const admins = adminsResult.value.data ?? [];
  const devices = devicesResult.status === 'fulfilled' ? devicesResult.value.data ?? [] : [];
  const devicesByAdmin = new Map();
  devices.forEach((device) => {
    const adminId = String(device.assigned_admin_id ?? '');
    if (!adminId) return;
    devicesByAdmin.set(adminId, [...(devicesByAdmin.get(adminId) ?? []), device]);
  });

  return {
    admins: admins.map((admin) => ({
      ...admin,
      last_sign_in_at: null,
      devices: devicesByAdmin.get(String(admin.id)) ?? [],
    })),
    devices,
    fallback: true,
  };
}

export async function loadAdminUsersPanelData() {
  try {
    const data = await invokeAdminUserFunction('list');
    return {
      admins: data.admins ?? [],
      devices: data.devices ?? [],
      fallback: false,
    };
  } catch (error) {
    if (!isRecoverableAdminFunctionError(error)) throw error;
    return loadAdminUsersPanelDataFallback();
  }
}

export async function saveAdminUser(payload) {
  return invokeAdminUserFunction('save', payload);
}

export async function deleteAdminUser(userId) {
  return invokeAdminUserFunction('delete', { userId });
}
