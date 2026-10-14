# ITSOSCup Key: verifica del backend e confini di fiducia

Analisi del 14 ottobre 2026. Il progetto Supabase `nalxfsbjeinptjflvndp` corrisponde all'URL già configurato ed era `ACTIVE_HEALTHY`, PostgreSQL 17. Le interrogazioni collegate hanno letto esclusivamente metadati di schema, funzioni, policy e advisor. Nessun record degli studenti è stato letto, modificato o cancellato. La migrazione Key non è stata applicata al database centrale.

## Componenti riutilizzati

- `admins.id = auth.uid()` e `admins.ruolo` sono l'autorità dei permessi, mediante `current_admin_role()` e `can_manage_matches()`. Nessuna autorizzazione usa `user_metadata`.
- `registered_devices`, `matches.assigned_device_id`, `venues`, `sport_config`, rose, statistiche e `lock_version` conservano i contratti esistenti.
- L'importazione chiude il referto attraverso l'effettivo `finalize_match_with_signatures`, già presente. La transazione include punteggio, statistiche, entrambe le firme e registrazione dell'operazione. Il test SQL usa una copia della definizione ottenuta dai metadati, senza dati reali.
- Gli avvisi pubblici usano `public_team_notices(p_sport_id,p_team_id)`: solo `published_to_team=true` e destinatari con iscrizione approvata. `class_notices`, `class_notice_recipients` e gli inviti privati restano sotto policy amministrative.

## Migrazione e API

Il file `supabase/migrations/20261014092322_key_station_import.sql` è stato creato con `supabase migration new`. `sql/050_key_station_import.sql` è la copia per il flusso storico della repository; applicare **una sola copia**, senza eseguire entrambe.

| RPC | Parametri | Esito |
| --- | --- | --- |
| `prepare_key_station` | `p_station_id uuid`, `p_sport_id bigint`, `p_match_ids bigint[]`, `p_label text`, `p_venue_id bigint` facoltativo | Identità preparazione/postazione, segreto Base64 di 32 byte, scadenza e versioni delle partite |
| `import_key_operation` | `p_operation jsonb` | ID operazione/partita, `imported`, `duplicate`, `conflict` o `rejected`, versione remota e messaggio |
| `create_key_receipt` | `p_preparation_id uuid`, `p_results_package_id uuid`, `p_operation_ids uuid[]` | Ricevuta persistita e autenticata con HMAC; ogni risultato contiene `report_hash` e `content_hash` |

Le tre RPC sono eseguibili soltanto da `authenticated` e controllano nuovamente il ruolo centrale `super_admin` o `match_manager`. Le tabelle dello schema privato `itsoscup_key` hanno RLS attiva e nessun privilegio per `PUBLIC`, `anon` o `authenticated`; il segreto non viene esposto con una query pubblica.

La preparazione registra una nuova postazione solo dentro l'RPC autenticata. Non cambia l'assegnazione di partite già affidate ad altre postazioni e rifiuta partite concluse, lock attivi e tornei/campi incompatibili. La creazione, le assegnazioni e le versioni sono atomiche. La disponibilità offline deve essere confermata dopo avere effettivamente generato e importato il pacchetto sulla chiavetta.

L'importazione verifica il segreto della preparazione con HMAC, autorizzazione partita/versione, revoche, assegnazione attuale e lock. Una versione cambiata o una partita già conclusa produce un conflitto registrato: non sovrascrive il referto. L'UUID operazione è globale; un contenuto diverso con lo stesso UUID viene rifiutato. Le ricevute confermano solo operazioni registrate e legano gli esiti al report e all'intero contenuto originale. Il client deve verificare anche il pacchetto esportato a cui la ricevuta si riferisce.

La validazione centrale richiede tipi JSON esatti: le stringhe `"true"`, `"yes"` o `"on"` non sono convertite in booleani del referto. Gli ID delle ricevute devono essere presenti e univoci; lo stesso UUID pacchetto non può essere riutilizzato per richiedere una ricevuta con operazioni differenti.

## Protocollo verificabile

L'involucro trasferito resta `itsoscup-offline-transfer`, versione 1, PBKDF2-SHA256 con 260000 iterazioni e AES-256-GCM. Il contenuto Key decifrato è versione 2. La preparazione include il segreto di autorizzazione; i risultati e le ricevute lo omettono.

L'operazione contiene `id`, `type=key_report`, `match_id`, `base_version`, `preparation_id`, `station_id`, `payload`, `report_revision`, `report_hash`, `signatures_payload`, `audit_log`, `auth_tag`. `payload` è il solo stato sportivo, compresi `stats_snapshot`, `event_log` e `is_finished=true`; firme, hash e storico sono al livello dell'operazione.

- `report_hash = SHA256(canonicalJSON({match_id,payload,report_revision}))`.
- Ogni firma contiene quel `report_hash` e il capitano della relativa rosa; le immagini devono avere intestazione PNG valida e dimensione limitata.
- `auth_tag = HMAC-SHA256(secret, canonicalJSON(operation senza auth_tag))`.
- `content_hash` della ricevuta è SHA256 dello stesso contenuto completo senza `auth_tag`.
- Lo storico è una catena di hash con revisioni consecutive; l'ultima voce `finalize` deve riferirsi al payload finale. L'intera operazione firmata, lo storico e gli hash vengono conservati nello schema privato.
- La canonicalizzazione ordina le chiavi ASCII e ammette solo numeri interi sicuri JavaScript. Le stringhe, compresi nomi e note Unicode, sono supportate.

La cifratura protegge i file della chiavetta smarrita quando la password è custodita separatamente. Il segreto di preparazione vincola i risultati alle partite assegnate e permette una verifica centralizzata; **non costituisce una firma hardware**. Una persona che conosce la password dell'archivio e ne estrae il segreto può costruire un altro pacchetto per le partite assegnate. PIN, ruoli, revisione dei capitani e storico regolano il flusso dell'applicazione; la verifica umana dei referti rimane necessaria. Le firme raccolte sono attestazioni grafiche del processo, non firme digitali qualificate.

## Criticità preesistenti rilevate

Questa migrazione è aggiuntiva e non modifica i privilegi storici, per evitare regressioni non verificate sul servizio reale.

- `team_favorites_public_device` usa `FOR ALL TO anon,authenticated USING(true) WITH CHECK(true)`: non garantisce proprietà del dispositivo. Il nuovo flusso preferiti deve evitare quel servizio e usare il salvataggio locale consensuale finché non esiste un'autorità sicura del proprietario.
- `players_public_read USING(true)` espone il contenuto della tabella, che comprende `full_name` e `student_code`. Le impostazioni `privacy_settings` del sito regolano la visualizzazione e non costituiscono una restrizione server. Va affrontato in una migrazione dedicata con test di compatibilità e query pubbliche a campi minimi.
- Il vecchio `register_device` è `SECURITY DEFINER`, eseguibile da anon e privo di verifica `auth.uid()`. La risposta include campi operativi della postazione. Key usa la nuova registrazione autenticata.
- `save_live_snapshot` controlla proprietario/versione/scadenza del lock, ma non rivaluta il ruolo corrente. Le nuove RPC Key controllano il ruolo prima di importare.
- Gli advisor segnalano due viste con privilegi del proprietario (`v_team_standings`, `v_player_ranking`), due funzioni con `search_path` mutabile, `pg_net` nello schema pubblico, protezione password compromesse disabilitata e numerose RPC `SECURITY DEFINER` eseguibili dalle API. Alcune sono intenzionalmente pubbliche; il loro corpo va valutato singolarmente.

Riferimenti ufficiali: [RLS e viste security invoker](https://supabase.com/docs/guides/database/postgres/row-level-security), [advisor sulle viste](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [advisor sulle RPC pubbliche](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [sicurezza password](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Sono state consultate le note correnti Supabase: [deprecazione cifrari TLS](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) e [aggiornamenti PostgreSQL/pgcrypto](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes). Key usa il runtime Chromium/Node locale e AES-GCM; non dipende dai cifrari pgcrypto legacy per i pacchetti USB.

## Verifica e limiti

`tests/key-sql.test.mjs` esegue la migrazione su PostgreSQL isolato con [PGlite e pgcrypto](https://pglite.dev/extensions/), rose e partite sintetiche. Verifica permessi, canonicalizzazione tra JavaScript e PostgreSQL, assegnazioni atomiche, chiusura con firme/statistiche, importazioni duplicate, conflitti, alterazioni, PNG corrotti, capitani o giocatori errati, revoche e ricevute. Comprende un trasferimento completo usando il vero Engine/Vault SQLite desktop, la crittografia browser e la ricevuta SQL, con riapertura dell'archivio cifrato.

Questi test non sostituiscono il collaudo su chiavette fisiche, la perdita improvvisa di alimentazione, due computer Windows completamente isolati né un test di concorrenza con due sessioni PostgreSQL native. PGlite serializza l'accesso locale; i lock transazionali sono verificati funzionalmente, non sotto carico multiprocesso. L'applicazione della migrazione centrale e la verifica dei flussi sulle credenziali amministrative reali restano operazioni di rilascio separate.

## Verifica desktop e collaudo fisico richiesto

La prova Electron avvia l'interfaccia dal runtime locale su Windows e verifica che il renderer non disponga di Node, che l'IPC ammetta solo le azioni previste e che richieste Internet, localhost e filesystem siano negate. I test Engine/Vault operano su directory temporanee reali: cifratura SQLite, riapertura, rimozione simulata della directory della chiavetta, errori di rinomina e recupero del backup. Il trasferimento centrale usa due ambienti software indipendenti con dati sintetici. Una prova del runtime in sviluppo e una build `.exe` riuscita non dimostrano da sole il primo avvio dell'eseguibile distribuito su un altro computer.

Prima dell'uso durante un torneo, registrare il risultato di ciascuna prova seguente su copie dei dati sintetici:

1. Preparare due chiavette reali, preferibilmente provando entrambi i filesystem effettivamente utilizzati. Copiare l'eseguibile portatile e il pacchetto cifrato; custodire separatamente password e PIN.
2. Su due computer Windows differenti disabilitare fisicamente o dal sistema operativo Wi-Fi, Ethernet e ogni altro adattatore. Avviare la build distribuita su una macchina che non l'ha mai usata e verificare che non scarichi runtime, font o altre dipendenze.
3. Creare/importare l'archivio, accedere come segnapunti e supervisore, verificare che ciascun segnapunti veda soltanto le proprie partite e che un PIN errato non autorizzi modifiche.
4. Gestire una partita sintetica completa per ogni sport impiegato, controllando cronometro, presenze, punteggi, eventi, sostituzioni, timeout e sanzioni consentite dal regolamento. Verificare le firme sul medesimo referto e la richiesta di nuove firme dopo una correzione autorizzata.
5. Chiudere e riaprire l'applicazione su un altro computer con la stessa chiavetta: dati, identificativi e referti devono seguirla; il cronometro recuperato deve rimanere in pausa al checkpoint salvato.
6. Scollegare la chiavetta durante il lavoro e reinserire anche una chiavetta diversa. L'applicazione deve indicare il salvataggio pendente, conservare i dati in memoria e riuscire a salvare soltanto dopo il ritorno della chiavetta corretta. Non forzare la chiusura quando indica dati ancora in memoria.
7. Simulare l'arresto improvviso su una copia di prova, poi verificare il recupero di `archive.keyvault`, `.bak` e `.pending`. Confrontare l'ultima revisione integra; documentare la possibile perdita del tempo trascorso dall'ultimo checkpoint.
8. Salvare un backup cifrato in un luogo separato e ripristinarlo su una nuova chiavetta. Password errata e archivio esistente devono essere rifiutati. Verificare rose, eventi, firme, storico e identificativi dopo il recupero.
9. Trasferire i risultati al centro con la stessa chiavetta e con una seconda chiavetta di trasporto. Provare importazione ripetuta, file alterato, versione remota modificata, partita già conclusa e postazione revocata. Ogni conflitto deve richiedere revisione senza sostituzione del referto centrale.
10. Quando Internet torna disponibile, sincronizzare con un amministratore autorizzato in un ambiente di collaudo, importare la ricevuta cifrata sulla postazione e verificarne identità, pacchetto esportato, hash del referto e hash dell'operazione. Riavviare: la conferma deve restare persistente.

Il profilo temporaneo Chromium ospita l'involucro dell'applicazione; la sessione del renderer è effimera e il database studenti persistente è il vault cifrato sulla chiavetta. L'applicazione non può garantire l'assenza di tracce nella memoria virtuale, nei dump prodotti dal sistema operativo o negli strumenti amministrativi del computer. La stampa consegna inoltre una copia in chiaro al sistema di stampa Windows, alla stampante o alla destinazione PDF scelta: queste copie richiedono le normali misure di riservatezza della scuola e non sono protette dalla cifratura del vault.

La password dimenticata non può essere recuperata dal software. Il backup cifrato recupera una chiavetta guasta o smarrita soltanto quando la relativa password è ancora disponibile.
