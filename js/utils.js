export function getEl(id) {
  return document.getElementById(id);
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatDuration(totalSeconds = 0) {
  const safe = Math.max(0, toNumber(totalSeconds, 0));
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (safe % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

function ensureToastContainer() {
  let container = document.querySelector('.toast-wrap');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-wrap';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info') {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

function ensureAppDialog() {
  let overlay = document.querySelector('.app-dialog-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.className = 'app-dialog-overlay';
  overlay.innerHTML = `
    <div class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
      <div class="modal-header app-dialog-header">
        <h2 id="app-dialog-title"></h2>
        <button class="close-btn" type="button" data-app-dialog-cancel aria-label="Chiudi">&times;</button>
      </div>
      <form class="app-dialog-form">
        <div class="app-dialog-message" id="app-dialog-message"></div>
        <div class="field app-dialog-field hidden">
          <label for="app-dialog-input" id="app-dialog-input-label">Valore</label>
          <input id="app-dialog-input" type="text" />
          <textarea id="app-dialog-textarea" rows="4"></textarea>
        </div>
        <div class="app-dialog-actions">
          <button class="btn btn-ghost" type="button" data-app-dialog-cancel>Annulla</button>
          <button class="btn btn-primary" type="submit" data-app-dialog-confirm>OK</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function setAppDialogOpen(isOpen) {
  document.querySelector('.app-dialog-overlay')?.classList.toggle('open', isOpen);
  document.body.classList.toggle('dialog-open', isOpen);
}

function openAppDialog({
  title = 'Avviso',
  message = '',
  tone = 'info',
  mode = 'alert',
  confirmLabel = 'OK',
  cancelLabel = 'Annulla',
  defaultValue = '',
  placeholder = '',
  inputType = 'text',
  multiline = false,
  inputLabel = 'Valore',
} = {}) {
  const overlay = ensureAppDialog();
  const dialog = overlay.querySelector('.app-dialog');
  const form = overlay.querySelector('.app-dialog-form');
  const titleEl = overlay.querySelector('#app-dialog-title');
  const messageEl = overlay.querySelector('#app-dialog-message');
  const field = overlay.querySelector('.app-dialog-field');
  const fieldLabel = overlay.querySelector('#app-dialog-input-label');
  const input = overlay.querySelector('#app-dialog-input');
  const textarea = overlay.querySelector('#app-dialog-textarea');
  const cancelButtons = overlay.querySelectorAll('[data-app-dialog-cancel]');
  const cancelAction = overlay.querySelector('.app-dialog-actions [data-app-dialog-cancel]');
  const confirmButton = overlay.querySelector('[data-app-dialog-confirm]');
  const activeInput = multiline ? textarea : input;

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      form.onsubmit = null;
      overlay.onclick = null;
      document.removeEventListener('keydown', onKeydown);
      cancelButtons.forEach((button) => {
        button.onclick = null;
      });
      setAppDialogOpen(false);
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(mode === 'confirm' ? false : null);
      }
    };

    dialog.className = `app-dialog ${tone}`;
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmButton.textContent = confirmLabel;
    cancelAction.textContent = cancelLabel;
    cancelAction.classList.toggle('hidden', mode === 'alert');

    field.classList.toggle('hidden', mode !== 'prompt');
    input.classList.toggle('hidden', multiline);
    textarea.classList.toggle('hidden', !multiline);
    activeInput.value = String(defaultValue ?? '');
    activeInput.placeholder = placeholder;
    input.type = inputType;
    fieldLabel.textContent = inputLabel;

    form.onsubmit = (event) => {
      event.preventDefault();
      if (mode === 'prompt') {
        finish(activeInput.value);
        return;
      }
      finish(mode === 'confirm' ? true : true);
    };

    cancelButtons.forEach((button) => {
      button.onclick = () => finish(mode === 'confirm' ? false : null);
    });

    overlay.onclick = (event) => {
      if (event.target === overlay) finish(mode === 'confirm' ? false : null);
    };

    document.addEventListener('keydown', onKeydown);
    setAppDialogOpen(true);
    setTimeout(() => {
      if (mode === 'prompt') activeInput.focus();
      else confirmButton.focus();
      if (mode === 'prompt' && activeInput.select) activeInput.select();
    }, 0);
  });
}

export function showAppAlert(message, options = {}) {
  return openAppDialog({
    title: options.title ?? 'Avviso',
    message,
    tone: options.tone ?? 'info',
    mode: 'alert',
    confirmLabel: options.confirmLabel ?? 'OK',
  });
}

export function showAppConfirm(message, options = {}) {
  return openAppDialog({
    title: options.title ?? 'Conferma',
    message,
    tone: options.tone ?? 'warning',
    mode: 'confirm',
    confirmLabel: options.confirmLabel ?? 'Conferma',
    cancelLabel: options.cancelLabel ?? 'Annulla',
  });
}

export function showAppPrompt(message, options = {}) {
  return openAppDialog({
    title: options.title ?? 'Inserisci dato',
    message,
    tone: options.tone ?? 'info',
    mode: 'prompt',
    confirmLabel: options.confirmLabel ?? 'Conferma',
    cancelLabel: options.cancelLabel ?? 'Annulla',
    defaultValue: options.defaultValue ?? '',
    placeholder: options.placeholder ?? '',
    inputType: options.inputType ?? 'text',
    multiline: Boolean(options.multiline),
    inputLabel: options.inputLabel ?? 'Valore',
  });
}

export function setHidden(el, shouldHide) {
  if (!el) return;
  el.classList.toggle('hidden', shouldHide);
}

export function sortByName(items, key = 'name') {
  return [...items].sort((a, b) =>
    String(a?.[key] ?? '').localeCompare(String(b?.[key] ?? ''), 'it', {
      sensitivity: 'base',
    })
  );
}

export function medalByRank(index) {
  if (index === 0) return '1°';
  if (index === 1) return '2°';
  if (index === 2) return '3°';
  return String(index + 1);
}

export function buildOptions(items, valueKey = 'id', labelKey = 'name') {
  return items
    .map(
      (item) =>
        `<option value="${escapeHtml(item[valueKey])}">${escapeHtml(item[labelKey])}</option>`
    )
    .join('');
}

