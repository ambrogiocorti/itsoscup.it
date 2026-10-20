# Tornei Scuola

ITSOSCup è un'unica piattaforma online per i tornei scolastici, installabile come PWA dal sito: tornei, squadre, calendario, live match, firme capitani, report, atletica, QR campo, Telegram e archivio.

Il frontend e HTML/CSS/JavaScript vanilla. Supabase gestisce Auth, PostgreSQL, RLS, RPC, trigger, Edge Functions e dati realtime.

## Installazione come app Windows (PWA)

La distribuzione consigliata è **https://itsoscup.it**, non il vecchio `.exe`.

1. Da **Microsoft Edge o Google Chrome** visita `https://itsoscup.it` con Internet attivo.
2. Premi **Installa ITSOSCup** (icona di download nell'intestazione pubblica o nella barra della dashboard). Se il browser non propone l'installazione, usa il menu browser → **App → Installa questo sito come app**.
3. Avvia l'app dal desktop o dal menu Start. Aprirà lo stesso sito in una finestra dedicata e si aggiornerà con i normali deploy, senza installare nuove versioni `.exe`.
4. Usa **lo stesso account Supabase Auth della piattaforma**. Il ruolo `super_admin` apre la dashboard completa, `match_manager` apre di norma il Calendario e la diretta, `report_viewer` consulta i report.
5. **Serve Internet per autenticarsi, registrare le partite e salvare i risultati.** Il service worker non conserva in cache pagine admin/live o dati delle partite. Un'interruzione mostra un messaggio e richiede il ripristino della connessione.

Non si crea un nuovo account, PIN USB, password archivio o database PWA: la PWA utilizza quello online. I due ruoli vedono schermate appropriate **dentro la stessa applicazione**. Per sicurezza, continuare a usare RLS e RPC Supabase: nascondere un pulsante non conferisce né revoca permessi.

Le precedenti funzioni di trasferimento USB/Key non compaiono più nel Calendario o nel Centro di controllo. Il vecchio sorgente Windows e la pagina offline legacy restano temporaneamente nel repository solo per il recupero di eventuali archivi e dati preesistenti: **non eliminare le cartelle dati Windows prima di averli verificati**. La compilazione Windows è attivabile soltanto manualmente, senza build automatiche.


## Strumenti del torneo (solo web)

Dal Calendario dell'amministrazione, apri **Strumenti torneo** (`tournament-tools.html`).

- **Pianificazione intelligente**: seleziona torneo, data, fascia oraria, durata, riposo e campi. La proposta considera conflitti con incontri gia' programmati; gli incontri che non rientrano nella fascia scelta rimangono non assegnati. Pubblicazione disponibile solo al Super Admin, previa conferma.
- **Recupero ritardi**: ripianifica gli incontri futuri non iniziati, senza alterare partite concluse o live. Le modifiche sono soggette a convalida server-side.
- **Verifica pre-gara**: controlla campi, orari, check-in e squalifiche confermate. I risultati sono segnalazioni informative, non decisioni automatiche.
- **Documenti**: prepara e stampa in PDF relazione finale e attestati. I referti firmati rimangono scaricabili dalla pagina Calendario.
- **Maxischermo**: in `gym.html` scegli Palestra o Atrio; visualizza ora, punteggi, calendario e comunicazioni urgenti. Schermo intero su richiesta.
- **Notifiche**: è riutilizzato il sistema Web Push esistente, con consenso esplicito e opzione «Solo squadre seguite». La pubblicazione di variazioni usa i trigger già presenti.

**Database**: le migrazioni da `050` a `059` aggiungono generazione sicura del calendario, iscrizioni, pallamano, rose definitive e iscrizioni atletica. Sono già state applicate al progetto Supabase della piattaforma; su nuove installazioni vanno eseguite in ordine e verificate in ambiente separato prima della produzione. Non è inclusa alcuna app Android.

## Funzionalita principali

- Portale pubblico con tornei, classifiche, partite, albo d'oro, pagina squadra e vista campo via QR.
- Dashboard admin multi-ruolo con calendario, campi, squadre, report, atletica, Telegram, impostazioni e Centro di controllo.
- Centro di controllo riservato al Super Admin con checklist pre-giornata, stato campi, postazioni, ritardi, problemi e analytics.
- Gestione admin dentro Impostazioni Superadmin: creazione Auth, ruoli, nome visualizzato, ultimo accesso e postazione associata.
- Calendario tabellare e vista calendario con drag-and-drop per spostare match mantenendo ora/durata.
- Formati torneo disponibili nell'interfaccia: gironi ed eliminazione diretta.
- Live match con lock, snapshot, timer, punteggio, roster, presenze, falli, MVP, cartellini e cronologia opzionale.
- Chiusura match con referto finale, staff gara e doppia firma elettronica dei capitani.
- PWA online-first: installazione da browser, aggiornamenti del sito, un solo database e pagina chiara quando la rete non è disponibile.
- Registro modifiche con utente/postazione, valori precedenti, nuovi valori, data/ora e motivazione.
- Backup/ripristino, privacy pubblica configurabile, squalifiche da confermare, rinvii e controlli conflitti.
- Atletica con eventi, risultati, tentativi, ranking, batterie/corsie, qualificazioni/finali, record d'istituto, staffette e stati atleta.
- Test statici, sintassi JavaScript, test Playwright desktop/mobile e CI GitHub.

## Pagine

- `/` o `index.html`: pagina pubblica studenti/docenti.
- `/admin/`: dashboard amministrativa canonica.
- `admin.html` e `admin/admin.html`: redirect verso `/admin/`.
- `live.html?match=<id>`: gestione live del match.
- `gym.html`: schermo palestra/proiettore.
- `bracket-demo.html`: demo quadro eliminazione con dati realistici.

## Ruoli

- `super_admin`: accesso completo, Centro di controllo, gestione globale campi/postazioni e risultati ufficiali.
- `match_manager`: gestione match/live e report consentiti.
- `report_viewer`: consultazione report.

Le regole lato UI sono in `js/auth.js`; la protezione reale va mantenuta con RLS/RPC nel database.

## Setup rapido

1. Crea o apri il progetto Supabase.
2. Apri SQL Editor.
3. Esegui tutte le migrazioni `sql/*.sql` in ordine crescente.
4. Configura `js/app-config.js` con `supabaseUrl` e `supabaseAnonKey`.
5. Deploya le Edge Functions Telegram se vuoi inviare messaggi automatici.
6. Deploya `manage-admin-user` se vuoi creare/modificare admin dalla dashboard.
7. Pubblica i file statici su GitHub Pages o avvia un server locale.
8. Apri `/` per il pubblico e `/admin/` per la dashboard.

Per dati demo puoi eseguire `sql/002_seed_demo_tornei.sql` dopo lo schema base.

## Migrazioni SQL

- `001_refactor_hybrid.sql`: schema principale, RLS, view e RPC.
- `002_seed_demo_tornei.sql`: dati demo.
- `003_mvp_config_per_torneo.sql`: configurazione MVP.
- `004_fix_legacy_foreign_keys.sql`: correzioni FK legacy.
- `005_fix_finalize_match_ambiguous.sql`: fix finalizzazione.
- `006_fix_allow_mvp_schema_cache.sql`: compatibilita `allow_mvp`.
- `007_atletica_attempts_limits.sql`: tentativi/limiti atletica.
- `008_hard_guards_matches_and_orphans.sql`: guardie e pulizia orfani.
- `009_schedule_push_archive_signatures.sql`: campi, orari, capitani, firme, QR, albo.
- `010_notifications_archive_card_limits.sql`: limiti cartellini e compatibilita.
- `011_save_team_captain_rpc.sql`: RPC salvataggio squadre/capitani.
- `012_fix_team_and_sport_admin_rpc.sql`: RPC admin squadre/tornei.
- `015_disable_web_push_use_telegram.sql`: disattiva Web Push legacy.
- `016_telegram_match_reminders.sql`: promemoria match Telegram.
- `017_drop_web_push_legacy.sql`: elimina tabelle/RPC Web Push legacy.
- `018_telegram_team_notifications.sql`: notifiche squadra Telegram.
- `019_fix_finalize_match_with_signatures_ambiguous.sql`: fix firme capitani.
- `020_fix_finalize_signature_conflict_targets.sql`: fix conflict target statistiche/firme.
- `021_audit_reopen_emergency_foundation.sql`: audit, correzioni controllate, ranking/privacy.
- `022_complete_operational_modules.sql`: staff, disponibilita, eventi live, squalifiche, rinvii, backup, privacy, atletica avanzata.
- `023_devices_admin_offline_audit.sql`: dispositivi/postazioni e audit con origine dispositivo.
- `024_platform_professional_completion.sql`: dashboard oggi, notifiche interne, stati operativi, check-in, template comunicazioni, salute sistema.
- `025_official_ops_devices_validation_logs.sql`: registro dispositivi, log errori, log accessi sensibili, impostazioni piattaforma, validatore pre-evento.
- `026_admin_users_formats_migration_check.sql`: formati torneo avanzati, vincolo corsie atletica e registro migrazioni verificabile dalla dashboard.
- `027_fix_platform_backup_restore_players.sql`: ripristino backup completo anche su squadre, giocatori e capitani.
- `028_public_notifications_superadmin.sql`: notifiche pubbliche visibili dal campanello della home.
- `029_admin_profile_resolution.sql`: risoluzione profilo admin.
- `030_admin_uuid_only.sql`: controllo admin basato su UUID Auth.
- `031_limit_tournament_formats.sql`: limita i formati esposti a gironi ed eliminazione diretta.
- `032_issue_reports_rpc.sql`: RPC per segnalazioni problemi pubbliche e lettura admin.
- `033_regia_operational_control.sql`: ruolo Regia, Centro Operativo, postazioni match, stati campo, ritardi, approvazione ufficiale e scadenza notifiche.
- `034_regia_permissions_patch.sql`: allinea RPC e policy precedenti al ruolo Regia.
- `035_auto_shift_after_late_finish.sql`: slitta automaticamente i match successivi dello stesso campo quando una live viene chiusa in ritardo.
- `037_regia_live_permissions.sql`: abilita correttamente Regia sulle RPC live storiche che usano `can_manage_matches`.
- `038_disable_regia_emergency_controls.sql`: rimuove dalla superficie applicativa i controlli globali Emergenza/Riprendi evento.
- `039_remove_regia_role.sql`: converte eventuali utenti Regia in Super Admin e rimuove il ruolo Regia dalla piattaforma.

## Telegram

1. Crea un bot con BotFather.
2. Aggiungilo come amministratore del canale.
3. Imposta i secrets:

```powershell
supabase secrets set TELEGRAM_BOT_TOKEN="TOKEN_BOT" TELEGRAM_CHAT_ID="@itsoscup" --project-ref nalxfsbjeinptjflvndp
supabase functions deploy send-telegram-match --project-ref nalxfsbjeinptjflvndp
supabase functions deploy send-telegram-team --project-ref nalxfsbjeinptjflvndp
```

Nel pannello admin puoi inviare un promemoria dal menu a tre puntini del match o una comunicazione dalla tabella squadre. La sezione Telegram mostra anche il QR del canale e i template messaggio.

## Gestione admin

La gestione utenti in `/admin/` e visibile ai profili autorizzati. Solo i Super Admin possono creare, modificare o cancellare altri account amministrativi.

```powershell
supabase functions deploy manage-admin-user --project-ref nalxfsbjeinptjflvndp
```

La funzione usa `SUPABASE_SERVICE_ROLE_KEY` solo lato Supabase Edge Function. Non inserirla mai in `js/app-config.js`.

Secrets richiesti per la funzione:

```powershell
supabase secrets set SUPABASE_URL="https://nalxfsbjeinptjflvndp.supabase.co" SUPABASE_ANON_KEY="ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="SERVICE_ROLE_KEY" --project-ref nalxfsbjeinptjflvndp
```

## Modalità online e offline: stato ufficiale

**La PWA distribuita da https://itsoscup.it è online-first, NON una postazione di arbitraggio totalmente offline.** Il suo service worker (`sw.js`) rifiuta esplicitamente di usare vecchie pagine admin/live in cache: in caso di navigazione senza Internet compare una schermata 503 «Connessione Internet necessaria». I salvataggi ufficiali dei risultati, l'autenticazione e la chiusura dei referti richiedono connessione al backend Supabase.

Il repository contiene ancora un workspace per chiavette USB e una vecchia procedura basata su cache e file cifrati. È una funzione **legacy/sperimentale**, non parte del percorso ufficialmente supportato dalla PWA. Non promettere al personale che la sola preparazione della pagina garantisca la riapertura offline o che gli snapshot salvati nel browser vengano sempre sincronizzati. L'utilizzo durante un evento reale richiede un collaudo su PC Windows scolastici, isolando davvero Internet e rete locale e verificando esportazione, importazione e riconciliazione. Vedi `docs/offline-senza-rete.md`.

Se la connessione viene meno durante un evento ufficiale:
1. Bloccare nuove modifiche alla partita e documentare il punteggio con la procedura cartacea approvata dall'istituto.
2. Non chiudere schede o cancellare dati locali se compare un avviso di operazioni non sincronizzate.
3. Quando la rete è disponibile, verificare la versione centrale e gli eventuali conflitti **prima** di confermare o sovrascrivere.
4. Inserire/riconciliare solo attraverso l'account autorizzato, controllando l'esito in Calendario, Referti e Registro modifiche.

### Funzioni nuove per i coordinatori

- `/tournament-setup.html`: percorso guidato per il Super Admin (crea torneo, scadenze, rose, incontri, calendario).
- `/tournament-demo.html`: esercitazione isolata **solo per simulazioni in memoria**, senza scritture su Supabase.
- `/tournament-insights.html`: confronto dei tornei per sport e anno di creazione, senza nominativi degli studenti.
- `/tournament-closeout.html`: verifica finale **di sola lettura** prima dell'archiviazione: gare concluse, risultati, pianificazione e firme dei capitani; per l'atletica, discipline e risultati delle iscrizioni. Il report è stampabile ma non ufficializza o blocca il torneo.
- Dashboard → **Preparazione del torneo**: controlli informativi di iscrizioni, rose e partite.
- Squadre → **Conferma definitiva delle rose**: sigillo protetto dal database, riapertura motivata e registrata.
- Atletica → **Iscrizioni agli eventi**: distingue partecipazione e risultati; le schede includono gli atleti iscritti prima del primo tentativo.
- Match Live → Pallamano: esclusioni da due minuti e tiri da sette metri nel registro; la validazione sportiva dell'evento e la firma del referto restano responsabilità dell'operatore.


## Test

```powershell
npm install
npm test
npm run check:js
npx playwright install chromium
npm run test:e2e
```

CI GitHub: `.github/workflows/ci.yml` esegue static checks, sintassi JavaScript e Playwright desktop/mobile.

## Sicurezza

- Nel frontend devono esserci solo chiavi Supabase pubbliche `anon`.
- Nessuna password operativa e nessuna service role key in JavaScript.
- `APP_CONFIG.allowDirectTableFallbacks` e disabilitato di default.
- RLS e RPC sono obbligatorie per operazioni critiche.
- Il log errori e il log accessi sensibili sono gestiti da migrazione `025`.
- La dashboard mostra le migrazioni applicate lette da `platform_migrations`; se manca `039`, applica l'ultimo file SQL e ricarica la pagina.

## Struttura

```text
.
|-- admin/
|   `-- index.html
|-- admin.html
|-- index.html
|-- live.html
|-- gym.html
|-- bracket-demo.html
|-- manifest.webmanifest
|-- sw.js
|-- css/
|   |-- style.css
|   `-- admin-modules.css
|-- js/
|   |-- admin-users.js
|   |-- admin-users-panel.js
|   |-- admin-system.js
|   |-- app-config.js
|   |-- auth.js
|   |-- db.js
|   |-- error-logger.js
|   |-- main-admin.js
|   |-- main-index.js
|   |-- main-live.js
|   |-- matches.js
|   |-- offline-db.js
|   |-- offline-store.js
|   |-- platform-ops.js
|   `-- utils.js
|-- sql/
|-- supabase/functions/
|   |-- manage-admin-user/
|   |-- send-telegram-match/
|   `-- send-telegram-team/
|-- tests/
`-- vendor/
```

## Continuità e responsabilità della scuola

Leggere [il runbook operativo e di passaggio di consegne](docs/continuita-operativa.md). Descrive ambienti, ruoli, collaudi, backup/ripristino, responsabilità e misure di emergenza. Il laboratorio in memoria **non è un database staging** e non equivale a un collaudo di ripristino.
