import { showAppPrompt } from './utils.js';

const DEVICE_ID_KEY = 'tornei_device_id';
const DEVICE_LABEL_KEY = 'tornei_device_label';

function createDeviceId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getDeviceInfo() {
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = createDeviceId();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }

  const label = String(window.localStorage.getItem(DEVICE_LABEL_KEY) ?? '').trim();
  return {
    id,
    label: label || 'Dispositivo non nominato',
    isNamed: Boolean(label),
  };
}

export function setDeviceLabel(label) {
  const clean = String(label ?? '').trim().slice(0, 80);
  if (clean) window.localStorage.setItem(DEVICE_LABEL_KEY, clean);
  return getDeviceInfo();
}

export async function promptDeviceLabel({ force = false } = {}) {
  const current = getDeviceInfo();
  if (current.isNamed) return current;

  const value = await showAppPrompt('Nome di questo dispositivo/postazione:', {
    title: 'Nome postazione',
    defaultValue: 'Tablet Palestra Grande',
    inputLabel: 'Nome dispositivo',
    placeholder: 'Es. Tablet Palestra Grande',
  });
  if (value === null) return current;
  return setDeviceLabel(value);
}

export function buildDeviceAuditFields() {
  const device = getDeviceInfo();
  return {
    updated_device_id: device.id,
    updated_device_label: device.label,
  };
}
