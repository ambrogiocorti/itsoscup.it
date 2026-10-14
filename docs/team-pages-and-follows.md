# Pagine squadra e preferiti locali

La pagina autonoma è `team.html?sport=<id>&team=<id>`. Le vecchie rotte della home con `sport` e `team` reindirizzano prima del caricamento dei dati, anche con `/index.html`. Le classifiche e i nomi squadra nel dettaglio delle partite conducono alla nuova pagina. Il link «Torna al torneo» conserva il torneo selezionato.

La pagina contiene intestazione, statistiche calcolate dal motore della classifica esistente, prossima partita, calendario delle partite da giocare (incluse sospensioni, rinvii e annullamenti), storico dei risultati, rosa/capitano e avvisi pubblici della sola squadra. Non contiene le sezioni generali della home. Per atletica, che usa eventi e risultati individuali invece di partite tra squadre, indica il collegamento al torneo per la classifica individuale.

## Come funzionano «Segui squadra» e «Le mie squadre»

Il primo «Segui squadra» richiede consenso esplicito al salvataggio sul browser. La preferenza usa `tornei_device_id`, già gestito da `device.js`, senza introdurre un secondo identificativo. Non legge né scrive `team_favorites` sul server e non richiede login. I precedenti preferiti cloud non vengono importati automaticamente: l'API anonima preesistente non offre una prova affidabile di proprietà del dispositivo.

`tornei_team_follows_v1` conserva soltanto consenso, identificativi di torneo/squadra, impronte dei dati pubblici, risultati, date, stato e letture. Non conserva nomi degli studenti, rose, nomi delle classi, testo degli avvisi o codici di accesso classe. Gli avvisi sono identificati con un'impronta SHA-256; il testo è recuperato nuovamente dall'RPC pubblica. Le preferenze rimangono dopo la chiusura del browser ordinario; in navigazione privata o dopo la cancellazione dei dati del sito possono scomparire. Sono specifiche del browser/profilo/dispositivo e non vengono sincronizzate con altri dispositivi.

La home mostra tutte le squadre seguite, prossimo incontro, ultimo risultato, riepilogo degli avvisi e aggiornamenti nuovi/letti. Ogni squadra permette di smettere di seguirla; «Cancella preferiti» rimuove preferenze, consenso e letture locali senza cancellare l'identificativo dispositivo condiviso. Anche dati locali danneggiati possono essere cancellati dall'interfaccia. Archiviazione negata o piena produce un errore comprensibile senza dichiarare salvata una preferenza.

Il primo controllo stabilisce una base e non segnala come nuovi tutti i risultati precedenti. I controlli successivi riconoscono nuovi risultati e correzioni del risultato finale, variazioni di orario/campo, rinvii/annullamenti/sospensioni, nuove partite e nuovi avvisi pubblici o modifiche del loro testo. I gol live non producono una notifica a ogni azione. Controlli identici non duplicano gli aggiornamenti; variazioni ripetute dello stesso tipo ancora non lette vengono riunite. «Letto» e «Segna tutti come letti» salvano la lettura. Avvisi non più pubblicati vengono rimossi dalle novità locali; un errore temporaneo nell'RPC non cancella la base di confronto.

I dati si aggiornano manualmente, ogni minuto mentre la pagina è visibile, alla riapertura della pagina e al ritorno della connessione. La pagina squadra usa inoltre il canale Realtime delle partite esistente. Non sono implementate né promesse notifiche push, notifiche a browser chiuso o sincronizzazione in background. Due schede dello stesso browser ricevono le modifiche ai preferiti tramite eventi `storage`; un controllo invariato non riscrive i dati, evitando cicli di aggiornamento tra schede.

Per limitare accumuli locali sono conservate al massimo 20 squadre, 60 aggiornamenti per squadra, 500 impronte di partite per squadra e i 30 avvisi restituiti dall'RPC. L'interfaccia mostra gli ultimi 12 aggiornamenti e indica quando ne esistono altri. «Segna tutti come letti» si applica esplicitamente a tutti gli aggiornamenti conservati.

## Privacy e limiti del database

La nuova pagina riutilizza `getPrivacySettings` e `formatPublicPlayerName`. Quando `player_name` è `hidden`, non effettua alcuna richiesta alla tabella `players`, nasconde la rosa e i nomi delle classi. Per le rose pubbliche richiede solo `id, full_name, is_captain`, applicando l'abbreviazione configurata. Se la configurazione privacy non può essere caricata, interrompe la visualizzazione; una nuova richiesta fallita nasconde anche la rosa precedentemente visibile.

Gli avvisi provengono esclusivamente da `public_team_notices`, con identificativi validati, e vengono mostrati come testo escapato. Non accede alle tabelle private di inviti, registrazioni, destinatari o letture. La pubblicazione effettiva e l'appartenenza alla squadra dipendono dalle restrizioni server dell'RPC esistente.

Queste garanzie dell'interfaccia non correggono la policy RLS preesistente di `players`, che permette letture anonime di righe complete; né revocano la policy anonima troppo permissiva di `team_favorites`. L'audit del database documenta la necessità di una migrazione distinta e compatibile con i client esistenti. Il nuovo sistema di preferiti evita di usare l'API vulnerabile.

## Verifiche riproducibili

- `node --test tests/team-follow.test.mjs`: rotte, selezione della prossima partita, escaping/privacy, consenso, identità dispositivo, persistenza, revoca, base iniziale, correzioni, deduplicazione/letture, errori e limiti di archiviazione, mancata riscrittura dei controlli invariati.
- `npx playwright test tests/e2e/team-follow.spec.mjs tests/e2e/team-notices.spec.mjs`: desktop e smartphone, redirect dei vecchi collegamenti, pagina autonoma, link dalla classifica, contenuti, assenza di overflow, home personalizzata, rinvii/risultati/avvisi, letture, privacy senza richiesta della rosa nascosta, escaping, errori di configurazione/avvisi/archiviazione e compatibilità dei test avvisi preesistenti.
- Il test di persistenza chiude davvero un processo Chromium con profilo temporaneo e ne avvia un altro sullo stesso profilo: preferito, identificativo e letture sono verificati dopo il riavvio. Ogni test usa soltanto dati sintetici; nessuna scrittura su Supabase o dato reale degli studenti.
- `node tests/js-syntax-check.mjs` e `node tests/static-checks.mjs` verificano il caricamento dei moduli e la compatibilità con il progetto.

Il collaudo browser usa il client Supabase simulato: prova il flusso pubblico completo senza dipendere da dati personali o creare righe sul database reale. Disponibilità dell'RPC e RLS reali sono oggetto del separato audit in lettura. Il funzionamento degli aggiornamenti richiede che il browser possa raggiungere i dati pubblici quando torna online; la semplice cache PWA non viene presentata come un servizio push.
