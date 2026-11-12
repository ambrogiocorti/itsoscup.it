// Stampe ITSOSCup con un'unica impaginazione: intestazione con logo, titolo, dati del
// documento e piè di pagina con data di generazione. Usata da QR, fogli gara e documenti.
import { qrSvg } from './qr-code.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOGO = () => `${window.location.origin}/favicon.svg`;
const generatedAt = () => new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());

export const PRINT_BASE_CSS = `
  @page { size: A4 portrait; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #0f172a; }
  body { font-family: Inter, "Segoe UI", Arial, sans-serif; font-size: 11px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pk-letterhead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid #0f172a; margin-bottom: 14px; }
  .pk-brand { display: flex; align-items: center; gap: 10px; }
  .pk-brand img { width: 34px; height: 34px; }
  .pk-brand strong { display: block; font-size: 15px; letter-spacing: -.02em; }
  .pk-brand strong span { color: #2563eb; }
  .pk-brand small { display: block; color: #64748b; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  .pk-doc-kind { text-align: right; color: #475569; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  .pk-doc-kind b { display: block; color: #0f172a; font-size: 11px; letter-spacing: 0; text-transform: none; }
  .pk-title { margin: 0 0 4px; font-size: 22px; line-height: 1.1; letter-spacing: -.02em; }
  .pk-subtitle { margin: 0 0 12px; color: #475569; font-size: 12px; }
  .pk-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; margin: 0 0 14px; }
  .pk-meta div { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; background: #f8fafc; }
  .pk-meta span { display: block; color: #64748b; font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
  .pk-meta strong { font-size: 11px; }
  .pk-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .pk-table th, .pk-table td { border: 1px solid #cbd5e1; padding: 7px 6px; text-align: left; vertical-align: middle; }
  .pk-table th { background: #0f172a; color: #fff; font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; }
  .pk-table tbody tr:nth-child(even) td { background: #f8fafc; }
  .pk-table td.pk-write { height: 30px; min-width: 70px; }
  .pk-center { text-align: center !important; }
  .pk-page { break-after: page; page-break-after: always; }
  .pk-page:last-child { break-after: auto; page-break-after: auto; }
  .pk-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 22px; }
  .pk-sign div { border-top: 1px solid #0f172a; padding-top: 5px; color: #475569; font-size: 9.5px; }
  .pk-footer { position: fixed; left: 0; right: 0; bottom: -8mm; display: flex; justify-content: space-between; color: #94a3b8; font-size: 8.5px; border-top: 1px solid #e2e8f0; padding-top: 4px; }
  @media screen { body { padding: 24px; background: #e2e8f0; } .pk-page, .pk-poster { background: #fff; max-width: 210mm; margin: 0 auto 24px; padding: 14mm; box-shadow: 0 10px 30px #0f172a22; } .pk-footer { position: static; margin-top: 14px; } }
`;

export function letterhead(kind) {
  return `<header class="pk-letterhead"><div class="pk-brand"><img src="${esc(LOGO())}" alt=""><div><strong>ITSOS<span>Cup</span></strong><small>Tornei scolastici</small></div></div><div class="pk-doc-kind">${esc(kind)}<b>${esc(generatedAt())}</b></div></header>`;
}

export function metaGrid(items = []) {
  const rows = items.filter(([, value]) => value != null && value !== '');
  return rows.length ? `<div class="pk-meta">${rows.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>` : '';
}

export function brandedDocument({ title, bodyHtml, extraCss = '' }) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="icon" href="${esc(LOGO())}"><style>${PRINT_BASE_CSS}${extraCss}</style></head><body>${bodyHtml}<footer class="pk-footer"><span>ITSOSCup · itsoscup.it</span><span>Generato il ${esc(generatedAt())}</span></footer></body></html>`;
}

/** Apre subito la finestra (prima di attese di rete) così i blocchi popup non intervengono. */
export function openPrintWindow(message = 'Preparazione della stampa…') {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Il browser ha bloccato la finestra di stampa: consenti i popup per itsoscup.it e riprova.');
  win.document.open();
  win.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>ITSOSCup</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;font:600 15px system-ui,sans-serif;color:#0f172a;background:#f8fafc">${esc(message)}</body></html>`);
  win.document.close();
  return win;
}

export async function printHtml(win, html) {
  win.document.open();
  win.document.write(html);
  win.document.close();
  await new Promise((resolve) => {
    const images = [...win.document.images].filter((img) => !img.complete);
    if (!images.length) return resolve();
    let left = images.length;
    const done = () => { left -= 1; if (left <= 0) resolve(); };
    images.forEach((img) => { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); });
    setTimeout(resolve, 2500);
  });
  win.focus();
  setTimeout(() => win.print(), 150);
}

const POSTER_CSS = `
  .pk-poster { min-height: 262mm; display: flex; flex-direction: column; }
  .pk-poster-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; }
  .pk-poster-kicker { display: inline-flex; gap: 6px; align-items: center; padding: 5px 12px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .pk-poster h1 { margin: 6px 0 0; font-size: 40px; line-height: 1.05; letter-spacing: -.03em; max-width: 170mm; }
  .pk-poster .pk-poster-sub { margin: 0; font-size: 16px; color: #475569; }
  .pk-qr-frame { margin: 18px 0 8px; padding: 16px; border: 3px solid #0f172a; border-radius: 22px; width: 118mm; height: 118mm; }
  .pk-qr-frame svg { width: 100%; height: 100%; display: block; }
  .pk-steps { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin: 10px 0 0; padding: 0; list-style: none; counter-reset: s; }
  .pk-steps li { counter-increment: s; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 12px; font-weight: 600; background: #f8fafc; }
  .pk-steps li::before { content: counter(s); display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #0f172a; color: #fff; font-size: 10px; font-weight: 800; }
  .pk-url { margin-top: 12px; font: 600 11px ui-monospace, Menlo, Consolas, monospace; color: #334155; word-break: break-all; max-width: 160mm; }
`;

/**
 * Locandina A4 con QR grande e istruzioni, da appendere a un campo o all'ingresso.
 */
export async function printQrPoster({ kind = 'QR', title, subtitle = '', url, steps = [], icon = '' }, win = null) {
  const target = win ?? openPrintWindow();
  try {
    const svg = await qrSvg(url, { label: title, margin: 1 });
    const body = `<section class="pk-poster">${letterhead(kind)}<div class="pk-poster-body">
      <span class="pk-poster-kicker">${icon}${esc(kind)}</span>
      <h1>${esc(title)}</h1>
      ${subtitle ? `<p class="pk-poster-sub">${esc(subtitle)}</p>` : ''}
      <div class="pk-qr-frame">${svg}</div>
      ${steps.length ? `<ol class="pk-steps">${steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>` : ''}
      <div class="pk-url">${esc(url)}</div>
    </div></section>`;
    await printHtml(target, brandedDocument({ title: `${kind} · ${title}`, bodyHtml: body, extraCss: POSTER_CSS }));
  } catch (error) {
    target.close();
    throw error;
  }
}
