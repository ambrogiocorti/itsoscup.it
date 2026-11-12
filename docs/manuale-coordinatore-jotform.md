# ITSOSCup — Base di conoscenza per l'assistente dei coordinatori
Versione: ottobre 2026. Aggiornare dopo ogni modifica strutturale significativa.

## Scopo
Aiutare professori e futuri coordinatori a usare ITSOSCup in modo autonomo, senza accedere ai dati degli studenti. Rispondere con procedure e collegamenti, non con supposizioni.

## Struttura e ruoli
La Dashboard risiede in /admin?view=dashboard. Le principali sezioni sono Tornei, Squadre, Campi, Calendario, Centro di controllo, Atletica, Report, Telegram e Impostazioni. Le pagine operative hanno la stessa sidebar amministrativa: /tournament-tools.html (pianificazione), /athletics-athletes.html (schede atleti), /live.html (Match Live). L'accesso amministrativo è protetto tramite Supabase. Ci sono ruoli con permessi differenti: Super Admin, Match Manager e Report Viewer. Se un pulsante non è disponibile, controllare l'assegnazione del ruolo; non consigliare scorciatoie per aggirare il controllo.

## Creare un torneo
Accedere a /admin?view=sports. Creare il torneo specificando nome, anno, sport, formato e andata/ritorno. Sport previsti: calcio, basket, pallavolo, pallamano e atletica. Aggiungere o verificare le squadre da /admin?view=teams, configurare i campi da /admin?view=venues, quindi preparare le partite nel Calendario.

## Iscrizioni per classe
In Squadre cercare Iscrizioni delle classi. Impostare la scadenza unica del torneo, poi predisporre i codici di accesso per le classi. Le classi compilano il modulo classe indicando componenti e capitano. La proposta deve essere verificata e approvata da un docente. Dopo la scadenza, il database blocca modifiche alla rosa e nuove iscrizioni. Le approvazioni amministrative restano possibili. Non chiedere mai codici di accesso in chat.

## Generazione calendario
"1. Crea incontri" produce accoppiamenti senza campi/orari. "2. Pianifica calendario" assegna campi e orari. In /tournament-tools.html scegliere torneo, data, intervallo di disponibilità, durata, riposo minimo e campi. Generare anteprima e verificare tutte le assegnazioni; l'algoritmo evita sovrapposizioni della stessa squadra anche su campi diversi, cerca turni di recupero, impone il massimo di due turni consecutivi e pone tutte le gare d'andata prima di quelle di ritorno. Se alcune gare non entrano, allargare la fascia temporale o modificare la disponibilità: non forzare una soluzione scorretta. La pubblicazione si effettua solo dopo controllo.

## Match Live e referti
Da /admin?view=matches aprire la partita e la sua postazione Live. Controllare squadre, presenza dei giocatori, cronometro e sincronizzazione prima di operare. Eventi sport-specifici: reti, punti, set, falli/cartellini, periodi/tempi e timeout nei casi applicabili. La pallamano supporta due tempi, timeout e reti; le regole disciplinari dettagliate sono da verificare nelle configurazioni. A fine gara verificare il punteggio e chiudere con le firme richieste. Per errori utilizzare la correzione tracciata, mai modifiche dirette al database non autorizzate.

## Atletica
In /admin?view=events si gestiscono gare, atleti e risultati. Le schede /athletics-athletes.html mostrano il nome, la classe, gli eventi con risultati registrati, ciascun tentativo e il migliore. Verificare unità di misura e validità di ogni tentativo. Non inventare valori mancanti.

## Centro di controllo
In /admin?view=operations si leggono gli stati delle partite, dei campi e le attività da verificare. È una funzione riservata ai ruoli autorizzati.

## Tecnologia e stato offline
Frontend HTML, CSS e JavaScript; hosting GitHub Pages; backend Supabase. La PWA pubblica è online-first, perciò operazioni amministrative ufficiali richiedono Internet. La postazione di trasferimento offline è uno strumento specifico, non dimostra che ogni pagina web funzioni senza rete. Non rassicurare erroneamente su salvataggi già sincronizzati.

## Gestione di errori
Se i risultati sembrano vecchi: verificare lo stato sincronizzazione e aggiornare. Se non si può accedere: verificare rete e ruolo. Se la pianificazione non colloca tutto: ampliare disponibilità invece di forzare. Se un'iscrizione è chiusa: far controllare la scadenza al Super Admin. Se il problema persiste, chiedere ai referenti tecnici della scuola; non promettere interventi automatici o accesso alle impostazioni riservate.

## Continuità
La scuola dovrebbe avere un referente principale e uno sostituto, account individuali, accesso organizzativo al dominio e hosting, repository, Supabase e configurazione Jotform. Il manuale è in /guida-coordinatore.html. Aggiornare il manuale e l'agente dopo cambiamenti, verificare con torneo di prova, backup, recupero account e inventario amministrativo. Non salvare segreti nel manuale.

## FAQ suggerite
- Come creo un torneo da zero?
- Qual è la differenza tra Crea incontri e Pianifica calendario?
- Come imposto la scadenza delle iscrizioni?
- Perché una classe non riesce più a inviare la rosa?
- Come imposto i campi e il riposo minimo?
- Come evito partite consecutive?
- Come faccio i ritorni solo dopo l'andata?
- Come creo un torneo di pallamano?
- Dove trovo i tentativi di atletica?
- Come correggo un risultato già inserito?
- Dove trovo i referti ufficiali?
- Perché non vedo una voce della sidebar?
- Cosa posso fare se manca Internet?
- Che cosa devo consegnare al nuovo coordinatore?
- Chi devo contattare se un dato non viene sincronizzato?


## Manuale operativo esteso e passaggio di consegne (aggiornamento 20 ottobre 2026)
La versione dettagliata per i coordinatori è disponibile, dopo accesso amministrativo, in /guida-coordinatore.html.
I capitoli coprono: scopo e glossario; accessi e ruoli; preparazione iniziale; creazione torneo;
iscrizioni e chiusura per torneo; squadre e capitani; creazione accoppiamenti; pianificazione;
verifica sovrapposizioni e pause; gestione della giornata; Match Live e referti; atletica e
tutti i tentativi registrati; differenze calcio/basket/pallavolo/pallamano; comunicazioni;
flussi online-first e postazioni offline; problemi frequenti; privacy; manutenzione;
passaggio di consegne; checklist prima/dopo gli eventi; FAQ.

L'assistente Jotform è visibile nella sola Dashboard Admin come cerchio flottante in basso
a destra, creato dallo script Jotform. Non esiste un pulsante ITSOSCup separato per
aprire la conversazione. Il manuale rimane operativo senza Jotform.

### Flusso rigoroso per coordinatore
1. Accedi a /admin?view=dashboard e controlla il ruolo.
2. Crea/configura un torneo da /admin?view=sports; verifica sport e formato.
3. Censisci i campi da /admin?view=venues.
4. In /admin?view=teams apri Iscrizioni delle classi: imposta data e ora scadenza,
   genera link classe, raccogli e approva rose e capitani.
5. In /admin?view=matches «1. Crea incontri» genera gli accoppiamenti.
6. In /tournament-tools.html «2. Pianifica calendario» distribuisce giorno/ora/campo.
7. Verifica che non ci siano sovrapposizioni anche tra campi, non più di due turni
   consecutivi, andata prima del ritorno, nessun incontro lasciato non collocato
   prima della pubblicazione completa.
8. Verifica rete e operatori. In /live.html i segnapunti registrano punti/reti
   ed eventi nella partita aperta; non c'è sidebar su Match Live.
9. Prima di chiudere la gara verifica risultato, presenze, referto e firme
   richieste, poi controlla la classifica aggiornata.

### Assistenza su dati mancanti o errori
- Se una classe non riesce a compilare: scadenza, codice e stato iscrizione sono
  le prime verifiche. I docenti possono approvare proposte già presentate.
- Se una partita non può essere pianificata: aumentare fasce/campi, non ridurre
  i riposi in modo arbitrario o forzare tre turni consecutivi.
- Se compare un conflitto offline: non scegliere quale versione sovrascrivere
  prima di averla confrontata con il referto.
- Se lo studente di atletica non ha un tentativo registrato: non inventarlo.
- Se il servizio Jotform non funziona: il personale deve poter usare il manuale.
- Le credenziali e le chiavi API non devono mai comparire nel manuale né nella chat.

### Regole per il successore
La scuola nomina un coordinatore e un sostituto, assegna account individuali,
documenta i responsabili di dominio/GitHub Pages/Supabase/Jotform e organizza ogni
anno una prova guidata dall'iscrizione alla chiusura del referto. Conserva procedure
di ripristino e backup fuori da documenti pubblicamente accessibili.

Questo testo è descrittivo: non costituisce accesso automatico ai dati di produzione,
non assegna ruoli e non esegue operazioni senza un account autorizzato.

## Novità operative: configurazione guidata e continuità (20 ottobre 2026)
- `/tournament-setup.html`: il Super Admin seleziona o crea un torneo in un percorso di cinque fasi; scadenza, verifica squadre, creazione accoppiamenti e pianificazione si svolgono nelle sezioni protette.
- Nella Dashboard è visibile una checklist dei dati del torneo selezionato. È informativa: il docente deve confermare i controlli prima della gara.
- `/tournament-demo.html`: laboratorio protetto con squadre, calendari e punteggi fittizi, nessuna scrittura al database. Consigliato per formare i nuovi coordinatori.
- `/tournament-insights.html`: riepiloghi per sport e anno di creazione; l'anno indicato non equivale automaticamente all'anno scolastico. CSV senza nominativi degli studenti.
- La conferma definitiva delle rose si effettua in Squadre -> Iscrizioni delle classi: il Super Admin sigilla la rosa dopo l'approvazione; la riapertura richiede motivazione e registro. Dopo il sigillo il database blocca modifiche alle squadre e ai giocatori.
- In Atletica si possono iscrivere gli studenti agli eventi anche prima del primo tentativo. Schede atleti include questi eventi e distingue le iscrizioni dai risultati.
- La Pallamano usa due tempi e supporta nella cronologia gli eventi Esclusione 2 minuti e Tiro da 7 metri; non sostituisce il regolamento adottato dalla scuola.
- La pianificazione mostra una matrice campi/orari e indicatori di attesa, insieme ai vincoli applicati dal database.

### Controllo finale del torneo
In `/tournament-closeout.html` il docente seleziona il torneo e legge le verifiche di completezza: per gli sport di squadra controlla incontri conclusi, campi, punteggi, firme e stato delle rose; per atletica distingue eventi e iscrizioni ancora prive di risultati. Il riepilogo è stampabile ma **non** sostituisce il referto ufficiale, non finalizza né archivia automaticamente il torneo. Le incongruenze vanno risolte nelle sezioni competenti prima dell'archiviazione.

### Continuità istituzionale
La scuola dispone di un runbook tecnico in `docs/continuita-operativa.md`, con inventario servizi, ruoli, backup, staging, ripristino, gestione incidenti e check di consegna. Non contiene credenziali. L'assistente AI deve rimandare al documento e al referente tecnico per questioni di ripristino e privacy; non inventare procedure o garantire RPO/RTO.
