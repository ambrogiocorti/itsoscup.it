# ITSOSCup Platform 0.2 — Windows portatile

Lo stesso eseguibile contiene **Piattaforma** e **Postazione Key**. La centrale funziona interamente senza Internet o LAN: tornei, squadre, giocatori, campi, calendario, live, report, atletica, archivio, Centro di controllo, utenti locali e trasferimenti USB. Gli asset del sito, icone e QR sono inclusi nella distribuzione. I due ambienti hanno archivi e permessi separati.

Al primo avvio della piattaforma, creare una password dell’archivio di almeno 12 caratteri, nome, email e PIN amministratore di 8–20 cifre. La password apre l’archivio; email e PIN determinano il ruolo locale nella dashboard. Al successivo avvio, sbloccare l’archivio e accedere alla dashboard con il proprio PIN. I dati si trovano in `ITSOSCup-Platform-data`, accanto al lanciatore sulla USB, cifrati anche nei backup. Gli account locali sono distinti dagli account del sito.

La centrale prepara i campi da **Chiavette e postazioni offline**, importa i referti firmati e genera le ricevute senza connessione. Duplicati, firme non valide e versioni concorrenti sono controllati nella stessa transazione del salvataggio. Un ripristino centrale revoca le preparazioni precedenti e richiede una nuova assegnazione; non dichiara nuovamente importati risultati rimossi dal ripristino.

Telegram e gli invii sul sito richiedono una connessione e un account del sito: non vengono simulati nell’ambiente offline. I risultati Key preparati dal sito possono essere importati dal centro web usando il protocollo SQL 050; l’archivio centrale offline e il database online restano distinti e non vengono sovrascritti automaticamente.

Applicazione per segnapunti Windows 10/11 **x64**, con Electron, dipendenze e interfaccia incluse localmente. Non avvia server, non usa Internet o LAN e non richiede Node.js sul computer del campo. Il pacchetto `portable` è un singollo eseguibile senza installazione; il pacchetto ZIP contiene l'applicazione completa, da estrarre prima dell'avvio.

**Stato:** implementazione e verifiche automatiche disponibili; il collaudo fisico di chiavette e due computer indipendenti resta obbligatorio prima dell'uso scolastico. I test usano esclusivamente dati sintetici. Le build non sono firmate con un certificato Windows.

## Preparare la postazione

1. Aprire la centrale locale nella stessa app, oppure il centro web dopo aver applicato la migrazione SQL 050. Preparare una postazione Key v2 scegliendo torneo, campo, partite, operatori, supervisore e PIN.
2. Copiare `ITSOSCup-Platform-0.2.1-x64.exe` e il pacchetto di preparazione cifrato sulla chiavetta. In alternativa estrarre tutto lo ZIP sulla chiavetta. Aprire **Postazione Key** dalla barra dell’app.
3. Avviare l'eseguibile. Creare l'archivio con una password di almeno 12 caratteri; conservarla separatamente dalla chiavetta. Configurare il primo supervisore locale e il suo PIN di 8–20 cifre.
4. Accedere come supervisore e importare la preparazione con la password del pacchetto. Ogni segnapunti accederà con il proprio PIN e vedrà le partite assegnate.
5. Verificare rose, capitani, orari e regolamenti prima di scollegare tutte le reti. L'eseguibile contiene già tutto ciò che serve al primo avvio offline.

La cartella `ITSOSCup-Key-data` nasce **accanto all'eseguibile sulla chiavetta**, usando `PORTABLE_EXECUTABLE_DIR` per il lanciatore portatile. Nella distribuzione ZIP si trova accanto all'eseguibile estratto. In sviluppo è possibile impostare `ITSOSCUP_KEY_DATA_DIR`, ignorata nelle build distribuite.

## Gestire e trasferire una partita

- Registrare presenze, punteggio, periodo/set, cronometro, eventi e personale. Carte e falli rispettano la configurazione dello sport; timeout e sostituzioni sono disponibili quando previsti.
- Il cronometro usa un orologio monotono e salva un checkpoint ogni cinque secondi. Dopo un arresto improvviso riparte **in pausa** dall'ultimo checkpoint: l'operatore verifica e corregge il tempo, con modifica registrata.
- Alla chiusura, mostrare il referto ai capitani. Punteggio, statistiche ed eventi restano bloccati durante la raccolta delle firme. Ogni firma PNG contiene identità del capitano, consenso, ora, operatore testimone e SHA-256 del referto esatto.
- Una correzione del supervisore richiede una motivazione e annulla entrambe le firme, incrementando la revisione. Dopo l'esportazione la correzione deve passare dal centro e da una nuova preparazione, così nessun referto trasferibile cambia silenziosamente.
- Il supervisore esporta un pacchetto cifrato nella cartella `ITSOSCup-Key-data/exchange`. Il centro importa i risultati con controllo di autorizzazioni, versione, integrità e identificativi. Importare poi la **ricevuta cifrata** sulla stessa postazione: vengono confermati soltanto gli identificativi, le impronte e il pacchetto esportati. Un conflitto resta visibile e richiede revisione al centro.

Le firme raccolte documentano la conferma del referto sotto supervisione; non sono firme elettroniche qualificate né una verifica crittografica dell'identità personale del capitano.

## Protezione, rimozione e recupero

SQLite (`sql.js` e WASM inclusi) lavora in memoria. Su disco vengono scritti solo archivio SQLite cifrato AES-256-GCM e pacchetti cifrati, con chiave derivata tramite PBKDF2-SHA256, 260.000 iterazioni e sale casuale. PIN e segreto di autorizzazione sono nell'archivio cifrato; il PIN è anche derivato separatamente con sale. Il renderer non riceve i segreti e non può leggere file arbitrari. Rete, nuovi browser, permessi, Node nel renderer e navigazioni esterne sono bloccati; IPC è limitata ad azioni definite. Il profilo Chromium temporaneo usa una sessione in memoria, distinta dall'archivio USB.

L'archivio ha un limite separato di 256 MiB; una modifica che lo supera viene annullata prima del salvataggio e non blocca i dati già accettati. Ogni referto resta entro 2 MiB e 10.000 eventi/voci dello storico; il controllo avviene prima delle firme. Le esportazioni sono suddivise automaticamente in lotti sotto 12 MiB: è possibile esportare tutti i lotti consecutivamente anche senza rete. Tutti i file rimangono nella cartella exchange e gli identificativi delle operazioni restano identici nelle copie ricreate. Le ricevute si importano quando il centro ha verificato i risultati.

Ogni salvataggio scrive ciphertext in `.pending`, sincronizza il file, conserva `.bak`, poi sostituisce l'archivio. Windows non supporta il fsync di directory: la durabilità finale dipende anche dalla chiavetta e dalla sua cache. Un identificativo di volume impedisce di ricreare automaticamente dati nel computer o su un'altra chiavetta al posto di quella rimossa. È consentita una sola istanza per percorso sullo stesso computer.

Se la chiavetta viene rimossa, **mantenere aperta l'applicazione**, reinserire la stessa chiavetta e premere **Riprova salvataggio**. Le operazioni restano in memoria, i controlli sono bloccati e non viene dichiarato successo. La chiusura ordinaria è impedita fino al salvataggio; uno spegnimento forzato può perdere i dati rimasti soltanto in RAM.

- **Recupera backup precedente** verifica l'archivio, `.bak` e `.pending` e sceglie la generazione cifrata valida più recente. Verificare poi gli ultimi eventi e il tempo.
- **Backup cifrato** salva una copia esterna; la password dell'archivio è necessaria per aprirla. È vietato sovrascrivere i file di sistema dell'archivio.
- Su una nuova chiavetta senza archivio, **Recupera backup su nuova chiavetta** verifica password e SQLite prima del ripristino e genera una nuova identità di volume. Non sostituisce un archivio esistente. Se il backup precede risultati già importati, riconciliare al centro e ripreparare le partite prima di riprendere.
- Le preparazioni cifrate **v1** preesistenti possono essere aperte e gestite localmente. Per chiusura firmata e importazione centrale verificabile occorre una preparazione Key **v2** autorizzata: un v1 non contiene il segreto di autorizzazione.

## Build riproducibile e test

Da questa cartella, con Node.js 24 e npm:

```powershell
npm ci
npm test
npm run test:smoke
npm --prefix ../.. ci
npm run test:ui
npm run test:platform
npm run test:platform:ui
npm run build:win
npm run test:packaged
node tests/packaged-smoke.cjs dist/ITSOSCup-Platform-0.2.1-x64.exe
node tests/renderer-smoke.cjs "dist/win-unpacked/ITSOSCup Platform.exe"
node tests/platform-ui.cjs "dist/win-unpacked/ITSOSCup Platform.exe"
```

La build scarica Electron e gli strumenti **sulla postazione di preparazione**; sul computer del campo non scarica nulla. I file di distribuzione sono in `dist/`. Il controllo nativo con `--platform-self-check` avvia una finestra nascosta, verifica asset locali, isolamento e accessi rete/file negati, scrive `ITSOSCup-Platform-self-check.json` accanto all'eseguibile e termina senza aprire un archivio. Non accetta percorsi di uscita arbitrari.

I test automatici coprono interoperabilità Node/WebCrypto, AES-GCM e password errate, SQLite cifrato dopo riapertura, autorizzazioni, PIN e versioni locali, timer monotono, regolamenti, firme e correzioni, replay di pacchetti/ricevute, rimozione simulata della cartella USB, errore atomico durante la sostituzione e recupero su una nuova directory. La suite centrale `tests/key-sql.test.mjs` verifica inoltre l'intero protocollo desktop → WebCrypto → PostgreSQL sintetico → ricevuta → desktop e le autorizzazioni SQL.

Verifiche locali superate il 14 ottobre 2026: 15 regressioni Node, 8 test di integrazione centrale, avvio nativo Electron, flusso completo dell'interfaccia con firme disegnate, avvio dell'eseguibile Windows distribuito, persistenza SQLite/WASM dopo il suo riavvio e avvio del singolo lanciatore portatile da una directory indipendente inizialmente vuota. Il contenuto dell'applicazione distribuita e gli asset originali sono stati confrontati byte per byte con le sorgenti correnti. La build ha generato realmente `.exe` e `.zip`; `dist/verification.json` registra dimensioni, SHA-256 e limiti dei collaudi locali. Queste prove non sostituiscono il collaudo fisico seguente.

## Collaudo fisico ancora necessario

1. Usare due computer Windows indipendenti e almeno due chiavette, senza dati reali. Disabilitare Wi-Fi, Ethernet e ogni altra connessione **prima del primo avvio**.
2. Avviare entrambe le distribuzioni da USB, creare/importare archivio, chiudere l'applicazione, rimuovere la chiavetta e riaprire sul secondo computer. Verificare la persistenza e gli stessi referti.
3. Registrare, firmare ed esportare una partita; trasferirla al centro con chiavetta, importarla completamente offline e riportare la ricevuta al campo. Ripetere importazione ed esportazione: nessun duplicato e nessuna seconda finalizzazione. Verificare separatamente il percorso web, se usato.
4. Preparare deliberatamente due assegnazioni concorrenti; verificare conflitto al centro, nessuna sovrascrittura e ricevuta coerente.
5. Rimuovere la chiavetta durante punteggio, firma e esportazione. Verificare blocco del successo, reinserimento della **stessa** chiavetta, retry e persistenza; provare anche una chiavetta diversa con la stessa lettera.
6. Provare file corrotti, password errata, arresto improvviso, recupero `.pending`/`.bak`, backup esterno su nuova chiavetta e verifica degli ultimi cinque secondi del cronometro.
7. Verificare con personale autorizzato i regolamenti di ciascuno sport, la raccolta del consenso dei capitani, la stampa e la procedura di correzione centrale.

Questo checklist distingue simulazioni automatiche da collaudi hardware: un build e un test locale superati non costituiscono il collaudo fisico richiesto.
