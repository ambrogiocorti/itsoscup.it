# ITSOSCup — Continuità operativa e passaggio di consegne

**Revisione:** 20 ottobre 2026 · **Destinatari:** direzione scolastica, coordinatore tornei, referente tecnico, sostituto.
**Obiettivo:** gestire ITSOSCup senza dipendere dall'autore del progetto.

## 1. Inventario dei servizi e proprietà istituzionale

| Servizio | A cosa serve | Azione della scuola |
|---|---|---|
| Dominio itsoscup.it | Accesso pubblico | Verificare intestatario, pagamento e rinnovo annuale |
| GitHub (repository `ambrogiocorti/itsoscup.it`) | Codice e pubblicazione | Concedere accesso nominativo a due responsabili; attivare 2FA |
| GitHub Pages | Hosting HTML/CSS/JS | Verificare build, URL e HTTPS dopo ogni commit |
| Supabase progetto ITSOSCup | Auth, PostgreSQL, RPC, Edge Functions | Nominare titolare e amministratore tecnico; separare le chiavi pubbliche dai segreti server |
| Jotform AI Agent | Guida dei coordinatori | Custodire accesso istituzionale; aggiornare Knowledge Base e verificare privacy |
| Windows per i segnapunti | Uso sul campo | Inventario, aggiornamenti, antivirus, sessioni singole e prova di connessione |

Il repository contiene un URL Supabase e una chiave **anon/pubblica**, non una `service_role`. Non copiare token privati o backup dentro GitHub o dentro il manuale.

## 2. Account e autorizzazioni

- Designare almeno **un coordinatore principale e un sostituto**, con account separati.
- Conservare la procedura di recupero degli accessi in un archivio sicuro della scuola, non nel repository.
- Verificare ogni anno che gli account non più necessari siano revocati.
- Usare il ruolo Super Admin solo per configurazioni, pubblicazioni e correzioni autorizzate.
- Usare Match Manager e Report Viewer per le attività consentite, senza aggirare RLS o RPC.
- Non condividere l'accesso di un docente con una postazione segnapunti non supervisionata.

## 3. Ambienti: produzione e prova

**Produzione:** `https://itsoscup.it` e il suo progetto Supabase. Qui vivono dati reali di studenti.

**Laboratorio interno:** `/tournament-demo.html` crea simulazioni in memoria senza scritture, ma **non equivale a una copia del database**.

**Staging completo da predisporre:** creare un progetto Supabase e un deployment separati, con dati sintetici. Applicare le migrazioni nella stessa sequenza della produzione; verificare RLS, firme, partite e rollback *prima* di qualsiasi migrazione che possa interessare dati reali. Non copiare dati degli studenti nello staging senza esplicita approvazione della scuola.

Prima di un rilascio:
1. Leggere il diff GitHub e le nuove migrazioni.
2. Eseguire `npm ci`, `npm test`, `npm run check:js`, `npm run check:inline`, `npm run test:innovation`, `npm run test:teams` e `npm run test:e2e` (con Chromium Playwright installato).
3. Provarlo da account Super Admin, Match Manager e Report Viewer; verificare le sezioni negate.
4. Simulare un torneo senza risultati veri: iscrizione → conferma rose → creazione incontri → pianificazione → Match Live → firme → referto.
5. Fare una verifica mobile e da tastiera, con zoom al 200% e stampa A4.
6. Verificare nel sito reale che il caricamento dei nuovi asset non lasci versioni CSS/JS in cache.

## 4. Backup, ripristino e test di ripristino

- Definire con la scuola una politica di backup **gestita in Supabase**, compatibile con il piano attivo: cronologia e disponibilità dei backup dipendono dal servizio. Non presumere che il progetto abbia PITR.
- Periodicamente scaricare/esportare un backup attraverso una procedura approvata che tuteli i dati degli studenti e le chiavi. Proteggere le copie con crittografia, controllo accessi e retention.
- **Ogni trimestre:** ripristinare una copia di test in un progetto isolato con autorizzazione; verificare numero di tornei, partite, rose, tentativi e referti, oltre alle policy RLS.
- Non effettuare mai un test di ripristino sovrascrivendo la produzione.
- Per problemi di dati dopo un rilascio, fermare le modifiche, valutare impatto e coinvolgere il referente tecnico. Un `git revert` annulla soltanto il codice frontend: **non** annulla migrazioni o modifiche del database.
- Annotare **RPO/RTO scelti dalla scuola** (quanti dati si possono perdere e quanto tempo è tollerato per il ripristino). Questi parametri non sono garantiti dal codice.

## 5. Collaudo dei calendari

Configurare un torneo di prova con 4, 6, 8 squadre e uno o più campi. Ripetere per andata semplice e doppio girone.

Verificare:
- nessuna sovrapposizione su campi differenti;
- intervalli minimi di riposo;
- nessuna squadra con tre turni consecutivi;
- andata completa prima di qualunque ritorno;
- gironi prima delle eliminatorie, dove previste;
- gestione di slot insufficienti senza forzare assegnazioni;
- ricalcolo dopo ritardi, considerando partite live e già terminate.

La procedura SQL di pubblicazione `apply_smart_schedule` e i controlli `assert_smart_schedule_fairness` sono parte della protezione; i controlli della UI **non sostituiscono** il server.

## 6. Uso durante la giornata di gara

1. Verificare Internet su tutte le postazioni e aprire le gare assegnate.
2. Controllare operatore, torneo, campo, squadre, rose, cronometro e spazio di firma.
3. Registrare eventi sport-specifici; per la pallamano usare esclusioni e tiri da 7 metri se richiesti, senza confondere la registrazione con l'aggiornamento automatico del punteggio.
4. Per atletica verificare iscrizioni all'evento, unità e cronologia completa dei tentativi.
5. Prima del risultato ufficiale confrontare referto, firme e dati salvati centralmente.
6. Al termine stampare `/tournament-closeout.html`; risolvere gli elementi segnalati prima di archiviare.

## 7. Connessione interrotta

La PWA è **online-first**. In caso di perdita rete non dichiarare conclusi i salvataggi ufficiali. Usare il referto cartaceo di emergenza approvato.

Il workspace USB è storico/sperimentale: vedi `docs/offline-senza-rete.md`. Non usare come unica fonte dati finché non è stata completata una prova fisica su tutti i PC Windows, incluso spegnimento, esportazione, conflitto e riconciliazione.

## 8. Sicurezza dello script Jotform

La Dashboard carica lo script originale Jotform nel **medesimo contesto JavaScript del documento**, non in un iframe sandbox. La scuola deve valutare accesso allo storage del browser, dati eventualmente disponibili nel DOM, termini del fornitore, trasferimenti e informativa. Limitare l'utilizzo alle sole procedure di supporto; mai inserire password, token, codici delle classi o dati personali.

Aggiornare `docs/manuale-coordinatore-jotform.md` e testare 15 FAQ dopo modifiche operative. Il Jotform esterno può essere raggiungibile indipendentemente dal login ITSOSCup: configurare le restrizioni direttamente dal servizio.

## 9. Esito della consegna

Il successore ha superato la formazione soltanto se riesce autonomamente, in un ambiente senza dati reali, a:
- accedere con ruolo corretto e spiegare le restrizioni;
- creare un torneo, una scadenza e una rosa di prova;
- verificare la rosa definitiva e generare il calendario;
- identificare sovrapposizioni e spiegare il limite di due turni;
- simulare un risultato, recuperare un referto e avviare la verifica finale;
- descrivere cosa fare senza Internet e in caso di conflitto;
- individuare il referente backup, dominio e credenziali.

**Registro delle prove:** data, responsabile, versione commit, scenario, esito, anomalie, prossima verifica. Le firme personali del registro vanno custodite dalla scuola e non pubblicate nel repository.

## 10. Contatti e governance da compilare dalla scuola

- Coordinatore principale: _da assegnare_
- Sostituto: _da assegnare_
- Referente tecnico GitHub/Supabase: _da assegnare_
- Referente privacy/DPO: _da assegnare_
- Gestione dominio e scadenza: _da assegnare_
- Ubicazione della procedura di accesso e backup: _archivio riservato, da indicare senza credenziali_
- Data del prossimo collaudo annuale: _da fissare_

La mancanza di un referente identificato in queste righe è un'attività organizzativa da completare prima del passaggio di consegne.
