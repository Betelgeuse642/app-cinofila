# Istruzioni del progetto — App cinofila

## Prodotto
Web app per istruttori cinofili, inizialmente per uso personale e potenzialmente commerciale. Interfaccia in italiano, semplice e intuitiva anche per utenti poco esperti.

## Stato del progetto
- Web app realizzata con HTML, CSS e JavaScript vanilla.
- Dati salvati localmente tramite `localStorage`, chiave `cinofilo-data-v1`.
- Modello dati: `{ clienti, pagamenti, appuntamenti, pacchetti, incassi }`; i pacchetti hanno `categoria` (`pacchetto`/`singola`), `tipo` e `istruttore`; gli appuntamenti hanno `pacchettoId` e `istruttore`.
- Incassi separati dai contratti: stati pagamento derivati (`Pagato`, `Parziale`, `Da pagare`, `Da verificare`).
- Funzioni di esportazione e importazione JSON, snapshot automatico e blocco multi-scheda.
- Scheda cliente con due sole sezioni oltre l’anagrafica: **Pacchetto lezioni** e **Lezione singola**. Ogni gruppo è una scheda compatta con intestazione su due righe: titolo e azioni (`Modifica/Elimina`, `Pagamento`) sulla stessa riga, informazioni (lezioni utilizzate/rimaste, stato pagamento, data) sotto, poi divisore sottile e calendario. Pagamento espandibile; per i pacchetti elenco compatto delle date con piccoli tasti Modifica/Elimina.
- Date delle lezioni scelte individualmente, istruttore indicato per ogni lezione (senza campo separato sul pacchetto); data di vendita automatica; acconti iniziali senza data/nota, con etichetta automatica.
- Tutti i campi data usano il formato `gg/mm/aaaa` con normalizzazione al blur; i valori restano memorizzati in ISO (`AAAA-MM-GG`).
- Consumo automatico delle lezioni alla scadenza: se una lezione non viene modificata o eliminata prima della data, incrementa le lezioni utilizzate del pacchetto/lezione; il dato viene salvato su caricamento, salvataggio e controllo periodico.
- Home con quattro pulsanti (**Scheda cliente**, **Appuntamenti**, **Resoconto**, **Archivio**) e viste `home`, `clienti`, `appuntamenti`, `archivio`, `resoconto`. `#appuntamenti` è una vista reale; gli hash legacy `#pagamenti` e `#pacchetti` vengono reindirizzati a `#clienti`.
- Eliminazione a cascata del cliente (pacchetti, pagamenti, incassi e appuntamenti) o del pacchetto/lezione (pagamenti, incassi e appuntamenti non svolti; quelli svolti restano senza collegamento); conferma con conteggi e avvisi, operazione annullabile.
- Nessun dato di esempio: il primo avvio è vuoto e non viene scritto nulla automaticamente.
- Ricerca/filtri su Clienti, Archivio e Appuntamenti; agenda globale raggruppata per giorno, con filtri per periodo, stato e categoria.
- Resoconto e report filtrabili per mese e cliente; export CSV di incassi e pagamenti.
- Accessibilità: focus gestito, chiusura con `Escape`, ARIA di base, contrasto AA, layout mobile.
- Restyling "studio caldo": serif editoriale, carta avorio, verde bosco, bordi sottili e card con ombre leggere.
- Fasi 8–17 completate e pubblicate. Fasi 18–40 completate e verificate localmente sul branch `feat/fase-30-36-scheda-due-sezioni`; nessuna pubblicazione.
- Ultima verifica dichiarata: **536 test superati, 0 fallimenti** (03/11/2026).

Queste informazioni descrivono lo stato noto. Verifica sempre il repository prima di assumere che non sia cambiato.

## Percorsi
- App: `/home/betelgeuse/OPENCODE_JOB/add_cinofilo/`
- Test Playwright: `/home/betelgeuse/OPENCODE_JOB/add_cinofilo-tests/`
- Attenzione al nome della cartella test: `add_cinofilo-tests` (underscore tra `add` e `cinofilo`).
- Repository Git: `https://github.com/Betelgeuse642/app-cinofila.git` (pubblico), branch `main`, remote `origin`.
- Pubblicazione: GitHub Pages, sorgente `main` cartella `/`, URL `https://betelgeuse642.github.io/app-cinofila/`.
- Non modificare impostazioni GitHub/Pages senza approvazione.

## Principi di sviluppo
- Mantieni l'app leggera, preferendo HTML, CSS e JavaScript già presenti.
- Non introdurre framework, backend, account, sincronizzazione cloud o servizi a pagamento senza approvazione.
- Mantieni un'interfaccia responsive, leggibile, con pulsanti chiari e passaggi essenziali.
- Rispetta lo stile e l'architettura esistenti.
- Non inventare dati e non nascondere errori.

## Dati e compatibilità
- Preserva i dati esistenti in `cinofilo-data-v1`.
- Prima di modificare il modello dati, verifica lettura, salvataggio, esportazione e importazione.
- Preferisci modifiche compatibili e valori predefiniti sicuri.
- Non cancellare o sovrascrivere dati senza autorizzazione esplicita.
- Verifica persistenza, esportazione e importazione dopo ogni modifica pertinente.
- `saveData()` restituisce `false` in caso di errore: usa `commit(msg)` e non mascherare i fallimenti.
- Il legacy `Parziale` senza incassi è marcato `incassoDaVerificare` ed escluso da incassi/crediti finché non viene verificato.
- Alla prima lettura, appuntamenti e pagamenti senza `pacchettoId` vengono convertiti in lezioni singole; anche i collegamenti a pacchetti inesistenti vengono scollegati e convertiti. I dati orfani restano separati.

## Test
Dalla cartella `/home/betelgeuse/OPENCODE_JOB/add_cinofilo-tests/`:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 test_regressione.py   # 68
PYTHONDONTWRITEBYTECODE=1 python3 test_fase7.py         # 52
PYTHONDONTWRITEBYTECODE=1 python3 test_fase8.py         # 37
PYTHONDONTWRITEBYTECODE=1 python3 test_fase9.py         # 33
PYTHONDONTWRITEBYTECODE=1 python3 test_fase10.py        # 43
PYTHONDONTWRITEBYTECODE=1 python3 test_fase11.py        # 46
PYTHONDONTWRITEBYTECODE=1 python3 test_fase12.py        # 31
PYTHONDONTWRITEBYTECODE=1 python3 test_fase13.py        # 51
PYTHONDONTWRITEBYTECODE=1 python3 test_fase14.py        # 49
PYTHONDONTWRITEBYTECODE=1 python3 test_fase16.py        # 50
PYTHONDONTWRITEBYTECODE=1 python3 test_fase30.py        # 76
```

Esegui tutte le suite dopo modifiche a modello dati, rendering, filtri, report o accessibilità, e riporta i conteggi effettivi.

## Repository, pubblicazione e sicurezza

- `main` è il branch pubblicato: ogni push o merge su `main` aggiorna il sito pubblico.
- Non lavorare direttamente su `main`. Crea un branch dedicato, esegui i test, controlla il diff, commit, push del branch e apri una pull request.
- Eseguire merge su `main` solo dopo approvazione esplicita.
- Non eseguire commit, push, merge o tag senza richiesta e approvazione.
- Non modificare impostazioni GitHub, GitHub Pages o protezioni del branch senza approvazione.
- Non inserire nel repository dati personali, backup o esportazioni JSON/CSV. `.gitignore` esclude cache Python, file temporanei, log ed export dell'app.
- Il sito è pubblico e senza autenticazione; i dati restano nel browser dell'utente.
- `localStorage` è separato per origine: `file://` e URL Pages sono archivi distinti. Per trasferire dati usare export/import JSON.
- Dopo il merge attendere la build Pages e verificare il sito pubblico. La cache Pages può richiedere fino a circa 10 minuti o un hard refresh.
- Rollback: `git revert` del commit problematico, poi push su `main`; mai force push.
- Versione stabile: la procedura concordata è creare il tag annotato `v1.0.0` sul commit `68cdc1e` e pusharlo solo dopo approvazione.
- `.nojekyll` disabilita l'elaborazione Jekyll di Pages ed è appropriato perché l'app è statica e non usa Jekyll.

## Pianificazione e fasi
- Leggi `PIANO.md` prima di pianificare una nuova fase.
- Verifica lo stato reale del codice e dei test: non fidarti ciecamente della documentazione.
- Non avviare una nuova fase senza un piano e la relativa approvazione.
- Non anticipare fasi successive né aggiungere funzionalità non approvate.
- Aggiorna `PIANO.md` al termine del lavoro, riportando modifiche, test effettivi, stato e problemi aperti.

## Verifiche
- Esegui i test Playwright pertinenti e, quando possibile, l'intera suite.
- Controlla le funzionalità esistenti dopo ogni modifica.
- Verifica layout desktop e mobile, gestione degli errori e persistenza dopo il ricaricamento.
- Prima del commit esegui `git diff --check` e controlla che non siano stati aggiunti dati personali, backup o esportazioni.
- Riporta il numero effettivo di test superati e falliti.
- Non dichiarare test o verifiche non eseguiti.

## Limiti
Non implementare funzionalità aggiuntive oltre a quelle approvate.
Non usare servizi esterni, telemetria o dipendenze senza approvazione.
