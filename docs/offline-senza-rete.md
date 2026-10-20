# ITSOSCup: stato del lavoro offline e procedura di collaudo

> **Stato ottobre 2026:** la PWA ufficiale è **online-first**. Il service worker non memorizza pagine amministrative né Match Live per navigazione offline e, se manca la connessione, restituisce una pagina esplicita di errore 503.
>
> Il seguente flusso USB è una **procedura storica/sperimentale** ancora presente nel repository. Non considerarla pronta per una giornata reale finché non è stata collaudata con tutti i PC Windows della scuola. Non promette l'utilizzo completo del sito senza connessione.

## La distinzione fondamentale

| Funzione | Sito/PWA ufficiale | Workspace USB legacy |
|---|---|---|
| Aprire una pagina Admin nuova senza rete | Non supportato | Dipende da installazione/cache provata |
| Login e autorizzazione Supabase senza rete | Non supportato | Nessuna revoca/identità indipendente garantita |
| Creare/modificare calendario ufficiale | Richiede rete | Non previsto |
| Cronometro, punteggio e annotazioni isolate | Richiede app già caricata; salvataggio ufficiale online | Bozze locali nella modalità storica |
| Firme e referto ufficiale | Online | Non completamente supportati |
| Sincronizzare, verificare conflitti e pubblicare | Online | Importazione successiva con revisione umana |

## Collaudo richiesto prima dell'uso come sistema offline

1. Preparare PC A, PC B e PC coordinatore su profili Windows della scuola, senza dati veri di studenti.
2. Verificare sul sistema scolastico gli asset necessari, il browser supportato e la disponibilità della pagina locale.
3. Disattivare sia Internet sia rete locale, chiudere completamente il browser e riaprire la postazione.
4. Registrare due partite fittizie e un'interruzione di corrente/spegnimento; verificare che i dati non vadano persi.
5. Esportare ciascun pacchetto cifrato su USB; mantenere copie gestite dal coordinatore, mai esporre password nei messaggi.
6. Provare un conflitto intenzionale tra due pacchetti della medesima gara. Deve essere segnalato, mai risolto sovrascrivendo automaticamente.
7. Ricollegare il PC coordinatore; importare e verificare contro il risultato ufficiale fittizio, controllando l'audit.
8. Simulare un file danneggiato, una password errata e una chiavetta rimossa durante l'esportazione.
9. Documentare per ogni postazione data della prova, versione del software, docente responsabile ed esito.
10. Ripetere il test dopo qualunque modifica a storage, service worker, cifratura o live.

## Modalità di emergenza approvata in assenza di collaudo

- Fermare le modifiche online e passare a un referto cartaceo numerato e firmato.
- Annotare campo, torneo, squadre, ora, risultato e incidenti, con gestione sicura dei dati personali.
- Non usare un dispositivo locale non collaudato come unica fonte dei dati.
- Al ritorno della rete, il docente autorizzato confronta cartaceo, centrale e dati locali; poi procede alla registrazione.
- Conservare il cartaceo secondo le regole di trattamento dati definite dalla scuola.

## Sicurezza delle vecchie esportazioni USB

Le esportazioni storiche hanno previsto AES-GCM 256 e derivazione PBKDF2, ma una scelta crittografica corretta **non certifica da sola** il corretto funzionamento dell'intero flusso. I dati IndexedDB possono essere in chiaro nel profilo del browser e i file contengono potenzialmente dati di minorenni. Chi custodisce il supporto deve essere autorizzato dalla scuola.

Una password protegge il contenuto, non equivale a una firma istituzionale. È indispensabile convalidare ogni importazione con permessi backend e confronto del referto.

## Evoluzione necessaria

Per una modalità offline di produzione serve un programma Windows distribuibile e collaudato, con dati di partita esplicitamente assegnati, storage cifrato/protetto, aggiornamenti verificati, coda di operazioni, controllo revisioni, trasferimento sicuro, firme e riconciliazione con conferma manuale. Il solo PWA install non soddisfa questi requisiti.
