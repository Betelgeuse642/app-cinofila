# Istruzioni del progetto — App cinofila

## Prodotto
Web app per istruttori cinofili, inizialmente per uso personale e potenzialmente commerciale. Interfaccia in italiano, semplice e intuitiva anche per utenti poco esperti.

## Stato del progetto
- Web app realizzata con HTML, CSS e JavaScript vanilla.
- Dati salvati localmente tramite `localStorage`, chiave `cinofilo-data-v1`.
- Modello dati: `{ clienti, pagamenti, appuntamenti, pacchetti, incassi }`.
- Incassi separati dai contratti: stati pagamento derivati (`Pagato`, `Parziale`, `Da pagare`, `Da verificare`).
- Funzioni di esportazione e importazione JSON, snapshot automatico e blocco multi-scheda.
- Scheda cliente con storico, archivio clienti dedicato e gestione dati orfani.
- Eliminazione a cascata del cliente (pacchetti, pagamenti, incassi e appuntamenti) o del pacchetto (pagamenti e incassi collegati); conferma con conteggi e avvisi, operazione annullabile.
- Nessun dato di esempio: il primo avvio è vuoto e non viene scritto nulla automaticamente.
- Ricerca/filtri su tutte le liste, agenda raggruppata per giorno.
- Resoconto e report filtrabili per mese e cliente; export CSV di incassi e pagamenti.
- Accessibilità: focus gestito, chiusura con `Escape`, ARIA di base, contrasto AA, layout mobile.
- Restyling "studio caldo": serif editoriale, carta avorio, verde bosco, bordi sottili e card con ombre leggere.
- Fasi 8–16 completate e verificate.
- Ultima verifica dichiarata: **506 test superati, 0 fallimenti** (26/10/2026).

Queste informazioni descrivono lo stato noto. Verifica sempre il repository prima di assumere che non sia cambiato.

## Percorsi
- App: `/home/betelgeuse/OPENCODE_JOB/add_cinofilo/`
- Test Playwright: `/home/betelgeuse/OPENCODE_JOB/add_cinofilo-tests/`
- Attenzione al nome della cartella test: `add_cinofilo-tests` (underscore tra `add` e `cinofilo`).
- Il progetto non è un repository Git: non usare `git status` come fonte di verità e non eseguire operazioni Git.

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

## Test
Dalla cartella `/home/betelgeuse/OPENCODE_JOB/add_cinofilo-tests/`:

```bash
python3 test_regressione.py   # 93
python3 test_fase7.py         # 52
python3 test_fase8.py         # 37
python3 test_fase9.py         # 34
python3 test_fase10.py        # 61
python3 test_fase11.py        # 46
python3 test_fase12.py        # 33
python3 test_fase13.py        # 51
python3 test_fase14.py        # 49
python3 test_fase16.py        # 50
```

Esegui tutte le suite dopo modifiche a modello dati, rendering, filtri, report o accessibilità.

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
- Riporta il numero effettivo di test superati e falliti.
- Non dichiarare test o verifiche non eseguiti.

## Limiti
Non implementare funzionalità aggiuntive oltre a quelle approvate.
Non usare servizi esterni, telemetria o dipendenze senza approvazione.
