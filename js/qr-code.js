// QR generati sul sito (libreria qrcode-generator 1.4.4, MIT) invece che da api.qrserver.com:
// nessun servizio esterno riceve i link e la stampa funziona anche se quel servizio non risponde.
let loading = null;

function loadLibrary() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('/vendor/qrcode-generator-1.4.4/qrcode.js', window.location.origin).href;
      script.async = true;
      script.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('Libreria QR non disponibile')));
      script.onerror = () => { loading = null; reject(new Error('Libreria QR non raggiungibile: ricarica la pagina.')); };
      document.head.append(script);
    });
  }
  return loading;
}

/** Restituisce il QR come SVG (stringa), nitido a qualsiasi dimensione di stampa. */
export async function qrSvg(text, { margin = 2, label = 'Codice QR' } = {}) {
  const qrcode = await loadLibrary();
  const qr = qrcode(0, 'M');
  qr.addData(String(text ?? ''), 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const size = count + margin * 2;
  let path = '';
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (qr.isDark(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const safeLabel = String(label).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${safeLabel}"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#0f172a"/></svg>`;
}

export async function qrDataUrl(text, options) {
  const svg = await qrSvg(text, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
