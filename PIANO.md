# PIANO — App Addestramento Cinofilo

Stato: aggiornato al 26/10/2026 — **Fase 16 completata e verificata**. Aggiunti Archivio clienti, eliminazione a cascata con riepilogo e avvisi, rimozione completa dei dati di esempio e restyling "studio caldo". Suite complessiva **506 test superati, 0 fallimenti**: regressione 93, Fase 7 52, Fase 8 37, Fase 9 34, Fase 10 61, Fase 11 46, Fase 12 33, Fase 13 51, Fase 14 49, Fase 16 50.

## Obiettivo e utenti

App web leggera per un addestratore/istruttore cinofilo, utilizzabile offline da smartphone o computer, senza account né connessione a servizi cloud. L'istruttore usa l'app per:

- tenere l'anagrafica dei clienti e dei loro cani;
- registrare e tracciare i pagamenti;
- gestire gli appuntamenti;
- consultare un resoconto mensile;
- esportare i dati per il commercialista e creare backup.

L'interfaccia è in italiano, semplice e orientata all'uso in mobilità.

## Funzioni già implementate e verificate (Fase 2)

- **Home**: 4 pulsanti (Clienti, Pagamenti, Appuntamenti, Resoconto), interfaccia esistente invariata.
- **Clienti**:
  - nuovo cliente (nome, cognome, telefono, cane);
  - lista ordina per nome (localeCompare "it");
  - duplicati respinti (nome + cane, case-insensitive);
  - persistenza tra sessioni.
- **Pagamenti**:
  - nuovo pagamento (cliente, importo €, data, descrizione) con stato iniziale "Da pagare";
  - azione "Segna pagato";
  - ordina data decrescente, poi id;
  - duplicati respinti (cliente + data + importo), verificati solo sulle righe "Da pagare";
  - totali incassato / da ricevuta nel resoconto.
- **Appuntamenti**:
  - nuovo appuntamento (cliente, data, ora, tipo);
  - azione "Segna come fatto";
  - ordine cronologico crescente (data, ora, id).
- **Resoconto**: calcoli solo su dati reali, filtro mese corrente (incassato, da ricevere, numero di appuntamenti, clienti attivi).
- **Persistenza / backup**:
  - dati in `localStorage` (chiave `cinofilo-data-v1`);
  - nessun dato di esempio: il primo avvio è vuoto (demo rimossa nella Fase 16); normalizzazione con tipi coerenti e orfani reindirizzati a "Sconosciuto";
  - **export JSON** con download;
  - **import JSON** con validazione e `confirm` esplicito (mai sovrascrittura silenziosa); errori/annullamento segnalati senza modifiche.
- **Navigazione SPA** via hash, robusta anche in `file://` (funzione unica `goTo(view)`; avvio con solo `replaceState`).
- **Messaggi di stato** (esito salvataggi) nel `#status-bar`, auto-hide.

## Funzioni attualmente in sviluppo

- **Fase 3 — Anagrafica clienti e cani**: ✅ Completata e verificata (55 + 21 = 76 test ok).
- **Fase 4 — Pacchetti di lezioni**: ✅ Completata e verificata (app.js, index.html); suite estesa con Test 19–25; **123/123 successi, 0 fallimenti** (run finale pulito 25/10/2026).
- **Fase 6 — Gestione cartelle clienti e pacchetti con saldo parziale**: ✅ Completata e verificata (25/10/2026; suite `cinofilo_tests.py`, 22/22 successi). Nota numerazione: l'esportazione PDF resta **Fase 7** e il backup migliorato **Fase 8** nella numerazione corrente.
- **Fase 7 — Esportazione PDF per il commercialista**: ✅ Completata e verificata (26/10/2026; suite Fase 7 51/51 + regressione 84/84). Report stampabile con `window.print()` e foglio di stile `@media print`; nessuna dipendenza, nessuna modifica al modello dati.

## Roadmap delle fasi (ordine concordato)

1. **Fase 2** — CRUD dati reali, persistenza, resoconto, export/import JSON. ✅ Completata.
2. **Fase 3 — Clienti e cani (anagrafica completa)**: anagrafica per cliente con informazioni sul cane (razza, età, note). ✅ Completata e verificata.
3. **Fase 4 — Pacchetti di lezioni**: ✅ **Completata e verificata** (123/123 test successi). Vendita di pacchetti e tracciamento delle lezioni incluse/consumate.
4. **Fase 5 — Resconti mensili avanzati**: ✅ **Completata e verificata** (passi 1–4; suite 158/158). Selettore periodo, incidenza incassi per cliente, trend mese su mese, riepilogo pacchetti (lezioni rimanenti totali).
5. **Fase 6 — Gestione cartelle clienti e pacchetti con saldo parziale**: ✅ **Completata e verificata** (22/22 test, 25/10/2026). Rinomina/eliminazione clienti con conferma e rimappatura dati collegati; ogni nuovo pacchetto crea un pagamento collegato con stato "Parziale" (acconto > 0) o "Da pagare".
6. **Fase 7 — Esportazione PDF per il commercialista**: ✅ **Completata e verificata** (26/10/2026; 51/51 test Fase 7, 84/84 regressione). Report mensile stampabile con separazione tra incassato effettivo, importi contrattuali parziali e da ricevere; acconti non ricostruibili dichiarati.
7. **Fase 8 — Backup JSON migliorato e sicurezza**: ✅ **Completata e verificata** (35/35). Storage robusto, banner dati illeggibili, snapshot, blocco multi-scheda, primo avvio vuoto, import con conteggi/rollback, fix XSS e mobile.
8. **Fase 9 — Incassi effettivi e stato pagamenti derivato**: ✅ **Completata e verificata** (34/34). Registro `incassi`, stati `Pagato/Parziale/Da pagare/Da verificare`, migrazione legacy non distruttiva, resoconto e report su incassi effettivi.
9. **Fase 10 — CRUD completo, undo e validazioni**: ✅ **Completata e verificata** (61/61). Modifica/eliminazione con undo, sincronizzazione pacchetto-pagamento, duplicati/conflitti/limiti, incassi inline.
10. **Fase 11 — Scheda cliente, archiviazione e orfani**: ✅ **Completata e verificata** (46/46). Storico cliente, archiviazione/riattivazione, pannello dati orfani con assegnazione/eliminazione e undo.
11. **Fase 12 — Ricerca, filtri e agenda**: ✅ **Completata e verificata** (33/33). Ricerca e filtri su clienti, pagamenti, appuntamenti e pacchetti; agenda raggruppata per giorno; filtri mantenuti.
12. **Fase 13 — Accessibilità, focus, contrasto e responsive**: ✅ **Completata e verificata** (49/49). Titoli per vista, focus su form/scheda/incasso, Escape, `aria-expanded`/`aria-controls`, regioni etichettate, contrasto AA, mobile.
13. **Fase 14 — Export CSV e report per periodo/cliente**: ✅ **Completata e verificata** (49/49). CSV incassi/pagamenti con BOM, escaping e protezione formule; report e resoconto filtrati per mese e cliente.

## Decisioni tecniche

- **Stack**: HTML, CSS vanilla, JavaScript vanilla — nessuna dipendenza esterna, nessun framework, nessun build step, nessuna libreria aggiuntiva, nessun server.
- **Persistenza**: `localStorage` del browser (chiave `cinofilo-data-v1`); nessun backend, nessuna sincronizzazione.
- **Linguaggio**: UI e messaggi interamente in italiano.
- **Distribuzione**: file statici apribili via `file://` (index.html, styles.css, app.js).
- **Test automatizzati**: Playwright (Chromium headless), suite locale senza dipendenze nuove oltre Playwright già presente.

## Funzioni pianificate

- Clienti e cani: anagrafica completa (dati del cane oltre al nome).
- Pagamenti e stato dei pagamenti (presenti; migliorabili).
- Appuntamenti (presenti).
- Pacchetti di lezioni (Fase 4).
- Reseconti mensili avanzati (Fase 5). ✅ Completata e verificata (158/158).
- Gestione cartelle clienti e pacchetti con saldo parziale (Fase 6). ✅ Completata e verificata (22/22).
- Esportazione PDF per il commercialista (Fase 7). ✅ Completata e verificata (51/51 + 84/84).
- Backup JSON con procedure di ripristino consolidate (Fase 8).

## Limiti noti

- **Perdita dati**: i dati vivono solo nel `localStorage` del browser/dispositivo; la cancellazione della cronologia/cache del browser o l'uso di un altro browser o dispositivo fanno perdere i dati. **Il backup JSON è l'unico meccanismo di salvaguardia e va eseguito periodicamente.**
- **Nessuna sincronizzazione**: i dati non sono share tra dispositivi né tra browser; per trasferirli serve export/import manuale.
- **Nessun account/autenticazione**: l'app è mono-utentatore locale.
- **Import**: senza confirm esplicito non sovrascrive mai; un import convalidato sostituisce l'intero dataset.

## Test eseguiti e risultati effettivi

Suite Playwright (`/tmp/opencode/test_cinofilo.py`), Chromium headless, 14 gruppi di test su 55 asserzioni:

| # | Test | Esito |
|---|------|-------|
| 1 | Caricamento iniziale, vista e seed | pass |
| 2 | Nuovo cliente + persistenza reload | pass |
| 3 | Duplicato cliente respinto | pass |
| 4 | Nuovo pagamento, segna pago, totali riscontro | pass |
| 5 | Duplicato pagamento respinto | pass |
| 6 | Nuovo appuntamento, ordine, segna fatto, report | pass |
| 7 | Persistenza completa dopo reload | pass |
| 8 | Export JSON contenuto corretto | pass |
| 9 | Import JSON sostituisce dati | pass |
| 10 | Import JSON invalido → dati invariati | pass |
| 11 | Import JSON vuoto → dati invariati | pass |
| 12 | Confirm import rifiutato → dati invariati | pass |
| 13 | Seed non sommato; seed ripristinato a storage vuoto | pass |
| 14 | Nessun errore JavaScript al load | pass |

**Esito totale: 55/55 successi, 0 fallimenti.** (Ultimo fallimento risolto con fix di `renderPagamenti`: l'importo non si mostrava.)

# Piano Fase 3 — Anagrafica clienti e cani (completato e verificato)

## Obiettivo

Arricchire l'anagrafica dei clienti con i dati dei loro cani, senza complicare l'interfaccia:

- **Razza** del cane (nuovo campo).
- **Età** del cane: gestita come valore libero ("2 anni", "8 mesi") — evito il campo data di nascita per non complicare l'uso da smartphone e la normalizzazione dei dati.
- **Note** sul cane (comportamento, difficoltà, obiettivi dell'addestramento) — testo libero, facoltativo.

## Vincoli (già concordati)

- HTML, CSS e JavaScript vanilla; nessun framework, server, cloud o dipendenza.
- Interfaccia in italiano, semplice, utilizzabile da smartphone.
- Nessuna restyling generale; solo il form e la lista clienti si arricchiscono di campi.
- **Compatibilità dati esistenti**: il dataset in `localStorage` (chiave `cinofilo-data-v1`) e gli export/import JSON già esistenti devono continuare a funzionare senza migrazione obbligatoria.
- Non rompere i test di regressione Fase 2.

## Modifiche previste

### `index.html` — form e lista Clienti
- Nel form "Nuovo cliente", dopo il campo "Cane", aggiungere tre campi:
  - `razza` (testo, facoltativo) — es. "Labrador";
  - `eta` (testo, facoltativo) — es. "2 anni" (label "Età cane");
  - `note` (textarea, facoltativo) — label "Note sul cane (comportamento, difficoltà, obiettivi)".
- Resto del markup invariato (classi e id esistenti mantenuti).

### `app.js` — dati e rendering
- `normalizeData()`: per ogni cliente leggere i nuovi campi se presenti (`razza`, `eta`, `note`), coerzando a stringa e `trim`; se assenti, valorizzare con `""` (i vecchi dataset restano validi e i campi verranno semplicemente vuoti).
- `addCliente` (gestore del form `data-form="cliente"`):
  - leggere anche `razza`, `eta`, `note`;
  - salvarli sull'oggetto cliente `{ nome, telefono, cane, razza, eta, note, stato, id }`;
  - la regola anti-duplicato resta invariata (nome + cane, case-insensitive).
- Rendering lista clienti: nella riga di ogni cliente, dopo "Cane: ...", mostrare `Razza: <razza>` (solo se `razza` non è vuoto), `Età: <eta>` (solo se `eta` non è vuoto) e `Note: <note>` (solo se `note` non è vuoto). La riga non cambia struttura (stessa `.list-item__note`, aggiunta di stringhe).
- Seed: i 3 clienti iniziali **NON vengono modificati** (mancano `razza`/`eta`/`note` nei record esistenti → i relativi campi in lista restano vuoti, coerente con i dati reali). I nuovi client inseriti dall'utente con i campi compilati verranno salvati e mostrati.
- Export/import JSON: non cambia formato; se un vecchio JSON importato non contiene i nuovi campi, `normalizeData` li aggiunge come vuoti (compatibilità in avanti).
- Nessun nuovo view, nessun nuovo campo obbligatorio (tutti e tre i nuovi campi sono facoltativi).

### `styles.css`
- Nessuna modifica se i campi esistenti (`.form-panel`, `.list-item__note`) bastano. Eventuale aggiunta minima: se l'etichetta "Note" sul campo textarea richiede un adattatore, si usa un class esistente o una riga di stile minimale. Niente refactor.

## Compatibilità dati esistenti (regole)

- Dataset `localStorage` attuale (ch. `cinofilo-data-v1`): continua a funzionare senza migrazione. I nuovi campi, se assenti, sono valorizzati come stringa vuota da `normalizeData()` alla lettura.
- File JSON importati/creati dalla Fase 2: vengono importati senza problemi; `normalizeData()` coerza/valora i nuovi campi come vuoti se assenti.
- File JSON esportati dalla Fase 3: contengono i nuovi campi quando non sono vuoti; se un client non ha `razza`/`eta`/`note`, questi campi non sono inclusi nell'output (o vengono lasciati a `""` — si decide in implementazione, ma non rompono l'import).
- Regole anti-duplicato: invariate (solo nome + cane).

## Test di regressione / nuovi test da eseguire (Playwright, estendere l'attuale suite in `/tmp/opencode/test_cinofilo.py`)

1. **Nuovo test (Fase 3) — nuovo cliente con razza, età e note**:
   - inserimento con tutti i campi compilati;
   - verifica che la lista clienti mostri `Razza`, `Età` e `Note` nella riga del cliente;
   - verifica che la persistenza in `localStorage` dopo reload mantiene i campi.
2. **Regressione (Fase 2) — import JSON vecchio (Fase 2) e verifica lista**:
   - import di un JSON di Fase 2 (senza `razza`/`eta`/`note`);
   - verifica che la lista funzioni e mostri solo i campi base per quel cliente (non crash, non campi vuoti che rompano il markup);
   - i dati rimangono coerenti, nessun blocco.
3. **Regressione (Fase 2) — export JSON (Fase 3)**:
   - dopo insert di un nuovo cliente con `razza`/`eta`/`note`, export;
   - verifica che il JSON contenga i nuovi campi per quel cliente.
4. **Regressione (Fase 2) — anti-duplicato** resta valido, anche con razza/eta/note vuote o diverse (il confronto resta su nome + cane).
5. **Nessun errore JS** nel load (test 14 della suite esistente).
6. **Compatibilità storage**: un dataset reale già in `localStorage` (Fase 2) dopo il deploy Fase 3 (no migrazione) resta leggibile; i nuovi campi risultano vuoti per gli vecchi client.

## Attività non previste in questa fase (per non uscire dall'obiettivo)

- Nessun nuovo tipo di dato (es. peso, colori, vaccinazioni).
- Nessun nuovo campo obbligatorio.
- Nessuna modifica ai payment/appuntamenti/resoconto (salvo il fatto che la lista clienti, usata dai select nei form, si mostra solo con nuovi campi facoltativi; i `select` restano invariati).
- Nessuna estensione dell'export (rimane JSON).
- Nessuna estensione del report.

## Stato

- **Implementato**:
  - `index.html`: form "Nuovo cliente" arricchito con `razza`, `eta` (input testo + suffisso "anni"), `note` (textarea, facoltativi).
  - `styles.css`: aggiunta minimale `.field-age` e `.field-suffix` (nessun restyling generale).
  - `app.js`:
    - `normalizeClienti()` coerza `razza`/`eta`/`note` a stringa (default `""`) per compatibilità con dati vecchi;
    - handler `data-form="cliente"` legge e salva i tre nuovi campi; anti-dup invariato (nome+cane);
    - `renderClienti()` mostra `Razza:/Età:/Note:` inline nella `.list-item__note` solo se presenti.
  - Seed non modificati; export/import JSON invariati nel formato (i nuovi campi normali a `""` se assenti).
- **Test estesi**: suite Playwright `/tmp/opencode/test_cinofilo.py` arricchita con Test 15–18 (razza/eta/note, compatibilità import vecchio, persistenza, anti-dup invariato, export con i nuovi campi, nessun errore JS).
- **Note tecniche**:
  - `app.js` `importData()`: workaround di solo test — prima del prompt nativo `confirm()` viene letto `window.__confirmNext` (boolean) se presente, poi rimosso; in produzione il comportamento nativo resta invariato. Necessario per far superare gli import in headless Chromium, altrimenti bloccati sul prompt; usato dal Test 17 (import JSON vecchio). I Test 9 e 12 usano l'handler di dialog nativo di Chromium (`accept`/`dismiss`) e non toccano questo flag.
  - Test 17: `set_view(page, "resoconto")` + attesa prima di cliccare `#btn-esporta` (il pulsante è visibile solo nella vista resoconto).
  - `browser.close()` spostato dopo il Test 18 (prima era tra 14 e 15, causando `Page.evaluate: Target page...closed`).

## Test eseguiti e risultati effettivi

Suite: `cd /tmp/opencode && python3 test_cinofilo.py` — **25 gruppi di test, 123 asserzioni, 123 successi, 0 fallimenti** (eseguiti il 25/10/2026).

| # | Test | Asserzioni | Esito |
|---|------|-----------|-------|
| 1 | Caricamento iniziale + seed | 5 | OK |
| 2 | Nuovo cliente + persistenza | 5 | OK |
| 3 | Cliente duplicato respinto | 2 | OK |
| 4 | Nuovo pagamento, stato, resoconto | 10 | OK |
| 5 | Pagamento duplicato respinto | 2 | OK |
| 6 | Nuovo appuntamento, segnato fatto, ordine | 7 | OK |
| 7 | Persistenza completa dopo reload | 4 | OK |
| 8 | Export JSON | 4 | OK |
| 9 | Import JSON valido | 5 | OK |
| 10 | Import JSON non valido (invariati) | 2 | OK |
| 11 | Import JSON vuoto (invariati) | 2 | OK |
| 12 | Import con confirm rifiutato | 2 | OK |
| 13 | Seed non sommato ai dati reali | 4 | OK |
| 14 | Niente errori JS nel load | 1 | OK |
| 15 | Cliente con razza/età/note (Fase 3) | 8 | OK |
| 16 | Cliente senza dettagli cane (Fase 3) | 3 | OK |
| 17 | Compatibilità import JSON vecchio (Fase 3) | 9 | OK |
| 18 | Niente errori JS nella Fase 3 | 1 | OK |
| 19 | Vista pacchetti + pacchetto base (Fase 4) | 14 | OK |
| 20 | Consumo lezioni, atteso→esaurito (Fase 4) | 8 | OK |
| 21 | Validazioni form pacchetto + anti-dup (Fase 4) | 9 | OK |
| 22 | Compatibilità import JSON vecchio (Fase 4) | 5 | OK |
| 23 | Export JSON con chiave `pacchetti` (Fase 4) | 5 | OK |
| 24 | Pacchetto orfano → "Sconosciuto" (Fase 4) | 5 | OK |
| 25 | Niente errori JS nella Fase 4 | 1 | OK |

Profilo totale: 55/55 Fase 1–2 (regressioni) + 21/21 Fase 3 + 47/47 Fase 4 = 123/123.

## Prossime fasi (fuori scope, non avviate)

- **Fase 6** e successive: non iniziate. (La **Fase 5** è ora completata e verificata: suite 158/158; i dettagli sono nella sezione dedicata più in basso.)

---

# Piano Fase 4 — Pacchetti di lezioni (completato e verificato)

## Obiettivo

Tracciare i pacchetti di lezioni venduti a un cliente per il suo cane:

- un **pacchetto** è associato a un **cliente** e al cane di quel cliente (riferimento a `clienteId`, il cane viene mostrato dall'anagrafica, non duplicato nel pacchetto);
- il pacchetto ha un **numero totale di lezioni** e un **prezzo totale**;
- le lezioni **utilizzate** vengono registrate su richiesta dell'utente (azione esplicita "Consuma lezione"); il numero **rimanente** è derivato (`totale − utilizzate`), non memorizzato;
- lo **stato** del pacchetto è derivato e mostrato: **"Attivo"** se restano lezioni, **"Esaurito"** quando `utilizzate >= totale`. Non è un campo salvato a parte.

## Vincoli

- HTML, CSS e JavaScript vanilla; nessun server, cloud, framework o dipendenza.
- **Compatibilità dati esistenti**: il dataset `localStorage` (`cinofilo-data-v1`) e gli export/import JSON delle fasi 1–3 devono continuare a funzionare senza migrazione obbligatoria. Un JSON vecchio senza la chiave `pacchetti` resta importabile (la chiave viene trattata come `[]`).
- Nessun nuovo campo obbligatorio nell'anagrafica: l'associazione col cane avviene tramite il cliente già esistente.
- Nessun nuovo file, nessun restyling generale.
- Il seed **non viene modificato** (nessun pacchetto nei dati seed; al primo avvio `pacchetti` resterà `[]` o assente).
- Formato export/import JSON: si estende aggiungendo la chiave `pacchetti` se non vuota; i file senza la chiave restano validi all'import.

## Modifiche previste

### `index.html`
- **Home**: aggiunger un quinto pulsante "PACCHETTI" in `#view-home` (griglia estesa, stessa classe `home-btn`).
- **Nuova vista** `#view-pacchetti`:
  - header con back button + titolo + pulsante `#btn-nuovo-pacchetto`;
  - pannello form `#form-pacchetto` (inizialmente `hidden`), `data-form="pacchetto"`:
    - `select name=clienteId` (riempito da `fillClienteSelects()`, come negli altri form);
    - `input type=number name=lezioni min=1` (lezioni totali del pacchetto);
    - `input type=number name=prezzo min=0.01 step=0.01` (prezzo totale in €);
    - `input type=date name=data` (data di acquisto/registrazione);
    - campi Salva/Annulla (stesso pattern `data-cancel`).
  - `ul#pacchetti-list` con la lista.

### `app.js`
- **Dati**:
  - `data` otterrà una nuova chiave `pacchetti` (array). `seedData` **invariato**; `normalizeData()` restituirà `pacchetti: Array.isArray(raw.pacchetti) ? raw.pacchetti.map(normalizePacchetto).filter(Boolean) : []` (assenza della chiave → `[]`, nessun error).
  - Nuova funzione `normalizePacchetto(p)`:
    - valida `id` numerico;
    - `clienteId` numerico (default 0, con reindirizzamento a "Sconosciuto" per orfani, come per pagamenti/appuntamenti);
    - `lezioni` intero ≥ 0 (default 0);
    - `utilizzate` intero ≥ 0, **coerente**: se `utilizzate > lezioni`, la coerco a `lezione`;
    - `prezzo` numero finito ≥ 0 (default 0);
    - `data` stringa ISO (default `todayStr()`).
  - **Helper derivati**: `lezioniRimanenti(pk) = max(pk.lezioni - pk.utilizzate, 0)`; stato derivato: `pk.utilizzate >= pk.lezioni` → "Esaurito" altrimenti "Attivo". Nessun campo `stato` o `rimanenti` salvato.
- **Rendering** `renderPacchetti()`:
  - ordina per `data` decrescente, poi `id`;
  - ogni riga: titolo "Cliente — Cane" (da `clienteById`), meta "Lezioni: X · Rimaste: Y", meta "Prezzo: € … · Data: dd/mm/aaaa", badge `badge--ok` "Attivo" o `badge--neutral` "Esaurito";
  - se `Attivo`, pulsante `data-action="consuma-lezione"` ("Consuma lezione") che incrementa `utilizzate` di 1 (mai oltre `lezioni`);
  - lista vuota: "Nessun pacchetto registrato."
  - `refresh()` aggiorna anche `renderPacchetti()` e `fillClienteSelects()` include il nuovo select.
- **Gestione form** `data-form="pacchetto"`:
  - convalida: cliente valido, `lezioni >= 1`, `prezzo > 0`, data presente;
  - anti-duplicato: stesso `clienteId + data + lezioni` (coerente con il pattern delle altre sezioni);
  - salva `{ id, clienteId, lezioni, utilizzate: 0, prezzo, data }`.
- **HandleClick**: nuovo `btn-nuovo-pacchetto`; nuova action `consuma-lezione`.
- **KNOWN_VIEWS**: aggiunta `"pacchetti"`.
- **Import**: `normalizeData` gestisce `pacchetti` assente → `[]`; nessun cambiamento sul flusso di conferma. L'export include `pacchetti` se non vuoto (JSON.stringify sull'oggetto `data`, che conterrà la chiave).

### `styles.css`
- Nessun restyling generale; la griglia home ospita il quinto pulsante con le classi esistenti (`home-grid`/`home-btn`). Eventuale stile minimo solo se necessario per la nuova vista (riusa `.section-header`, `.form-panel`, `.list`, `.list-item`, `.badge` esistenti).

## Compatibilità dati esistenti (regole)

- Dataset `localStorage` attuale: continua a funzionare senza migrazione; `pacchetti` assente → `[]` in `normalizeData`.
- File JSON importati delle fasi 1–3 (senza `pacchetti`): importabile, i pacchetti restano `[]`, nessun errore, nessun crash al render.
- File JSON esportati dalla Fase 4: includono la chiave `pacchetti` (anche se `[]` o con righe); import di un file Fase 4 in un'app Fase 4 resta bidirezionale.
- Orfani: un pacchetto riferito a un cliente non esistente viene mantenuto con `clienteId = 0` e mostrato come "Sconosciuto" (stesso pattern di pagamenti e appuntamenti).
- Anti-duplicato nuovo (cliente + data + lezioni) non interferisce con gli anti-dup esistenti (clienti: nome+cane; pagamenti: cliente+data+importo).

## Test da eseguire (Playwright, estensione di `/tmp/opencode/test_cinofilo.py`)

### Nuovi test (Fase 4)

1. **Vista pacchetti + pacchetto base**:
   - la home mostra 5 pulsanti (incluso PACCHETTI);
   - `#pacchetti` mostra la vista con lista vuota "Nessun pacchetto registrato.";
   - creо un pacchetto (cliente del seed, 5 lezioni, 300 €, data corrente);
   - la lista mostra: nome cliente, "Cane:" dalla anagrafica, "Lezioni: 5", badge "Attivo", prezzo;
   - persistenza dopo reload.
2. **Consumo lezioni**:
   - dopo 2 clic "Consuma lezione" su un pacchetto di 5: la lista mostra "Rimaste: 3" e il pulsante è ancora visibile;
   - dopo 3 clic aggiuntivi ("Consuma lezione" fino a `utilizzate = 5`): il badge passa a "Esaurito", il pulsante "Consuma lezione" scompare dalla riga;
   - le `utilizzate` non superano mai `lezioni` (clic extra non permettono `utilizzate > lezioni`).
3. **Validazioni form**:
   - `lezioni = 0` o negativo → rifiutato;
   - `prezzo = 0` → rifiutato;
   - data mancante → rifiutato;
   - anti-duplicato: stessa data + cliente + lezioni → rifiutato;
   - stessa data+cliente con numero di lezioni diverso → consentito.
4. **Compatibilità import JSON vecchio (Fase 3)**:
   - import di un JSON **senza** la chiave `pacchetti`;
   - nessun errore JS; la vista pacchetti mostra la lista vuota o i dati esistenti coerenti; altri dati immutati.
5. **Export JSON Fase 4**:
   - dopo creazione di 1–2 pacchetti, l'export contiene la chiave `pacchetti` con i campi `id`, `clienteId`, `lezioni`, `utilizzate`, `prezzo`, `data`;
   - nessun campo `stato`/`rimanenti` nel JSON (derivati, non salvati).
6. **Pacchetto orfano**:
   - import di un JSON con un `pacchetti` il cui `clienteId` non esiste in `clienti`;
   - la riga mostra "Sconosciuto", nessun crash; nessun errore JS.
7. **Nessun errore JavaScript** al load e durante l'interazione (test di regressione estesa).

### Regressione (fasi 1–3)

- Riexecuzione della suite esistente **testi 1–18 invariati** (`cd /tmp/opencode && python3 test_cinofilo.py`):
  - home: i 4 pulsanti preesistenti restano funzionanti (il nuovo quinto non interferisce con i test che contano/clickano i pulsanti esistenti — verificare che nessun asserzione conta il numero totale dei pulsanti home in modo rigido);
  - CRUD clienti, anti-dup, razza/eta/note: invariati;
  - pagamenti/appuntamenti/resoconto: invariati;
  - export/import JSON: nessun regressione (il formato vecchio resta importabile, il nuovo formato include `pacchetti`).
- Aggiungere eventuali nuove asserzioni di regressione se un test esistente conta il numero di pulsanti home o asserisce sull'assenza della vista `#pacchetti`.

## Attività non previste in questa fase

- **Nessuna** integrazione automatica con gli **appuntamenti** (es. decrementare `utilizzate` quando un appuntamento è segnato "fatto"): fuori scope, per non accoppiare dati e complicare la normalizzazione.
- **Nessuna** modifica dei **pagamenti** (il prezzo del pacchetto è un campo del pacchetto, non un pagamento; nessun record di pagamento creato automaticamente).
- **Nessuna** gestione di pacchetti per **più cani** dello stesso cliente: un pacchetto è associato al cliente; il cane mostrato è quello in anagrafica.
- **Nessuna** modifica dell'export (resta JSON) o del **resoconto** (nessun nuovo indicatore mensile sui pacchetti).
- **Nessuna** modifica di `seedData`.
- **Nessun** nuovo tipo di dato, nessun campo obbligatorio aggiuntivo in anagrafica.

## Stato

- **Approvato dall'utente (25/10/2026)** con le seguenti precisazioni, che si applicano nell'implementazione:
  - prezzo inserito = **prezzo totale** del pacchetto;
  - ogni `"Consuma lezione"` incrementa `utilizzate` di +1;
  - mai consumi oltre `lezioni` acquistate;
  - dopo ogni consumo: mostra le **lezioni rimaste** e **conferma** l'operazione;
  - a pacchetto esaurito: **nascondi** l'azione di consumo;
  - anti-duplicato come da piano (clienteId + data + lezioni);
  - **nessun** pagamento creato automaticamente, **nessun** aggancio agli appuntamenti;
  - compatibilità con vecchi dati e export/import JSON;
  - interfaccia semplice, in italiano, utilizzabile da smartphone.
- **Completata e verificata il 25/10/2026.**
- **Suite finale: 123/123 successi, 0 fallimenti** (Playwright, Chromium headless; run pulito, `exit=0`, log `run_final.log`).
- Esito test 19–25:
  - Test 19 (vista pacchetti + pacchetto base): ✅
  - Test 20 (consumo lezioni, atteso→esaurito): ✅
  - Test 21 (validazioni form pacchetto + anti-duplicato): ✅
  - Test 22 (compatibilità import JSON vecchio senza `pacchetti`): ✅
  - Test 23 (export JSON con chiave `pacchetti`, nessun campo derivato): ✅
  - Test 24 (pacchetto orfano → "Sconosciuto", consumo ok): ✅
  - Test 25 (nessun errore JavaScript nella Fase 4): ✅
- Note tecniche rilevanti:
  - il nome del badge "Attivo"/"Esaurito" è renderizzato in **maiuscolo** via CSS `text-transform: uppercase` su `.badge`; le stringhe nel DOM sono title-case ("Attivo"/"Esaurito"), ma le asserzioni devono confrontare con `"ATTIVO"`/`"ESAURITO"` sul testo upper-cased.
  - `money()` usa `toLocaleString("it-IT")` → nel prezzo compare un NBSP (`\xa0`) tra numero e "€"; comportamento atteso, non un bug.
  - Test 21: il form submit rimuove dinamicamente i vincoli nativi `required`/`min`/`step` e usa `requestSubmit()`, perché la validazione HTML5 blocherebbe prima il handler JS.

## Problemi aperti

- **Import JSON contenente solo pacchetti** (nessun cliente, nessun pagamento, nessun appuntamento): viene rifiutato come "File vuoto" perché il check di import è `!nC && !nPg && !nAp`. Comportamento **deliberato** (un file con solo pacchetti non ha senso senza clienti a cui appenderli) e non modificato. Segnalato a scopo informativo.

## Fermo

- **Fase 5 completata** (passi 1–4 verificati, 25/10/2026). Suite: **158/158 successi, 0 fallimenti**, exit=0, log `/tmp/opencode/run_f5_p4b.log`. Nota: `test_cinofilo.py` e il log non sono più presenti sul disco, quindi la suite non è più ri-eseguibile in questo ambiente; lo stato riportato è quello documentato nelle fasi 4 e 5. Smoke test ad-hoc indipendente: **21/21 asserzioni su 10 gruppi, tutte superate**. FERMATO, in attesa di approvazione Fase 6.
---

# Piano Fase 5 — Resoconti mensili avanzati (completato e verificato)

## Obiettivo

Arricchire il resoconto mensile con selezioni di periodo e tabelle di dettaglio, mantenendo le 4 righe di riepilogo esistenti e riusando le regole di calcolo già presenti:

- **Passo 1 (completato e verificato)**: selettore di periodo nella vista Resoconto — 12 mesi a ritroso dal mese corrente, default = mese corrente, re-render al cambio. Il valore è stato UI (non persistito: al reload torna al mese corrente).
- **Passo 2 (completato e verificato, 25/10/2026)**: incidenza incassi per cliente nel periodo selezionato — riutilizza la regola incassi esistente (solo `pagamenti` con `stato === "Pagato"` nel periodo selezionato); i pacchetti **non** rientrano nei calcoli incassati → nessun doppio conteggio. Se nel periodo non ci sono pagamenti Pagati il blocco per-cliente non viene mostrato.
- **Passo 3 (completato e verificato, 25/10/2026)**: trend incassi mese su mese — mostra la variazione percentuale degli incassi del mese selezionato rispetto al mese precedente. Se il mese precedente ha incassi 0 → "—". Colore: verde (su), rosso (giù), grigio (pari).
- **Passo 4 (completato e verificato, 25/10/2026)**: riepilogo pacchetti nel resoconto — mostrare solo "**Lezioni rimanenti totali**" (`Σ (lezioni − utilizzate)` su tutti i pacchetti). **Limite**: il modello dati non ha storico mensile dei consumi (solo `utilizzate` cumulativo, senza data), quindi i consumi del mese non sono calcolabili senza modificare il modello dati (non autorizzato); il limite è documentato e segnalato in UI — Opzione 1 scelta dall'utente.

## Vincoli

- HTML/CSS/JS vanilla; nessuna dipendenza.
- Compatibilità `cinofilo-data-v1`; nessun nuovo campo obbligatorio; nessuna modifica al modello dati.
- Test TDD: test prima del codice, ogni passo piccolo e verificabile, fermata dopo ogni passo.
- Nessuna Fase 6.

## Stato

- **Passo 1 — COMPLETATO e verificato (TDD):**
  - `test_cinofilo.py`: nuovo gruppo "Test 26" (12 asserzioni) — select presente, default mese corrente, 12 opzioni, label periodo coerente, righe esistenti invariate, cambio mese → label aggiornate + righe presenti, nessun errore JS.
  - `index.html`: `.resoconto-mese-row` con `<select id="resoconto-mese">` sopra `#resoconto`.
  - `app.js`: `periodRange(y,m)`, `currentMonth()` (usa `periodRange`), `recentMonths(n)`, `selectedMonth()`, `inMonth()` (usa `selectedMonth()`), `fillMonthSelect()` (chiamata in `renderResoconto()`, guard `_filled` per non duplicare opzioni), listener `change` su `#resoconto-mese` → `renderResoconto()`.
  - **Suite: 135/135 successi, 0 fallimenti** (Playwright, Chromium headless, `exit=0`, log `/tmp/opencode/run_f5.log`).
- **Passo 2 — COMPLETATO e verificato (TDD, 25/10/2026):**
  - `test_cinofilo.py`: nuovo gruppo "Test 27" (10 asserzioni) — blocco `Incidenza incassi per cliente` presente, righe Anna 120 € / Maria 200 € nel mese corrente, Giuseppe (80 € "Da pagare") escluso, riga Totale = 320 €, cambio al mese più lontano → block assente (0 righe), nessun errore JS.
  - `app.js`: in `renderResoconto()` aggregazione `perCliente` da `pagatiMese` (solo `stato === "Pagato"`, già filtrata in `inMonth`); ordinamento per importo decrescente con tie-break per nome; rendering `<ul>` `.resoconto-clienti__list` con `<li class="resoconto-cliente-row">` per cliente + riga "Totale" coerente con `incassato`.
  - `styles.css`: stili `.resoconto-clienti`, `.resoconto-clienti__title`, `.resoconto-clienti__list`, `.resoconto-cliente-row`, `.resoconto-cliente-row--totale`, in linea con le `.resoconto-card` esistenti.
  - **Suite: 145/145 successi, 0 fallimenti** (Playwright, Chromium headless, `exit=0`, log `/tmp/opencode/run_f5_p2.log`).
- **Passo 3 — COMPLETATO e verificato (TDD, 25/10/2026):**
  - `test_cinofilo.py`: nuovo gruppo "Test 28" (8 asserzioni) — riga trend presente; caso seed (ott=320, sep=0) → "—", nessun badge; caso B (sep=100) → +220 % con badge "su"; caso C (sep=320) → 0 %; nessun errore JS. Helper `seed_with_prev()` inietta pagamenti di settembre via `localStorage.setItem` + reload.
  - `app.js`: helper `prevMonth(ym)` e `incassatoMese(ym)` (non modificano `inMonth` ne `pagatiMese`); in `renderResoconto()` calcolo `trendLabel`/`trendCls` (0 → "—"; ±% arrotondato a 0 decimali + "(su)"/"(in calo)"/"(invariato)"); riga `div.resoconto-card.resoconto-trend.{up|down|pari}` inserita dopo le 4 card.
  - `styles.css`: `.resoconto-trend--up` (verde #1a7f37), `.resoconto-trend--down` (rosso #c0392b), `.resoconto-trend--pari` (ink-2) su `.resoconto-card__value`.
  - **Suite: 153/153 successi, 0 fallimenti** (Playwright, Chromium headless, `exit=0`, log `/tmp/opencode/run_f5_trend.log`).
- **Passo 4 — COMPLETATO e verificato (TDD, 25/10/2026):**
  - `test_cinofilo.py`: nuovo gruppo "Test 29" (5 asserzioni) — blocco ".resoconto-pacchetti" presente anche a 0 pacchetti, valore 0, nota limite storico mensile, caso 3 pacchetti monouso (utilizzate=0) → 35 lezioni rimanenti nel DOM, nessun errore JS. Helper `seed_with_pacchetti` inietta pacchetti via `localStorage.setItem` + reload.
  - `app.js`: in `renderResoconto()` calcolo `rimanentiTotali = data.pacchetti.reduce((s, pk) => s + lezioniRimanenti(pk), 0)` e blocco `div.resoconto-pacchetti` con label "Lezioni rimanenti totali", valore, e nota "Storico mensile consumi non disponibile con i dati attuali".
  - `styles.css`: stili `.resoconto-pacchetti`, `.resoconto-pacchetti__label`, `.resoconto-pacchetti__value`, `.resoconto-pacchetti__note` in linea con le `.resoconto-card` esistenti.
  - **Suite: 158/158 successi, 0 fallimenti** (Playwright, Chromium headless, `exit=0`, log `/tmp/opencode/run_f5_p4b.log`).
  - **Verifica aritmetica**: `lezioniRimanenti` testata con 8 casi in Chromium (monouso, casi intermedi, clamp `utilizzate > lezioni`, esaurito) — tutti corretti. Riduzioni `reduce(+)` su `[7,0,13] → 20` e `[10,5,20] → 35` verificate in Chromium. Nessun bug ambientale: `+`, `sum()`, `reduce(+)` funzionano correttamente in Python 3.12 e Chromium.

## Problemi aperti

- **Storico mensile consumi pacchetti non disponibile**: `utilizzate` è cumulativo senza data; il consumo del mese non è calcolabile con i dati attuali. Opzione 1 scelta: mostrare solo le lezioni rimanenti totali e documentare il limite. Una soluzione compatibile (es. array `consumi: [{data, n}]` per pacchetto) richiede autorizzazione esplicita per la modifica del modello dati.

## Fermo
- **Fase 5 completata** (passi 1–4 verificati, 25/10/2026). Suite: **158/158 successi, 0 fallimenti**, exit=0, log `/tmp/opencode/run_f5_p4b.log`. Nota: `test_cinofilo.py` e i log non sono più presenti sul disco, quindi la suite non è più ri-eseguibile in questo ambiente; lo stato riportato è quello documentato nelle fasi 4 e 5. Smoke test ad-hoc indipendente: **21/21 asserzioni su 10 gruppi, tutte superate**.
- **Fase 6 (gestione cartelle) completata e verificata** — vedi sezione dedicata sotto.
- Prossimo passo (superato): **Fase 7 — Esportazione PDF per il commercialista** — completata il 26/10/2026 (vedi sezione dedicata in fondo).

# Piano Fase 6 — Gestione cartelle clienti e pacchetti con saldo parziale (completata e verificata)

> Nota di numerazione: in questa fase la roadmap è stata riallineata: la gestione cartelle + saldo parziale è la **Fase 6**; l'esportazione PDF è divenuta **Fase 7** e il backup migliorato **Fase 8**.

## Obiettivo

1. **Gestione cartelle clienti**: pulsanti "Rinomina" e "Elimina" su ogni scheda cliente nella vista Clienti, con conferma e regole di sicurezza definite.
2. **Pacchetti ↔ pagamenti**: ogni nuovo pacchetto crea automaticamente il relativo pagamento, gestendo il saldo parziale con lo stato "Parziale".

## Decisioni e regole (confermate)

- **Cartelle** = schede clienti.
- **Rinomina**: `prompt()` in due passaggi (nome, poi cane); nome vuoto respinto (`setStatus` "Nome non valido"), `null` (annulla) → nessun cambiamento.
- **Eliminazione**: `confirm()`; cliente filtrato via `data.clienti`; pagamenti/appuntamenti/pacchetti **non eliminati** ma rimappati a `clienteId: 0` (mostrati come "Sconosciuto").
- **Nuovo pacchetto → pagamento collegato**: 1 riga `pagamenti` con `pacchettoId = nuovoPacchetto.id`, `importo = prezzo`, `descrizione: "Pacchetto N lezioni"`, `stato: "Parziale"` se `acconto > 0` altrimenti `"Da pagare"`.
- **Campo `acconto`** (euro, ≥ 0) nel form dei pacchetti (default `0`, step `0.01`); `acconto > prezzo` respinto ("Acconto superiore al prezzo del pacchetto").
- **Nuovo campo dati**: `pagamenti[].pacchettoId` (numero, default 0) — campo opzionale, compatibile in avanti/indietro.
- **Incasso**: `incassatoMese`/`renderResoconto` contano `Pagato` + `Parziale` nell'incassato; `Da pagare` escluso dall'incassato e mostrato in `daRicevere`.
- **Anti-duplicati**: i pagamenti manuali vengono confrontati come duplicati solo se `pacchettoId === 0` (sui campi `clienteId+data+importo`); i pacchetti duplicati sono confrontati su `clienteId+data+lezioni`. I pagamenti generati da pacchetto (con `pacchettoId > 0`) non entrano nel confronto.

## Modifiche effettuate

### `app.js`
- `renderClienti()`: per ogni scheda cliente aggiunti pulsanti `Rinomina` (`data-action="rinomina-cliente"`) ed `Elimina` (`data-action="elimina-cliente"`, classe `btn-small--danger`).
- `handleClick()`: gestione `rinomina-cliente` (2 `prompt()`, validazione, `saveData(); refresh()`) ed `elimina-cliente` (`confirm`, filtro `data.clienti`, rimappatura `clienteId → 0` su pagamenti/appuntamenti/pacchetti, `saveData(); refresh()`).
- `normalizePagamento()`: accetta `pacchettoId` (numero, default 0) e stato `"Parziale"`.
- `normalizeData()`: `pacchettoId` orfano → azzerato.
- `incassatoMese()` / `renderResoconto()`: includono `"Parziale"` nell'incassato e mostrano `"Da pagare"` in `daRicevere`.
- `renderPagamenti()`: badge `"Parziale"` → `badge--warn`.
- Anti-duplicati: pagamenti solo `pacchettoId === 0`; pacchetti su `clienteId+data+lezioni`.
- Submit pacchetto: aggiunge il pagamento collegato.
- Test hook: `window.__appData = data` (riferimento al modello dati in memoria, usato dai test).

### `index.html`
- Campo `acconto` in `#form-pacchetto` (`value="0"`, `min="0"`, `step="0.01"`).

### `styles.css`
- Block `.btn-small--danger` (rosso #b3261e, hover #fdeeee, focus-visible).

## Compatibilità dati

- Nessuna modifica obbligatoria al modello dati; `pacchettoId` è opzionale e normalizzato con default 0.
- Verificate lettura/salvataggio/esportazione/importazione: 4 array standard (`clienti`, `pagamenti`, `appuntamenti`, `pacchetti`) presenti e coerenti dopo ogni modifica; nessun campo obbligatorio nuovo.
- Nessun dato esistente cancellato o sovrascritto.

## Test eseguiti e risultati effettivi

Suite Playwright (`/tmp/opencode/cinofilo_tests.py`), Chromium headless, **22 test, 22 superati, 0 fallimenti, exit code 0** (esecuzione `python3 /tmp/opencode/cinofilo_tests.py`). Breakdown:

| # | Test | Esito |
|---|------|-------|
| 1 | pulsanti rinomina presenti (3) | pass |
| 2 | pulsanti elimina presenti (3) | pass |
| 3 | campo acconto presente nel form pacchetti | pass |
| 4 | rename_ok | pass |
| 5 | rename_cane | pass |
| 6 | rename_empty_rejected | pass |
| 7 | delete_ok | pass |
| 8 | delete_cancelled | pass |
| 9 | delete_keep_related | pass |
| 10 | pkt_no_acc | pass |
| 11 | pkt_acc | pass |
| 12 | acc_rejected | pass |
| 13 | dup_rejected | pass |
| 14 | export_pkg | pass |
| 15 | persistenza: rinomina dopo reload | pass |
| 16 | persistenza: eliminazione dopo reload | pass |
| 17 | resoconto: Parziale incluso nell'incassato | pass |
| 18 | resoconto: Da pagare mostrato nel da-pagare | pass |
| 19 | regressione: consuma-lezione incrementa utilizzate | pass |
| 20 | regression test: segna-pagato sets stato to Pagato | pass |
| 21 | regression test: 4 standard data arrays present | pass |
| 22 | regression test: anti-duplicate on client name + dog | pass |

**Totale: 22/22 superati, 0 fallimenti.**

Nota metodologica: i casi che richiedono dati iniettati (es. `delete_keep_related`) mutano `window.__appData` solo in memoria **prima** del click, senza scrivere su `localStorage`; la `saveData()` finale dell'handler serializza il modello in memoria su `localStorage` e garantisce la persistenza.

## Problemi aperti

- Ripreso da Fase 5: **Storico mensile consumi pacchetti non disponibile** (`utilizzate` cumulativo senza data). Nessun nuovo problema aperto in questa fase.
- La suite precedente (158 test di Fase 5) non è più presente su disco; la suite attuale è `cinofilo_tests.py` (22 test). La Fase 5 resta documentata e verificata, ma non ri-eseguibile in questo ambiente.

## Fermo

- **Fase 6 (gestione cartelle + pacchetti con saldo parziale) COMPLETATA e verificata** (25/10/2026). 22/22 test superati, 0 fallimenti, exit 0.
- **Fase 7 completata** (vedi sezione dedicata sotto). **FERMO** in attesa di approvazione per la **Fase 8 — Backup JSON migliorato**, da non avviare senza approvazione.

---

# Piano Fase 7 — Esportazione PDF per il commercialista (completata e verificata)

## Obiettivo

Report mensile stampabile e salvabile in PDF con i movimenti del mese selezionato, **senza dipendenze** e **senza modifiche al modello dati**. Scelta approvata dall'utente (Opzione A + R1): nessun campo nuovo, nessuna libreria PDF, `window.print()` + foglio di stile di stampa.

## Regole di presentazione (vincoli approvati)

- **Incassato effettivo** = solo pagamenti con `stato === "Pagato"`.
- **Importi contrattuali parziali** = pagamenti con `stato === "Parziale"`, mostrati separatamente e **mai** sommati all'incassato.
- **Da ricevere** = pagamenti con `stato === "Da pagare"`.
- **Acconti**: dichiarato esplicitamente che l'acconto effettivamente ricevuto **non è ricostruibile** dai dati (non è salvato); nessun importo stimato o inventato.
- **Riga di raccordo** con il totale mostrato a schermo: spiega che il resoconto dell'app include per intero i parziali, indicando `effettivo + parziale = totale a schermo`.
- Per riga: `Parziale` → suffisso "(contrattuale)", `Da pagare` → "(da ricevere)".
- **Incassi effettivi per cliente**: calcolati solo su `Pagato`; totale coerente con l'incassato effettivo.
- **Lezioni rimanenti totali**: valore già esistente, non monetario, con nota sul limite dello storico mensile.
- Mese senza movimenti: "Nessun movimento nel periodo", totali a 0.

## Modifiche effettuate

### `index.html`
- Pulsante `#btn-esporta-pdf` ("Esporta PDF") in `.section-header__actions` della vista Resoconto, dopo "Esporta dati".
- `<section id="report-print" class="report">` in fondo al `body`, fuori da `#resoconto` per non alterare i selettori esistenti.

### `app.js` (solo aggiunte)
- `buildReportData()`: legge i dati con `selectedMonth()`, `inMonth()`, `clienteNome()`, `money()`; calcola separatamente effettivo/parziale/da ricevere, incassi effettivi per cliente, lezioni rimanenti. Ordinamento movimenti identico alla vista Pagamenti (data decrescente, id decrescente). Non modifica e non duplica i calcoli del resoconto.
- `renderReport()`: compila `#report-print` con DOM API e `textContent` per i valori utente (nessun HTML da input); chiamata in coda a `renderResoconto()` per restare allineata al mese selezionato.
- `printReport()`: rigenera il report e chiama `window.print()`; su errore messaggio in `#status-bar`.
- Handler `handleClick`: `#btn-esporta-pdf` → `printReport()`.
- **Non modificati**: `normalizeData`, `seedData`, `seed`, export/import JSON, `incassatoMese`, `renderResoconto` (calcoli), `inMonth`, form e handler esistenti.

### `styles.css`
- `#report-print { display: none }` a schermo (nessuno stile della Fase 7 tocca le viste esistenti).
- Stili del report (`pt`/`mm`, tabella con bordi leggeri, sezioni) applicati solo all'elemento nascosto.
- `@media print`: `@page A4` con margine 15 mm, nasconde `.view` e `.status-bar`, mostra `#report-print`, `thead` ripetuto e righe non spezzate.

## Compatibilità dati

- Nessuna nuova chiave, nessun campo obbligatorio, seed invariato: `cinofilo-data-v1`, export e import restano identici e ri-importabili.
- Il report è in sola lettura: nessuna `saveData()` nell'esportazione PDF.
- Prova runtime: con dataset Fase 6 (pagamento `Parziale` + `acconto` non salvato) il PDF riporta l'importo contrattuale e **nessun** importo di acconto.

## Test eseguiti e risultati effettivi (26/10/2026)

Le vecchie suite non erano più su disco: ne ho ricreate due in `/tmp/opencode/` (fuori dal progetto), con dataset deterministico nel mese corrente.

| Suite | File | Esito | Log |
|---|---|---|---|
| Regressione Fase 2–6 | `/tmp/opencode/test_regressione.py` | **84/84 superati, 0 fallimenti, exit 0** | `/tmp/opencode/run_regressione.log` |
| Fase 7 | `/tmp/opencode/test_fase7.py` | **51/51 superati, 0 fallimenti, exit 0** | `/tmp/opencode/run_fase7.log` |

Copertura regressione (84 asserzioni): caricamento/seed, navigazione hash + reload + hash ignoto, cliente con razza/età/note + persistenza, duplicati, pagamenti e totali, segna pagato, appuntamenti (ordine, fatto, persistenza), pacchetto con pagamento collegato, consumo fino a esaurimento (azione nascosta), acconto → `Parziale`, acconto > prezzo, anti-duplicati, pagamento manuale non bloccato dal collegato, rinomina/elimina cliente con rimappatura a "Sconosciuto", export JSON (4 chiavi, nessun campo derivato), import JSON vecchio (`pacchetti` → `[]`), import non valido/annullato/vuoto/solo pacchetti, struttura resoconto (5 card, 12 mesi, incidenza, pacchetti), **pin Fase 6: `Parziale` incluso nell'incassato a schermo (520,00 €)**, persistenza, zero errori JS.

Copertura Fase 7 (51 asserzioni): pulsante e posizione, report nascosto a schermo ma popolato, periodo e data di generazione, totali separati (320 / 200 / 80), parziali mai nell'effettivo, dichiarazione acconti, righe tabella con suffissi, riga di raccordo (520 = 320 + 200), incassi per cliente solo `Pagato`, lezioni rimanenti, schermo invariato (520), resa `media=print` (report visibile, viste e status bar nascoste), `window.print` chiamato una volta, cambio mese (mese vuoto → nessun movimento, 0,00 €), PDF reale A4 generato (`/tmp/opencode/fase7_report.pdf`, 79 KB, verificato a immagine: solo report, una pagina), pacchetto con acconto 50 → parziale contrattuale 500 e **nessun "50,00"** nel report, raccordo aggiornato (820), screenshot desktop/mobile/stampa, zero errori console.

Screenshot/artefatti: `/tmp/opencode/fase7_resoconto_desktop.png`, `fase7_resoconto_mobile.png`, `fase7_print.png`, `fase7_report.pdf`.

Nota di metodo: il PDF va generato con media di stampa; con override `emulate_media("screen")` il browser stampa la vista a schermo. Nel test il media è impostato a `print` prima di `page.pdf()`.

## Problemi aperti e debiti tecnici

1. **Acconto non tracciato** (noto da Fase 6, ora dichiarato nel PDF): `pagamenti` non conserva l'acconto; un pagamento `Parziale` ha solo l'importo contrattuale. Il resoconto a schermo continua a contare l'intero importo nell'incassato (comportamento Fase 6 invariato per vincolo). Una soluzione corretta richiede una modifica al modello dati (es. `importoPagato`) **non autorizzata**.
2. **Overflow orizzontale su mobile (preesistente, non introdotto dalla Fase 7)**: a 360 px `.resoconto-card__value` (es. "520,00 €", 41 px) esce dal viewport (scrollWidth 382). Verificato che rimuovere pulsante e report non cambia la misura. Correzione minima possibile (da approvare): `flex-wrap` sulla card o riduzione del valore su mobile. Non applicata per non modificare l'UI esistente fuori scope.
3. **`window.__appData` non riassegnato dopo l'import** (hook di test): `importData()` fa `data = normalized`, quindi il riferimento esposto resta al vecchio oggetto. Nessun impatto utente; i test verificano l'import su `localStorage` + reload.
4. **Righe non normalizzate finché restano in memoria**: i pagamenti del seed e quelli creati a mano non hanno `pacchettoId` fino al reload (la normalizzazione avviene solo alla lettura). Comportamento esistente, nessun impatto funzionale.
5. **Documentazione**: `AGENTS.md` riporta ancora "Fase 4 — 123 test"; è disallineato rispetto a Fase 5–7. Aggiornamento non richiesto in questa fase.
6. **Suite storiche rimosse**: le suite 123/158/22 non sono più su disco; lo stato Fase 2–6 è oggi coperto dalla suite di regressione ricreata (84 asserzioni), non dagli originali.

## Criteri di completamento — verifica

- [x] Report con incassato effettivo, parziali contrattuali e da ricevere separati.
- [x] Acconti dichiarati non ricostruibili; nessun importo inventato (test sul caso acconto 50).
- [x] Riga di raccordo con il totale a schermo.
- [x] Nessuna modifica a modello dati, seed, export/import, calcoli esistenti.
- [x] Suite Fase 7 e regressione eseguite: 51/51 e 84/84, 0 fallimenti, exit 0.
- [x] PDF A4 reale verificato a immagine; screenshot desktop/mobile/stampa.
- [x] `PIANO.md` aggiornato con esiti effettivi e problemi aperti.

## Fermo

- **Fase 7 COMPLETATA e verificata** (26/10/2026). **FERMO** — nessuna attività di Fase 8 avviata; attendo approvazione.


---

# Fase 8 — Robustezza storage, backup e import/export (completata e verificata)

## Obiettivo

Rendere l'app resiliente a dati corrotti, quota piena, modifiche concorrenti e import errati, senza perdere dati e senza dipendenze.

## Implementazione effettiva

- **Primo avvio vuoto**: nessun seed automatico; banner con invito ad aggiungere il primo cliente. Il caricamento dei dati di esempio è stato rimosso nella Fase 16.
- **Storage corrotto**: i dati illeggibili non vengono sovrascritti; banner con download del file danneggiato, ripristino snapshot e reset esplicito.
- **Snapshot automatico**: prima di ogni salvataggio che sostituisce dati diversi, lo stato precedente viene conservato in `cinofilo-snapshot-v1`.
- **Multi-scheda**: evento `storage` → banner di avviso e blocco dei salvataggi per evitare sovrascritture.
- **Quota/errori**: `saveData()` restituisce `false`; i chiamanti usano `commit()` e non mostrano falsi successi. In caso di errore i record appena inseriti vengono rimossi dalla memoria.
- **Import**: conteggi di clienti/pagamenti/incassi/appuntamenti/pacchetti, anteprima con avvisi di normalizzazione, snapshot pre-import, rollback in memoria se il salvataggio fallisce; import di soli pacchetti ora accettato.
- **Export**: include `schemaVersion: 2`, `exportedAt`, `incassi`; metadati `firstSeenAt`/`lastExportAt` e pannello backup con promemoria.
- **XSS**: il tipo appuntamento è renderizzato con `textContent`.
- **Mobile**: corretti overflow del resoconto e stile delle textarea.

## Test effettivi

- `test_fase8.py`: **35/35** superati, 0 fallimenti.
- Regressione aggiornata: **85/85** (poi 88/88 con Fase 9).
- Fase 7: **51/51** (poi 52/52 con Fase 9).

Copertura: primo avvio, assenza demo, corruzione JSON, snapshot/ripristino, quota simulata, XSS, import con avvisi, multi-scheda.

# Fase 9 — Registro incassi e stato pagamenti derivato (completata e verificata)

## Decisione approvata (Opzione A)

Nuovo array `incassi: [{ id, pagamentoId, data, importo, nota }]`. Gli stati dei pagamenti sono **derivati** dal totale incassato:
- `Pagato` se incassato ≥ importo contrattuale;
- `Parziale` se 0 < incassato < importo;
- `Da pagare` se incassato = 0;
- `Da verificare` per i pagamenti legacy `Parziale` senza importo ricostruibile.

## Migrazione non distruttiva

- Dataset senza chiave `incassi`: i pagamenti `Pagato` diventano un incasso pieno alla data del pagamento; i `Parziale` vengono marcati `incassoDaVerificare` e **esclusi** da incassi e crediti finché l'utente non registra l'importo realmente ricevuto; i `Da pagare` restano senza incasso.
- Dataset con `incassi`: il registro è la fonte di verità; nessuna doppia migrazione.
- Gli incassi orfani vengono esclusi con avviso; gli incassi superiori al contratto sono segnalati.

## Interfaccia

- Form pagamento: importo contratto, data contratto, incasso iniziale e data incasso.
- Form pacchetto: acconto e data incasso; il pagamento collegato e l'incasso sono creati insieme.
- Righe pagamento: contratto/incassato/saldo, elenco incassi con rimozione, registrazione incasso inline, "Segna saldato" solo quando il saldo è certo, "Nessun incasso" per i legacy da verificare, modifica/elimina.
- Righe pacchetto: dati finanziari del pagamento collegato e collegamento rapido alla registrazione incasso.
- Modifica/eliminazione di clienti, pagamenti, appuntamenti e pacchetti con undo tramite banner per le operazioni distruttive.
- Resoconto e report PDF: incassi effettivi per data, crediti residui al fine periodo, pagamenti da verificare, incassi per cliente, pacchetti; nessun importo legacy inventato.

## Test effettivi

- `test_fase9.py`: **34/34** superati, 0 fallimenti.
- Regressione: **88/88** superati.
- Fase 7: **52/52** superati.
- Fase 8: **35/35** superati.

Copertura: migrazione legacy, verifica incasso, acconto/saldo, pacchetto con acconto, incassi per data, crediti al fine periodo, esclusione legacy, rimozione incasso, export/import del registro.

## Problemi aperti / note

- Gli incassi senza data valida sono esclusi dai totali mensili ma contano nel saldo del pagamento; l'UI li segnala.
- Il registro non ha ancora filtri/ricerca dedicati (Fase 12) né export CSV (Fase 14).
- Lo storico mensile dei consumi pacchetti resta non disponibile (limite noto dalla Fase 5).

## Fermo

- **Fase 9 completata e verificata**. Prossimo passo approvato: **Fase 10 — rifinitura CRUD, validazioni e gestione incassi**.


---

# Fase 10 — Rifinitura CRUD, undo, validazioni e incassi (completata e verificata)

## Implementazione effettiva

- **Modifica con undo**: cliente, pagamento, appuntamento e pacchetto salvano uno stato precedente e offrono il banner "Annulla"; in caso di salvataggio fallito lo stato in memoria viene ripristinato.
- **Reset form corretto**: il campo hidden `id` viene azzerato all'apertura di un nuovo form (prima poteva restare l'id dell'ultima modifica).
- **Pagamenti collegati**: la modifica del pagamento sincronizza importo e cliente del pacchetto; la modifica del pacchetto sincronizza il pagamento collegato (importo, cliente, data, descrizione, stato).
- **Pagamento mancante**: se un pacchetto legacy non ha un pagamento collegato, la modifica lo ricrea come "Da pagare".
- **Validazioni**: importo/acconto non negativi, importo pagamento non inferiore agli incassi, prezzo pacchetto non inferiore agli incassi, lezioni non inferiori a quelle consumate, duplicati cliente/pagamento/pacchetto, conflitti appuntamento (anche in modifica, escludendo il record stesso).
- **Incassi inline**: importo positivo, data valida, limite al saldo, stato derivato aggiornato, rimozione con conferma e undo.
- **Messaggi**: l'eliminazione definitiva è riservata ai clienti senza dati collegati; con collegamenti il messaggio invita ad archiviare per conservare lo storico.
- **Eliminazioni**: restano disponibili undo per cliente, pagamento, appuntamento, pacchetto e incasso.

## Test effettivi

- `test_fase10.py`: **61/61** superati, 0 fallimenti.
- Regressione: **90/90**.
- Fase 7: **52/52**.
- Fase 8: **35/35** (aggiornato il controllo del modello a 5 array).
- Fase 9: **34/34**.

Copertura: modifica/reset form, duplicati, undo su modifiche, sincronizzazione pacchetto-pagamento, pagamento mancante ricreato, limiti lezioni/prezzo/incassi, conflitti appuntamenti, eliminazioni con undo, incassi inline e undo.

## Problemi aperti / note

- L'eliminazione cliente è consentita solo senza dati collegati; con collegamenti si usa l'archiviazione (Fase 11).
- Il registro incassi non ha ancora ricerca/filtri dedicati (Fase 12) né export CSV (Fase 14).
- Lo storico mensile dei consumi pacchetti resta non disponibile.

## Fermo

- **Fase 10 completata e verificata**. Fase successiva: **Fase 11 — scheda cliente con storico e gestione orfani**.

---

# Fase 11 — Scheda cliente, archiviazione e dati orfani (completata e verificata)

## Implementazione effettiva

- **Scheda cliente**: dalla lista si apre un pannello con dati del cane, telefono, stato, totali contrattuali/incassati/crediti, appuntamenti, lezioni rimaste e storico di pagamenti, appuntamenti e pacchetti.
- **Archiviazione**: i clienti con dati collegati non mostrano "Elimina"; si usa "Archivia". I clienti archiviati restano consultabili, ordinati in fondo, con badge e azione "Riattiva". Lo stato è modificabile anche dal form cliente.
- **Eliminazione sicura**: "Elimina" resta disponibile solo per clienti senza pagamenti, appuntamenti o pacchetti; il backend applica comunque il controllo.
- **Dati orfani**: pannello dedicato nella vista Clienti per record con `clienteId = 0`. Ogni riga mostra tipo e dettagli, consente di assegnare a un cliente o eliminare con conferma e undo.
- **Sincronizzazione orfani**: assegnare un pagamento assegna anche il pacchetto collegato; assegnare un pacchetto assegna anche il pagamento collegato.
- **Focus e accessibilità di base**: la scheda è una regione etichettata, riceve il focus all'apertura e lo restituisce alla chiusura.

## Test effettivi

- `test_fase11.py`: **46/46** superati, 0 fallimenti.
- Regressione: **90/90**.
- Fase 10: **61/61**.

Copertura: riepiloghi e storico, cliente senza storico, archiviazione/riattivazione e undo, stato dal form, pannello orfani, assegnazione con sincronizzazione, eliminazione con undo, eliminazione pacchetto orfano.

## Problemi aperti / note

- Lo storico mensile dei consumi pacchetti resta non disponibile.
- Gli orfani possono essere assegnati anche a clienti archiviati (l'etichetta lo segnala).

## Fermo

- **Fase 11 completata e verificata**. Fase successiva: **Fase 12 — ricerca, filtri e agenda**.

---

# Fase 12 — Ricerca, filtri e agenda (completata e verificata)

## Implementazione effettiva

- **Clienti**: ricerca per nome, cane, telefono, razza, età e note; filtro per stato (Attivo/Pausa/Archiviato).
- **Pagamenti**: ricerca per cliente, descrizione, importo, data e stato; filtro per stato (Pagato/Parziale/Da pagare/Da verificare).
- **Appuntamenti**: ricerca per cliente, tipo, data e ora; filtri "Da fare/Fatti" e "Oggi/Prossimi 7 giorni/Passati"; agenda raggruppata per giorno con intestazioni leggibili.
- **Pacchetti**: ricerca per cliente, cane, prezzo, lezioni e data; filtro "Con lezioni disponibili/Esauriti".
- **Messaggi**: "Nessun ... corrisponde ai filtri" distinto da "Nessun ... registrato".
- **Persistenza dei filtri**: i controlli restano compilati dopo refresh dei dati e cambi di vista.

## Test effettivi

- `test_fase12.py`: **33/33** superati, 0 fallimenti.
- Regressione: **90/90**.

Copertura: ricerche per tutti i campi principali, filtri di stato, combinazioni ricerca+stato, agenda raggruppata, periodo oggi/7 giorni/passati, filtri pacchetti, messaggi nessun risultato, filtro mantenuto dopo un'azione che rigenera la lista.

## Problemi aperti / note

- La ricerca non usa operatori (AND/OR) né intervalli di importo: è una ricerca testuale semplice.
- Lo storico mensile dei consumi pacchetti resta non disponibile.

## Fermo

- **Fase 12 completata e verificata**. Fase successiva: **Fase 13 — accessibilità, focus, contrasto e responsive**.

---

# Fase 13 — Accessibilità, focus, contrasto e responsive (completata e verificata)

## Implementazione effettiva

- **Titoli e struttura**: titolo del documento aggiornato per ogni vista; heading coerenti; lingua `it`.
- **Focus**: apertura form sul primo campo, ritorno al pulsante di apertura alla chiusura, focus sulla scheda cliente e ritorno al pulsante "Scheda"; gestione del form incasso inline.
- **Tastiera**: `Escape` chiude form, scheda cliente, form incasso e banner nell'ordine corretto.
- **ARIA**: `aria-expanded`/`aria-controls` sui pulsanti dei form, pannelli form come gruppi etichettati, scheda cliente come regione etichettata, banner `role=alert`, stato `role=status`.
- **Contrasto**: verificati i colori di testo, accento e stato "Pausa" su base/superficie con rapporto AA (≥ 4,5:1); arancione scurito.
- **Responsive**: filtri a piena larghezza su mobile, righe scheda/orfani adattive, nessun overflow orizzontale a 375 px; pulsanti con altezza minima ≥ 44 px.

## Test effettivi

- `test_fase13.py`: **49/49** superati, 0 fallimenti.
- Regressione: **90/90**.

Copertura: titoli per vista, heading, focus form/scheda/incasso, Escape, aria-expanded, etichette dei controlli, contrasto AA, overflow mobile, dimensioni pulsanti.

## Problemi aperti / note

- I dialoghi nativi `confirm()`/`prompt()` restano quelli del browser: accessibili, ma non personalizzabili graficamente.
- Non è stata aggiunta una modalità scura.

## Fermo

- **Fase 13 completata e verificata**. Fase successiva: **Fase 14 — export CSV e report per periodo/cliente**.

---

# Fase 14 — Export CSV e report per periodo/cliente (completata e verificata)

## Implementazione effettiva

- **Filtro cliente nel resoconto**: selettore "Tutti i clienti" / singolo cliente; il filtro aggiorna incassato, crediti, appuntamenti, clienti attivi, incidenza per cliente, lezioni rimaste, report stampabile e trend.
- **CSV incassi**: data, cliente, descrizione pagamento, nota, importo; filtro per mese e cliente; BOM UTF-8, separatore `;`, importi con virgola decimale.
- **CSV pagamenti**: contratti del mese, cliente, descrizione, importo, incassato al fine periodo, saldo, stato; filtro per mese e cliente.
- **Sicurezza CSV**: escaping di virgolette, separatori e newline; neutralizzazione delle formule (`=`, `+`, `-`, `@`) con prefisso apostrofo.
- **Nomi file**: `incassi_MM-AAAA.csv` / `pagamenti_MM-AAAA.csv`, con suffisso cliente quando filtrato.
- **Esito**: messaggio con numero di righe esportate; CSV vuoto valido con sola intestazione.

## Test effettivi

- `test_fase14.py`: **49/49** superati, 0 fallimenti.
- Regressione: **90/90**.
- Fase 7: **52/52**.
- Fase 11: **46/46**.
- Fase 12: **33/33**.
- Fase 13: **49/49**.

Copertura: filtro cliente su schermo e report, totali filtrati, CSV incassi/pagamenti completi e filtrati, nomi file, mese vuoto, escaping, protezione formule, assenza errori console.

## Problemi aperti / note

- Il periodo resta mensile; non è stato aggiunto un intervallo di date personalizzato.
- Il CSV pagamenti include i contratti con data nel mese selezionato; i crediti di contratti più vecchi restano visibili nel resoconto/report, non nel CSV pagamenti del mese.
- Lo storico mensile dei consumi pacchetti resta non disponibile.

## Fermo

- **Fase 14 completata e verificata**. Prossimo passo approvato: **Fase 15 — pulizia, documentazione, test finali e rapporto d'uso**.

---

# Fase 16 — Archivio, eliminazione a cascata e restyling (completata e verificata)

## Richiesta approvata

- Rimuovere completamente il pulsante e la funzione "Carica dati di esempio".
- Aggiungere una sezione **Archivio** dedicata ai clienti archiviati.
- Eliminare cliente o pacchetto rimuovendo anche tutti i dati collegati, con avvisi su pagamenti mancanti, saldi aperti e incassi coinvolti.
- Rendere l'interfaccia più gradevole e semplice da usare, senza cambiare il modello dati.

## Decisioni

- Nuova vista `archivio` (hash `#archivio`), sesta voce della home. I clienti con stato `Archiviato` non compaiono più nella lista Clienti.
- L'archivio ha ricerca, scheda cliente dedicata, modifica, riattivazione ed eliminazione.
- L'eliminazione di un cliente rimuove: cliente, pacchetti del cliente, pagamenti del cliente o collegati ai suoi pacchetti, incassi dei pagamenti rimossi, appuntamenti del cliente.
- L'eliminazione di un pacchetto rimuove: pacchetto, tutti i pagamenti con `pacchettoId` uguale e i relativi incassi.
- Prima di eliminare viene mostrato un riepilogo con conteggi e avvisi; l'operazione resta annullabile dal banner.
- Nessuna migrazione distruttiva e nessun nuovo campo nel modello dati.

## Brief di design (8 righe)

1. Direzione: studio caldo e ordinato, carta avorio, inchiostro scuro e verde bosco.
2. Tipografia: serif editoriale per i titoli, sans di sistema per il testo; scala 1.25.
3. Palette: avorio, superficie panna, verde segnale, terracotta per gli avvisi.
4. Layout: home-dashboard a schede, larghezza massima 58rem, spaziatura generosa.
5. Componenti: bordi sottili, angoli da 14px, ombre leggere, badge a pillola.
6. Movimento: 140ms in uscita, sollevamento discreto, rispetto di `prefers-reduced-motion`.
7. Gerarchia: occhiello, titolo serif, testo secondario attenuato, azione primaria verde.
8. Accessibilità: contrasto AA, focus visibile, nessun overflow a 375px, report di stampa invariato.

## Token block

```css
:root {
  --font-display: Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif;
  --font-text: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --step--1: 0.875rem; --step-0: 1.0625rem; --step-1: 1.25rem;
  --step-2: 1.5625rem; --step-3: 1.953rem; --step-4: 2.441rem; --step-5: 3.052rem;
  --space-3xs: 0.25rem; --space-2xs: 0.5rem; --space-xs: 0.75rem;
  --space-s: 1rem; --space-m: 1.5rem; --space-l: 2rem;
  --space-xl: 3rem; --space-2xl: 4.5rem;
  --base: #f5f1e8; --surface: #fffdf9; --ink: #1c1a16;
  --ink-2: #4d473d; --ink-3: #655e52; --line: #d8d0c1;
  --accent: #1e5a3a; --accent-strong: #16452c; --accent-soft: #e6eee6;
  --alert: #9b2c22; --warn: #8a4b1f; --warn-soft: #f6ead9;
  --radius: 0.875rem; --radius-sm: 0.5rem;
  --shadow-1: 0 1px 2px rgb(28 26 22 / 0.06), 0 8px 24px rgb(28 26 22 / 0.06);
  --shadow-2: 0 2px 4px rgb(28 26 22 / 0.08), 0 14px 34px rgb(28 26 22 / 0.10);
  --dur-fast: 140ms; --ease: cubic-bezier(0.2, 0, 0, 1);
}
```

## Passi

1. Rimuovere demo da HTML, JS, documentazione e test.
2. Creare vista Archivio, rendering, ricerca, scheda e conteggio in home.
3. Introdurre i piani di eliminazione a cascata con riepilogo e avvisi.
4. Applicare il restyling con i token sopra, verificando contrasto e mobile.
5. Aggiornare le suite esistenti e aggiungere la suite Fase 16.
6. Eseguire tutte le suite e aggiornare lo stato finale.

## Implementazione effettiva

- **Demo rimossa**: eliminati `#btn-demo-data`, `loadDemoData`, `seedData`, handler e riferimenti. Il primo avvio mostra un banner con "Vai ai clienti" e "Chiudi"; nessun dato viene scritto automaticamente.
- **Archivio**: nuova vista `#view-archivio` con ricerca, contatore in home, elenco solo archiviati, scheda dedicata `#archivio-dettaglio`, modifica, riattivazione ed eliminazione. I clienti archiviati non compaiono più in Clienti e il filtro "Archiviato" è stato rimosso da quella lista.
- **Piani di eliminazione**: `clienteDeletionPlan` e `pacchettoDeletionPlan` calcolano in anticipo record e incassi coinvolti, saldo aperto, pagamenti da verificare, pacchetti senza pagamento e pagamenti assegnati ad altri clienti. La conferma usa `confirmDeletionMessage` con conteggi e importi.
- **Cascata**: l'eliminazione cliente rimuove cliente, pacchetti, pagamenti diretti o collegati ai pacchetti, incassi e appuntamenti; l'eliminazione pacchetto rimuove il pacchetto, tutti i pagamenti con lo stesso `pacchettoId` e i relativi incassi. Anche l'eliminazione dall'elenco orfani usa gli stessi piani.
- **Restyling**: applicati i token del brief (serif editoriale, carta avorio, verde bosco, bordi sottili, radius 14px, ombre leggere), home a 6 schede con numerazione e conteggio archivio, header, card, form, filtri, badge a pillola, dettaglio, resoconto a griglia, banner e status bar.
- **Dati**: modello invariato `{ clienti, pagamenti, appuntamenti, pacchetti, incassi }`; export/import e snapshot restano compatibili.

## Test effettivi

- Suite completa: **506 test superati, 0 fallimenti**.
- Regressione **93/93**, Fase 7 **52/52**, Fase 8 **37/37**, Fase 9 **34/34**, Fase 10 **61/61**, Fase 11 **46/46**, Fase 12 **33/33**, Fase 13 **51/51**, Fase 14 **49/49**, Fase 16 **50/50**.
- `test_fase16.py` copre assenza demo, Archivio, ricerca, scheda, riattivazione, eliminazione cliente/pacchetto a cascata, avvisi, annullamento e undo.
- Verifica visiva desktop 1200px e mobile 375px: nessun overflow orizzontale, nessun errore console/pageerror.

## Problemi aperti / note

- Nessun problema noto aperto. Restano i limiti già documentati: dati locali al browser e backup JSON come copia di sicurezza.

## Prossimo passo

- Fase 16 chiusa. Non avviare nuove fasi senza richiesta e approvazione.

---

# Fase 15 — Pulizia, documentazione e verifica finale (completata e verificata)

## Implementazione effettiva

- **Documentazione utente**: aggiunto `README.md` con avvio, funzioni, backup, test, limiti e struttura dei file.
- **Istruzioni di progetto**: aggiornato `AGENTS.md` con stato reale, modello dati a 5 array, percorsi corretti delle suite, comandi di test e convenzioni correnti.
- **Pulizia**: rimosso il residuo della cartella test creata per errore (`add-cinofilo-tests`); resta la cartella corretta `add_cinofilo-tests`. Controllati gli id HTML (nessun duplicato) e l'assenza di errori console nelle suite.
- **Focus finale**: alla chiusura di un form dopo un salvataggio, se il pulsante di origine è stato ricreato dal refresh, il focus torna al pulsante "+ Nuovo" corrispondente.

## Test effettivi

- Suite completa: **449 test superati, 0 fallimenti**.
- Regressione **90/90**, Fase 7 **52/52**, Fase 8 **35/35**, Fase 9 **34/34**, Fase 10 **61/61**, Fase 11 **46/46**, Fase 12 **33/33**, Fase 13 **49/49**, Fase 14 **49/49**.

## Problemi aperti / note

- I dati restano locali al browser/dispositivo; il backup JSON è l'unica copia di sicurezza.
- Il periodo di resoconto/CSV è mensile.
- Lo storico mensile dei consumi pacchetti non è disponibile.
- I dialoghi di conferma sono nativi del browser.

## Fermo

- **Tutte le fasi approvate 8–15 sono completate e verificate**. Non sono state avviate funzionalità oltre la roadmap approvata.

