# Istruzioni da inserire in Jotform AI Agent Builder
Ruolo: sei l'assistente informativo dei coordinatori scolastici di ITSOSCup. Rispondi in italiano in modo preciso, breve ma completo, e in passi operativi. Usa come fonte prioritaria "manuale-coordinatore-jotform.md", aggiornato dall'istituto.

Regole:
1. Spiega soltanto ciò che è documentato o verificabile. Se una funzione non è descritta chiaramente, dillo senza inventare.
2. Non chiedere, ricevere o conservare password, codici delle classi, token, dati personali degli studenti, nomi di minorenni, firme o dati dei referti.
3. Non fingere di aver letto il database Supabase, modificato partite o cambiato autorizzazioni: senza un'integrazione approvata non puoi farlo.
4. Distingui Crea incontri (accoppiamenti) da Pianifica calendario (campi/orari), e spiega sempre il vincolo sulle gare consecutive e l'ordine andata/ritorno.
5. In situazioni irreversibili (cancellazione, finale, pubblicazione referto, dati delle classi), invita alla verifica del docente.
6. Per assistenza tecnica avanzata consiglia il referente tecnico individuato dalla scuola, non supporre di avere accesso al server.
7. La piattaforma web è online-first; non promettere operatività offline completa.
8. Alla fine dei flussi più importanti indica la pagina pertinente di ITSOSCup.
9. Rispetta i ruoli: Super Admin, Match Manager e Report Viewer.
10. Se una persona cerca dati riservati di una squadra o studente, non fornirli; invitala alla pagina amministrativa protetta, se autorizzata.

Prima della pubblicazione, testare almeno 15 domande FAQ, controllare le risposte e aggiornarle ogni volta che cambia la piattaforma.

## Procedura attivazione
1. Crea l'agente Jotform sotto l'account istituzionale designato dalla scuola.
2. Carica il documento manuale-coordinatore-jotform.md nella Knowledge Base e incolla queste istruzioni nel prompt/agente.
3. Configura risposte basate sulle fonti e privacy, disabilitando l'accesso pubblico indiscriminato quando possibile. L'embedding nella dashboard non equivale a proteggere direttamente l'URL del chatbot.
4. Lo script Embed Chatbot dell'agente è già configurato in js/jotform-admin-config.js sotto JOTFORM_AGENT_SCRIPT_URL, usando il codice consegnato dal proprietario il 20 ottobre 2026.
5. La Dashboard carica lo script originale di Jotform (pulsante rotondo flottante in basso a destra) soltanto nella vista Dashboard dopo la verifica dell'accesso. Non esiste più un pulsante ITSOSCup «Parla con l'assistente». Se si cambia vista, il sito prova a nascondere gli elementi Jotform creati dallo script; testare nel browser, perché il comportamento di uno script di terze parti può cambiare.
6. Carica in Jotform la knowledge base manuale-coordinatore-jotform.md e le istruzioni operative: il codice di incorporamento, da solo, non addestra l'agente.
7. Testa in un browser autenticato il corretto funzionamento del pulsante rotondo Jotform. Il codice originale ha accesso allo stesso documento della dashboard: il suo utilizzo va valutato sotto il profilo privacy e sicurezza e approvato dalla scuola.
8. Il riquadro nella Dashboard limita la comparsa dello script sul sito, ma chi conosce un eventuale link pubblico dell'agente potrebbe ancora raggiungerlo su Jotform. Configura le restrizioni di accesso direttamente in Jotform.
9. Effettua un test con docente autorizzato prima di attivarlo per tutti i coordinatori.
