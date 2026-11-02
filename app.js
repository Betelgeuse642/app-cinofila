/* ===== Persistenza dati (localStorage) ===== */
const STORAGE_KEY = "cinofilo-data-v1";
const SNAPSHOT_KEY = "cinofilo-snapshot-v1";
const META_KEY = "cinofilo-meta-v1";

/* Stato del caricamento/salvataggio: serve a non sovrascrivere dati non letti
   e a bloccare le scritture quando un'altra scheda ha modificato gli stessi dati. */
let storageCorrupt = false;
let corruptRaw = "";
let storageBlocked = false;
let storageBlockReason = "";
let skipSnapshotOnce = false;
let normalizeWarnings = [];

function emptyData() {
  return { clienti: [], pagamenti: [], appuntamenti: [], pacchetti: [], incassi: [] };
}

function isDataEmpty(d) {
  return !d.clienti.length && !d.pagamenti.length && !d.appuntamenti.length
    && !d.pacchetti.length && !(d.incassi || []).length;
}

function validId(v) {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === "string" ? s : "");
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

function isTime(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function str(v, max) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return max && s.length > max ? s.slice(0, max) : s;
}

function warn(msg) {
  normalizeWarnings.push(msg);
}

function dedupeById(rows, label) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.id)) {
      warn(label + ": id duplicato " + r.id + " ignorato");
      continue;
    }
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* Sanitizza una riga generica: id e campi attesi, rimuove i campi estranei. */
function safeRow(row, expectedFields) {
  const out = { id: row.id };
  for (const f of expectedFields) {
    if (f in row) out[f] = row[f];
  }
  return out;
}

/* Converte un record in forma normalizzata; restituisce null se non valido. */
function normalizeClienti(c) {
  if (!c || !validId(c.id)) { warn("clienti: riga senza id valido ignorata"); return null; }
  const stato = c.stato === "Pausa" || c.stato === "Archiviato" ? c.stato : "Attivo";
  return {
    id: c.id,
    nome: str(c.nome, 120),
    telefono: str(c.telefono, 40),
    cane: str(c.cane, 120),
    razza: str(c.razza, 80),
    eta: str(c.eta, 20),
    note: str(c.note, 2000),
    stato,
  };
}

function normalizePagamento(p) {
  if (!p || !validId(p.id)) { warn("pagamenti: riga senza id valido ignorata"); return null; }
  let importo = p.importo;
  if (typeof importo === "string" && importo.trim() !== "") importo = Number(importo);
  if (typeof importo !== "number" || !isFinite(importo) || importo < 0) {
    warn("pagamenti: importo non valido per id " + p.id + ", impostato a 0");
    importo = 0;
  }
  // pacchettoId: associazione opzionale a un pacchetto (0 = nessun collegamento).
  const pacchettoId = typeof p.pacchettoId === "number" && Number.isInteger(p.pacchettoId) && p.pacchettoId > 0 ? p.pacchettoId : 0;
  const stato = p.stato === "Pagato" ? "Pagato" : (p.stato === "Parziale" ? "Parziale" : "Da pagare");
  let data = typeof p.data === "string" ? p.data : "";
  if (!isIsoDate(data)) {
    warn("pagamenti: data non valida per id " + p.id + ", escluso dai resoconti");
    data = "";
  }
  return {
    id: p.id,
    clienteId: typeof p.clienteId === "number" ? p.clienteId : 0,
    importo: Math.round(importo * 100) / 100,
    data,
    stato,
    descrizione: str(p.descrizione, 300),
    pacchettoId,
    incassoDaVerificare: p.incassoDaVerificare === true,
  };
}

function normalizeAppuntamento(a) {
  if (!a || !validId(a.id)) { warn("appuntamenti: riga senza id valido ignorata"); return null; }
  let data = typeof a.data === "string" ? a.data : "";
  if (!isIsoDate(data)) {
    warn("appuntamenti: data non valida per id " + a.id + ", escluso dai resoconti");
    data = "";
  }
  let ora = typeof a.ora === "string" ? a.ora : "";
  if (!isTime(ora)) {
    warn("appuntamenti: ora non valida per id " + a.id);
    ora = "00:00";
  }
  return {
    id: a.id,
    clienteId: typeof a.clienteId === "number" ? a.clienteId : 0,
    data,
    ora,
    tipo: str(a.tipo, 60) || "Addestramento",
    istruttore: str(a.istruttore, 60),
    pacchettoId: typeof a.pacchettoId === "number" && Number.isInteger(a.pacchettoId) && a.pacchettoId > 0 ? a.pacchettoId : 0,
    fatto: a.fatto === true,
  };
}

function normalizePacchetto(p) {
  if (!p || !validId(p.id)) { warn("pacchetti: riga senza id valido ignorata"); return null; }
  const categoria = p.categoria === "singola" ? "singola" : "pacchetto";
  let lezioni = Number.isInteger(p.lezioni) && p.lezioni >= 0 ? p.lezioni : 0;
  if (categoria === "singola") lezioni = 1;
  if (lezioni === 0) warn("pacchetti: numero lezioni non valido per id " + p.id);
  const utilizzate = Number.isInteger(p.utilizzate) && p.utilizzate >= 0 ? Math.min(p.utilizzate, lezioni) : 0;
  let prezzo = p.prezzo;
  if (typeof prezzo === "string" && prezzo.trim() !== "") prezzo = Number(prezzo);
  if (typeof prezzo !== "number" || !isFinite(prezzo) || prezzo < 0) {
    warn("pacchetti: prezzo non valido per id " + p.id + ", impostato a 0");
    prezzo = 0;
  }
  let data = typeof p.data === "string" ? p.data : "";
  if (!isIsoDate(data)) {
    warn("pacchetti: data non valida per id " + p.id);
    data = "";
  }
  return {
    id: p.id,
    clienteId: typeof p.clienteId === "number" ? p.clienteId : 0,
    categoria,
    tipo: str(p.tipo, 60),
    istruttore: str(p.istruttore, 60),
    lezioni,
    utilizzate,
    prezzo,
    data,
  };
}

/* Lezioni rimanenti e stato sono derivati, non salvati: evita duplicazioni di stato. */
function lezioniRimanenti(pk) {
  return Math.max(pk.lezioni - pk.utilizzate, 0);
}

function pacchettoEsaurito(pk) {
  return pk.utilizzate >= pk.lezioni;
}

function normalizeIncasso(i) {
  if (!i || !validId(i.id)) { warn("incassi: riga senza id valido ignorata"); return null; }
  if (!validId(i.pagamentoId)) { warn("incassi: pagamento non valido per id " + i.id + ", ignorato"); return null; }
  let importo = i.importo;
  if (typeof importo === "string" && importo.trim() !== "") importo = Number(importo);
  if (typeof importo !== "number" || !isFinite(importo) || importo <= 0) {
    warn("incassi: importo non valido per id " + i.id + ", ignorato");
    return null;
  }
  let data = typeof i.data === "string" ? i.data : "";
  if (!isIsoDate(data)) {
    warn("incassi: data non valida per id " + i.id + ", escluso dai resoconti mensili");
    data = "";
  }
  return {
    id: i.id,
    pagamentoId: i.pagamentoId,
    data,
    importo: Math.round(importo * 100) / 100,
    nota: str(i.nota, 200),
  };
}

function normalizeData(raw) {
  normalizeWarnings = [];
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const clienti = dedupeById(
    (Array.isArray(src.clienti) ? src.clienti : []).map(normalizeClienti).filter(Boolean),
    "clienti"
  );
  const pagamenti = dedupeById(
    (Array.isArray(src.pagamenti) ? src.pagamenti : []).map(normalizePagamento).filter(Boolean),
    "pagamenti"
  );
  const appuntamenti = dedupeById(
    (Array.isArray(src.appuntamenti) ? src.appuntamenti : []).map(normalizeAppuntamento).filter(Boolean),
    "appuntamenti"
  );
  // Chiave `pacchetti` assente in vecchi dataset → [] (compatibilità in avanti).
  const pacchetti = dedupeById(
    (Array.isArray(src.pacchetti) ? src.pacchetti : []).map(normalizePacchetto).filter(Boolean),
    "pacchetti"
  );
  const clientesIds = new Set(clienti.map(c => c.id));
  const pacchettiIds = new Set(pacchetti.map(pk => pk.id));
  // Orfani: mantenuti con clienteId 0 (vengono resi visibili come "sconosciuto").
  let orfani = 0;
  for (const p of pagamenti) if (!clientesIds.has(p.clienteId)) { p.clienteId = 0; orfani++; }
  for (const a of appuntamenti) if (!clientesIds.has(a.clienteId)) { a.clienteId = 0; orfani++; }
  for (const pk of pacchetti) if (!clientesIds.has(pk.clienteId)) { pk.clienteId = 0; orfani++; }
  if (orfani) warn(orfani + " collegamenti a clienti inesistenti sono stati mostrati come \"Sconosciuto\"");
  // Pagamenti con pacchettoId orfano: azzerati (nessun pacchetto a quello id).
  let pkOrfani = 0;
  for (const p of pagamenti) if (p.pacchettoId && !pacchettiIds.has(p.pacchettoId)) { p.pacchettoId = 0; pkOrfani++; }
  if (pkOrfani) warn(pkOrfani + " pagamenti collegati a pacchetti inesistenti sono stati scollegati");

  // Migrazione alla scheda a due sezioni: appuntamenti e pagamenti senza
  // pacchetto diventano lezioni singole, senza inventare importi o date.
  let migrateSingole = 0;
  for (const a of appuntamenti) {
    if (a.clienteId && !a.pacchettoId) {
      const pk = {
        id: nextId(pacchetti), clienteId: a.clienteId, categoria: "singola",
        tipo: a.tipo, istruttore: a.istruttore, lezioni: 1,
        utilizzate: a.fatto ? 1 : 0, prezzo: 0, data: a.data,
      };
      pacchetti.push(pk);
      a.pacchettoId = pk.id;
      migrateSingole++;
    }
  }
  for (const p of pagamenti) {
    if (p.clienteId && !p.pacchettoId) {
      const pk = {
        id: nextId(pacchetti), clienteId: p.clienteId, categoria: "singola",
        tipo: (p.descrizione || "Lezione singola").slice(0, 60), istruttore: "",
        lezioni: 1, utilizzate: 0, prezzo: p.importo, data: p.data,
      };
      pacchetti.push(pk);
      p.pacchettoId = pk.id;
      migrateSingole++;
    }
  }
  if (migrateSingole) {
    warn(migrateSingole + " dati senza pacchetto sono stati convertiti in lezioni singole");
  }
  pacchettiIds.clear();
  for (const pk of pacchetti) pacchettiIds.add(pk.id);

  // Registro incassi. Se la chiave è assente, il dataset è precedente alla Fase 9:
  // i pagamenti "Pagato" non hanno un importo/acconto registrato, quindi viene
  // creato un incasso pieno alla data del pagamento (migrazione trasparente).
  // I "Parziali" legacy non consentono di ricostruire l'acconto: vengono marcati
  // "Da verificare" senza inventare importi.
  const hasIncassiKey = Array.isArray(src.incassi);
  let incassi = dedupeById(
    (hasIncassiKey ? src.incassi : []).map(normalizeIncasso).filter(Boolean),
    "incassi"
  );
  const pagamentiIds = new Set(pagamenti.map(p => p.id));
  const incassiOrfani = incassi.filter(i => !pagamentiIds.has(i.pagamentoId));
  if (incassiOrfani.length) {
    warn(incassiOrfani.length + " incassi collegati a pagamenti inesistenti sono stati esclusi");
    incassi = incassi.filter(i => pagamentiIds.has(i.pagamentoId));
  }
  if (!hasIncassiKey) {
    let migrati = 0;
    let nonMigrabili = 0;
    for (const p of pagamenti) {
      if (p.stato === "Pagato") {
        if (p.importo > 0) {
          if (!isIsoDate(p.data)) warn("pagamenti: incasso migrato senza data valida per id " + p.id);
          incassi.push({
            id: nextId(incassi),
            pagamentoId: p.id,
            data: p.data,
            importo: p.importo,
            nota: "Importo registrato prima dell'aggiornamento",
          });
          migrati++;
        } else {
          nonMigrabili++;
        }
      } else if (p.stato === "Parziale") {
        p.incassoDaVerificare = true;
      }
    }
    if (migrati) warn(migrati + " pagamenti \"Pagato\" sono stati convertiti in incassi alla loro data");
    if (nonMigrabili) warn(nonMigrabili + " pagamenti \"Pagato\" con importo 0 non hanno un incasso");
  }
  for (const p of pagamenti) {
    const tot = totaleIncassi(p.id, incassi);
    if (tot > 0) p.incassoDaVerificare = false;
    if (tot > p.importo + 0.005) {
      warn("pagamenti: incassi superiori all'importo contrattuale per id " + p.id);
    }
    p.stato = statoPagamento(p, incassi);
  }
  return { clienti, pagamenti, appuntamenti, pacchetti, incassi };
}

function getNormalizeWarnings() {
  return normalizeWarnings.slice();
}

function loadData() {
  let rawText = null;
  try {
    rawText = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    storageBlocked = true;
    storageBlockReason = "unavailable";
    return emptyData();
  }
  if (rawText === null || rawText.trim() === "") return emptyData();
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch (e) {
    storageCorrupt = true;
    corruptRaw = rawText;
    return emptyData();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    storageCorrupt = true;
    corruptRaw = rawText;
    return emptyData();
  }
  try {
    return normalizeData(raw);
  } catch (e) {
    storageCorrupt = true;
    corruptRaw = rawText;
    return emptyData();
  }
}

function saveData() {
  if (storageBlocked) {
    setStatus("Salvataggio bloccato: ricarica la pagina per continuare.", true);
    return false;
  }
  const payload = JSON.stringify(data);
  let previous = null;
  try {
    previous = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    setStatus("Errore di lettura dello spazio di archiviazione.", true);
    return false;
  }
  if (previous && previous !== payload && !skipSnapshotOnce) {
    writeSnapshot(previous, "pre-salvataggio");
  }
  skipSnapshotOnce = false;
  try {
    localStorage.setItem(STORAGE_KEY, payload);
    return true;
  } catch (e) {
    setStatus("Errore di salvataggio: spazio di archiviazione non disponibile. Le modifiche non sono state salvate.", true);
    return false;
  }
}

function writeSnapshot(raw, reason) {
  if (!raw) return;
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      at: new Date().toISOString(),
      reason,
      raw,
    }));
  } catch (e) {
    // Lo snapshot è una sicurezza in più: se non c'è spazio non blocca il salvataggio principale.
  }
}

function getSnapshot() {
  try {
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    if (!snap || typeof snap.raw !== "string" || !snap.raw) return null;
    JSON.parse(snap.raw); // valida il contenuto
    return snap;
  } catch (e) {
    return null;
  }
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showBanner(message, actions) {
  const bar = document.getElementById("app-banner");
  if (!bar) return;
  bar.innerHTML = "";
  const text = document.createElement("span");
  text.className = "app-banner__text";
  text.textContent = message;
  bar.appendChild(text);
  if (actions && actions.length) {
    const box = document.createElement("div");
    box.className = "app-banner__actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-action";
      btn.textContent = action.label;
      btn.addEventListener("click", action.onClick, { once: true });
      box.appendChild(btn);
    }
    bar.appendChild(box);
  }
  bar.hidden = false;
}

function hideBanner() {
  const bar = document.getElementById("app-banner");
  if (!bar) return;
  bar.hidden = true;
  bar.innerHTML = "";
}

function handleCorruptStorage() {
  if (!storageCorrupt) return;
  storageBlocked = true;
  storageBlockReason = "corrupt";
  const actions = [];
  if (corruptRaw) {
    actions.push({
      label: "Scarica dati danneggiati",
      onClick: () => downloadText("cinofilo-dati-danneggiati.json", corruptRaw, "application/json"),
    });
  }
  if (getSnapshot()) {
    actions.push({ label: "Ripristina snapshot", onClick: restoreSnapshot });
  }
  actions.push({ label: "Ricomincia da zero", onClick: resetStorage });
  showBanner("I dati locali non sono leggibili. Non verranno sovrascritti finché non scegli un'azione.", actions);
}

function restoreSnapshot() {
  if (storageBlockReason === "multitab") {
    setStatus("Ricarica la pagina prima di ripristinare: i dati sono cambiati in un'altra scheda.", true);
    return;
  }
  const snap = getSnapshot();
  if (!snap) {
    setStatus("Nessuno snapshot valido disponibile.", true);
    return;
  }
  if (!confirm("Ripristinare lo snapshot del " + new Date(snap.at).toLocaleString("it-IT") + "? I dati attuali non leggibili verranno sostituiti.")) return;
  let parsed;
  try {
    parsed = JSON.parse(snap.raw);
  } catch (e) {
    setStatus("Lo snapshot non è valido.", true);
    return;
  }
  data = normalizeData(parsed);
  window.__appData = data;
  storageCorrupt = false;
  corruptRaw = "";
  storageBlocked = false;
  storageBlockReason = "";
  skipSnapshotOnce = true; // non sovrascrivere lo snapshot appena usato con dati corrotti
  if (!saveData()) return;
  refresh();
  hideBanner();
  setStatus("Snapshot ripristinato.");
}

function resetStorage() {
  if (storageBlockReason === "multitab") {
    setStatus("Ricarica la pagina prima di azzerare: i dati sono cambiati in un'altra scheda.", true);
    return;
  }
  if (!confirm("Ricomincia da zero? I dati locali non leggibili verranno rimossi. Scarica prima una copia se ti serve.")) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    setStatus("Impossibile rimuovere i dati locali.", true);
    return;
  }
  data = emptyData();
  window.__appData = data;
  storageCorrupt = false;
  corruptRaw = "";
  storageBlocked = false;
  storageBlockReason = "";
  skipSnapshotOnce = true;
  if (!saveData()) return;
  refresh();
  hideBanner();
  setStatus("Dati locali azzerati.");
}

function initBanner() {
  if (storageCorrupt) {
    handleCorruptStorage();
    return;
  }
  if (storageBlocked) {
    storageBlockReason = storageBlockReason || "unavailable";
    showBanner("Lo spazio di archiviazione locale non è accessibile. Le modifiche non verranno salvate.", [
      { label: "Ricarica", onClick: () => location.reload() },
    ]);
    return;
  }
  let hasStoredData = false;
  try {
    hasStoredData = localStorage.getItem(STORAGE_KEY) !== null;
  } catch (e) { /* già gestito sopra */ }
  if (!hasStoredData && isDataEmpty(data)) {
    showBanner("Nessun dato registrato. Aggiungi il primo cliente dalla sezione Scheda cliente.", [
      { label: "Vai ai clienti", onClick: () => { hideBanner(); goTo("clienti"); } },
      { label: "Chiudi", onClick: hideBanner },
    ]);
  }
  if (normalizeWarnings.length) {
    showBanner("Alcuni dati non validi sono stati corretti o esclusi. Controlla i resoconti.", [
      { label: "Dettagli", onClick: () => setStatus(normalizeWarnings.join(" · "), true) },
      { label: "Chiudi", onClick: hideBanner },
    ]);
    return;
  }
  maybeBackupReminder();
}

function maybeBackupReminder() {
  if (isDataEmpty(data)) return;
  const meta = readMeta();
  if (!meta.firstSeenAt) {
    writeMeta({ firstSeenAt: new Date().toISOString() });
    return;
  }
  const now = Date.now();
  const first = new Date(meta.firstSeenAt).getTime();
  const last = meta.lastExportAt ? new Date(meta.lastExportAt).getTime() : 0;
  const due = last ? (now - last > 30 * 24 * 60 * 60 * 1000) : (now - first > 7 * 24 * 60 * 60 * 1000);
  if (!due) return;
  const bar = document.getElementById("app-banner");
  if (bar && !bar.hidden) return;
  showBanner("È passato un po' di tempo dall'ultimo backup. Scarica una copia dei dati.", [
    { label: "Scarica backup", onClick: exportData },
    { label: "Più tardi", onClick: hideBanner },
  ]);
}

window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY) return;
  storageBlocked = true;
  storageBlockReason = "multitab";
  showBanner("I dati sono stati modificati in un'altra scheda. Ricarica per evitare sovrascritture.", [
    { label: "Ricarica", onClick: () => location.reload() },
  ]);
  setStatus("Dati modificati in un'altra scheda: ricarica la pagina.", true);
});

let data = loadData();
// Esposto per test: consente ai test Playwright di re-idratre i dati da
// localStorage (data.__testSet = <oggetto>) e re-renderizzare senza ricarica.
window.__appData = data;

/* ===== Helper ===== */
function clienteById(id) {
  return data.clienti.find(c => c.id === id);
}

function clienteNome(id) {
  const c = clienteById(id);
  return c ? c.nome : "Sconosciuto";
}

function nextId(rows) {
  return rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
}

function incassiDi(pagamentoId, list) {
  return (list || data.incassi || []).filter(i => i.pagamentoId === pagamentoId);
}

function totaleIncassi(pagamentoId, list) {
  return incassiDi(pagamentoId, list).reduce((s, i) => s + i.importo, 0);
}

function saldoPagamento(p) {
  return Math.max(0, Math.round((p.importo - totaleIncassi(p.id)) * 100) / 100);
}

function statoPagamento(p, list) {
  const inc = totaleIncassi(p.id, list);
  if (p.incassoDaVerificare && inc === 0) return "Da verificare";
  if (inc > 0 && inc >= p.importo - 0.005) return "Pagato";
  if (inc > 0) return "Parziale";
  return "Da pagare";
}

function ricalcolaStatiPagamenti() {
  for (const p of data.pagamenti) {
    if (totaleIncassi(p.id) > 0) p.incassoDaVerificare = false;
    p.stato = statoPagamento(p);
  }
}

function addIncasso(pagamentoId, importo, data_, nota) {
  const p = data.pagamenti.find(x => x.id === pagamentoId);
  if (!p) return null;
  const amount = Math.round(Number(importo) * 100) / 100;
  if (!(amount > 0) || !isFinite(amount)) return null;
  if (!isIsoDate(data_)) return null;
  const row = {
    id: nextId(data.incassi),
    pagamentoId,
    data: data_,
    importo: amount,
    nota: str(nota, 200),
  };
  data.incassi.push(row);
  p.incassoDaVerificare = false;
  p.stato = statoPagamento(p);
  return row;
}

function removeIncasso(id) {
  const row = data.incassi.find(i => i.id === id);
  if (!row) return false;
  data.incassi = data.incassi.filter(i => i.id !== id);
  ricalcolaStatiPagamenti();
  return true;
}

function setStatus(msg, isError) {
  const bar = document.getElementById("status-bar");
  bar.textContent = msg;
  bar.hidden = !msg;
  bar.classList.toggle("status-error", !!isError);
  if (bar._timer) clearTimeout(bar._timer);
  if (msg) bar._timer = setTimeout(() => { bar.hidden = true; }, 6000);
}

/* Salva e ridisegna; restituisce false se il salvataggio è fallito.
   I chiamanti non devono mostrare un messaggio di successo in caso di errore. */
function commit(msg) {
  if (!saveData()) return false;
  refresh();
  if (msg) setStatus(msg);
  return true;
}

let undoState = null;

function rememberUndo(label) {
  undoState = { label, raw: JSON.stringify(data) };
}

function restoreUndoState() {
  if (!undoState) return;
  data = normalizeData(JSON.parse(undoState.raw));
  window.__appData = data;
  refresh();
}

function offerUndo() {
  if (!undoState) return;
  showBanner("Operazione eseguita. Puoi annullarla.", [
    { label: "Annulla", onClick: undoLast },
    { label: "Chiudi", onClick: hideBanner },
  ]);
}

function undoLast() {
  if (!undoState) return;
  restoreUndoState();
  undoState = null;
  hideBanner();
  if (!commit("Operazione annullata.")) return;
}

/* ===== Navigazione ===== */
const views = document.querySelectorAll(".view");
const VIEW_TITLES = {
  home: "Addestramento Cinofilo",
  clienti: "Scheda cliente · Addestramento Cinofilo",
  appuntamenti: "Appuntamenti · Addestramento Cinofilo",
  archivio: "Archivio · Addestramento Cinofilo",
  resoconto: "Resoconto · Addestramento Cinofilo",
};
function showView(id) {
  const target = "view-" + id;
  for (const v of views) {
    v.classList.toggle("is-hidden", v.id !== target);
  }
  document.title = VIEW_TITLES[id] || VIEW_TITLES.home;
  window.scrollTo(0, 0);
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-nav]");
  if (!link) return;
  e.preventDefault();
  goTo(link.dataset.nav);
});

const FILTER_RENDERERS = {
  // I filtri aggiornano solo la lista: non ridisegnano la scheda aperta,
  // così i form in compilazione non perdono i valori.
  "filtro-clienti": () => renderClienti(true),
  "filtro-clienti-stato": () => renderClienti(true),
  "filtro-archivio": () => renderArchivio(true),
  "filtro-appuntamenti": renderAppuntamenti,
  "filtro-appuntamenti-stato": renderAppuntamenti,
  "filtro-appuntamenti-periodo": renderAppuntamenti,
  "filtro-appuntamenti-categoria": renderAppuntamenti,
};
function onFilterChange(e) {
  const fn = FILTER_RENDERERS[e.target.id];
  if (fn) fn();
  const panel = e.target.closest("#form-cliente-pacchetto");
  if (panel) {
    if (e.target.name === "lezioni") syncScheduleRows(panel);
    else refreshPacchettoForm(panel);
  }
}
document.addEventListener("input", onFilterChange);
document.addEventListener("change", onFilterChange);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const active = document.activeElement;
  const receipts = [...document.querySelectorAll(".receipt-form:not([hidden])")]
    .filter(f => f.getClientRects().length);
  const openForms = [...document.querySelectorAll(".form-panel")]
    .filter(p => !p.hidden && p.getClientRects().length);
  const focusedReceipt = receipts.find(f => f.contains(active));
  const focusedForm = openForms.find(p => p.contains(active));
  // Chiude prima il form che contiene il focus; altrimenti il primo visibile.
  const receipt = focusedReceipt || (!focusedForm && receipts[0]);
  if (receipt) {
    const holder = receipt.closest("[data-id]");
    receipt.hidden = true;
    receipt.reset();
    const trigger = holder ? holder.querySelector("[data-action='registra-incasso']") : null;
    if (trigger) trigger.focus();
    return;
  }
  const openForm = focusedForm
    || openForms.find(p => p.id === lastOpenedFormId)
    || openForms[0];
  if (openForm) { toggleForm(openForm.id, false); return; }
  const detail = document.querySelector(".detail-panel:not([hidden])");
  if (detail) {
    closeDetailPanel(detail.id);
    return;
  }
  const banner = document.getElementById("app-banner");
  if (banner && !banner.hidden) hideBanner();
});

window.addEventListener("popstate", (e) => {
  // In file:// popstate scatta solo su back/forward reali; la vista si risolve dall'hash corrente.
  goTo(hashView());
});

/* Fallback per modifiche dirette dell'hash (digita nel box URL); anche qui si passa da goTo. */
window.addEventListener("hashchange", () => {
  goTo(hashView());
});

function hashView() {
  return (location.hash || "#home").slice(1);
}

/* Viste ammissibili; tutte le transizioni attraversano goTo().
   Le vecchie viste autonome convivono solo come alias della scheda cliente. */
const KNOWN_VIEWS = ["home", "clienti", "appuntamenti", "archivio", "resoconto"];
const LEGACY_VIEWS = { pagamenti: "clienti", pacchetti: "clienti" };

function goTo(view) {
  // Le vecchie sezioni ora vivono dentro la scheda cliente.
  const requested = view;
  const isLegacy = !!LEGACY_VIEWS[requested];
  const isUnknown = !isLegacy && !KNOWN_VIEWS.includes(requested);
  if (isLegacy) view = LEGACY_VIEWS[requested];
  // Convalida il nome della vista: se sconosciuta, torna alla vista iniziale.
  if (!KNOWN_VIEWS.includes(view)) view = "home";
  showView(view);
  const target = "#" + view;
  if (location.hash === target) {
    // URL già corretto: allinea solo lo stato, senza nuove entrature di back/forward.
    if (!history.state || history.state.view !== view) history.replaceState({ view }, "", target);
  } else if (isLegacy || isUnknown) {
    // Alias o hash non valido: sostituisce la voce di cronologia invece di aggiungerla,
    // così il tasto Indietro non resta bloccato sul vecchio hash.
    history.replaceState({ view }, "", target);
  } else {
    history.pushState({ view }, "", target);
  }
}

/* ===== Formattazione ===== */
function money(n) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function isoToDateLabel(iso) {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function addDaysIso(iso, days) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function filterValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function matchesText(query, ...fields) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  return fields.some(f => String(f == null ? "" : f).toLowerCase().includes(q));
}

/* ===== Render clienti e archivio ===== */
let selectedClienteId = 0;
let detailTriggerId = 0;
let selectedArchivioId = 0;
let archivioTriggerId = 0;

function clientLinks(id) {
  return {
    pagamenti: data.pagamenti.filter(p => p.clienteId === id),
    appuntamenti: data.appuntamenti.filter(a => a.clienteId === id),
    pacchetti: data.pacchetti.filter(pk => pk.clienteId === id),
  };
}

function countLabel(n, singular, plural) {
  return n + " " + (n === 1 ? singular : plural);
}

/* Piano di eliminazione del cliente: include anche i dati collegati in modo
   indiretto, così non restano pagamenti o incassi orfani. */
function clienteDeletionPlan(id) {
  const c = clienteById(id);
  if (!c) return null;
  const pacchetti = data.pacchetti.filter(pk => pk.clienteId === id);
  const pacchettoIds = new Set(pacchetti.map(pk => pk.id));
  const pagamenti = data.pagamenti.filter(p =>
    p.clienteId === id || (p.pacchettoId && pacchettoIds.has(p.pacchettoId)));
  const pagamentoIds = new Set(pagamenti.map(p => p.id));
  const incassi = data.incassi.filter(i => pagamentoIds.has(i.pagamentoId));
  const appuntamenti = data.appuntamenti.filter(a => a.clienteId === id);
  const warnings = [];

  const senzaPagamento = pacchetti.filter(pk => !data.pagamenti.some(p => p.pacchettoId === pk.id));
  if (senzaPagamento.length) {
    warnings.push(countLabel(senzaPagamento.length, "pacchetto non ha", "pacchetti non hanno") + " un pagamento collegato.");
  }
  const altroCliente = pagamenti.filter(p => p.clienteId !== id);
  if (altroCliente.length) {
    warnings.push(countLabel(altroCliente.length, "pagamento collegato risulta", "pagamenti collegati risultano")
      + " assegnato a un altro cliente: verrà eliminato comunque.");
  }
  const pacchettiAltrui = pagamenti.filter(p =>
    p.clienteId === id && p.pacchettoId && !pacchettoIds.has(p.pacchettoId));
  if (pacchettiAltrui.length) {
    warnings.push(countLabel(pacchettiAltrui.length, "pacchetto di un altro cliente", "pacchetti di altri clienti")
      + " perderà il pagamento collegato.");
  }
  const daVerificare = pagamenti.filter(p => p.incassoDaVerificare);
  if (daVerificare.length) {
    warnings.push(countLabel(daVerificare.length, "pagamento ha", "pagamenti hanno") + " un incasso legacy da verificare.");
  }
  const saldo = pagamenti.filter(p => !p.incassoDaVerificare)
    .reduce((s, p) => s + saldoPagamento(p), 0);
  if (saldo > 0.005) {
    warnings.push("Restano " + money(saldo) + " da incassare: anche il credito verrà eliminato.");
  }
  const incassato = incassi.reduce((s, i) => s + i.importo, 0);
  return { cliente: c, pacchetti, pagamenti, incassi, appuntamenti, warnings, saldo, incassato };
}

/* Piano di eliminazione del pacchetto: rimuove tutti i pagamenti collegati
   (anche eventuali duplicati incoerenti) e i relativi incassi. */
function pacchettoDeletionPlan(id) {
  const pk = data.pacchetti.find(x => x.id === id);
  if (!pk) return null;
  const pagamenti = data.pagamenti.filter(p => p.pacchettoId === id);
  const pagamentoIds = new Set(pagamenti.map(p => p.id));
  const incassi = data.incassi.filter(i => pagamentoIds.has(i.pagamentoId));
  const appuntamenti = data.appuntamenti.filter(a => a.pacchettoId === id);
  const appuntamentiDaEliminare = appuntamenti.filter(a => !a.fatto);
  const appuntamentiSvolti = appuntamenti.filter(a => a.fatto);
  const warnings = [];
  if (!pagamenti.length) {
    warnings.push("Nessun pagamento collegato a questo pacchetto.");
  }
  if (pagamenti.length > 1) {
    warnings.push("Sono presenti " + pagamenti.length + " pagamenti collegati allo stesso pacchetto: verranno eliminati tutti.");
  }
  if (appuntamentiSvolti.length) {
    warnings.push(countLabel(appuntamentiSvolti.length, "appuntamento svolto resterà", "appuntamenti svolti resteranno")
      + " nello storico senza collegamento al pacchetto.");
  }
  const saldo = pagamenti.reduce((s, p) => s + (p.incassoDaVerificare ? 0 : saldoPagamento(p)), 0);
  if (saldo > 0.005) {
    warnings.push("Restano " + money(saldo) + " da incassare su questo pacchetto.");
  }
  const daVerificare = pagamenti.filter(p => p.incassoDaVerificare);
  if (daVerificare.length) {
    warnings.push(countLabel(daVerificare.length, "pagamento ha", "pagamenti hanno") + " un incasso legacy da verificare.");
  }
  const incassato = incassi.reduce((s, i) => s + i.importo, 0);
  return {
    pacchetto: pk, pagamenti, incassi, appuntamenti,
    appuntamentiDaEliminare, appuntamentiSvolti,
    warnings, saldo, incassato,
  };
}

function deletionLines(items) {
  const lines = [];
  for (const item of items) {
    if (item.n > 0) lines.push("- " + countLabel(item.n, item.singular, item.plural) + (item.extra ? " (" + item.extra + ")" : ""));
  }
  return lines;
}

function confirmDeletionMessage(title, items, warnings, noLinksText) {
  let msg = title;
  const lines = deletionLines(items);
  if (lines.length) {
    msg += "\n\nVerranno eliminati:\n" + lines.join("\n");
  } else if (noLinksText) {
    msg += "\n\n" + noLinksText;
  }
  if (warnings.length) msg += "\n\nAttenzione:\n- " + warnings.join("\n- ");
  msg += "\n\nL'operazione può essere annullata subito dopo.";
  return msg;
}

function deleteClienteCascade(plan) {
  const id = plan.cliente.id;
  const pacchettoIds = new Set(plan.pacchetti.map(pk => pk.id));
  const pagamentoIds = new Set(plan.pagamenti.map(p => p.id));
  data.clienti = data.clienti.filter(c => c.id !== id);
  data.pacchetti = data.pacchetti.filter(pk => !pacchettoIds.has(pk.id));
  data.pagamenti = data.pagamenti.filter(p => !pagamentoIds.has(p.id));
  data.incassi = data.incassi.filter(i => !pagamentoIds.has(i.pagamentoId));
  data.appuntamenti = data.appuntamenti.filter(a => a.clienteId !== id);
  if (selectedClienteId === id) selectedClienteId = 0;
  if (selectedArchivioId === id) selectedArchivioId = 0;
}

function deletePacchettoCascade(plan) {
  const id = plan.pacchetto.id;
  const pagamentoIds = new Set(plan.pagamenti.map(p => p.id));
  const appuntamentoIds = new Set(plan.appuntamentiDaEliminare.map(a => a.id));
  data.pacchetti = data.pacchetti.filter(pk => pk.id !== id);
  data.pagamenti = data.pagamenti.filter(p => !pagamentoIds.has(p.id));
  data.incassi = data.incassi.filter(i => !pagamentoIds.has(i.pagamentoId));
  data.appuntamenti = data.appuntamenti.filter(a => !appuntamentoIds.has(a.id));
  for (const a of data.appuntamenti) {
    if (a.pacchettoId === id) a.pacchettoId = 0;
  }
}

function detailRow(box, title, note) {
  const row = document.createElement("div");
  row.className = "detail-row";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = note;
  row.append(strong, span);
  box.appendChild(row);
}

/* ===== Scheda cliente gestibile (Fasi 18-23) =====
   Pagamenti, appuntamenti e pacchetti vivono dentro la scheda del cliente.
   I form hanno il cliente già impostato e non lo richiedono più. */
const CARD_FORMS = {
  pagamento: "form-cliente-pagamento",
  appuntamento: "form-cliente-appuntamento",
  pacchetto: "form-cliente-pacchetto",
};

function pacchettoLabel(tipo) {
  const t = (tipo || "").trim();
  return !t || t.toLowerCase() === "pacchetto" ? "Pacchetto" : "Pacchetto " + t;
}

function pacchettoDescrizione(tipo, lezioni) {
  const t = (tipo || "").trim();
  return (!t || t.toLowerCase() === "pacchetto" ? "Pacchetto " : "Pacchetto " + t + " · ") + lezioni + " lezioni";
}

function cardSectionHead(titleId, title, buttonId, buttonLabel, panelId) {
  return `
    <div class="card-section__head">
      <h4 id="${titleId}">${title}</h4>
      <button type="button" class="btn-action" id="${buttonId}" aria-controls="${panelId}" aria-expanded="false">${buttonLabel}</button>
    </div>`;
}

function pagamentoFormHtml(clienteId) {
  return `
    <div id="${CARD_FORMS.pagamento}" class="form-panel" hidden>
      <h5 data-form-title>Nuovo pagamento</h5>
      <form data-form="pagamento" data-new-btn="cliente-btn-nuovo-pagamento">
        <input type="hidden" name="id" />
        <input type="hidden" name="clienteId" value="${clienteId}" />
        <label>
          <span>Importo contratto (€)</span>
          <input type="number" name="importo" min="0.01" step="0.01" required />
        </label>
        <label>
          <span>Data contratto</span>
          <input type="date" name="data" required />
        </label>
        <label>
          <span>Descrizione</span>
          <input type="text" name="descrizione" autocomplete="off" />
        </label>
        <div data-receipt-fields>
          <label>
            <span>Incasso iniziale (€, opzionale)</span>
            <input type="number" name="acconto" min="0" step="0.01" value="0" />
          </label>
          <label>
            <span>Data incasso iniziale</span>
            <input type="date" name="dataIncasso" />
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-action btn-primary">Salva</button>
          <button type="button" class="btn-action" data-cancel="${CARD_FORMS.pagamento}">Annulla</button>
        </div>
      </form>
    </div>`;
}

function appuntamentoFormHtml(clienteId) {
  return `
    <div id="${CARD_FORMS.appuntamento}" class="form-panel" hidden>
      <h5 data-form-title>Nuova lezione</h5>
      <form data-form="appuntamento" data-new-btn="cliente-btn-nuovo-pacchetto">
        <input type="hidden" name="id" />
        <input type="hidden" name="clienteId" value="${clienteId}" />
        <input type="hidden" name="pacchettoId" value="0" />
        <label>
          <span>Data</span>
          <input type="date" name="data" required />
        </label>
        <label>
          <span>Ora</span>
          <input type="time" name="ora" required />
        </label>
        <label>
          <span>Tipo di lezione</span>
          <select name="tipo" required>
            <option value="Addestramento">Addestramento</option>
            <option value="Esame">Esame</option>
            <option value="Valutazione">Valutazione</option>
            <option value="Ritiro">Ritiro</option>
          </select>
        </label>
        <label>
          <span>Istruttore</span>
          <input type="text" name="istruttore" list="istruttori-suggeriti" maxlength="60" autocomplete="off" />
        </label>
        <div class="form-actions">
          <button type="submit" class="btn-action btn-primary">Salva</button>
          <button type="button" class="btn-action" data-cancel="${CARD_FORMS.appuntamento}">Annulla</button>
        </div>
      </form>
    </div>`;
}

function pacchettoFormHtml(clienteId) {
  return `
    <div id="${CARD_FORMS.pacchetto}" class="form-panel" hidden>
      <h5 data-form-title>Pacchetto</h5>
      <form data-form="pacchetto" data-new-btn="cliente-btn-nuovo-pacchetto">
        <input type="hidden" name="id" />
        <input type="hidden" name="clienteId" value="${clienteId}" />
        <input type="hidden" name="categoria" value="pacchetto" />
        <fieldset class="form-block">
          <legend data-form-kind-legend>Pacchetto</legend>
          <label>
            <span data-tipo-label>Tipo di pacchetto</span>
            <input type="text" name="tipo" list="tipi-suggeriti" maxlength="60" autocomplete="off"
                   placeholder="Es. Base, Puppy, Recupero" />
          </label>
          <label data-lezioni-field>
            <span>Numero di lezioni</span>
            <input type="number" name="lezioni" min="1" step="1" required />
          </label>
          <label>
            <span>Prezzo totale (€)</span>
            <input type="number" name="prezzo" min="0.01" step="0.01" required />
          </label>
        </fieldset>
        <fieldset class="form-block" data-receipt-fields>
          <legend>Pagamento</legend>
          <div data-initial-receipts></div>
          <button type="button" class="btn-small" data-add-acconto>+ Aggiungi acconto</button>
          <p class="form-hint" data-payment-summary>Il saldo verrà calcolato al salvataggio.</p>
        </fieldset>
        <fieldset class="form-block" data-schedule-fields>
          <legend data-schedule-legend>Date lezioni</legend>
          <p class="form-hint">Compila le date che conosci: le altre si potranno aggiungere dal calendario.</p>
          <div data-schedule-rows></div>
          <p class="form-hint" data-schedule-summary></p>
        </fieldset>
        <div class="form-actions">
          <button type="submit" class="btn-action btn-primary" data-submit-label>Aggiungi pacchetto</button>
          <button type="button" class="btn-action" data-cancel="${CARD_FORMS.pacchetto}">Annulla</button>
        </div>
      </form>
    </div>`;
}

function emptyState(text) {
  const div = document.createElement("div");
  div.className = "list-empty";
  div.textContent = text;
  return div;
}

function fillDatalist(list, values) {
  if (!list) return;
  list.innerHTML = "";
  for (const value of values) {
    const opt = document.createElement("option");
    opt.value = value;
    list.appendChild(opt);
  }
}

function fillCardDatalists(box) {
  const tipi = new Set();
  for (const pk of data.pacchetti) if (pk.tipo) tipi.add(pk.tipo);
  for (const a of data.appuntamenti) if (a.tipo) tipi.add(a.tipo);
  fillDatalist(box.querySelector("#tipi-suggeriti"),
    [...tipi].sort((a, b) => a.localeCompare(b, "it")));
  const istruttori = new Set();
  for (const pk of data.pacchetti) if (pk.istruttore) istruttori.add(pk.istruttore);
  for (const a of data.appuntamenti) if (a.istruttore) istruttori.add(a.istruttore);
  fillDatalist(box.querySelector("#istruttori-suggeriti"),
    [...istruttori].sort((a, b) => a.localeCompare(b, "it")));
  fillDatalist(box.querySelector("#note-incasso-suggerite"),
    ["Acconto 1", "Acconto 2", "Acconto 3", "Saldo"]);
}

function lezioneLabel(pk) {
  if (!pk) return "Lezione";
  if (pk.categoria === "singola") {
    return "Lezione singola" + (pk.tipo ? " · " + pk.tipo : "");
  }
  return pacchettoLabel(pk.tipo);
}

function lezioneDescrizione(pk) {
  if (pk.categoria === "singola") {
    return "Lezione singola" + (pk.tipo ? " · " + pk.tipo : "");
  }
  return pacchettoDescrizione(pk.tipo, pk.lezioni);
}

function syncPacchettoForm(panel) {
  const form = panel ? panel.querySelector("form") : null;
  if (!form) return;
  const idField = form.elements.namedItem("id");
  const categoriaField = form.elements.namedItem("categoria");
  const id = Number(idField ? idField.value : 0);
  const categoria = categoriaField && categoriaField.value === "singola" ? "singola" : "pacchetto";
  const title = panel.querySelector("[data-form-title]");
  const kindLegend = panel.querySelector("[data-form-kind-legend]");
  const scheduleLegend = panel.querySelector("[data-schedule-legend]");
  const tipoLabel = panel.querySelector("[data-tipo-label]");
  const lezioniField = panel.querySelector("[data-lezioni-field]");
  const submit = panel.querySelector("[data-submit-label]");
  const singola = categoria === "singola";
  if (title) {
    title.textContent = id ? (singola ? "Modifica lezione" : "Modifica pacchetto")
      : (singola ? "Lezione singola" : "Pacchetto");
  }
  if (kindLegend) kindLegend.textContent = singola ? "Lezione singola" : "Pacchetto";
  if (scheduleLegend) scheduleLegend.textContent = singola ? "Data lezione" : "Date lezioni";
  if (tipoLabel) tipoLabel.textContent = singola ? "Tipo di lezione" : "Tipo di pacchetto";
  if (lezioniField) lezioniField.hidden = singola;
  const lezioni = form.elements.namedItem("lezioni");
  if (lezioni) {
    if (singola || !lezioni.value) lezioni.value = "1";
  }
  const prezzoField = form.elements.namedItem("prezzo");
  if (prezzoField) prezzoField.min = singola ? "0" : "0.01";
  if (submit) {
    submit.textContent = id ? "Salva modifiche"
      : (singola ? "Aggiungi lezione" : "Aggiungi pacchetto");
  }
  form.dataset.newBtn = categoria === "singola" ? "cliente-btn-nuova-singola" : "cliente-btn-nuovo-pacchetto";
  const receipt = panel.querySelector("[data-receipt-fields]");
  if (receipt) receipt.hidden = id > 0;
  const schedule = panel.querySelector("[data-schedule-fields]");
  if (schedule) schedule.hidden = id > 0;
  if (!id) {
    const receiptsBox = panel.querySelector("[data-initial-receipts]");
    if (receiptsBox && !receiptsBox.children.length) addInitialReceiptRow(panel);
    syncScheduleRows(panel);
  }
  refreshPacchettoForm(panel);
}

function refreshPacchettoForm(panel) {
  const form = panel ? panel.querySelector("form") : null;
  if (!form) return;
  const id = Number(form.elements.namedItem("id").value || 0);
  const summary = panel.querySelector("[data-payment-summary]");
  if (id) {
    const pk = data.pacchetti.find(x => x.id === id);
    const linked = pk ? data.pagamenti.find(p => p.pacchettoId === pk.id) : null;
    if (summary) {
      summary.textContent = linked
        ? "Pratica attuale: incassato " + money(totaleIncassi(linked.id)) + " · saldo " +
          money(saldoPagamento(linked)) + ". Usa Registra incasso per gli aggiornamenti."
        : "Nessun pagamento collegato a questo pacchetto.";
    }
    return;
  }
  const prezzo = Number(form.elements.namedItem("prezzo").value) || 0;
  const receipts = [...panel.querySelectorAll("[data-initial-receipt]")];
  const incassato = receipts.reduce((s, row) => {
    const value = Number(row.querySelector('[data-field="importo"]').value) || 0;
    return s + Math.max(0, value);
  }, 0);
  if (summary) {
    if (prezzo > 0 && incassato > prezzo + 0.005) {
      summary.textContent = "Gli acconti superano il prezzo totale.";
    } else if (prezzo > 0) {
      summary.textContent = "Acconti: " + money(Math.round(incassato * 100) / 100) +
        " · Saldo: " + money(Math.max(0, Math.round((prezzo - incassato) * 100) / 100));
    } else {
      summary.textContent = "Il saldo verrà calcolato al salvataggio.";
    }
  }
  const rows = [...panel.querySelectorAll("[data-schedule-row]")];
  let filled = 0;
  let conflicts = 0;
  for (const row of rows) {
    const date = row.querySelector('[data-field="data"]').value;
    const time = row.querySelector('[data-field="ora"]').value;
    const status = row.querySelector("[data-row-status]");
    row.classList.remove("is-conflict", "is-incomplete", "is-filled");
    if (!date && !time) {
      if (status) status.textContent = "Da programmare";
      continue;
    }
    if (!date || !time) {
      if (status) status.textContent = "Compila data e ora";
      row.classList.add("is-incomplete");
      continue;
    }
    filled++;
    row.classList.add("is-filled");
    const conflict = data.appuntamenti.find(a => a.data === date && a.ora === time);
    if (conflict) {
      conflicts++;
      row.classList.add("is-conflict");
      if (status) status.textContent = "Occupato";
    } else if (status) {
      status.textContent = "Libero";
    }
  }
  const scheduleSummary = panel.querySelector("[data-schedule-summary]");
  if (scheduleSummary) {
    scheduleSummary.textContent = filled + " di " + rows.length + " lezioni programmate" +
      (conflicts ? " · " + conflicts + " conflitti" : "");
    scheduleSummary.classList.toggle("is-error", conflicts > 0);
  }
}

function addInitialReceiptRow(panel, values) {
  const box = panel ? panel.querySelector("[data-initial-receipts]") : null;
  if (!box) return;
  const row = document.createElement("div");
  row.className = "dynamic-row dynamic-row--payment";
  row.dataset.initialReceipt = "";
  row.innerHTML = `
    <label class="dynamic-row__field"><span>Importo (€)</span>
      <input type="number" min="0.01" step="0.01" data-field="importo" />
    </label>
    <button type="button" class="btn-small btn-small--danger" data-remove-acconto>Rimuovi</button>`;
  row.querySelector('[data-field="importo"]').value = values && values.importo ? String(values.importo) : "";
  box.appendChild(row);
  refreshPacchettoForm(panel);
}

function addScheduleRow(panel, values) {
  const box = panel ? panel.querySelector("[data-schedule-rows]") : null;
  if (!box) return;
  const defaultInstructor = "";
  const row = document.createElement("div");
  row.className = "dynamic-row";
  row.dataset.scheduleRow = "";
  row.innerHTML = `
    <label class="dynamic-row__field"><span>Data</span>
      <input type="date" data-field="data" />
    </label>
    <label class="dynamic-row__field"><span>Ora</span>
      <input type="time" data-field="ora" />
    </label>
    <label class="dynamic-row__field"><span>Istruttore</span>
      <input type="text" list="istruttori-suggeriti" data-field="istruttore" />
    </label>
    <span class="dynamic-row__status" data-row-status></span>`;
  row.querySelector('[data-field="data"]').value = (values && values.data) || "";
  row.querySelector('[data-field="ora"]').value = (values && values.ora) || "";
  row.querySelector('[data-field="istruttore"]').value = (values && values.istruttore) || defaultInstructor;
  box.appendChild(row);
}

function syncScheduleRows(panel) {
  const form = panel ? panel.querySelector("form") : null;
  const box = panel ? panel.querySelector("[data-schedule-rows]") : null;
  if (!form || !box) return;
  const input = form.elements.namedItem("lezioni");
  let count = Number(input && input.value);
  if (!Number.isInteger(count) || count < 1) count = 1;
  count = Math.min(count, 60);
  while (box.children.length < count) addScheduleRow(panel);
  while (box.children.length > count) box.lastElementChild.remove();
  refreshPacchettoForm(panel);
}

function readInitialReceipts(panel) {
  return [...(panel ? panel.querySelectorAll("[data-initial-receipt]") : [])].map((row, i) => ({
    importo: Math.round((Number(row.querySelector('[data-field="importo"]').value) || 0) * 100) / 100,
    data: todayStr(),
    nota: "Acconto " + (i + 1),
  })).filter(r => r.importo !== 0);
}

function readScheduleRows(panel) {
  return [...(panel ? panel.querySelectorAll("[data-schedule-row]") : [])].map(row => ({
    data: row.querySelector('[data-field="data"]').value,
    ora: row.querySelector('[data-field="ora"]').value,
    istruttore: row.querySelector('[data-field="istruttore"]').value.trim(),
  })).filter(r => r.data || r.ora);
}

function renderPaymentBlock(block, pk) {
  block.innerHTML = "";
  block.removeAttribute("data-id");
  const linked = data.pagamenti.find(p => p.pacchettoId === pk.id);
  if (!linked) {
    block.innerHTML = `<h5>Pagamenti</h5>
      <div class="list-empty">Nessun pagamento collegato.</div>
      <div class="lezione-block__actions">
        <button type="button" class="btn-small" data-action="modifica-pacchetto">Aggiungi pagamento</button>
      </div>`;
    return;
  }
  if (linked.clienteId !== pk.clienteId) {
    block.innerHTML = `<h5>Pagamenti</h5>
      <div class="list-empty">Pagamento collegato a un altro cliente.</div>`;
    return;
  }
  block.dataset.id = linked.id;
  const badge = statoBadge(linked);
  const inc = totaleIncassi(linked.id);
  const saldo = saldoPagamento(linked);
  const receipts = incassiDi(linked.id).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  block.innerHTML = `
    <h5>Pagamenti</h5>
    <div class="payment-head">
      <span class="badge ${badge.cls}"></span>
      <span class="payment-date" data-date></span>
    </div>
    <div class="payment-line" data-description></div>
    <div class="payment-line" data-money></div>
    <div class="payment-line" data-balance></div>
    <div class="receipt-list" data-receipts></div>
    <div class="lezione-block__actions">
      ${(saldo > 0 || linked.incassoDaVerificare) ? '<button type="button" class="btn-small" data-action="registra-incasso">Registra incasso</button>' : ""}
      ${(saldo > 0 && !linked.incassoDaVerificare) ? '<button type="button" class="btn-small" data-action="salda-pagamento">Segna saldato</button>' : ""}
      ${linked.incassoDaVerificare ? '<button type="button" class="btn-small" data-action="nessun-incasso">Nessun incasso</button>' : ""}
    </div>
    <form class="receipt-form" data-form="incasso" aria-label="Registra incasso" hidden>
      <input type="hidden" name="pagamentoId" value="${linked.id}" />
      <label><span>Importo incassato (€)</span>
        <input type="number" name="importo" min="0.01" step="0.01" max="${linked.incassoDaVerificare ? linked.importo : saldo}" required />
      </label>
      <label><span>Data incasso</span><input type="date" name="data" required /></label>
      <label><span>Nota (opzionale)</span><input type="text" name="nota" list="note-incasso-suggerite" autocomplete="off" /></label>
      <div class="form-actions">
        <button type="submit" class="btn-action btn-primary">Salva incasso</button>
        <button type="button" class="btn-action" data-cancel-receipt>Annulla</button>
      </div>
    </form>`;
  block.querySelector(".badge").textContent = badge.txt;
  block.querySelector("[data-description]").textContent = linked.descrizione || "Pagamento";
  block.querySelector("[data-date]").textContent = "Contratto del " +
    (linked.data ? isoToDateLabel(linked.data) : "data non valida");
  const moneyLine = linked.incassoDaVerificare
    ? "Contratto: " + money(linked.importo) + " · Incassato: da verificare"
    : "Contratto: " + money(linked.importo) + " · Incassato: " + money(inc);
  block.querySelector("[data-money]").textContent = moneyLine;
  block.querySelector("[data-balance]").textContent = "Saldo: " + money(saldo);
  const recBox = block.querySelector("[data-receipts]");
  for (const r of receipts) {
    const row = document.createElement("div");
    row.className = "receipt-row";
    row.innerHTML = `<span class="receipt-row__text"></span>
      <button type="button" class="btn-small btn-small--danger" data-action="elimina-incasso" data-incasso-id="${r.id}">Rimuovi</button>`;
    row.querySelector(".receipt-row__text").textContent =
      (r.data ? isoToDateLabel(r.data) : "Data non valida") + " · " + money(r.importo) +
      (r.nota ? " · " + r.nota : "");
    recBox.appendChild(row);
  }
}

function renderCalendarBlock(block, pk) {
  const apps = data.appuntamenti.filter(a => a.pacchettoId === pk.id)
    .sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora) || a.id - b.id);
  const canAdd = apps.length < pk.lezioni;
  block.innerHTML = `<h5>Calendario</h5>
    <div class="calendar-list" data-calendar-rows></div>
    <div class="lezione-block__actions">
      ${canAdd ? `<button type="button" class="btn-small" data-action="nuova-lezione" data-pacchetto-id="${pk.id}">+ Aggiungi lezione</button>` : ""}
    </div>`;
  const list = block.querySelector("[data-calendar-rows]");
  if (!apps.length) {
    list.appendChild(emptyState("Nessuna lezione programmata."));
    return;
  }
  for (const a of apps) {
    const row = document.createElement("div");
    row.className = "calendar-row";
    row.dataset.id = a.id;
    row.innerHTML = `
      <div class="calendar-row__info">
        <strong class="calendar-row__date"></strong>
        <span class="calendar-row__meta"></span>
      </div>
      <span class="badge ${a.fatto ? "badge--ok" : "badge--neutral"}"></span>
      <div class="calendar-row__actions">
        <button type="button" class="btn-small" data-action="modifica-appuntamento">Modifica</button>
        ${!a.fatto ? '<button type="button" class="btn-small" data-action="segna-fatto">Segna fatto</button>' : ""}
        <button type="button" class="btn-small btn-small--danger" data-action="elimina-appuntamento">Elimina</button>
      </div>`;
    row.querySelector(".calendar-row__date").textContent =
      (a.data ? isoToDateLabel(a.data) : "Data non valida") + " · " + a.ora;
    row.querySelector(".calendar-row__meta").textContent =
      "Istruttore: " + (a.istruttore || pk.istruttore || "—") + " · " + a.tipo;
    row.querySelector(".badge").textContent = a.fatto ? "Fatto" : "Da fare";
    list.appendChild(row);
  }
}

function lezioneGroup(pk) {
  const group = document.createElement("div");
  group.className = "lezione-group";
  group.dataset.id = pk.id;
  group.dataset.categoria = pk.categoria;
  const linked = data.pagamenti.find(p => p.pacchettoId === pk.id);
  const apps = data.appuntamenti.filter(a => a.pacchettoId === pk.id);
  const esaurito = pacchettoEsaurito(pk);
  const payBadge = linked && linked.clienteId === pk.clienteId
    ? statoBadge(linked)
    : { cls: "badge--neutral", txt: "Senza pagamento" };
  group.innerHTML = `
    <div class="lezione-group__head">
      <div class="lezione-group__title-wrap">
        <strong class="lezione-group__title"></strong>
        <div class="lezione-group__badges">
          <span class="badge ${payBadge.cls}"></span>
          <span class="badge badge--neutral" data-schedule-badge></span>
        </div>
      </div>
      <div class="lezione-group__actions">
        <button type="button" class="btn-small" data-action="modifica-pacchetto">Modifica</button>
        <button type="button" class="btn-small btn-small--danger" data-action="elimina-pacchetto">Elimina</button>
      </div>
    </div>
    <div class="lezione-grid">
      <div class="lezione-block">
        <h5>${pk.categoria === "singola" ? "Lezione" : "Pacchetto"}</h5>
        <div class="lezione-meta" data-meta></div>
        <div class="lezione-block__actions">
          ${!esaurito ? '<button type="button" class="btn-small" data-action="consuma-lezione">Consuma lezione</button>' : ""}
        </div>
      </div>
      <div class="lezione-block lezione-block--payments"></div>
      <div class="lezione-block lezione-block--calendar"></div>
    </div>`;
  group.querySelector(".lezione-group__title").textContent = lezioneLabel(pk);
  const badges = group.querySelectorAll(".lezione-group__badges .badge");
  badges[0].textContent = payBadge.txt;
  badges[1].textContent = apps.length + "/" + pk.lezioni + " lezioni";
  const meta = group.querySelector("[data-meta]");
  const lines = [
    "Lezioni: " + pk.lezioni + " · Utilizzate: " + pk.utilizzate + " · Rimaste: " + lezioniRimanenti(pk),
    "Prezzo: " + money(pk.prezzo),
  ];
  for (const line of lines) {
    const div = document.createElement("div");
    div.textContent = line;
    meta.appendChild(div);
  }
  renderPaymentBlock(group.querySelector(".lezione-block--payments"), pk);
  renderCalendarBlock(group.querySelector(".lezione-block--calendar"), pk);
  return group;
}

function renderLezioneGroups(box, c) {
  const links = clientLinks(c.id);
  const pacchetti = links.pacchetti.filter(pk => pk.categoria !== "singola")
    .sort((a, b) => (b.data || "").localeCompare(a.data || "") || b.id - a.id);
  const singole = links.pacchetti.filter(pk => pk.categoria === "singola")
    .sort((a, b) => (b.data || "").localeCompare(a.data || "") || b.id - a.id);
  const pkgList = box.querySelector("#cliente-pacchetti-list");
  const singleList = box.querySelector("#cliente-singole-list");
  pkgList.innerHTML = "";
  singleList.innerHTML = "";
  if (!pacchetti.length) pkgList.appendChild(emptyState("Nessun pacchetto."));
  for (const pk of pacchetti) pkgList.appendChild(lezioneGroup(pk));
  if (!singole.length) singleList.appendChild(emptyState("Nessuna lezione singola."));
  for (const pk of singole) singleList.appendChild(lezioneGroup(pk));
}

function renderClienteGestione(box, c) {
  box.insertAdjacentHTML("beforeend", `
    <datalist id="tipi-suggeriti"></datalist>
    <datalist id="istruttori-suggeriti"></datalist>
    <datalist id="note-incasso-suggerite"></datalist>
    <section class="card-section" aria-labelledby="cliente-card-pacchetti">
      ${cardSectionHead("cliente-card-pacchetti", "Pacchetto lezioni", "cliente-btn-nuovo-pacchetto", "+ Aggiungi pacchetto", CARD_FORMS.pacchetto)}
      <div id="cliente-pacchetti-list" class="lezione-list"></div>
    </section>
    <section class="card-section" aria-labelledby="cliente-card-singole">
      ${cardSectionHead("cliente-card-singole", "Lezione singola", "cliente-btn-nuova-singola", "+ Aggiungi lezione", CARD_FORMS.pacchetto)}
      <div id="cliente-singole-list" class="lezione-list"></div>
    </section>
    ${pacchettoFormHtml(c.id)}
    ${appuntamentoFormHtml(c.id)}`);
  fillCardDatalists(box);
  renderLezioneGroups(box, c);
}

function renderClienteStorico(box, links) {
  box.insertAdjacentHTML("beforeend", `
    <h4>Pacchetti</h4><div data-detail-pacchetti></div>
    <h4>Lezioni singole</h4><div data-detail-singole></div>
    <h4>Pagamenti</h4><div data-detail-pagamenti></div>
    <h4>Appuntamenti</h4><div data-detail-appuntamenti></div>`);
  const pkgBox = box.querySelector("[data-detail-pacchetti]");
  const singleBox = box.querySelector("[data-detail-singole]");
  const pacchetti = links.pacchetti.filter(pk => pk.categoria !== "singola");
  const singole = links.pacchetti.filter(pk => pk.categoria === "singola");
  if (!pacchetti.length) pkgBox.textContent = "Nessun pacchetto.";
  if (!singole.length) singleBox.textContent = "Nessuna lezione singola.";
  const appendLezione = (target, pk) => {
    detailRow(target,
      lezioneLabel(pk) + " · " + money(pk.prezzo),
      "Lezioni: " + pk.lezioni + " · utilizzate: " + pk.utilizzate +
        " · rimaste: " + Math.max(0, pk.lezioni - pk.utilizzate));
  };
  for (const pk of pacchetti) appendLezione(pkgBox, pk);
  for (const pk of singole) appendLezione(singleBox, pk);

  const payBox = box.querySelector("[data-detail-pagamenti]");
  if (!links.pagamenti.length) payBox.textContent = "Nessun pagamento.";
  for (const p of [...links.pagamenti].sort((a, b) => (b.data || "").localeCompare(a.data || ""))) {
    detailRow(payBox,
      (p.data ? isoToDateLabel(p.data) : "Data non valida") + " · " + money(p.importo)
        + (p.descrizione ? " · " + p.descrizione : ""),
      statoPagamento(p) + " · incassato " + money(totaleIncassi(p.id))
        + " · saldo " + money(saldoPagamento(p)));
  }

  const appBox = box.querySelector("[data-detail-appuntamenti]");
  if (!links.appuntamenti.length) appBox.textContent = "Nessun appuntamento.";
  for (const a of [...links.appuntamenti].sort((x, y) => (x.data + x.ora).localeCompare(y.data + y.ora))) {
    const pk = a.pacchettoId ? data.pacchetti.find(x => x.id === a.pacchettoId) : null;
    detailRow(appBox,
      isoToDateLabel(a.data) + " · " + a.ora + " · " + a.tipo +
        (a.istruttore ? " · " + a.istruttore : "") +
        (pk ? " · " + lezioneLabel(pk) : ""),
      a.fatto ? "Fatto" : "Da fare");
  }
}

function captureOpenCardForms(box, clienteId) {
  if (!box || box.hidden || box.dataset.clienteId !== String(clienteId)) return [];
  return [...box.querySelectorAll(".form-panel")]
    .filter(p => !p.hidden)
    .map(p => {
      const values = {};
      const form = p.querySelector("form");
      if (form) {
        for (const el of form.elements) {
          if (!el.name || el.name === "clienteId") continue;
          values[el.name] = el.type === "checkbox" ? (el.checked ? "on" : "") : el.value;
        }
      }
      const title = p.querySelector("[data-form-title]");
      const receipt = p.querySelector("[data-receipt-fields]");
      const initialReceipts = [...p.querySelectorAll("[data-initial-receipt]")].map(row => ({
        importo: row.querySelector('[data-field="importo"]').value,
      }));
      const scheduleRows = [...p.querySelectorAll("[data-schedule-row]")].map(row => ({
        data: row.querySelector('[data-field="data"]').value,
        ora: row.querySelector('[data-field="ora"]').value,
        istruttore: row.querySelector('[data-field="istruttore"]').value,
      }));
      return {
        id: p.id,
        title: title ? title.textContent : "",
        receiptHidden: receipt ? receipt.hidden : null,
        values,
        initialReceipts,
        scheduleRows,
      };
    });
}

function restoreOpenCardForms(box, snapshot) {
  if (!box || box.hidden || !snapshot.length) return;
  for (const item of snapshot) {
    const panel = box.querySelector("#" + item.id);
    if (!panel) continue;
    const form = panel.querySelector("form");
    if (!form) continue;
    const recordId = Number(item.values.id || 0);
    if (recordId) {
      const kind = form.dataset.form;
      const exists = kind === "pagamento" ? data.pagamenti.some(p => p.id === recordId)
        : kind === "appuntamento" ? data.appuntamenti.some(a => a.id === recordId)
          : kind === "pacchetto" ? data.pacchetti.some(pk => pk.id === recordId)
            : true;
      if (!exists) continue;
    }
    panel.hidden = false;
    const heading = panel.querySelector("[data-form-title]");
    if (heading) {
      if (!heading.id) heading.id = panel.id + "-title";
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-labelledby", heading.id);
      if (item.title) heading.textContent = item.title;
    }
    const receipt = panel.querySelector("[data-receipt-fields]");
    if (receipt && item.receiptHidden !== null) receipt.hidden = item.receiptHidden;
    if (panel.id === CARD_FORMS.pacchetto) {
      const schedule = panel.querySelector("[data-schedule-fields]");
      if (schedule) schedule.hidden = recordId > 0;
    }
    for (const [name, value] of Object.entries(item.values)) {
      const el = form.elements.namedItem(name);
      if (!el) continue;
      if (el.type === "checkbox") {
        el.checked = value === "on";
        continue;
      }
      if (el.tagName === "SELECT" && ![...el.options].some(o => o.value === value)) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        el.appendChild(opt);
      }
      el.value = value;
    }
    if (panel.id === CARD_FORMS.pacchetto) {
      const receiptsBox = panel.querySelector("[data-initial-receipts]");
      if (receiptsBox && item.initialReceipts && item.initialReceipts.length) {
        receiptsBox.innerHTML = "";
        for (const r of item.initialReceipts) addInitialReceiptRow(panel, r);
      }
      const scheduleBox = panel.querySelector("[data-schedule-rows]");
      if (scheduleBox && item.scheduleRows && item.scheduleRows.length) {
        scheduleBox.innerHTML = "";
        for (const r of item.scheduleRows) addScheduleRow(panel, r);
      }
    }
    syncFormExpanded(panel.id);
    if (panel.id === CARD_FORMS.pacchetto) syncPacchettoForm(panel);
  }
}

function renderClienteDettaglioInto(boxId, clienteId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  // Conserva i valori dei form aperti se la scheda viene ridisegnata per lo stesso cliente.
  const formSnapshot = boxId === "cliente-dettaglio" ? captureOpenCardForms(box, clienteId) : [];
  const c = clienteById(clienteId);
  if (!c) {
    if (boxId === "archivio-dettaglio") selectedArchivioId = 0;
    else selectedClienteId = 0;
    box.hidden = true;
    box.innerHTML = "";
    delete box.dataset.clienteId;
    return;
  }
  box.hidden = false;
  box.dataset.clienteId = String(clienteId);
  const closeAction = boxId === "archivio-dettaglio" ? "chiudi-dettaglio-archivio" : "chiudi-dettaglio";
  box.innerHTML = `
    <div class="detail-panel__head">
      <h3 id="${boxId}-title" data-detail-title></h3>
      <button type="button" class="btn-small" data-action="${closeAction}">Chiudi</button>
    </div>
    <div class="detail-panel__meta" data-detail-meta></div>
    <div class="detail-panel__totals" data-detail-totals></div>`;
  box.querySelector("[data-detail-title]").textContent = c.nome;
  const meta = ["Cane: " + (c.cane || "—")];
  if (c.razza) meta.push("Razza: " + c.razza);
  if (c.eta) meta.push("Età: " + c.eta + " anni");
  if (c.telefono) meta.push("Tel: " + c.telefono);
  meta.push("Stato: " + (c.stato || "Attivo"));
  box.querySelector("[data-detail-meta]").textContent = meta.join("  ·  ");

  const links = clientLinks(c.id);
  const contratti = links.pagamenti.reduce((s, p) => s + p.importo, 0);
  const incassato = links.pagamenti.reduce((s, p) => s + totaleIncassi(p.id), 0);
  const saldo = links.pagamenti.reduce((s, p) => s + saldoPagamento(p), 0);
  const daVerificare = links.pagamenti.filter(p => p.incassoDaVerificare).length;
  const fatti = links.appuntamenti.filter(a => a.fatto).length;
  const rimanenti = links.pacchetti.reduce((s, pk) => s + Math.max(0, pk.lezioni - pk.utilizzate), 0);
  box.querySelector("[data-detail-totals]").textContent =
    "Contratti: " + money(contratti) + "  ·  Incassato: " + money(incassato)
    + "  ·  Saldo: " + money(saldo)
    + (daVerificare ? "  ·  Da verificare: " + daVerificare : "")
    + "  ·  Appuntamenti: " + links.appuntamenti.length + " (" + fatti + " fatti)"
    + "  ·  Lezioni rimaste: " + rimanenti;

  if (boxId === "archivio-dettaglio") renderClienteStorico(box, links);
  else {
    renderClienteGestione(box, c);
    restoreOpenCardForms(box, formSnapshot);
  }
}

function renderClienteDettaglio() {
  renderClienteDettaglioInto("cliente-dettaglio", selectedClienteId);
}

function renderArchivioDettaglio() {
  const c = clienteById(selectedArchivioId);
  if (!c || c.stato !== "Archiviato") selectedArchivioId = 0;
  renderClienteDettaglioInto("archivio-dettaglio", selectedArchivioId);
}

function closeDetailPanel(boxId) {
  if (boxId === "archivio-dettaglio") {
    selectedArchivioId = 0;
    renderArchivio();
    const trigger = document.querySelector("#archivio-list li[data-id='" + archivioTriggerId + "'] [data-action='scheda-archivio']");
    if (trigger) trigger.focus();
    archivioTriggerId = 0;
    return;
  }
  const triggerId = detailTriggerId;
  selectedClienteId = 0;
  renderClienti();
  const trigger = document.querySelector("#clienti-list li[data-id='" + triggerId + "'] [data-action='scheda-cliente']");
  if (trigger) trigger.focus();
  detailTriggerId = 0;
}

function orphanItems() {
  const items = [];
  for (const p of data.pagamenti.filter(x => x.clienteId === 0)) {
    items.push({ tipo: "pagamento", id: p.id,
      label: "Pagamento · " + (p.data ? isoToDateLabel(p.data) : "data non valida")
        + " · " + money(p.importo) + (p.descrizione ? " · " + p.descrizione : "") });
  }
  for (const a of data.appuntamenti.filter(x => x.clienteId === 0)) {
    items.push({ tipo: "appuntamento", id: a.id,
      label: "Appuntamento · " + (a.data ? isoToDateLabel(a.data) : "data non valida") + " · " + a.ora + " · " + a.tipo });
  }
  for (const pk of data.pacchetti.filter(x => x.clienteId === 0)) {
    items.push({ tipo: "pacchetto", id: pk.id,
      label: "Pacchetto · " + pk.lezioni + " lezioni · " + money(pk.prezzo) });
  }
  return items;
}

function renderOrfani() {
  const panel = document.getElementById("orfani-panel");
  const list = document.getElementById("orfani-list");
  if (!panel || !list) return;
  const items = orphanItems();
  panel.hidden = items.length === 0;
  list.innerHTML = "";
  if (!items.length) return;
  const clients = [...data.clienti].sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "orphan-row";
    const label = document.createElement("span");
    label.className = "orphan-row__label";
    label.textContent = item.label;
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Assegna a cliente");
    for (const c of clients) {
      const opt = document.createElement("option");
      opt.value = String(c.id);
      opt.textContent = c.nome + (c.stato === "Archiviato" ? " (archiviato)" : "");
      select.appendChild(opt);
    }
    const assign = document.createElement("button");
    assign.type = "button";
    assign.className = "btn-small";
    assign.dataset.action = "assegna-orfano";
    assign.dataset.tipo = item.tipo;
    assign.dataset.id = String(item.id);
    assign.textContent = "Assegna";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-small btn-small--danger";
    del.dataset.action = "elimina-orfano";
    del.dataset.tipo = item.tipo;
    del.dataset.id = String(item.id);
    del.textContent = "Elimina";
    row.append(label, select, assign, del);
    list.appendChild(row);
  }
}

/* Compila la riga anagrafica condivisa da Clienti e Archivio. */
function fillClienteRow(li, c) {
  li.querySelector(".list-item__title").textContent = c.nome;
  li.querySelector(".badge").textContent = c.stato || "Attivo";
  li.querySelector(".list-item__meta").textContent = "Tel: " + (c.telefono || "—");
  // Cane + dettagli facoltativi (razza, età, note): mostrati solo se non vuoti.
  const parts = ["Cane: " + (c.cane || "—")];
  if (c.razza) parts.push("Razza: " + c.razza);
  if (c.eta) parts.push("Età: " + c.eta + " anni");
  if (c.note) parts.push(c.note);
  li.querySelector(".list-item__note").textContent = parts.join("  ·  ");
}

function renderClienti(skipDetail) {
  const ul = document.getElementById("clienti-list");
  ul.innerHTML = "";
  const selected = clienteById(selectedClienteId);
  if (!selected || selected.stato === "Archiviato") {
    selectedClienteId = 0;
    detailTriggerId = 0;
  }
  const query = filterValue("filtro-clienti");
  const statoFiltro = filterValue("filtro-clienti-stato");
  const attivi = data.clienti.filter(c => c.stato !== "Archiviato");
  const sorted = attivi.filter(c => {
    if (statoFiltro && c.stato !== statoFiltro) return false;
    return matchesText(query, c.nome, c.cane, c.telefono, c.razza, c.eta, c.note);
  }).sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  for (const c of sorted) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.id = c.id;
    li.innerHTML = `
      <div class="list-item__head">
        <span class="list-item__title"></span>
        <span class="badge badge--${badgeKind(c.stato)}"></span>
      </div>
      <div class="list-item__meta"></div>
      <div class="list-item__note"></div>
      <div class="list-item__actions">
        <button type="button" class="btn-small" data-action="scheda-cliente">Scheda</button>
        <button type="button" class="btn-small" data-action="modifica-cliente">Modifica</button>
        <button type="button" class="btn-small" data-action="archivia-cliente">Archivia</button>
        <button type="button" class="btn-small btn-small--danger" data-action="elimina-cliente">Elimina</button>
      </div>`;
    fillClienteRow(li, c);
    ul.appendChild(li);
  }
  if (!ul.children.length) {
    const li = document.createElement("li");
    li.className = "list-empty";
    if (!attivi.length) {
      li.textContent = data.clienti.length
        ? "Nessun cliente attivo. I clienti archiviati sono in Archivio."
        : "Nessun cliente registrato.";
    } else {
      li.textContent = "Nessun cliente corrisponde ai filtri.";
    }
    ul.appendChild(li);
  }
  if (!skipDetail) renderClienteDettaglio();
  renderOrfani();
}

function renderArchivio(skipDetail) {
  const ul = document.getElementById("archivio-list");
  if (!ul) return;
  ul.innerHTML = "";
  const query = filterValue("filtro-archivio");
  const archiviati = data.clienti.filter(c => c.stato === "Archiviato");
  const sorted = archiviati
    .filter(c => matchesText(query, c.nome, c.cane, c.telefono, c.razza, c.eta, c.note))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  for (const c of sorted) {
    const li = document.createElement("li");
    li.className = "list-item is-archived";
    li.dataset.id = c.id;
    li.innerHTML = `
      <div class="list-item__head">
        <span class="list-item__title"></span>
        <span class="badge badge--neutral"></span>
      </div>
      <div class="list-item__meta"></div>
      <div class="list-item__note"></div>
      <div class="list-item__actions">
        <button type="button" class="btn-small" data-action="scheda-archivio">Scheda</button>
        <button type="button" class="btn-small" data-action="modifica-cliente">Modifica</button>
        <button type="button" class="btn-small" data-action="riattiva-cliente">Riattiva</button>
        <button type="button" class="btn-small btn-small--danger" data-action="elimina-cliente">Elimina</button>
      </div>`;
    fillClienteRow(li, c);
    ul.appendChild(li);
  }
  if (!ul.children.length) {
    const li = document.createElement("li");
    li.className = "list-empty";
    li.textContent = archiviati.length
      ? "Nessun cliente archiviato corrisponde alla ricerca."
      : "Nessun cliente archiviato.";
    ul.appendChild(li);
  }
  if (!skipDetail) renderArchivioDettaglio();
  const count = document.getElementById("archivio-count");
  if (count) {
    count.textContent = String(archiviati.length);
    count.hidden = archiviati.length === 0;
  }
}

function renderAppuntamenti() {
  const ul = document.getElementById("appuntamenti-list");
  if (!ul) return;
  const query = filterValue("filtro-appuntamenti");
  const stato = filterValue("filtro-appuntamenti-stato");
  const periodo = filterValue("filtro-appuntamenti-periodo");
  const categoria = filterValue("filtro-appuntamenti-categoria");
  const today = todayStr();
  const end = addDaysIso(today, 6);
  const rows = data.appuntamenti.filter(a => {
    if (!a.clienteId || !clienteById(a.clienteId)) return false;
    if (stato === "fatti" && !a.fatto) return false;
    if (stato === "da-fare" && a.fatto) return false;
    if (periodo === "oggi" && a.data !== today) return false;
    if (periodo === "7" && (a.data < today || a.data > end)) return false;
    if (periodo === "passati" && a.data >= today) return false;
    const pk = a.pacchettoId ? data.pacchetti.find(x => x.id === a.pacchettoId) : null;
    if (categoria === "pacchetto" && (!pk || pk.categoria === "singola")) return false;
    if (categoria === "singola" && (!pk || pk.categoria !== "singola")) return false;
    return matchesText(query, clienteNome(a.clienteId), a.istruttore, a.tipo,
      a.data, isoToDateLabel(a.data), a.ora, pk ? lezioneLabel(pk) : "");
  }).sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora) || a.id - b.id);

  ul.innerHTML = "";
  let lastDate = null;
  for (const a of rows) {
    if (a.data !== lastDate) {
      lastDate = a.data;
      const head = document.createElement("li");
      head.className = "agenda-day";
      const parsed = a.data ? new Date(a.data + "T00:00:00") : null;
      head.textContent = parsed && !isNaN(parsed.getTime())
        ? parsed.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" })
        : "Data non valida";
      ul.appendChild(head);
    }
    const pk = a.pacchettoId ? data.pacchetti.find(x => x.id === a.pacchettoId) : null;
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.id = a.id;
    li.dataset.clienteId = a.clienteId;
    li.innerHTML = `
      <div class="list-item__head">
        <span class="list-item__title"></span>
        <span class="badge ${a.fatto ? "badge--ok" : "badge--neutral"}"></span>
      </div>
      <div class="list-item__meta"></div>
      <div class="list-item__actions">
        <button type="button" class="btn-small" data-action="modifica-appuntamento">Modifica</button>
        ${!a.fatto ? '<button type="button" class="btn-small" data-action="segna-fatto">Segna fatto</button>' : ""}
        <button type="button" class="btn-small" data-action="vai-cliente" data-cliente-id="${a.clienteId}">Scheda cliente</button>
        <button type="button" class="btn-small btn-small--danger" data-action="elimina-appuntamento">Elimina</button>
      </div>`;
    li.querySelector(".list-item__title").textContent =
      (a.data ? isoToDateLabel(a.data) : "Data non valida") + " · " + a.ora + " · " + clienteNome(a.clienteId);
    li.querySelector(".badge").textContent = a.fatto ? "Fatto" : "Da fare";
    li.querySelector(".list-item__meta").textContent =
      "Istruttore: " + (a.istruttore || "—") + " · Tipo: " + a.tipo +
      (pk ? " · " + lezioneLabel(pk) : " · Senza lezione");
    ul.appendChild(li);
  }
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "list-empty";
    li.textContent = data.appuntamenti.length
      ? "Nessuna lezione corrisponde ai filtri."
      : "Nessuna lezione programmata.";
    ul.appendChild(li);
  }
  const istruttori = new Set();
  for (const pk of data.pacchetti) if (pk.istruttore) istruttori.add(pk.istruttore);
  for (const a of data.appuntamenti) if (a.istruttore) istruttori.add(a.istruttore);
  fillDatalist(document.getElementById("istruttori-globali"),
    [...istruttori].sort((a, b) => a.localeCompare(b, "it")));
}

function badgeKind(stato) {
  if (stato === "Attivo") return "ok";
  if (stato === "Pausa") return "warn";
  return "neutral";
}

/* ===== Render pagamenti ===== */
function statoBadge(p) {
  if (p.stato === "Pagato") return { cls: "badge--ok", txt: "Pagato" };
  if (p.stato === "Parziale") return { cls: "badge--warn", txt: "Parziale" };
  if (p.stato === "Da verificare") return { cls: "badge--warn", txt: "Da verificare" };
  return { cls: "badge--neutral", txt: "Da pagare" };
}


/* ===== Render resoconto ===== */
/* Resoconto: finestra selezionabile di 12 mesi a ritroso dal mese corrente.
   Il valore corrente del select e' lo stato della vista (non persistito: e' UI). */
function periodRange(y, m) {
  const mm = String(m).padStart(2, "0");
  const first = y + "-" + mm + "-01";
  const last = y + "-" + mm + "-" + String(new Date(y, m, 0).getDate()).padStart(2, "0");
  const label = mm + "/" + String(y);
  return { first, last, label };
}

function currentMonth() {
  const now = new Date();
  return periodRange(now.getFullYear(), now.getMonth() + 1);
}

/* Restituisce "YYYY-MM" per i N mesi a ritroso dal mese corrente (piu recente per primo). */
function recentMonths(n) {
  const now = new Date();
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
  }
  return out;
}

function selectedMonth() {
  const sel = document.getElementById("resoconto-mese");
  const val = sel ? sel.value : "";
  const [y, m] = val.split("-").map(Number);
  if (!y || !m) return currentMonth();
  return periodRange(y, m);
}

function selectedReportClient() {
  const sel = document.getElementById("resoconto-cliente");
  const val = sel ? Number(sel.value) : 0;
  return val && clienteById(val) ? val : 0;
}

function fillReportClientSelect() {
  const sel = document.getElementById("resoconto-cliente");
  if (!sel) return;
  const signature = data.clienti.map(c => c.id + ":" + c.nome + ":" + c.stato).join("|");
  if (sel.dataset.signature === signature) return;
  sel.dataset.signature = signature;
  const current = sel.value;
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Tutti i clienti";
  sel.appendChild(all);
  for (const c of [...data.clienti].sort((a, b) => a.nome.localeCompare(b.nome, "it"))) {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.nome + (c.stato === "Archiviato" ? " (archiviato)" : "");
    sel.appendChild(opt);
  }
  sel.value = current && clienteById(Number(current)) ? current : "";
}

function inMonth(iso) {
  const { first, last } = selectedMonth();
  return iso >= first && iso <= last;
}

/* Mese precedente (YYYY-MM) di un dato YYYY-MM. */
function prevMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // mese corrente -1 (m-1 in 0-based)
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

/* Incassi effettivi: solo il registro `incassi`, per data dell'incasso. */
function incassiPeriodo(range, clienteId) {
  return data.incassi.filter(i => {
    if (!i.data || i.data < range.first || i.data > range.last) return false;
    if (!clienteId) return true;
    const p = data.pagamenti.find(x => x.id === i.pagamentoId);
    return !!p && p.clienteId === clienteId;
  });
}

function incassatoMese(ym, clienteId) {
  const range = periodRange(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));
  return incassiPeriodo(range, clienteId).reduce((s, i) => s + i.importo, 0);
}

function incassiSenzaData(clienteId) {
  return data.incassi.filter(i => {
    if (i.data) return false;
    if (!clienteId) return true;
    const p = data.pagamenti.find(x => x.id === i.pagamentoId);
    return !!p && p.clienteId === clienteId;
  });
}

/* Credito residuo al termine del periodo: contratti fino a quella data meno
   incassi con data fino a quella data. Gli incassi senza data vengono sottratti
   (non è possibile collocarli nel tempo), ma sono segnalati a parte. */
function creditoPagamentoAl(p, last) {
  if (p.incassoDaVerificare) return 0;
  if (!p.data || p.data > last) return 0;
  const inc = incassiDi(p.id)
    .filter(i => !i.data || i.data <= last)
    .reduce((s, i) => s + i.importo, 0);
  return Math.max(0, Math.round((p.importo - inc) * 100) / 100);
}

function pagamentiDaVerificareAl(last, clienteId) {
  return data.pagamenti.filter(p =>
    p.incassoDaVerificare
    && incassiDi(p.id).length === 0
    && p.data && p.data <= last
    && (!clienteId || p.clienteId === clienteId)
  );
}

function fillMonthSelect() {
  const sel = document.getElementById("resoconto-mese");
  if (!sel) return;
  if (sel._filled) return;
  sel._filled = true;
  for (const ym of recentMonths(12)) {
    const [y, m] = ym.split("-").map(Number);
    const opt = document.createElement("option");
    opt.value = ym;
    opt.textContent = periodRange(y, m).label;
    sel.appendChild(opt);
  }
  const def = recentMonths(1)[0];
  sel.value = def;
}

document.addEventListener("change", (e) => {
  if (e.target.id === "resoconto-mese" || e.target.id === "resoconto-cliente") renderResoconto();
});

function renderResoconto() {
  const el = document.getElementById("resoconto");
  fillMonthSelect();
  fillReportClientSelect();
  const range = selectedMonth();
  const { label } = range;
  const clienteFiltro = selectedReportClient();
  const clienteLabel = clienteFiltro ? clienteNome(clienteFiltro) : "";

  const incassi = incassiPeriodo(range, clienteFiltro);
  const incassato = incassi.reduce((s, i) => s + i.importo, 0);
  const crediti = data.pagamenti
    .filter(p => !clienteFiltro || p.clienteId === clienteFiltro)
    .map(p => ({ p, saldo: creditoPagamentoAl(p, range.last) }))
    .filter(x => x.saldo > 0);
  const creditoTotale = crediti.reduce((s, x) => s + x.saldo, 0);
  const daVerificare = pagamentiDaVerificareAl(range.last, clienteFiltro);
  const daVerificareContratti = daVerificare.reduce((s, p) => s + p.importo, 0);
  const nApp = data.appuntamenti.filter(a => a.data && inMonth(a.data)
    && (!clienteFiltro || a.clienteId === clienteFiltro)).length;
  const attivi = clienteFiltro
    ? (clienteById(clienteFiltro).stato === "Attivo" ? 1 : 0)
    : data.clienti.filter(c => c.stato === "Attivo").length;
  const senzaData = incassiSenzaData(clienteFiltro);

  /* Trend incassi vs mese precedente: se il mese precedente è 0, mostra "—". */
  const selEl = document.getElementById("resoconto-mese");
  const selYm = selEl ? selEl.value : recentMonths(1)[0];
  const prevYm = prevMonth(selYm);
  const prevIncassato = incassatoMese(prevYm, clienteFiltro);
  let trendLabel, trendCls;
  if (prevIncassato === 0) {
    trendLabel = "—";
    trendCls = "";
  } else {
    const pct = ((incassato - prevIncassato) / prevIncassato) * 100;
    const abs = Math.abs(Math.round(pct));
    if (pct > 0) {
      trendLabel = `+${abs} % (su)`;
      trendCls = "resoconto-trend--up";
    } else if (pct < 0) {
      trendLabel = `−${abs} % (in calo)`;
      trendCls = "resoconto-trend--down";
    } else {
      trendLabel = `0 % (invariato)`;
      trendCls = "resoconto-trend--pari";
    }
  }

  // Incidenza incassi per cliente: solo incassi effettivi nel periodo.
  const perCliente = new Map();
  for (const i of incassi) {
    const p = data.pagamenti.find(x => x.id === i.pagamentoId);
    if (!p) continue;
    perCliente.set(p.clienteId, (perCliente.get(p.clienteId) || 0) + i.importo);
  }
  const sortedCliente = [...perCliente.entries()].sort((a, b) => {
    const na = clienteById(a[0]) ? clienteById(a[0]).nome : "";
    const nb = clienteById(b[0]) ? clienteById(b[0]).nome : "";
    if (b[1] !== a[1]) return b[1] - a[1];
    return na < nb ? -1 : 1;
  });

  el.innerHTML = "";
  const period = document.createElement("div");
  period.className = "resoconto-period";
  period.textContent = "Periodo: " + label + (clienteFiltro ? " · Cliente: " + clienteLabel : "");
  el.appendChild(period);

  const rows = [
    { label: "Incassato effettivo nel mese", value: money(incassato) },
    { label: "Crediti residui al fine mese", value: money(creditoTotale) },
    { label: "Pagamenti con incasso da verificare", value: String(daVerificare.length) },
    { label: "Appuntamenti nel mese", value: String(nApp) },
    { label: "Clienti attivi", value: String(attivi) },
  ];
  for (const r of rows) {
    const card = document.createElement("div");
    card.className = "resoconto-card";
    card.innerHTML = `<span class="resoconto-card__label"></span><span class="resoconto-card__value"></span>`;
    card.querySelector(".resoconto-card__label").textContent = r.label;
    card.querySelector(".resoconto-card__value").textContent = r.value;
    el.appendChild(card);
  }

  const trend = document.createElement("div");
  trend.className = "resoconto-card resoconto-trend " + trendCls;
  trend.innerHTML = `<span class="resoconto-card__label"></span><span class="resoconto-card__value"></span>`;
  trend.querySelector(".resoconto-card__label").textContent = "Trend incassi vs mese precedente";
  trend.querySelector(".resoconto-card__value").textContent = trendLabel;
  el.appendChild(trend);

  if (daVerificare.length) {
    const note = document.createElement("p");
    note.className = "resoconto-note resoconto-note--warn";
    note.textContent = daVerificare.length + " pagament" + (daVerificare.length === 1 ? "o" : "i")
      + " legacy con incasso non registrato (contratti per " + money(daVerificareContratti)
      + "): esclusi da incassi e crediti finché non verifichi l'importo ricevuto.";
    el.appendChild(note);
  }
  if (senzaData.length) {
    const note = document.createElement("p");
    note.className = "resoconto-note resoconto-note--warn";
    note.textContent = senzaData.length + " incass" + (senzaData.length === 1 ? "o" : "i")
      + " senza data valida: esclus" + (senzaData.length === 1 ? "o" : "i")
      + " dal totale mensile ma contat" + (senzaData.length === 1 ? "o" : "i")
      + " nel saldo dei pagamenti.";
    el.appendChild(note);
  }

  if (sortedCliente.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "resoconto-clienti";
    const title = document.createElement("div");
    title.className = "resoconto-clienti__title";
    title.textContent = "Incidenza incassi per cliente";
    wrap.appendChild(title);

    const list = document.createElement("ul");
    list.className = "resoconto-clienti__list";
    for (const [cid, tot] of sortedCliente) {
      const c = clienteById(cid);
      const li = document.createElement("li");
      li.className = "resoconto-cliente-row";
      li.innerHTML = `<span class="resoconto-cliente-row__nome"></span><span class="resoconto-cliente-row__val"></span>`;
      li.querySelector(".resoconto-cliente-row__nome").textContent = c ? c.nome : "Sconosciuto";
      li.querySelector(".resoconto-cliente-row__val").textContent = money(tot);
      list.appendChild(li);
    }
    wrap.appendChild(list);

    const t = document.createElement("li");
    t.className = "resoconto-cliente-row resoconto-cliente-row--totale";
    t.innerHTML = `<span class="resoconto-cliente-row__nome"></span><span class="resoconto-cliente-row__val"></span>`;
    t.querySelector(".resoconto-cliente-row__nome").textContent = "Totale";
    t.querySelector(".resoconto-cliente-row__val").textContent = money(incassato);
    list.appendChild(t);
    el.appendChild(wrap);
  }

  const rimanentiTotali = data.pacchetti
    .filter(pk => !clienteFiltro || pk.clienteId === clienteFiltro)
    .reduce((s, pk) => s + lezioniRimanenti(pk), 0);
  const pkBlock = document.createElement("div");
  pkBlock.className = "resoconto-pacchetti";
  pkBlock.innerHTML = `
    <span class="resoconto-pacchetti__label"></span>
    <span class="resoconto-pacchetti__value"></span>
    <span class="resoconto-pacchetti__note"></span>`;
  pkBlock.querySelector(".resoconto-pacchetti__label").textContent = "Lezioni rimanenti totali";
  pkBlock.querySelector(".resoconto-pacchetti__value").textContent = String(rimanentiTotali);
  pkBlock.querySelector(".resoconto-pacchetti__note").textContent =
    "Crediti da pacchetti inclusi nei crediti residui. Storico mensile consumi non disponibile.";
  el.appendChild(pkBlock);

  renderReport();
}

/* ===== Report stampabile per il commercialista (Fase 9) =====
   - incassato effettivo = righe del registro `incassi` con data nel periodo;
   - crediti residui = contratti fino al fine periodo meno incassi fino a quella data;
   - i pagamenti legacy "Parziale" restano "Da verificare" e sono esclusi da entrambi
     i totali finché non viene registrato l'importo effettivamente ricevuto. */
function buildReportData() {
  const range = selectedMonth();
  const { label } = range;
  const clienteFiltro = selectedReportClient();
  const clienteLabel = clienteFiltro ? clienteNome(clienteFiltro) : "";
  const incassi = incassiPeriodo(range, clienteFiltro)
    .map(i => {
      const p = data.pagamenti.find(x => x.id === i.pagamentoId);
      return {
        ...i,
        clienteId: p ? p.clienteId : 0,
        descrizione: p ? (p.descrizione || "") : "",
      };
    })
    .sort((a, b) => {
      const ka = a.data + String(a.id).padStart(6, "0");
      const kb = b.data + String(b.id).padStart(6, "0");
      return ka < kb ? 1 : -1;
    });
  const effettivo = incassi.reduce((s, i) => s + i.importo, 0);
  const crediti = data.pagamenti
    .filter(p => !clienteFiltro || p.clienteId === clienteFiltro)
    .map(p => {
      const saldo = creditoPagamentoAl(p, range.last);
      return {
        p,
        saldo,
        incassato: Math.max(0, Math.round((p.importo - saldo) * 100) / 100),
      };
    })
    .filter(x => x.saldo > 0)
    .sort((a, b) => {
      if (b.saldo !== a.saldo) return b.saldo - a.saldo;
      return clienteNome(a.p.clienteId).localeCompare(clienteNome(b.p.clienteId), "it");
    });
  const creditoTotale = crediti.reduce((s, x) => s + x.saldo, 0);
  const daVerificare = pagamentiDaVerificareAl(range.last, clienteFiltro);
  const daVerificareTotale = daVerificare.reduce((s, p) => s + p.importo, 0);
  const senzaData = incassiSenzaData(clienteFiltro);

  const perCliente = new Map();
  for (const i of incassi) {
    perCliente.set(i.clienteId, (perCliente.get(i.clienteId) || 0) + i.importo);
  }
  const perClienteRows = [...perCliente.entries()].sort((a, b) => {
    const na = clienteNome(a[0]);
    const nb = clienteNome(b[0]);
    if (b[1] !== a[1]) return b[1] - a[1];
    return na < nb ? -1 : 1;
  });

  return {
    label,
    last: range.last,
    clienteFiltro,
    clienteLabel,
    generated: isoToDateLabel(todayStr()),
    incassi,
    effettivo,
    crediti,
    creditoTotale,
    daVerificare,
    daVerificareTotale,
    senzaData,
    perClienteRows,
    rimanenti: data.pacchetti
      .filter(pk => !clienteFiltro || pk.clienteId === clienteFiltro)
      .reduce((s, pk) => s + lezioniRimanenti(pk), 0),
  };
}

/* ===== Esportazione CSV ===== */
function csvCell(value) {
  let s = value == null ? "" : String(value);
  // Evita l'interpretazione di formule nei fogli di calcolo.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[;"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvMoney(n) {
  return (Number(n) || 0).toFixed(2).replace(".", ",");
}

function csvFilePart(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function downloadCsv(name, rows) {
  const body = rows.map(r => r.map(csvCell).join(";")).join("\r\n");
  downloadText(name, "\ufeff" + body + "\r\n", "text/csv;charset=utf-8");
}

function csvFileName(prefix, r) {
  const period = r.label.replace(/[^0-9]+/g, "-");
  const client = r.clienteFiltro ? "_" + csvFilePart(r.clienteLabel) : "";
  return prefix + "_" + period + client + ".csv";
}

function exportCsvIncassi() {
  const r = buildReportData();
  const rows = [["Data incasso", "Cliente", "Descrizione pagamento", "Nota", "Importo (EUR)"]];
  for (const i of r.incassi) {
    rows.push([
      i.data ? isoToDateLabel(i.data) : "",
      clienteNome(i.clienteId),
      i.descrizione || "",
      i.nota || "",
      csvMoney(i.importo),
    ]);
  }
  downloadCsv(csvFileName("incassi", r), rows);
  setStatus("CSV incassi esportato: " + r.incassi.length + " righe.");
}

function exportCsvPagamenti() {
  const r = buildReportData();
  const range = selectedMonth();
  const rows = [["Data contratto", "Cliente", "Descrizione", "Importo (EUR)",
    "Incassato al fine periodo (EUR)", "Saldo (EUR)", "Stato"]];
  const pagamenti = data.pagamenti
    .filter(p => p.data && p.data >= range.first && p.data <= range.last)
    .filter(p => !r.clienteFiltro || p.clienteId === r.clienteFiltro)
    .sort((a, b) => {
      const ka = a.data + String(a.id).padStart(6, "0");
      const kb = b.data + String(b.id).padStart(6, "0");
      return ka < kb ? 1 : -1;
    });
  for (const p of pagamenti) {
    const saldo = creditoPagamentoAl(p, range.last);
    const incassato = p.incassoDaVerificare ? 0 : Math.max(0, p.importo - saldo);
    rows.push([
      isoToDateLabel(p.data),
      clienteNome(p.clienteId),
      p.descrizione || "",
      csvMoney(p.importo),
      csvMoney(incassato),
      csvMoney(saldo),
      statoPagamento(p),
    ]);
  }
  downloadCsv(csvFileName("pagamenti", r), rows);
  setStatus("CSV pagamenti esportato: " + pagamenti.length + " righe.");
}

function reportRow(tbody, cells, className) {
  const tr = document.createElement("tr");
  if (className) tr.className = className;
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

function reportEmpty(tbody, colSpan, text) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = colSpan;
  td.textContent = text;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

function renderReport() {
  const root = document.getElementById("report-print");
  if (!root) return;
  const r = buildReportData();

  root.innerHTML = `
    <header class="report__head">
      <h1 class="report__title">Resoconto incassi e crediti</h1>
      <p class="report__period"></p>
      <p class="report__generated"></p>
    </header>
    <div class="report__summary">
      <div class="report__card">
        <span class="report__label">Incassato effettivo nel periodo</span>
        <span class="report__value report__value--effettivo"></span>
      </div>
      <div class="report__card">
        <span class="report__label">Crediti residui al fine periodo</span>
        <span class="report__value report__value--credito"></span>
      </div>
      <div class="report__card">
        <span class="report__label">Pagamenti con incasso da verificare</span>
        <span class="report__value report__value--verifica"></span>
      </div>
    </div>
    <p class="report__note report__note--main"></p>
    <p class="report__reconcile"></p>
    <h2 class="report__h2">Incassi del periodo</h2>
    <table class="report__table">
      <thead>
        <tr><th>Data incasso</th><th>Cliente</th><th>Descrizione</th><th>Nota</th><th>Importo</th></tr>
      </thead>
      <tbody class="report__incassi-body"></tbody>
    </table>
    <h2 class="report__h2">Crediti residui al fine periodo</h2>
    <table class="report__table">
      <thead>
        <tr><th>Cliente</th><th>Data contratto</th><th>Descrizione</th><th>Contratto</th><th>Incassato</th><th>Saldo</th></tr>
      </thead>
      <tbody class="report__crediti-body"></tbody>
    </table>
    <h2 class="report__h2">Pagamenti con incasso da verificare</h2>
    <table class="report__table">
      <thead>
        <tr><th>Cliente</th><th>Data contratto</th><th>Descrizione</th><th>Importo contratto</th></tr>
      </thead>
      <tbody class="report__verifica-body"></tbody>
    </table>
    <h2 class="report__h2">Incassi effettivi per cliente</h2>
    <div class="report__clienti"></div>
    <h2 class="report__h2">Pacchetti</h2>
    <div class="report__pacchetti"></div>`;

  root.querySelector(".report__period").textContent = "Periodo: " + r.label
    + (r.clienteFiltro ? " · Cliente: " + r.clienteLabel : "");
  root.querySelector(".report__generated").textContent = "Generato il " + r.generated;
  root.querySelector(".report__value--effettivo").textContent = money(r.effettivo);
  root.querySelector(".report__value--credito").textContent = money(r.creditoTotale);
  root.querySelector(".report__value--verifica").textContent =
    String(r.daVerificare.length) + (r.daVerificare.length ? " · " + money(r.daVerificareTotale) : "");

  let note = "L'incassato effettivo somma solo gli incassi con data nel periodo. "
    + "I crediti residui sono calcolati al " + isoToDateLabel(r.last)
    + " sottraendo dagli importi contrattuali gli incassi fino a quella data.";
  if (r.daVerificare.length) {
    note += " I pagamenti legacy con incasso non registrato sono esclusi da incassi e crediti: "
      + "nessun importo viene stimato.";
  }
  if (r.senzaData.length) {
    note += " " + r.senzaData.length + " incass" + (r.senzaData.length === 1 ? "o" : "i")
      + " senza data valida non è conteggiat" + (r.senzaData.length === 1 ? "o" : "i")
      + " nel periodo.";
  }
  root.querySelector(".report__note--main").textContent = note;
  root.querySelector(".report__reconcile").textContent =
    "Raccordo con l'app: l'Incassato effettivo nel mese mostrato a schermo è "
    + money(r.effettivo) + "; i crediti residui al fine mese sono " + money(r.creditoTotale) + ".";

  const incassiBody = root.querySelector(".report__incassi-body");
  if (!r.incassi.length) {
    reportEmpty(incassiBody, 5, "Nessun incasso nel periodo.");
  } else {
    for (const i of r.incassi) {
      reportRow(incassiBody, [
        i.data ? isoToDateLabel(i.data) : "Data non valida",
        clienteNome(i.clienteId),
        i.descrizione || "—",
        i.nota || "—",
        money(i.importo),
      ]);
    }
    reportRow(incassiBody, ["", "", "", "Totale incassato", money(r.effettivo)], "report__row--totale");
  }

  const creditiBody = root.querySelector(".report__crediti-body");
  if (!r.crediti.length) {
    reportEmpty(creditiBody, 6, "Nessun credito residuo al fine periodo.");
  } else {
    for (const x of r.crediti) {
      reportRow(creditiBody, [
        clienteNome(x.p.clienteId),
        x.p.data ? isoToDateLabel(x.p.data) : "Data non valida",
        x.p.descrizione || "—",
        money(x.p.importo),
        money(x.incassato),
        money(x.saldo),
      ]);
    }
    reportRow(creditiBody, ["", "", "Totale crediti", "", "", money(r.creditoTotale)], "report__row--totale");
  }

  const verificaBody = root.querySelector(".report__verifica-body");
  if (!r.daVerificare.length) {
    reportEmpty(verificaBody, 4, "Nessun pagamento da verificare.");
  } else {
    for (const p of r.daVerificare) {
      reportRow(verificaBody, [
        clienteNome(p.clienteId),
        p.data ? isoToDateLabel(p.data) : "Data non valida",
        p.descrizione || "—",
        money(p.importo),
      ]);
    }
    reportRow(verificaBody, ["", "", "Totale contratti da verificare", money(r.daVerificareTotale)], "report__row--totale");
  }

  const clientiBox = root.querySelector(".report__clienti");
  if (!r.perClienteRows.length) {
    const p = document.createElement("p");
    p.className = "report__note";
    p.textContent = "Nessun incasso effettivo nel periodo.";
    clientiBox.appendChild(p);
  } else {
    for (const [cid, tot] of r.perClienteRows) {
      const row = document.createElement("div");
      row.className = "report__row";
      row.innerHTML = `<span></span><span></span>`;
      row.children[0].textContent = clienteNome(cid);
      row.children[1].textContent = money(tot);
      clientiBox.appendChild(row);
    }
    const tot = document.createElement("div");
    tot.className = "report__row report__row--totale";
    tot.innerHTML = `<span>Totale incassato effettivo</span><span></span>`;
    tot.children[1].textContent = money(r.effettivo);
    clientiBox.appendChild(tot);
  }

  const pkBox = root.querySelector(".report__pacchetti");
  const pkRow = document.createElement("div");
  pkRow.className = "report__row";
  pkRow.innerHTML = `<span>Lezioni rimanenti totali</span><span></span>`;
  pkRow.children[1].textContent = String(r.rimanenti);
  pkBox.appendChild(pkRow);
  const pkNote = document.createElement("p");
  pkNote.className = "report__note report__note--small";
  pkNote.textContent = "I crediti dei pacchetti sono inclusi nei crediti residui. Storico mensile consumi non disponibile.";
  pkBox.appendChild(pkNote);
}

function printReport() {
  try {
    // Rigenera per essere certo che il report corrisponda al mese selezionato.
    renderReport();
    window.print();
  } catch (err) {
    setStatus("Esportazione PDF non riuscita: " + err.message, true);
  }
}


function refresh() {
  renderClienti();
  renderArchivio();
  renderAppuntamenti();
  renderResoconto();
  renderBackupInfo();
}


/* ===== Gestione form ===== */
const formTriggers = new Map();
let lastOpenedFormId = null;

function syncFormExpanded(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  for (const btn of document.querySelectorAll('[aria-controls="' + id + '"]')) {
    btn.setAttribute("aria-expanded", String(!panel.hidden));
  }
}

function hideFormPanel(panel) {
  panel.hidden = true;
  const form = panel.querySelector("form");
  if (form) form.reset();
  syncFormExpanded(panel.id);
}

function toggleForm(id, show, record) {
  const panel = document.getElementById(id);
  if (!panel) return;
  if (!show) {
    const trigger = formTriggers.get(id);
    formTriggers.delete(id);
    hideFormPanel(panel);
    const f = panel.querySelector("form");
    if (trigger && document.contains(trigger)) {
      trigger.focus();
    } else if (f) {
      const fallback = document.getElementById(f.dataset.newBtn || ("btn-nuovo-" + f.dataset.form));
      if (fallback) fallback.focus();
    }
    return;
  }
  panel.hidden = false;
  lastOpenedFormId = id;
  formTriggers.set(id, document.activeElement);
  const f = panel.querySelector("form");
  if (!f) return;
  f.reset();
  const heading = panel.querySelector("[data-form-title]");
  if (heading) {
    if (!heading.id) heading.id = id + "-title";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-labelledby", heading.id);
  }
  const idField = f.elements.namedItem("id");
  if (idField) idField.value = "";
  const kind = f.dataset.form;
  const title = panel.querySelector("[data-form-title]");
  if (title) {
    const names = { cliente: "cliente", pagamento: "pagamento", pacchetto: "pacchetto" };
    if (kind === "appuntamento") {
      title.textContent = record ? "Modifica lezione" : "Nuova lezione";
    } else {
      title.textContent = kind === "pacchetto" && !record
        ? "Vendi pacchetto"
        : (record ? "Modifica " : "Nuovo ") + names[kind];
    }
  }
  const receiptFields = panel.querySelector("[data-receipt-fields]");
  if (receiptFields) receiptFields.hidden = !!record;
  const scheduleFields = panel.querySelector("[data-schedule-fields]");
  if (scheduleFields) scheduleFields.hidden = !!record;
  if (record) {
    for (const [key, value] of Object.entries(record)) {
      const el = f.elements.namedItem(key);
      if (el && typeof value !== "object" && value !== null) el.value = String(value);
    }
    if (kind === "appuntamento") {
      const sel = f.elements.namedItem("tipo");
      if (sel && sel.tagName === "SELECT" && ![...sel.options].some(o => o.value === record.tipo)) {
        const opt = document.createElement("option");
        opt.value = record.tipo;
        opt.textContent = record.tipo;
        sel.appendChild(opt);
        sel.value = record.tipo;
      }
    }
  }
  // Date predefinite per i nuovi inserimenti (l'utente può cambiarle).
  for (const name of ["data"]) {
    const el = f.elements.namedItem(name);
    if (el && !el.value && !record) el.value = todayStr();
  }
  if (kind === "appuntamento") {
    const ora = f.elements.namedItem("ora");
    if (ora && !ora.value && !record) ora.value = "09:00";
  }
  const first = panel.querySelector("input:not([type=hidden]), select");
  if (first) first.focus();
  syncFormExpanded(id);
}

function closeFormPanel(form) {
  const panel = form ? form.closest(".form-panel") : null;
  if (panel && panel.id) toggleForm(panel.id, false);
}

function openPacchettoForm(categoria) {
  const panel = document.getElementById(CARD_FORMS.pacchetto);
  if (!panel) return;
  toggleForm(CARD_FORMS.pacchetto, true);
  const form = panel.querySelector("form");
  form.elements.namedItem("categoria").value = categoria;
  syncPacchettoForm(panel);
  const first = panel.querySelector("input:not([type=hidden]), select");
  if (first) first.focus();
}

function openAppuntamentoForm(panelId, values) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  toggleForm(panelId, true);
  const form = panel.querySelector("form");
  form.elements.namedItem("clienteId").value = String(values.clienteId || 0);
  form.elements.namedItem("pacchettoId").value = String(values.pacchettoId || 0);
  form.elements.namedItem("istruttore").value = values.istruttore || "";
  if (values.tipo) {
    const sel = form.elements.namedItem("tipo");
    if (sel && sel.tagName === "SELECT") {
      if (![...sel.options].some(o => o.value === values.tipo)) {
        const opt = document.createElement("option");
        opt.value = values.tipo;
        opt.textContent = values.tipo;
        sel.appendChild(opt);
      }
      sel.value = values.tipo;
    }
  }
  const first = panel.querySelector("input:not([type=hidden]), select");
  if (first) first.focus();
}

function handleClick(e) {
  const cancel = e.target.closest("[data-cancel]");
  if (cancel) { toggleForm(cancel.dataset.cancel, false); return; }
  const cancelReceipt = e.target.closest("[data-cancel-receipt]");
  if (cancelReceipt) {
    const f = cancelReceipt.closest("form");
    if (f) { f.hidden = true; f.reset(); }
    return;
  }
  const addAcconto = e.target.closest("[data-add-acconto]");
  if (addAcconto) { addInitialReceiptRow(addAcconto.closest(".form-panel")); return; }
  const removeAcconto = e.target.closest("[data-remove-acconto]");
  if (removeAcconto) {
    const panel = removeAcconto.closest(".form-panel");
    const row = removeAcconto.closest("[data-initial-receipt]");
    if (row) row.remove();
    refreshPacchettoForm(panel);
    return;
  }
  if (e.target.id === "btn-nuovo-cliente") { toggleForm("form-cliente", true); return; }
  if (e.target.id === "cliente-btn-nuovo-pacchetto") { openPacchettoForm("pacchetto"); return; }
  if (e.target.id === "cliente-btn-nuova-singola") { openPacchettoForm("singola"); return; }
  const action = e.target.closest("[data-action]");
  if (action) {
    const holder = action.closest("[data-id]");
    const id = holder ? Number(holder.dataset.id) : 0;
    const act = action.dataset.action;
    if (act === "segna-fatto") {
      const a = data.appuntamenti.find(x => x.id === id);
      if (a) { a.fatto = true; commit("Appuntamento segnato come fatto."); }
    } else if (act === "consuma-lezione") {
      const pk = data.pacchetti.find(x => x.id === id);
      if (pk && pk.utilizzate < pk.lezioni) {
        rememberUndo("Lezione consumata.");
        pk.utilizzate += 1;
        const rimaste = lezioniRimanenti(pk);
        if (!commit(pacchettoEsaurito(pk)
          ? "Lezione consumata: pacchetto esaurito, nessuna lezione rimasta."
          : "Lezione consumata: restano " + rimaste + " lezioni.")) {
          restoreUndoState();
          return;
        }
        offerUndo();
      }
    } else if (act === "registra-incasso") {
      const li = action.closest("[data-id]");
      const form = li ? li.querySelector("form[data-form=incasso]") : null;
      if (form) {
        form.hidden = !form.hidden;
        if (!form.hidden) {
          const date = form.elements.namedItem("data");
          if (date && !date.value) date.value = todayStr();
          const amount = form.elements.namedItem("importo");
          if (amount && !amount.value) {
            const p = data.pagamenti.find(x => x.id === id);
            if (p && !p.incassoDaVerificare) amount.value = String(saldoPagamento(p));
          }
          const first = form.querySelector("input[name=importo]");
          if (first) first.focus();
        }
      }
    } else if (act === "salda-pagamento") {
      const p = data.pagamenti.find(x => x.id === id);
      if (!p) return;
      if (p.incassoDaVerificare) { setStatus("Verifica prima l'incasso legacy: non è possibile saldare automaticamente.", true); return; }
      const saldo = saldoPagamento(p);
      if (!(saldo > 0)) return;
      if (!confirm("Registrare un incasso di " + money(saldo) + " in data odierna?")) return;
      rememberUndo("Pagamento saldato.");
      const r = addIncasso(p.id, saldo, todayStr(), "Saldo");
      if (!r || !commit("Pagamento saldato: " + money(saldo))) {
        restoreUndoState();
        return;
      }
      offerUndo();
    } else if (act === "nessun-incasso") {
      const p = data.pagamenti.find(x => x.id === id);
      if (!p) return;
      if (!confirm("Confermi che per questo pagamento legacy non è stato ricevuto alcun importo? Lo stato diventerà \"Da pagare\".")) return;
      rememberUndo("Incasso legacy azzerato.");
      p.incassoDaVerificare = false;
      p.stato = statoPagamento(p);
      if (!commit("Pagamento impostato come da pagare.")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "elimina-incasso") {
      const rid = Number(action.dataset.incassoId);
      const r = data.incassi.find(x => x.id === rid);
      if (!r) return;
      if (!confirm("Rimuovere l'incasso di " + money(r.importo) + "?")) return;
      rememberUndo("Incasso rimosso.");
      removeIncasso(rid);
      if (!commit("Incasso rimosso.")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "modifica-pagamento") {
      const p = data.pagamenti.find(x => x.id === id);
      if (p) toggleForm(CARD_FORMS.pagamento, true, p);
    } else if (act === "elimina-pagamento") {
      const p = data.pagamenti.find(x => x.id === id);
      if (!p) return;
      const n = incassiDi(p.id).length;
      const extra = n ? " e " + n + " incass" + (n === 1 ? "o" : "i") + " collegat" + (n === 1 ? "o" : "i") : "";
      if (!confirm("Eliminare il pagamento di " + clienteNome(p.clienteId) + extra + "?")) return;
      rememberUndo("Pagamento eliminato.");
      data.pagamenti = data.pagamenti.filter(x => x.id !== p.id);
      data.incassi = data.incassi.filter(i => i.pagamentoId !== p.id);
      if (!commit("Pagamento eliminato.")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "modifica-pacchetto") {
      const pk = data.pacchetti.find(x => x.id === id);
      if (pk) {
        toggleForm(CARD_FORMS.pacchetto, true, pk);
        syncPacchettoForm(document.getElementById(CARD_FORMS.pacchetto));
      }
    } else if (act === "nuova-lezione") {
      const pk = data.pacchetti.find(x => x.id === id);
      if (!pk) return;
      const count = data.appuntamenti.filter(a => a.pacchettoId === pk.id).length;
      if (count >= pk.lezioni) {
        setStatus("Hai già programmato tutte le lezioni di questo pacchetto.", true);
        return;
      }
      openAppuntamentoForm(CARD_FORMS.appuntamento, {
        clienteId: pk.clienteId,
        pacchettoId: pk.id,
        istruttore: pk.istruttore,
        tipo: pk.categoria === "singola" ? (pk.tipo || "Addestramento") : "Addestramento",
      });
    } else if (act === "elimina-pacchetto") {
      const plan = pacchettoDeletionPlan(id);
      if (!plan) return;
      const pk = plan.pacchetto;
      const label = lezioneLabel(pk);
      const contratti = plan.pagamenti.reduce((s, p) => s + p.importo, 0);
      const items = [
        { n: plan.pagamenti.length, singular: "pagamento collegato", plural: "pagamenti collegati", extra: plan.pagamenti.length ? money(contratti) : "" },
        { n: plan.incassi.length, singular: "incasso", plural: "incassi", extra: plan.incassi.length ? money(plan.incassato) : "" },
        { n: plan.appuntamentiDaEliminare.length, singular: "appuntamento non svolto", plural: "appuntamenti non svolti" },
      ];
      const msg = confirmDeletionMessage(
        "Eliminare " + label + " di " + clienteNome(pk.clienteId) +
          (pk.categoria === "pacchetto" ? " (" + pk.lezioni + " lezioni)?" : "?"),
        items, plan.warnings, ""
      );
      if (!confirm(msg)) return;
      rememberUndo(label + " eliminato.");
      deletePacchettoCascade(plan);
      if (!commit(label + " eliminato con i dati collegati.")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "assegna-orfano") {
      const tipo = action.dataset.tipo;
      const oid = Number(action.dataset.id);
      const row = action.closest(".orphan-row");
      const sel = row ? row.querySelector("select") : null;
      const clienteId = Number(sel && sel.value);
      if (!clienteId || !clienteById(clienteId)) { setStatus("Seleziona un cliente valido.", true); return; }
      const nome = clienteNome(clienteId);
      rememberUndo("Dato orfano assegnato.");
      if (tipo === "pagamento") {
        const p = data.pagamenti.find(x => x.id === oid);
        if (!p) { setStatus("Pagamento non trovato.", true); return; }
        p.clienteId = clienteId;
        if (p.pacchettoId) {
          const pk = data.pacchetti.find(x => x.id === p.pacchettoId);
          if (pk) pk.clienteId = clienteId;
        }
      } else if (tipo === "appuntamento") {
        const a = data.appuntamenti.find(x => x.id === oid);
        if (!a) { setStatus("Appuntamento non trovato.", true); return; }
        a.clienteId = clienteId;
      } else if (tipo === "pacchetto") {
        const pk = data.pacchetti.find(x => x.id === oid);
        if (!pk) { setStatus("Pacchetto non trovato.", true); return; }
        pk.clienteId = clienteId;
        const linked = data.pagamenti.find(x => x.pacchettoId === pk.id);
        if (linked) linked.clienteId = clienteId;
      } else {
        setStatus("Tipo di dato non riconosciuto.", true);
        return;
      }
      if (!commit("Dato assegnato a " + nome + ".")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "elimina-orfano") {
      const tipo = action.dataset.tipo;
      const oid = Number(action.dataset.id);
      let plan = null;
      if (tipo === "pacchetto") {
        plan = pacchettoDeletionPlan(oid);
        if (!plan) return;
        const items = [
          { n: plan.pagamenti.length, singular: "pagamento collegato", plural: "pagamenti collegati" },
          { n: plan.incassi.length, singular: "incasso", plural: "incassi", extra: plan.incassi.length ? money(plan.incassato) : "" },
          { n: plan.appuntamentiDaEliminare.length, singular: "appuntamento non svolto", plural: "appuntamenti non svolti" },
        ];
        if (!confirm(confirmDeletionMessage("Eliminare definitivamente questo pacchetto senza cliente?", items, plan.warnings, ""))) return;
      } else if (!confirm("Eliminare definitivamente questo dato senza cliente?")) {
        return;
      }
      rememberUndo("Dato orfano eliminato.");
      if (tipo === "pagamento") {
        data.pagamenti = data.pagamenti.filter(x => x.id !== oid);
        data.incassi = data.incassi.filter(i => i.pagamentoId !== oid);
      } else if (tipo === "appuntamento") {
        data.appuntamenti = data.appuntamenti.filter(x => x.id !== oid);
      } else if (tipo === "pacchetto") {
        deletePacchettoCascade(plan);
      } else {
        setStatus("Tipo di dato non riconosciuto.", true);
        return;
      }
      if (!commit("Dato orfano eliminato con i dati collegati.")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "scheda-cliente") {
      selectedClienteId = id;
      detailTriggerId = id;
      renderClienti();
      const box = document.getElementById("cliente-dettaglio");
      if (box && !box.hidden) {
        box.focus({ preventScroll: true });
        box.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (act === "vai-cliente") {
      const cid = Number(action.dataset.clienteId);
      selectedClienteId = cid;
      detailTriggerId = cid;
      goTo("clienti");
      renderClienti();
      const box = document.getElementById("cliente-dettaglio");
      if (box && !box.hidden) {
        box.focus({ preventScroll: true });
        box.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (act === "scheda-archivio") {
      selectedArchivioId = id;
      archivioTriggerId = id;
      renderArchivio();
      const box = document.getElementById("archivio-dettaglio");
      if (box && !box.hidden) {
        box.focus({ preventScroll: true });
        box.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (act === "chiudi-dettaglio") {
      closeDetailPanel("cliente-dettaglio");
    } else if (act === "chiudi-dettaglio-archivio") {
      closeDetailPanel("archivio-dettaglio");
    } else if (act === "archivia-cliente") {
      const c = clienteById(id);
      if (!c) return;
      rememberUndo("Cliente archiviato.");
      c.stato = "Archiviato";
      selectedClienteId = 0;
      detailTriggerId = 0;
      if (!commit("Cliente archiviato: " + c.nome + ". Lo trovi in Archivio.")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "riattiva-cliente") {
      const c = clienteById(id);
      if (!c) return;
      rememberUndo("Cliente riattivato.");
      c.stato = "Attivo";
      selectedArchivioId = 0;
      archivioTriggerId = 0;
      if (!commit("Cliente riattivato: " + c.nome + ". È tornato tra i clienti attivi.")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "modifica-cliente") {
      const c = clienteById(id);
      if (c) {
        if (action.closest("#archivio-list")) goTo("clienti");
        toggleForm("form-cliente", true, c);
      }
    } else if (act === "elimina-cliente") {
      const plan = clienteDeletionPlan(id);
      if (!plan) return;
      const c = plan.cliente;
      const contratti = plan.pagamenti.reduce((s, p) => s + p.importo, 0);
      const items = [
        { n: plan.pagamenti.length, singular: "pagamento", plural: "pagamenti", extra: plan.pagamenti.length ? money(contratti) : "" },
        { n: plan.incassi.length, singular: "incasso", plural: "incassi", extra: plan.incassi.length ? money(plan.incassato) : "" },
        { n: plan.appuntamenti.length, singular: "appuntamento", plural: "appuntamenti" },
        { n: plan.pacchetti.length, singular: "pacchetto", plural: "pacchetti" },
      ];
      const msg = confirmDeletionMessage(
        "Eliminare definitivamente il cliente \"" + c.nome + "\"?",
        items, plan.warnings, "Non ha dati collegati."
      );
      if (!confirm(msg)) return;
      rememberUndo("Cliente eliminato.");
      deleteClienteCascade(plan);
      const linked = plan.pagamenti.length + plan.incassi.length + plan.appuntamenti.length + plan.pacchetti.length;
      if (!commit(linked ? "Cliente e dati collegati eliminati." : "Cliente eliminato.")) {
        restoreUndoState();
        return;
      }
      offerUndo();
    } else if (act === "modifica-appuntamento") {
      const a = data.appuntamenti.find(x => x.id === id);
      if (!a) return;
      if (action.closest("#view-appuntamenti")) {
        toggleForm("form-appuntamento", true, a);
        const info = document.querySelector("[data-appuntamento-info]");
        if (info) {
          const pk = a.pacchettoId ? data.pacchetti.find(x => x.id === a.pacchettoId) : null;
          info.textContent = clienteNome(a.clienteId) + (pk ? " · " + lezioneLabel(pk) : "");
        }
      } else {
        toggleForm(CARD_FORMS.appuntamento, true, a);
      }
    } else if (act === "elimina-appuntamento") {
      const a = data.appuntamenti.find(x => x.id === id);
      if (!a) return;
      if (!confirm("Eliminare l'appuntamento del " + isoToDateLabel(a.data) + " alle " + a.ora + "?")) return;
      rememberUndo("Appuntamento eliminato.");
      data.appuntamenti = data.appuntamenti.filter(x => x.id !== id);
      if (!commit("Appuntamento eliminato.")) { restoreUndoState(); return; }
      offerUndo();
    }
    return;
  }
  if (e.target.id === "btn-csv-incassi") { exportCsvIncassi(); return; }
  if (e.target.id === "btn-csv-pagamenti") { exportCsvPagamenti(); return; }
  if (e.target.id === "btn-esporta" || e.target.id === "btn-backup-now") { exportData(); return; }
  if (e.target.id === "btn-esporta-pdf") { printReport(); return; }
  if (e.target.id === "btn-restore-snapshot") { restoreSnapshot(); return; }
  if (e.target.id === "btn-importa") {
    const fileInput = document.getElementById("file-import");
    fileInput.value = "";
    fileInput.click();
  }
}
document.addEventListener("click", handleClick);

document.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const fd = new FormData(form);

  if (kind === "cliente") {
    const id = Number(fd.get("id") || 0);
    const nome = (fd.get("nome") || "").toString().trim();
    const telefono = (fd.get("telefono") || "").toString().trim();
    const cane = (fd.get("cane") || "").toString().trim();
    const razza = (fd.get("razza") || "").toString().trim();
    const eta = (fd.get("eta") || "").toString().trim();
    const note = (fd.get("note") || "").toString().trim();
    const statoRaw = (fd.get("stato") || "Attivo").toString();
    const stato = ["Attivo", "Pausa", "Archiviato"].includes(statoRaw) ? statoRaw : "Attivo";
    if (!nome) { setStatus("Inserisci il nome del cliente.", true); return; }
    // Evita doppie registrazioni accidentali (stesso nome e cane), escluso il record in modifica.
    const dup = data.clienti.find(c => c.id !== id && c.nome.toLowerCase() === nome.toLowerCase() && c.cane.toLowerCase() === cane.toLowerCase());
    if (dup) { setStatus("Un cliente con lo stesso nome e cane è già registrato.", true); return; }
    if (id) {
      const c = clienteById(id);
      if (!c) { setStatus("Cliente non trovato.", true); return; }
      const eraArchiviato = c.stato === "Archiviato";
      rememberUndo("Cliente modificato.");
      Object.assign(c, { nome, telefono, cane, razza, eta, note, stato });
      if (stato === "Archiviato") {
        selectedClienteId = 0;
        detailTriggerId = 0;
      }
      const messaggio = !eraArchiviato && stato === "Archiviato"
        ? "Cliente archiviato: " + nome + ". Lo trovi in Archivio."
        : eraArchiviato && stato !== "Archiviato"
          ? "Cliente aggiornato e riattivato: " + nome
          : "Cliente aggiornato: " + nome;
      if (!commit(messaggio)) { restoreUndoState(); return; }
      toggleForm("form-cliente", false);
      offerUndo();
      return;
    }
    const row = { id: nextId(data.clienti), nome, telefono, cane, razza, eta, note, stato };
    data.clienti.push(row);
    if (!commit("Cliente salvato: " + nome)) {
      data.clienti = data.clienti.filter(c => c.id !== row.id);
      return;
    }
    toggleForm("form-cliente", false);
  }

  if (kind === "pagamento") {
    const id = Number(fd.get("id") || 0);
    const clienteId = Number(fd.get("clienteId"));
    const importo = Math.round(Number(fd.get("importo")) * 100) / 100;
    const data_ = (fd.get("data") || "").toString();
    const descrizione = (fd.get("descrizione") || "").toString().trim();
    const acconto = Math.round((Number(fd.get("acconto")) || 0) * 100) / 100;
    let dataIncasso = (fd.get("dataIncasso") || "").toString();
    if (!clienteId || !clienteById(clienteId)) { setStatus("Cliente non valido: riapri la scheda e riprova.", true); return; }
    if (!data_ || !(importo > 0)) { setStatus("Completa data e importo.", true); return; }
    if (!isIsoDate(data_)) { setStatus("La data del contratto non è valida.", true); return; }
    if (acconto < 0) { setStatus("L'incasso iniziale non può essere negativo.", true); return; }

    if (id) {
      const p = data.pagamenti.find(x => x.id === id);
      if (!p) { setStatus("Pagamento non trovato.", true); return; }
      const incassato = totaleIncassi(p.id);
      if (importo < incassato - 0.005) {
        setStatus("L'importo non può essere inferiore agli incassi già registrati (" + money(incassato) + ").", true);
        return;
      }
      rememberUndo("Pagamento modificato.");
      p.clienteId = clienteId;
      p.importo = importo;
      p.data = data_;
      p.descrizione = descrizione;
      if (p.pacchettoId) {
        const pk = data.pacchetti.find(x => x.id === p.pacchettoId);
        if (pk) {
          pk.prezzo = importo;
          pk.clienteId = clienteId;
        }
      }
      p.stato = statoPagamento(p);
      if (!commit("Pagamento aggiornato: " + money(importo))) { restoreUndoState(); return; }
      closeFormPanel(form);
      offerUndo();
      return;
    }

    // Evita raddoppio: stesso cliente, data e importo già presenti come "Da pagare"
    // e non associati a un pacchetto (quelli hanno pacchettoId > 0).
    const dup = data.pagamenti.find(p => p.clienteId === clienteId && p.data === data_ && p.importo === importo && p.stato === "Da pagare" && !p.pacchettoId);
    if (dup) { setStatus("Un pagamento con gli stessi importo e data è già registrato per questo cliente.", true); return; }
    if (acconto > importo) { setStatus("L'incasso iniziale non può superare l'importo del contratto.", true); return; }
    if (acconto > 0 && !dataIncasso) dataIncasso = data_;
    if (acconto > 0 && !isIsoDate(dataIncasso)) { setStatus("La data dell'incasso iniziale non è valida.", true); return; }
    const row = {
      id: nextId(data.pagamenti), clienteId, importo, data: data_,
      stato: "Da pagare", descrizione, pacchettoId: 0, incassoDaVerificare: false,
    };
    data.pagamenti.push(row);
    if (acconto > 0) addIncasso(row.id, acconto, dataIncasso, "Incasso iniziale");
    row.stato = statoPagamento(row);
    if (!commit("Pagamento salvato: " + money(importo))) {
      data.pagamenti = data.pagamenti.filter(p => p.id !== row.id);
      data.incassi = data.incassi.filter(i => i.pagamentoId !== row.id);
      return;
    }
    closeFormPanel(form);
  }

  if (kind === "pacchetto") {
    const id = Number(fd.get("id") || 0);
    const clienteId = Number(fd.get("clienteId"));
    const categoria = fd.get("categoria") === "singola" ? "singola" : "pacchetto";
    const tipo = (fd.get("tipo") || "").toString().trim().slice(0, 60);
    let lezioni = Number(fd.get("lezioni"));
    if (categoria === "singola") lezioni = 1;
    const prezzo = Math.round(Number(fd.get("prezzo")) * 100) / 100;
    const data_ = todayStr();
    const panel = form.closest(".form-panel");
    if (!clienteId || !clienteById(clienteId)) { setStatus("Cliente non valido: riapri la scheda e riprova.", true); return; }
    if (!Number.isInteger(lezioni) || lezioni < 1) { setStatus("Il numero di lezioni deve essere almeno 1.", true); return; }
    if (!(prezzo >= 0)) { setStatus("Il prezzo non può essere negativo.", true); return; }
    if (categoria === "pacchetto" && !(prezzo > 0)) { setStatus("Il prezzo deve essere maggiore di 0.", true); return; }

    if (id) {
      const pk = data.pacchetti.find(x => x.id === id);
      if (!pk) { setStatus("Pacchetto non trovato.", true); return; }
      if (lezioni < pk.utilizzate) {
        setStatus("Le lezioni non possono essere inferiori a quelle già consumate (" + pk.utilizzate + ").", true);
        return;
      }
      const linked = data.pagamenti.find(x => x.pacchettoId === pk.id);
      const incassato = linked ? totaleIncassi(linked.id) : 0;
      if (prezzo < incassato - 0.005) {
        setStatus("Il prezzo non può essere inferiore agli incassi già registrati (" + money(incassato) + ").", true);
        return;
      }
      rememberUndo("Pacchetto modificato.");
      pk.clienteId = clienteId;
      pk.tipo = tipo;
      pk.lezioni = categoria === "singola" ? 1 : lezioni;
      pk.prezzo = prezzo;
      if (prezzo === 0) {
        if (linked && incassato === 0) {
          data.pagamenti = data.pagamenti.filter(p => p.id !== linked.id);
          data.incassi = data.incassi.filter(i => i.pagamentoId !== linked.id);
        }
      } else if (linked) {
        linked.clienteId = clienteId;
        linked.importo = prezzo;
        linked.descrizione = lezioneDescrizione(pk);
        linked.stato = statoPagamento(linked);
      } else {
        // Dato legacy o incompleto: ricrea il pagamento collegato mancante.
        data.pagamenti.push({
          id: nextId(data.pagamenti),
          clienteId,
          importo: prezzo,
          data: pk.data || data_,
          stato: "Da pagare",
          descrizione: lezioneDescrizione(pk),
          pacchettoId: pk.id,
          incassoDaVerificare: false,
        });
      }
      if (!commit((categoria === "singola" ? "Lezione aggiornata: " : "Pacchetto aggiornato: ") +
          lezioneLabel(pk) + " per " + clienteNome(clienteId))) {
        restoreUndoState();
        return;
      }
      closeFormPanel(form);
      offerUndo();
      return;
    }

    const receipts = readInitialReceipts(panel);
    let acconti = 0;
    for (const r of receipts) {
      if (!(r.importo > 0)) { setStatus("L'importo di ogni acconto deve essere maggiore di 0.", true); return; }
      if (!isIsoDate(r.data)) { setStatus("Inserisci una data valida per ogni acconto.", true); return; }
      acconti += r.importo;
    }
    acconti = Math.round(acconti * 100) / 100;
    if (acconti > prezzo + 0.005) { setStatus("Gli acconti non possono superare il prezzo totale.", true); return; }

    const scheduleRows = readScheduleRows(panel).filter(r => r.data || r.ora);
    if (scheduleRows.length > lezioni) {
      setStatus("Hai inserito più date del numero di lezioni.", true);
      return;
    }
    const seen = new Set();
    for (let i = 0; i < scheduleRows.length; i++) {
      const row = scheduleRows[i];
      if (!isIsoDate(row.data) || !isTime(row.ora)) {
        setStatus("Completa data e ora della lezione " + (i + 1) + ".", true);
        return;
      }
      const key = row.data + " " + row.ora;
      if (seen.has(key)) {
        setStatus("Ci sono due lezioni alla stessa data e ora.", true);
        return;
      }
      seen.add(key);
      const conflict = data.appuntamenti.find(a => a.data === row.data && a.ora === row.ora);
      if (conflict) {
        setStatus("Data occupata: " + isoToDateLabel(row.data) + " alle " + row.ora +
          " (" + clienteNome(conflict.clienteId) + "). Scegli un'altra data o ora.", true);
        return;
      }
    }

    const tipoKey = v => {
      const t = (v || "").trim();
      return t.toLowerCase() === "pacchetto" ? "" : t.toLowerCase();
    };
    const dup = data.pacchetti.find(p => p.clienteId === clienteId && p.data === data_ &&
      p.categoria === categoria && p.lezioni === lezioni && tipoKey(p.tipo) === tipoKey(tipo));
    if (dup) { setStatus("Un elemento con le stesse lezioni, data e tipo è già registrato per questo cliente.", true); return; }

    const defaultInstructor = scheduleRows.find(r => r.istruttore)?.istruttore || "";
    const nuovoPacchetto = {
      id: nextId(data.pacchetti), clienteId, categoria, tipo, istruttore: defaultInstructor,
      lezioni: categoria === "singola" ? 1 : lezioni, utilizzate: 0, prezzo, data: data_,
    };
    const nuovoPagamento = prezzo > 0 ? {
      id: nextId(data.pagamenti),
      clienteId,
      importo: prezzo,
      data: data_,
      stato: "Da pagare",
      descrizione: lezioneDescrizione(nuovoPacchetto),
      pacchettoId: nuovoPacchetto.id,
      incassoDaVerificare: false,
    } : null;
    rememberUndo(categoria === "singola" ? "Lezione venduta." : "Pacchetto venduto.");
    data.pacchetti.push(nuovoPacchetto);
    if (nuovoPagamento) data.pagamenti.push(nuovoPagamento);
    if (nuovoPagamento) {
      receipts.forEach((r, i) => {
        addIncasso(nuovoPagamento.id, r.importo, r.data, r.nota || ("Acconto " + (i + 1)));
      });
      nuovoPagamento.stato = statoPagamento(nuovoPagamento);
    }
    const newAppointments = [];
    if (scheduleRows.length) {
      let nextAppId = nextId(data.appuntamenti);
      const defaultTipo = categoria === "singola" ? (tipo || "Addestramento") : "Addestramento";
      for (const row of scheduleRows) {
        const app = {
          id: nextAppId++,
          clienteId,
          data: row.data,
          ora: row.ora,
          tipo: defaultTipo,
          istruttore: row.istruttore || defaultInstructor,
          pacchettoId: nuovoPacchetto.id,
          fatto: false,
        };
        newAppointments.push(app);
        data.appuntamenti.push(app);
      }
    }
    const saldo = Math.max(0, Math.round((prezzo - acconti) * 100) / 100);
    const saldoMsg = prezzo > 0 ? " · saldo " + money(saldo) : "";
    const appMsg = newAppointments.length ? " · " + newAppointments.length + " appuntamenti creati" : "";
    if (!commit(lezioneLabel(nuovoPacchetto) + " salvato: " +
        (categoria === "singola" ? "" : lezioni + " lezioni, ") +
        "acconti " + money(acconti) + " per " + clienteNome(clienteId) + saldoMsg + appMsg)) {
      restoreUndoState();
      return;
    }
    closeFormPanel(form);
    offerUndo();
  }

  if (kind === "appuntamento") {
    const id = Number(fd.get("id") || 0);
    const clienteId = Number(fd.get("clienteId"));
    const pacchettoId = Number(fd.get("pacchettoId") || 0);
    const data_ = (fd.get("data") || "").toString();
    const ora = (fd.get("ora") || "").toString();
    const tipo = (fd.get("tipo") || "").toString();
    const istruttore = (fd.get("istruttore") || "").toString().trim().slice(0, 60);
    if (!clienteId || !data_ || !ora || !tipo) { setStatus("Completa tutti i campi della lezione.", true); return; }
    if (!clienteId || !clienteById(clienteId)) { setStatus("Cliente non valido: riapri la scheda e riprova.", true); return; }
    if (!isIsoDate(data_) || !isTime(ora)) { setStatus("Data o ora non valide.", true); return; }
    let linked = null;
    if (pacchettoId) {
      linked = data.pacchetti.find(pk => pk.id === pacchettoId);
      if (!linked || linked.clienteId !== clienteId) {
        setStatus("Pacchetto o lezione non valido per questo cliente.", true);
        return;
      }
    }
    if (!id && linked) {
      const count = data.appuntamenti.filter(a => a.pacchettoId === linked.id).length;
      if (count >= linked.lezioni) {
        setStatus("Hai già programmato tutte le lezioni di questo pacchetto.", true);
        return;
      }
    }
    const dup = data.appuntamenti.find(a => a.id !== id && a.clienteId === clienteId && a.data === data_ && a.ora === ora);
    if (dup) { setStatus("Questo cliente ha già una lezione in questa data e ora.", true); return; }
    const conflict = data.appuntamenti.find(a => a.id !== id && a.data === data_ && a.ora === ora);
    if (conflict) { setStatus("Hai già una lezione in questa data e ora con " + clienteNome(conflict.clienteId) + ".", true); return; }
    if (id) {
      const a = data.appuntamenti.find(x => x.id === id);
      if (!a) { setStatus("Lezione non trovata.", true); return; }
      rememberUndo("Lezione modificata.");
      Object.assign(a, { clienteId, pacchettoId, data: data_, ora, tipo, istruttore });
      if (!commit("Lezione aggiornata per " + clienteNome(clienteId))) {
        restoreUndoState();
        return;
      }
      closeFormPanel(form);
      offerUndo();
      return;
    }
    const row = {
      id: nextId(data.appuntamenti), clienteId, pacchettoId,
      data: data_, ora, tipo, istruttore, fatto: false,
    };
    data.appuntamenti.push(row);
    if (!commit("Lezione salvata per " + clienteNome(clienteId))) {
      data.appuntamenti = data.appuntamenti.filter(a => a.id !== row.id);
      return;
    }
    closeFormPanel(form);
  }

  if (kind === "incasso") {
    const pagamentoId = Number(fd.get("pagamentoId"));
    const importo = Math.round(Number(fd.get("importo")) * 100) / 100;
    const data_ = (fd.get("data") || "").toString();
    const nota = (fd.get("nota") || "").toString().trim();
    const p = data.pagamenti.find(x => x.id === pagamentoId);
    if (!p) { setStatus("Pagamento non trovato.", true); return; }
    if (!(importo > 0) || !isFinite(importo)) { setStatus("Inserisci un importo valido.", true); return; }
    if (!isIsoDate(data_)) { setStatus("Inserisci una data incasso valida.", true); return; }
    const max = p.incassoDaVerificare ? p.importo : saldoPagamento(p);
    if (importo > max + 0.005) {
      setStatus("L'importo supera il saldo disponibile (" + money(max) + ").", true);
      return;
    }
    const r = addIncasso(p.id, importo, data_, nota);
    if (!r) { setStatus("Impossibile registrare l'incasso.", true); return; }
    if (!commit("Incasso registrato: " + money(importo) + " · saldo " + money(saldoPagamento(p)))) {
      data.incassi = data.incassi.filter(i => i.id !== r.id);
      ricalcolaStatiPagamenti();
      refresh();
      return;
    }
    form.hidden = true;
  }
});

/* ===== Esporta / Importa dati ===== */
function readMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY));
    return m && typeof m === "object" ? m : {};
  } catch (e) {
    return {};
  }
}

function writeMeta(patch) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
  } catch (e) { /* metadati non essenziali */ }
}

function renderBackupInfo() {
  const el = document.getElementById("backup-last");
  if (!el) return;
  const meta = readMeta();
  const last = meta.lastExportAt ? new Date(meta.lastExportAt).toLocaleString("it-IT") : "mai";
  el.textContent = "Ultimo export: " + last + " · Snapshot automatico a ogni modifica.";
}

function exportData() {
  try {
    const payload = JSON.stringify({
      schemaVersion: 4,
      exportedAt: new Date().toISOString(),
      clienti: data.clienti,
      pagamenti: data.pagamenti,
      incassi: data.incassi || [],
      appuntamenti: data.appuntamenti,
      pacchetti: data.pacchetti,
    }, null, 2);
    const ts = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
    const filename = "cinofilo-dati-" + ts + ".json";
    downloadText(filename, payload, "application/json");
    writeMeta({ lastExportAt: new Date().toISOString() });
    renderBackupInfo();
    setStatus("Dati esportati in " + filename);
  } catch (err) {
    setStatus("Esportazione fallita: " + err.message, true);
  }
}

function importData(file) {
  const reader = new FileReader();
  reader.onerror = () => setStatus("Impossibile leggere il file.", true);
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); }
    catch (e) { setStatus("File non valido: contenuto non in formato JSON.", true); return; }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setStatus("File non valido: manca la struttura dati.", true); return;
    }
    const normalized = normalizeData(parsed);
    const warnings = getNormalizeWarnings();
    const nC = normalized.clienti.length;
    const nPg = normalized.pagamenti.length;
    const nAp = normalized.appuntamenti.length;
    const nPk = normalized.pacchetti.length;
    const nInc = normalized.incassi ? normalized.incassi.length : 0;
    if (!nC && !nPg && !nAp && !nPk && !nInc) {
      setStatus("File vuoto: nessun dato da importare.", true); return;
    }
    // Avviso esplicito prima di sovrascrivere.
    // Permette al test automatizzato di saltare il prompt (window.__confirmNext).
    const righe = [
      nC + " clienti",
      nPg + " pagamenti",
      nInc + " incassi",
      nAp + " appuntamenti",
      nPk + " pacchetti",
    ];
    let msg = "Importando verranno sostituiti i dati attuali.\n\n"
      + "Dati nel file: " + righe.join(", ") + ".\n\n";
    if (warnings.length) {
      const max = warnings.slice(0, 6).join("\n");
      msg += "Attenzione, alcuni dati sono stati corretti o esclusi:\n" + max
        + (warnings.length > 6 ? "\n… e altri " + (warnings.length - 6) + " avvisi." : "")
        + "\n\n";
    }
    msg += "Continuare?";
    const doImport = (typeof window.__confirmNext === "boolean") ? window.__confirmNext : confirm(msg);
    delete window.__confirmNext;
    if (!doImport) { setStatus("Importazione annullata.", false); return; }
    const previous = data;
    try {
      writeSnapshot(localStorage.getItem(STORAGE_KEY), "pre-import");
    } catch (e) { /* snapshot opzionale */ }
    data = normalized;
    window.__appData = data;
    skipSnapshotOnce = true;
    if (!saveData()) {
      data = previous;
      window.__appData = data;
      refresh();
      return;
    }
    refresh();
    setStatus("Dati importati: " + righe.join(", ") + (warnings.length ? " · " + warnings.length + " avvisi" : "") + ".");
  };
  reader.readAsText(file, "utf-8");
}

document.addEventListener("change", (e) => {
  if (e.target.id === "file-import") {
    const file = e.target.files && e.target.files[0];
    if (file) importData(file);
  }
});

/* ===== Avvio ===== */
refresh();
// Solo replaceState: nessuna push in avvio, anche se l'hash iniziale è già valido.
(function startup() {
  let initial = hashView();
  if (LEGACY_VIEWS[initial]) initial = LEGACY_VIEWS[initial];
  if (!KNOWN_VIEWS.includes(initial)) initial = "home";
  showView(initial);
  history.replaceState({ view: initial }, "", "#" + initial);
})();
initBanner();
