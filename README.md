# Addestramento Cinofilo

Web app locale per gestire clienti, cani, pagamenti, appuntamenti, pacchetti di lezioni e resoconti di un istruttore cinofilo. Funziona con HTML, CSS e JavaScript vanilla, senza server, account o cloud.

## Uso online

L'app è pubblicata su GitHub Pages:

<https://betelgeuse642.github.io/app-cinofila/>

Il sito è pubblico e non ha autenticazione. I dati restano nel browser dell'utente e non vengono inviati a un server.

## Avvio in locale

1. Apri `index.html` con un browser moderno (Chrome, Edge, Firefox, Safari).
2. Al primo avvio l'app è vuota: inizia inserendo i tuoi clienti da **Scheda cliente**.
3. Ogni scheda cliente contiene le sezioni Pagamenti, Appuntamenti e Pacchetti; i dati restano nel browser su quel dispositivo, nella chiave `localStorage` `cinofilo-data-v1`.

`file://` e l'URL GitHub Pages sono origini diverse: hanno archivi `localStorage` separati. Per trasferire i dati usa **Esporta JSON** e **Importa JSON**.

## Funzioni principali

- **Scheda cliente**: anagrafica con dati del cane e stato (Attivo/Pausa); due sole sezioni oltre l’anagrafica: **Pacchetto lezioni** e **Lezione singola**. Ogni elemento è una riga compatta con lezioni utilizzate/rimaste, stato pagamento e data, più i tasti **Modifica/Elimina** e **Pagamento**.
- **Archivio**: clienti archiviati con ricerca, scheda completa in sola consultazione, riattivazione ed eliminazione.
- **Pagamenti** (dentro ogni pacchetto/lezione): totale, acconti multipli registrati liberamente (Acconto 1, Acconto 2, Saldo) senza scadenze pianificate, saldo e stato derivato `Pagato`, `Parziale`, `Da pagare`, `Da verificare`.
- **Calendario** (dentro ogni pacchetto/lezione): date scelte singolarmente, ora e istruttore per lezione; aggiunta, modifica, eliminazione e stato fatto/da fare. L’istruttore può essere diverso per ogni lezione. Nei pacchetti le date sono in un elenco compatto con piccoli tasti Modifica/Elimina.
- **Appuntamenti** (vista home): agenda globale di tutte le lezioni, raggruppata per giorno, con ricerca e filtri per periodo, stato e categoria; modifica di data, ora, istruttore e stato.
- **Pacchetti e lezioni**: inserimento guidato con tipo, lezioni, prezzo, acconti e saldo; data automatica; date individuali con istruttore per lezione; pagamento collegato; lezioni totali/consumate/rimanenti; eliminazione con pagamenti, incassi e appuntamenti non svolti collegati.
- **Resoconto**: incassato effettivo del mese, crediti residui, incidenza per cliente, trend rispetto al mese precedente; filtro per cliente.
- **Report stampabile/PDF**: dal Resoconto, con separazione tra incassi effettivi e importi contrattuali.
- **CSV**: esportazione di incassi e pagamenti del mese, anche filtrati per cliente.
- **Backup**: esportazione/importazione JSON, snapshot automatico e ripristino in caso di dati illeggibili.

## Dati e backup

- La copia di sicurezza principale è **Esporta JSON**.
- L'app conserva uno snapshot automatico in `cinofilo-snapshot-v1`; se i dati diventano illeggibili compare un banner con download, ripristino o reset.
- L'importazione JSON chiede conferma e sostituisce l'intero dataset solo dopo validazione; non cancella dati senza conferma.
- L'eliminazione di un cliente rimuove anche pacchetti, pagamenti, incassi e appuntamenti collegati. La conferma mostra conteggi e avvisi su saldi aperti, pagamenti mancanti o incassi da verificare; l'operazione resta annullabile dal banner.
- Per conservare lo storico senza eliminarlo, usa **Archivia**: il cliente passa nell'omonima sezione e può essere riattivato in seguito.

## Test

Le suite Playwright sono fuori dal repository, in `/home/betelgeuse/OPENCODE_JOB/add_cinofilo-tests/`.

```bash
cd /home/betelgeuse/OPENCODE_JOB/add_cinofilo-tests
PYTHONDONTWRITEBYTECODE=1 python3 test_regressione.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase7.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase8.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase9.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase10.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase11.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase12.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase13.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase14.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase16.py
PYTHONDONTWRITEBYTECODE=1 python3 test_fase30.py
```

Ultima verifica: **533 test superati, 0 fallimenti** (02/11/2026).

## Repository e pubblicazione

- Repository pubblico: <https://github.com/Betelgeuse642/app-cinofila.git>.
- Pubblicazione: GitHub Pages, sorgente branch `main` cartella `/`, HTTPS attivo.
- `main` è il branch pubblicato: ogni push o merge su `main` aggiorna il sito.
- Non esiste una CI di test: le suite vanno eseguite manualmente prima della pubblicazione.
- Il sito è pubblico e senza autenticazione: non inserire dati personali, backup o esportazioni JSON/CSV nel repository.
- `.gitignore` esclude cache Python, file temporanei, log ed export dell'app; `.nojekyll` disabilita l'elaborazione Jekyll di Pages.
- Pages può mantenere una cache di circa 10 minuti: dopo un deploy può servire un hard refresh.
- `localStorage` è separato per origine: `file://` e URL Pages sono archivi distinti.

### Flusso per gli aggiornamenti

1. Allineati a `main` e verifica che il working tree sia pulito:

```bash
cd /home/betelgeuse/OPENCODE_JOB/add_cinofilo
git fetch origin --prune
git switch main
git pull --ff-only
git status --short --branch
```

2. Crea un branch dedicato:

```bash
git switch -c feat/nome-fase
```

3. Implementa la modifica e aggiorna `PIANO.md` con attività e test eseguiti.

4. Esegui tutte le suite dalla cartella dei test. Ogni suite deve terminare con `0 failed`.

5. Controlla il diff e prepara il commit con file espliciti, senza `git add -A`:

```bash
cd /home/betelgeuse/OPENCODE_JOB/add_cinofilo
git diff --check
git status --short
git diff --stat
git add index.html styles.css app.js AGENTS.md PIANO.md README.md .gitignore .nojekyll
git commit -m "Fase X: descrizione breve"
```

6. Pubblica il branch e apri una pull request:

```bash
git push -u origin feat/nome-fase
gh pr create --fill
```

In alternativa usa l'interfaccia web di GitHub.

7. Esegui il merge su `main` solo dopo approvazione esplicita. Il merge fa partire la pubblicazione Pages:

```bash
gh pr merge --squash --delete-branch
```

### Verifica dopo la pubblicazione

1. Controlla che la build Pages sia completata con stato `built`:

```bash
gh run list --repo Betelgeuse642/app-cinofila --limit 3
gh api repos/Betelgeuse642/app-cinofila/pages/builds --jq '.[0] | {status, created_at}'
```

2. Apri l'URL pubblico in una finestra privata o forza il refresh e verifica:
   - l'app si apre senza errori in console;
   - il primo avvio è vuoto;
   - creazione cliente, ricarica e persistenza;
   - esportazione e importazione JSON;
   - layout desktop e mobile.

3. Verifica che il commit pubblicato corrisponda al commit mergiato su `main`.

### Rollback

Per annullare un aggiornamento difettoso usa un nuovo commit di revert, mai un force push:

```bash
git switch main
git pull --ff-only
git revert <sha-del-commit>
git push origin main
```

Se il problema riguarda il modello dati, ripristina anche il backup JSON esportato prima del test.

### Versione stabile

Il tag annotato `v1.0.0` è già stato creato sul commit `68cdc1e` e pubblicato. Per una nuova versione stabile, crea un tag annotato con il nuovo numero di versione solo dopo approvazione:

```bash
git tag -a v1.1.0 <sha-del-commit> -m "Versione stabile v1.1.0"
git push origin v1.1.0
```

## Limiti noti

- I dati sono locali: cancellare i dati del browser o cambiare dispositivo/browser li perde. Usa il backup JSON.
- Il Resoconto e i CSV usano un periodo mensile; non è disponibile un intervallo di date personalizzato.
- Il CSV pagamenti include i contratti del mese selezionato; i crediti di contratti precedenti restano nel resoconto/report.
- Lo storico mensile dei consumi dei pacchetti non è disponibile.
- La modifica di un pacchetto o di una lezione singola non rigenera il calendario: le date già create restano invariate e si modificano dal calendario.
- L'inserimento di una lezione si blocca se data e ora sono già occupate; non c'è uno spostamento automatico.
- Il consumo delle lezioni è automatico alla scadenza: una lezione non modificata o eliminata prima della data incrementa le utilizzate. Non c’è più il tasto manuale “Consuma lezione”.
- Il tipo di pacchetto è facoltativo: se vuoto viene mostrato come “Pacchetto”.
- La data di vendita è automatica (oggi) e non viene chiesta nel form; l’istruttore si inserisce solo nelle singole date delle lezioni.
- Gli acconti iniziali hanno solo l’importo: data odierna e nota “Acconto N” sono automatiche.
- Alla prima apertura, i vecchi appuntamenti e pagamenti senza pacchetto vengono convertiti in lezioni singole; anche i collegamenti a pacchetti inesistenti vengono scollegati. I dati orfani restano nel pannello dedicato.
- Non esistono rate pianificate con scadenza, registro istruttori o sincronizzazione con calendari esterni.
- I dialoghi di conferma sono quelli nativi del browser.
- L'Archivio è in sola consultazione: per aggiungere pagamenti, pacchetti o lezioni a un cliente archiviato occorre prima riattivarlo.
- I form della scheda lavorano sul cliente aperto: per spostare un record su un altro cliente occorre eliminarlo e ricrearlo.

## File

- `index.html`: struttura dell'app e viste.
- `styles.css`: layout, responsive e stile di stampa.
- `app.js`: modello dati, persistenza, rendering, filtri, report e CSV.
- `PIANO.md`: stato delle fasi, decisioni e test eseguiti.
- `.gitignore`: esclusione di cache Python, file temporanei, log ed export.
- `.nojekyll`: disabilita l'elaborazione Jekyll di GitHub Pages.
