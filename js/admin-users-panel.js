import {
  deleteAdminUser,
  loadAdminUsersPanelData,
  saveAdminUser,
} from './admin-users.js';
import { escapeHtml, formatDateTime, getEl, showAppConfirm, showToast } from './utils.js';

function formatRoleLabel(role) {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'match_manager') return 'Match Manager';
  if (role === 'report_viewer') return 'Report Manager';
  return 'Ruolo non assegnato';
}

function getAdminPrimaryDevice(admin) {
  return (admin?.devices ?? [])[0] ?? null;
}

export function createAdminUsersPanel({ canManageAll = () => false } = {}) {
  const panelState = {
    admins: [],
    devices: [],
  };

  function resetForm() {
    getEl('form-admin-user')?.reset();
    getEl('admin-user-id').value = '';
    getEl('admin-user-password').required = true;
  }

  function renderDeviceOptions(selectedDeviceId = '') {
    const select = getEl('admin-user-device');
    if (!select) return;
    const options = panelState.devices
      .map((device) => {
        const label = device.label || 'Dispositivo non nominato';
        const status = device.is_revoked ? 'revocato' : device.is_offline_ready ? 'offline pronto' : 'attivo';
        return `<option value="${escapeHtml(device.device_id)}">${escapeHtml(label)} · ${escapeHtml(status)}</option>`;
      })
      .join('');
    select.innerHTML = `<option value="">Nessuna postazione</option>${options}`;
    select.value = selectedDeviceId || '';
  }

  function renderTable() {
    const body = getEl('table-admin-users-body');
    if (!body) return;
    if (!panelState.admins.length) {
      body.innerHTML = '<tr><td colspan="6" class="admin-users-empty">Nessun admin configurato.</td></tr>';
      return;
    }

    body.innerHTML = panelState.admins
      .map((admin) => {
        const device = getAdminPrimaryDevice(admin);
        const deviceList = (admin.devices ?? []).length
          ? `<div class="admin-user-device-list">${admin.devices
              .map((item) => `<span><i class="fa-solid fa-laptop"></i> ${escapeHtml(item.label ?? 'Dispositivo non nominato')}</span>`)
              .join('')}</div>`
          : '<span class="muted">Nessuna</span>';
        return `
          <tr>
            <td>
              <div class="admin-user-name-cell">
                <strong>${escapeHtml(admin.nome || 'Admin')}</strong>
                <small class="muted">${escapeHtml(formatRoleLabel(admin.ruolo))}</small>
              </div>
            </td>
            <td>${escapeHtml(admin.email ?? '-')}</td>
            <td><span class="badge badge-success">${escapeHtml(formatRoleLabel(admin.ruolo))}</span></td>
            <td>${escapeHtml(admin.last_sign_in_at ? formatDateTime(admin.last_sign_in_at) : 'Mai registrato')}</td>
            <td>${deviceList}</td>
            <td>
              <div class="table-actions">
                <button class="icon-btn edit" data-action="edit-admin-user" data-id="${escapeHtml(admin.id)}" data-device-id="${escapeHtml(device?.device_id ?? '')}" title="Modifica admin" aria-label="Modifica admin"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-btn delete" data-action="delete-admin-user" data-id="${escapeHtml(admin.id)}" title="Elimina admin" aria-label="Elimina admin"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function renderUnavailable(message = 'Gestione admin non disponibile. Verifica deploy della funzione manage-admin-user.') {
    const body = getEl('table-admin-users-body');
    if (!body) return;
    body.innerHTML = `<tr><td colspan="6" class="admin-users-empty">${escapeHtml(message)}</td></tr>`;
  }

  async function load() {
    if (!canManageAll()) return;
    try {
      const data = await loadAdminUsersPanelData();
      panelState.admins = data.admins ?? [];
      panelState.devices = data.devices ?? [];
      renderDeviceOptions();
      renderTable();
      if (data.fallback) {
        showToast('Ruoli caricati dal database. Per gestire password e utenti Auth, deploya manage-admin-user.', 'info');
      }
    } catch (error) {
      renderUnavailable(`${error.message} Verifica Supabase, migrazione 026 e deploy della funzione manage-admin-user.`);
    }
  }

  function editFromTable(adminId, deviceId = '') {
    const admin = panelState.admins.find((row) => String(row.id) === String(adminId));
    if (!admin) return;
    getEl('admin-user-id').value = admin.id;
    getEl('admin-user-name').value = admin.nome ?? '';
    getEl('admin-user-email').value = admin.email ?? '';
    getEl('admin-user-role').value = admin.ruolo ?? 'match_manager';
    getEl('admin-user-password').value = '';
    getEl('admin-user-password').required = false;
    renderDeviceOptions(deviceId || getAdminPrimaryDevice(admin)?.device_id || '');
  }

  async function handleSave(event) {
    event.preventDefault();
    const payload = {
      userId: getEl('admin-user-id').value || null,
      nome: getEl('admin-user-name').value,
      email: getEl('admin-user-email').value,
      ruolo: getEl('admin-user-role').value,
      password: getEl('admin-user-password').value,
      deviceId: getEl('admin-user-device').value || null,
    };

    await saveAdminUser(payload);
    resetForm();
    await load();
    showToast('Admin salvato.', 'success');
  }

  async function handleDelete(userId) {
    if (!(await showAppConfirm("Eliminare questo admin? L'accesso Auth verra rimosso.", {
      title: 'Elimina admin',
      tone: 'danger',
      confirmLabel: 'Elimina',
    }))) return;

    await deleteAdminUser(userId);
    await load();
    showToast('Admin eliminato.', 'success');
  }

  function bind() {
    getEl('btn-refresh-admin-users')?.addEventListener('click', () => {
      load().catch((error) => showToast(error.message, 'error'));
    });
    getEl('btn-reset-admin-user-form')?.addEventListener('click', () => {
      resetForm();
      renderDeviceOptions();
    });
    getEl('form-admin-user')?.addEventListener('submit', (event) => {
      handleSave(event).catch((error) => showToast(error.message, 'error'));
    });
    getEl('table-admin-users-body')?.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      if (actionEl.dataset.action === 'edit-admin-user') {
        editFromTable(actionEl.dataset.id, actionEl.dataset.deviceId);
      }
      if (actionEl.dataset.action === 'delete-admin-user') {
        handleDelete(actionEl.dataset.id).catch((error) => showToast(error.message, 'error'));
      }
    });
  }

  return {
    bind,
    load,
    renderUnavailable,
  };
}
