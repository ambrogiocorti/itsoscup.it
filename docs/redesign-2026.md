# ITSOSCup — redesign ottobre 2026

Il redesign aggiorna grafica e gerarchia visiva senza cambiare i contratti con Supabase.

Colori: #0f172a (navy), #2563eb (CTA), #f8fafc (superfici), #10b981 (stati attivi).
Sono incluse homepage pubblica, pagina squadra, amministrazione, match live,
schermo palestra, postazioni offline, portale classe e strumenti torneo.

L'interfaccia usa un foglio condiviso `css/redesign.css` caricato dopo i
CSS legacy. I selettori e gli ID usati dalla logica JavaScript rimangono
inalterati. Per un rollback grafico, ripristinare il commit precedente.
I report e le stampe PDF mantengono gli stili specifici e le regole di stampa.

Le funzionalità offline web **non sono state abilitate da questo redesign**.
L'app Windows e i trasferimenti cifrati mantengono il comportamento esistente.

Controlli raccomandati:
- GitHub Actions (statici, sintassi JS, Playwright).
- Test manuale autenticato dei ruoli super_admin, match_manager e report_viewer.
- Punteggio, timer, referti e firme su una partita di prova.
- Verifica reale delle dimensioni schermo: 375px, 768px, 1366px, proiettore.
