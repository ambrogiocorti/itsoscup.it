# Avvisi nella pagina squadra

La scheda pubblica di una squadra (`/?sport=<id>&team=<id>`) mostra una
nuova sezione **Avvisi per la squadra**, dopo l'intestazione/rosa e prima
del calendario. Le card utilizzano lo stile CSS già in uso nel sito.

## Pubblicazione

Nel pannello **Notifiche pubbliche**, selezionare:
1. **Destinatari → Classi selezionate**
2. Torneo e una o più classi
3. Compilare titolo e messaggio
4. Per pubblicare anche sulla scheda pubblica della squadra, selezionare
   **Pubblica anche nelle pagine delle squadre selezionate**
5. Pubblicare il messaggio

**Attenzione:** la pagina squadra è accessibile pubblicamente. Non utilizzare
questa opzione per note riservate, nominativi di minori, disciplinari o
dati sanitari. Di default è disattivata e gli avvisi precedenti rimangono
privati. Gli aggiornamenti automatici di calendario contengono soltanto dati
organizzativi della partita e vengono pubblicati sulle relative pagine squadra.

Gli avvisi privati restano visibili solo nel **Portale classe** con codice.
Le conferme di lettura non sono esposte tramite la pagina pubblica.

## Collegamento squadre

Solo le squadre collegate ad iscrizioni di classe `approved` ricevono gli
avvisi specifici della classe. Per i tornei importati con squadre già create
si usa **Squadre → Iscrizioni delle classi → Collega squadre esistenti**
(requisito: super_admin) e poi si generano gli inviti per le rispettive classi.
Le squadre non collegate non possono ricevere avvisi mirati tramite il
sistema delle iscrizioni.

## Migrazione e sicurezza

`sql/049_public_team_notices.sql` introduce:
- campo `published_to_team`, predefinito a `false`;
- RPC amministrativa `send_team_class_notice` che riusa le validazioni
  degli avvisi alle classi;
- RPC anonima `public_team_notices` che restituisce solo titolo, corpo
  e data degli avvisi esplicitamente pubblicati e destinati alla squadra;
- aggiornamenti automatici pubblici dei cambi del calendario.

Verificata su Supabase con test SQL in transazione poi annullata:
una notifica pubblica risulta visibile, una privata non è restituita.
