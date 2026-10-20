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
