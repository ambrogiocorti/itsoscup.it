import { getDeviceInfo } from './device.js';
import { logClientError } from './admin-system.js';

let registered = false;
const recentErrors = new Set();

function normalizeError(eventOrReason) {
  const error = eventOrReason?.error ?? eventOrReason?.reason ?? eventOrReason;
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ?? '',
    };
  }
  return {
    message: String(error?.message ?? error ?? 'Errore JavaScript'),
    stack: String(error?.stack ?? ''),
  };
}

async function writeClientError({ scope, message, stack }) {
  const device = getDeviceInfo();
  const shortMessage = String(message ?? '').slice(0, 1200);
  if (!shortMessage || /script error/i.test(shortMessage)) return;

  const key = `${scope}:${shortMessage}:${window.location.pathname}`;
  if (recentErrors.has(key)) return;
  recentErrors.add(key);
  window.setTimeout(() => recentErrors.delete(key), 60_000);

  await logClientError({
    action: scope,
    message: `${shortMessage}\nDispositivo: ${device.label} (${device.id.slice(0, 8)})`,
    stack,
    severity: 'error',
  });
}

export function registerClientErrorLogger(scope = 'runtime') {
  if (registered || typeof window === 'undefined') return;
  registered = true;

  window.addEventListener('error', (event) => {
    const normalized = normalizeError(event);
    writeClientError({
      scope,
      message: normalized.message,
      stack: normalized.stack,
    }).catch(() => undefined);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const normalized = normalizeError(event);
    writeClientError({
      scope: `${scope}:promise`,
      message: normalized.message,
      stack: normalized.stack,
    }).catch(() => undefined);
  });
}
