// Intestazione uniforme per le stampe fatte con il comando Stampa del browser
// (report, controllo finale, documenti del torneo, guida): logo, titolo e data.
const ROOT_SELECTORS = ['.view-section.active', '.closeout-wrap', '.tt-shell', '.insights-wrap', '#guide-main', 'main'];

function buildLetterhead() {
  const head = document.createElement('header');
  head.className = 'print-letterhead';
  head.setAttribute('aria-hidden', 'true');
  const date = new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  const title = document.querySelector('.view-section.active .page-title, main h1')?.textContent?.trim() || document.title;
  head.innerHTML = `<div class="print-letterhead-brand"><img src="/favicon.svg" alt="" width="30" height="30"><div><strong>ITSOS<span>Cup</span></strong><small>Tornei scolastici</small></div></div><div class="print-letterhead-doc"><span></span><b></b></div>`;
  head.querySelector('.print-letterhead-doc span').textContent = title;
  head.querySelector('.print-letterhead-doc b').textContent = `Stampato il ${date}`;
  return head;
}

window.addEventListener('beforeprint', () => {
  document.querySelectorAll('.print-letterhead').forEach((el) => el.remove());
  // Le stampe dedicate (QR, fogli gara) usano una finestra propria: qui solo la pagina corrente.
  const root = ROOT_SELECTORS.map((sel) => document.querySelector(sel)).find(Boolean);
  root?.prepend(buildLetterhead());
});
window.addEventListener('afterprint', () => document.querySelectorAll('.print-letterhead').forEach((el) => el.remove()));
