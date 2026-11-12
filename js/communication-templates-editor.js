// Editor dei modelli di comunicazione: elenco a sinistra, modifica a destra,
// variabili inseribili con un clic e anteprima del messaggio che si aggiorna mentre scrivi.
import { escapeHtml } from './utils.js';

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function fillTemplate(text, samples = {}) {
  return String(text ?? '').replace(VARIABLE_PATTERN, (_m, key) =>
    Object.prototype.hasOwnProperty.call(samples, key) ? samples[key] : `[${key}]`);
}

export function unknownVariables(text, allowed = []) {
  const found = new Set();
  String(text ?? '').replace(VARIABLE_PATTERN, (_m, key) => { if (!allowed.includes(key)) found.add(key); return ''; });
  return [...found];
}

function insertAtCursor(field, snippet) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.value = field.value.slice(0, start) + snippet + field.value.slice(end);
  const caret = start + snippet.length;
  field.focus();
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * @param {HTMLElement} target
 * @param {{templates:any[], meta:Record<string,any>, labels:Record<string,string>, samples:Record<string,string>,
 *          canEdit:boolean, onSave:(row:any)=>Promise<void>}} options
 */
export function renderTemplateEditor(target, { templates, meta, labels, samples, canEdit, onSave }) {
  const rows = templates.map((row) => ({ ...row }));
  let selectedKey = target.dataset.selectedTemplate && rows.some((r) => r.template_key === target.dataset.selectedTemplate)
    ? target.dataset.selectedTemplate
    : rows[0]?.template_key;
  const describe = (row) => meta[row.template_key] ?? {
    label: row.title || 'Modello',
    purpose: 'Modello riutilizzabile per messaggi automatici o manuali.',
    usedBy: 'Invio Telegram manuale o automatico',
    variables: Object.keys(labels),
  };

  target.innerHTML = `
    <div class="tpl-editor">
      <nav class="tpl-list" aria-label="Modelli di messaggio"></nav>
      <section class="tpl-detail" aria-live="polite"></section>
    </div>`;
  const list = target.querySelector('.tpl-list');
  const detail = target.querySelector('.tpl-detail');

  const renderList = () => {
    list.innerHTML = rows.map((row) => {
      const info = describe(row);
      const active = row.is_active !== false;
      return `<button type="button" class="tpl-list-item${row.template_key === selectedKey ? ' is-selected' : ''}" data-key="${escapeHtml(row.template_key)}" aria-pressed="${row.template_key === selectedKey}">
          <span class="tpl-dot ${active ? 'on' : 'off'}" aria-hidden="true"></span>
          <span class="tpl-list-text"><strong>${escapeHtml(info.label)}</strong><small>${escapeHtml(info.usedBy)}</small></span>
          <span class="tpl-state">${active ? 'Attivo' : 'Spento'}</span>
        </button>`;
    }).join('');
  };

  const renderDetail = () => {
    const row = rows.find((r) => r.template_key === selectedKey);
    if (!row) { detail.innerHTML = '<div class="empty-state">Nessun modello selezionato.</div>'; return; }
    const info = describe(row);
    const vars = info.variables ?? [];
    const original = templates.find((t) => t.template_key === row.template_key) ?? row;
    detail.innerHTML = `
      <header class="tpl-detail-head">
        <div>
          <span class="tpl-eyebrow"><i class="fa-brands fa-telegram" aria-hidden="true"></i> Telegram · ${escapeHtml(info.usedBy)}</span>
          <h3>${escapeHtml(info.label)}</h3>
          <p>${escapeHtml(info.purpose)}</p>
        </div>
        <label class="tpl-switch">
          <input type="checkbox" data-field="is_active" ${row.is_active !== false ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
          <span class="tpl-switch-track" aria-hidden="true"></span>
          <span>Attivo</span>
        </label>
      </header>
      <div class="tpl-detail-grid">
        <div class="tpl-form">
          <div class="field"><label for="tpl-title">Titolo</label>
            <input id="tpl-title" data-field="title" maxlength="120" value="${escapeHtml(row.title ?? '')}" ${canEdit ? '' : 'readonly'}></div>
          <div class="field"><label for="tpl-body">Messaggio</label>
            <textarea id="tpl-body" data-field="body" rows="6" maxlength="1500" ${canEdit ? '' : 'readonly'}>${escapeHtml(row.body ?? '')}</textarea>
            <small class="tpl-counter" data-counter></small></div>
          <div class="tpl-vars">
            <span class="tpl-vars-label">Inserisci un dato automatico nel punto del cursore:</span>
            <div class="tpl-chips">${vars.map((v) => `<button type="button" class="tpl-chip" data-insert="${escapeHtml(v)}" ${canEdit ? '' : 'disabled'} title="Inserisce {{${escapeHtml(v)}}}"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${escapeHtml(labels[v] ?? v)}</button>`).join('')}</div>
          </div>
          <p class="tpl-warning" data-warning hidden></p>
        </div>
        <aside class="tpl-preview" aria-label="Anteprima del messaggio">
          <span class="tpl-preview-label">Anteprima con dati di esempio</span>
          <div class="tpl-bubble"><strong data-preview-title></strong><p data-preview-body></p><time>10:30</time></div>
        </aside>
      </div>
      <footer class="tpl-actions">
        <span class="tpl-dirty" data-dirty hidden><i class="fa-solid fa-circle" aria-hidden="true"></i> Modifiche non salvate</span>
        <button type="button" class="btn btn-ghost" data-action="reset" ${canEdit ? '' : 'hidden'}>Annulla modifiche</button>
        <button type="button" class="btn btn-primary" data-action="save" ${canEdit ? '' : 'hidden'}><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Salva modello</button>
      </footer>`;

    const title = detail.querySelector('[data-field="title"]');
    const body = detail.querySelector('[data-field="body"]');
    const active = detail.querySelector('[data-field="is_active"]');
    const update = () => {
      row.title = title.value; row.body = body.value; row.is_active = active.checked;
      detail.querySelector('[data-preview-title]').textContent = fillTemplate(title.value, samples) || 'Senza titolo';
      detail.querySelector('[data-preview-body]').textContent = fillTemplate(body.value, samples) || 'Scrivi il testo del messaggio.';
      detail.querySelector('[data-counter]').textContent = `${body.value.length}/1500 caratteri`;
      const unknown = unknownVariables(`${title.value} ${body.value}`, vars);
      const warning = detail.querySelector('[data-warning]');
      warning.hidden = !unknown.length;
      warning.textContent = unknown.length ? `Questi dati non vengono compilati in questo modello: ${unknown.map((v) => `{{${v}}}`).join(', ')}.` : '';
      const dirty = row.title !== (original.title ?? '') || row.body !== (original.body ?? '') || (row.is_active !== false) !== (original.is_active !== false);
      detail.querySelector('[data-dirty]').hidden = !dirty;
      detail.querySelector('[data-action="save"]').disabled = !dirty;
      detail.querySelector('[data-action="reset"]').disabled = !dirty;
    };
    [title, body].forEach((field) => field.addEventListener('input', update));
    active.addEventListener('change', update);
    detail.querySelectorAll('[data-insert]').forEach((chip) => chip.addEventListener('click', () => insertAtCursor(body, `{{${chip.dataset.insert}}}`)));
    detail.querySelector('[data-action="reset"]').addEventListener('click', () => {
      Object.assign(row, { title: original.title, body: original.body, is_active: original.is_active });
      renderDetail(); renderList();
    });
    detail.querySelector('[data-action="save"]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await onSave({ template_key: row.template_key, title: row.title, body: row.body, is_active: row.is_active !== false });
        Object.assign(original, { title: row.title, body: row.body, is_active: row.is_active });
        update(); renderList();
      } catch {
        button.disabled = false; // onSave ha già mostrato l'errore.
      }
    });
    update();
  };

  list.addEventListener('click', (event) => {
    const item = event.target.closest('.tpl-list-item');
    if (!item) return;
    // Le modifiche non salvate restano in memoria se torni su questo modello.
    selectedKey = item.dataset.key;
    target.dataset.selectedTemplate = selectedKey;
    renderList(); renderDetail();
  });
  renderList();
  renderDetail();
}
