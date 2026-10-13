# ITSOSCup — operatività senza Internet e senza rete locale

Questa procedura non richiede Wi-Fi scolastico né collegamento tra i campi.
La soluzione è progettata per **postazioni autonome** e per il passaggio dei file
attraverso un supporto rimovibile controllato dalla scuola.

## Preparazione (quando Internet è ancora disponibile)

1. Dalla dashboard aprire **Calendario** e usare **Prepara offline** per
   memorizzare sul dispositivo i match non conclusi e le relative rose.
2. Aprire **Postazione offline**; verificare che le partite compaiano nella lista.
3. Scegliere una password forte (almeno 12 caratteri), che non sarà salvata.
4. Cliccare **Esporta partite** e copiare il file cifrato su USB.
5. Su ogni postazione già predisposta aprire **Postazione offline**, importare il
   pacchetto cifrato con la password e verificare i match assegnati.
6. Provare realmente il distacco totale della rete e la riapertura della pagina.
   Una prima apertura da browser mai installato senza rete **non è supportata**:
   tutti gli asset devono essere stati installati con il service worker prima
   dell'evento. In futuro serve un installer locale distribuibile via USB.

## Sul campo: nessuna rete

1. Aprire **Postazione offline** (la pagina usa solo asset locali in cache).
2. Selezionare il match già preparato o ricevuto via file USB.
3. Registrare punteggio, tempo, periodo e annotazioni.
4. Premere **Salva sul dispositivo** e verificare l'avvenuta registrazione.
5. Periodicamente, e certamente alla fine delle partite, scegliere
   **Esporta risultati** per salvare un file cifrato su USB.
6. Mantenere almeno due copie controllate del pacchetto e **non eliminare** i
   dati del dispositivo fino alla riconciliazione confermata.

## Dopo il ritorno di Internet

1. Su una postazione con account **super_admin** o **match_manager** abilitato,
   importare i file ricevuti dai campi.
2. Controllare il registro e i punteggi delle operazioni in attesa.
3. Usare **Verifica e sincronizza**, verificare il riepilogo e confermare.
4. Ogni operazione controlla il match remoto: partita non conclusa,
   versione invariata e acquisizione del lock. Se qualche condizione fallisce,
   l'operazione diventa **conflitto** e non sovrascrive il cloud.
5. Confrontare manualmente i conflitti; non cancellare i pacchetti prima
   di aver controllato il referto ufficiale.

## Sicurezza dei pacchetti

- I file esportati sono cifrati tramite AES-GCM a 256 bit, con chiave derivata
  dalla password con PBKDF2-SHA256 (260.000 iterazioni), IV e salt casuali.
- Nessuna password del pacchetto viene memorizzata.
- Il file può contenere dati degli studenti: conservare su dispositivi gestiti
  dalla scuola e distribuire password e file attraverso canali distinti.
- IndexedDB conserva i dati **in chiaro nel profilo locale del browser**:
  la postazione deve essere protetta da account del sistema operativo,
  cifratura del disco e controllo degli accessi fisici.
- Il codice utilizza identificativi delle operazioni e importazione
  idempotente; le revisioni concorrenti dello stesso match sono bloccate.
- I file non sono firme digitali dell'organizzatore. La password protegge
  riservatezza e integrità del file, ma un operatore che conosce la password
  può generare un altro pacchetto valido; l'accettazione resta responsabilità
  dell'account amministrativo autorizzato.

## Limiti attuali (non dichiarare offline completo)

Questa versione realizza una **prima modalità autonoma per le bozze dei risultati**.
Non sostituisce in assenza di rete:
- gestione completa del calendario/nuove partite;
- statistiche individuali live, referti ufficiali firmati e firme digitali
  dei capitani nell'editor autonomo;
- autenticazione autonoma, revoca credenziali e profili offline;
- propagazione in tempo reale tra postazioni;
- risoluzione automatica di modifiche concorrenti.

La sincronizzazione attuale riguarda snapshot delle partite preparate, non tutti
i tipi di record del database. Il sistema deve ancora essere ampliato e
collaudato su dispositivi reali prima dell'utilizzo come unica fonte ufficiale.
