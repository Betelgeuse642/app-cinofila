# Addestramento Cinofilo

Web app locale per gestire clienti, cani, pagamenti, appuntamenti, pacchetti di lezioni e resoconti di un istruttore cinofilo. Funziona con HTML, CSS e JavaScript vanilla, senza server, account o cloud.

## Avvio

1. Apri `index.html` con un browser moderno (Chrome, Edge, Firefox, Safari).
2. Al primo avvio l'app è vuota: inizia inserendo i tuoi clienti da **Clienti**.
3. I dati restano nel browser su quel dispositivo, nella chiave `localStorage` `cinofilo-data-v1`.

## Funzioni principali

- **Clienti**: anagrafica con dati del cane, stato (Attivo/Pausa), scheda con storico di pagamenti, appuntamenti e pacchetti.
- **Archivio**: clienti archiviati con ricerca, scheda completa, modifica, riattivazione ed eliminazione.
- **Pagamenti**: contratti, incassi anche parziali, stati derivati `Pagato`, `Parziale`, `Da pagare`, `Da verificare`; modifica, eliminazione con annullamento.
- **Appuntamenti**: agenda raggruppata per giorno, stato fatto/da fare, filtri per periodo.
- **Pacchetti**: lezioni totali/consumate/rimanenti, pagamento collegato, consumazione esplicita delle lezioni; eliminazione con i pagamenti e gli incassi collegati.
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
python3 test_regressione.py
python3 test_fase7.py
python3 test_fase8.py
python3 test_fase9.py
python3 test_fase10.py
python3 test_fase11.py
python3 test_fase12.py
python3 test_fase13.py
python3 test_fase14.py
python3 test_fase16.py
```

Ultima verifica: **506 test superati, 0 fallimenti** (26/10/2026).

## Limiti noti

- I dati sono locali: cancellare i dati del browser o cambiare dispositivo/browser li perde. Usa il backup JSON.
- Il Resoconto e i CSV usano un periodo mensile; non è disponibile un intervallo di date personalizzato.
- Il CSV pagamenti include i contratti del mese selezionato; i crediti di contratti precedenti restano nel resoconto/report.
- Lo storico mensile dei consumi dei pacchetti non è disponibile.
- I dialoghi di conferma sono quelli nativi del browser.

## File

- `index.html`: struttura dell'app e viste.
- `styles.css`: layout, responsive e stile di stampa.
- `app.js`: modello dati, persistenza, rendering, filtri, report e CSV.
- `PIANO.md`: stato delle fasi, decisioni e test eseguiti.
