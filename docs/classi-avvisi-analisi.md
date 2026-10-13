# ITSOSCup — moduli classi, avvisi e analisi

## Stato di rilascio

La piattaforma pubblicata continua a usare Supabase `nalxfsbjeinptjflvndp`.
Le migrazioni sono state **applicate** a questo database; il frontend rimane
nel branch `feat/offline-registrations-notices-analytics` fino alla pubblicazione.

### Funzionalità

- **Iscrizioni:** un invito per classe, codice di accesso casuale, roster e
  capitano, proposta in sospeso, approvazione/rifiuto; approvando si crea una
  squadra con i giocatori. I duplicati di classe/squadra sono bloccati.
- **Avvisi:** un amministratore operativo seleziona le classi destinatarie.
  Le classi visualizzano gli avvisi tramite il portale e confermano la lettura.
  Il trigger del calendario pubblica automaticamente gli aggiornamenti per le
  classi con iscrizioni approvate coinvolte nella partita. Le notifiche
  **non sono push su un dispositivo chiuso**: il portale deve essere consultato.
- **Analisi:** partite concluse, mancanti, ritardo medio solo con timestamp
  misurabili, durata, riprogrammazioni, riaperture per correzione ed export CSV.
  `ND` indica campione insufficiente.
- **Offline:** le nuove pagine e dipendenze sono precaricate dal service worker
  per consultazione dove esistano cache. **L'offline completo NON è ancora
  implementato.** Le operazioni dipendono dall'API Supabase e dal suo sistema
  di autenticazione remota, e il frontend carica l'SDK da CDN.

## Uso

1. Aprire `admin/innovation.html` dal link **Classi · Avvisi · Analisi**
   nella dashboard amministrativa.
2. Selezionare torneo, aggiungere una classe e distribuire il collegamento
   generato in modo riservato alla classe.
3. La classe usa `class.html` per inviare la rosa, scegliere il capitano,
   consultare gli avvisi e confermare le letture.
4. Il responsabile approva la proposta, che diventa una squadra reale nel torneo.
5. Dal pannello si selezionano le classi e si pubblicano i messaggi. Le variazioni
   ai dati di calendario delle partite registrate sono comunicate automaticamente.
6. La sezione Analisi mostra indicatori reali ed esporta un CSV.

## Migrazioni applicate in ordine

- `sql/040_class_portal.sql` — tabelle, RLS e funzioni. La versione nel branch
  include il revoca dell'esecuzione anonima delle funzioni amministrative,
  eseguita anche con una migrazione di correzione nel database.
- `sql/042_remove_permissive_policies.sql` — elimina le vecchie policy
  `Allow all` e revoca i permessi di scrittura anonimi.
- `sql/043_admin_directory_policy.sql` — lettura staff autorizzato.
- `sql/044_automatic_class_schedule_notices.sql` — trigger di calendario.
- `sql/045_class_notice_sort_order.sql` — ordinamento deterministico.

Per nuovi ambienti, applicare tutte queste migrazioni nell'ordine indicato,
dopo aver ripristinato lo schema storico e le funzioni amministrative esistenti.

## Test completati

- Privilegi `anon`: nessuna scrittura su sports/teams/players/matches/match_stats.
- Policy per `report_viewer`, `match_manager`, `super_admin`.
- Flusso DB (in una transazione `BEGIN ... ROLLBACK`): inserimento proposta
  di classe, approvazione, creazione squadra e giocatori, invio comunicazione
  e conferma lettura.
- Trigger di calendario (stesso metodo): inserimento partita e riprogrammazione
  producono due avvisi della classe.
- GitHub Actions: controlli sintattici JS e HTML e test unitari delle metriche.

**Non verificato:** test manuale browser con utenti reali, notifica fuori dal
portale, test offline completo e sincronizzazione fra più postazioni. La suite
statica storica `npm test` richiede file `supabase/` e `sql/` presenti nel
progetto locale originale ma non ancora tutti inclusi nella repository GitHub.

## Prima di usare a scuola

- Proteggere i codici delle classi: sono credenziali d'accesso, non link pubblici.
- Controllare informativa privacy, minimizzazione e durata della conservazione
  dei nomi degli studenti. Valutare l'esposizione pubblica dei roster esistenti.
- Configurare rate limit e protezione dagli abusi sugli endpoint anonimi.
- Eseguire un collaudo con credenziali di prova e aggiornare la procedura di
  backup e ripristino del database.

## Offline completo — prerequisito architetturale

L'attuale sito usa una base dati cloud e autenticazione Supabase, quindi le
pagine precaricate non equivalgono a un sistema interamente offline. Per
garantire iscrizioni, orari, gestione partite e firme senza Internet occorre:

1. **Backend locale autonomo** con archivio persistente, backup cifrati e
   credenziali utilizzabili senza cloud.
2. **Frontend e dipendenze locali**: nessun caricamento da CDN.
3. **Topologia postazioni**: un server sulla LAN per sincronizzare i campi in
   tempo reale (quando una rete locale è disponibile), oppure scritture separate
   con identificativi e rilevazione dei conflitti.
4. **Sincronizzazione verso il cloud** quando torna Internet: code idempotenti,
   versioni dei record, audit e gestione dei conflitti prima del commit.
5. Test reali di spegnimento rete durante partite, riavvio del server, conflitti
   contemporanei, credenziali offline, backup e ripristino.

**Non pubblicizzare l'offline completo prima della prova su più dispositivi.**
