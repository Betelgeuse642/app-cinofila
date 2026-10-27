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
    fatto: a.fatto === true,
  };
}

function normalizePacchetto(p) {
  if (!p || !validId(p.id)) { warn("pacchetti: riga senza id valido ignorata"); return null; }
  let lezioni = Number.isInteger(p.lezioni) && p.lezioni >= 0 ? p.lezioni : 0;
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
    showBanner("Nessun dato registrato. Aggiungi il primo cliente dalla sezione Clienti.", [
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
  clienti: "Clienti · Addestramento Cinofilo",
  archivio: "Archivio · Addestramento Cinofilo",
  pagamenti: "Pagamenti · Addestramento Cinofilo",
  appuntamenti: "Appuntamenti · Addestramento Cinofilo",
  pacchetti: "Pacchetti · Addestramento Cinofilo",
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
  "filtro-clienti": renderClienti,
  "filtro-clienti-stato": renderClienti,
  "filtro-archivio": renderArchivio,
  "filtro-pagamenti": renderPagamenti,
  "filtro-pagamenti-stato": renderPagamenti,
  "filtro-appuntamenti": renderAppuntamenti,
  "filtro-appuntamenti-stato": renderAppuntamenti,
  "filtro-appuntamenti-periodo": renderAppuntamenti,
  "filtro-pacchetti": renderPacchetti,
  "filtro-pacchetti-stato": renderPacchetti,
};
function onFilterChange(e) {
  const fn = FILTER_RENDERERS[e.target.id];
  if (fn) fn();
}
document.addEventListener("input", onFilterChange);
document.addEventListener("change", onFilterChange);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const receipt = document.querySelector(".receipt-form:not([hidden])");
  if (receipt) {
    const li = receipt.closest("li");
    receipt.hidden = true;
    receipt.reset();
    const trigger = li ? li.querySelector("[data-action='registra-incasso']") : null;
    if (trigger) trigger.focus();
    return;
  }
  const openForm = [...document.querySelectorAll(".form-panel")].find(p => !p.hidden);
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

/* Viste ammissibili; tutte le transizioni attraversano goTo(). */
const KNOWN_VIEWS = ["home", "clienti", "archivio", "pagamenti", "appuntamenti", "pacchetti", "resoconto"];

function goTo(view) {
  // Convalida il nome della vista: se sconosciuta, torna alla vista iniziale.
  if (!KNOWN_VIEWS.includes(view)) view = "home";
  showView(view);
  const target = "#" + view;
  if (location.hash === target) {
    // URL già corretto: allinea solo lo stato, senza nuove entrature di back/forward.
    if (!history.state || history.state.view !== view) history.replaceState({ view }, "", target);
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

function filterValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function matchesText(query, ...fields) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  return fields.some(f => String(f == null ? "" : f).toLowerCase().includes(q));
}

function addDaysIso(iso, days) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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
  const warnings = [];
  if (!pagamenti.length) {
    warnings.push("Nessun pagamento collegato a questo pacchetto.");
  }
  if (pagamenti.length > 1) {
    warnings.push("Sono presenti " + pagamenti.length + " pagamenti collegati allo stesso pacchetto: verranno eliminati tutti.");
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
  return { pacchetto: pk, pagamenti, incassi, warnings, saldo, incassato };
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
  data.pacchetti = data.pacchetti.filter(pk => pk.id !== id);
  data.pagamenti = data.pagamenti.filter(p => !pagamentoIds.has(p.id));
  data.incassi = data.incassi.filter(i => !pagamentoIds.has(i.pagamentoId));
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

function renderClienteDettaglioInto(boxId, clienteId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const c = clienteById(clienteId);
  if (!c) {
    if (boxId === "archivio-dettaglio") selectedArchivioId = 0;
    else selectedClienteId = 0;
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  const closeAction = boxId === "archivio-dettaglio" ? "chiudi-dettaglio-archivio" : "chiudi-dettaglio";
  box.innerHTML = `
    <div class="detail-panel__head">
      <h3 id="${boxId}-title" data-detail-title></h3>
      <button type="button" class="btn-small" data-action="${closeAction}">Chiudi</button>
    </div>
    <div class="detail-panel__meta" data-detail-meta></div>
    <div class="detail-panel__totals" data-detail-totals></div>
    <h4>Pagamenti</h4><div data-detail-pagamenti></div>
    <h4>Appuntamenti</h4><div data-detail-appuntamenti></div>
    <h4>Pacchetti</h4><div data-detail-pacchetti></div>`;
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
    detailRow(appBox, isoToDateLabel(a.data) + " · " + a.ora + " · " + a.tipo, a.fatto ? "Fatto" : "Da fare");
  }

  const pkBox = box.querySelector("[data-detail-pacchetti]");
  if (!links.pacchetti.length) pkBox.textContent = "Nessun pacchetto.";
  for (const pk of links.pacchetti) {
    detailRow(pkBox,
      pk.lezioni + " lezioni · " + money(pk.prezzo) + " · acquisto " + (pk.data ? isoToDateLabel(pk.data) : "—"),
      "Utilizzate: " + pk.utilizzate + " · rimaste: " + Math.max(0, pk.lezioni - pk.utilizzate));
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

function renderClienti() {
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
        <button type="button" class="btn-small" data-action="rinomina-cliente">Rinomina</button>
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
  renderClienteDettaglio();
  renderOrfani();
}

function renderArchivio() {
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
  renderArchivioDettaglio();
  const count = document.getElementById("archivio-count");
  if (count) {
    count.textContent = String(archiviati.length);
    count.hidden = archiviati.length === 0;
  }
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

function renderPagamenti() {
  const ul = document.getElementById("pagamenti-list");
  ul.innerHTML = "";
  const query = filterValue("filtro-pagamenti");
  const statoFiltro = filterValue("filtro-pagamenti-stato");
  const rows = [...data.pagamenti].filter(p => {
    if (statoFiltro && p.stato !== statoFiltro) return false;
    return matchesText(query, clienteNome(p.clienteId), p.descrizione, p.importo,
      money(p.importo), p.data, isoToDateLabel(p.data), p.stato);
  }).sort((a, b) => {
    const ka = a.data + String(a.id).padStart(6, "0");
    const kb = b.data + String(b.id).padStart(6, "0");
    return ka < kb ? 1 : -1; // data decrescente, poi id decrescente
  });
  for (const p of rows) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.id = p.id;
    const badge = statoBadge(p);
    const inc = totaleIncassi(p.id);
    const saldo = saldoPagamento(p);
    const receipts = incassiDi(p.id).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    li.innerHTML = `
      <div class="list-item__head">
        <span class="list-item__title"></span>
        <span class="badge ${badge.cls}"></span>
      </div>
      <div class="list-item__meta" data-money></div>
      <div class="list-item__meta" data-date></div>
      ${p.incassoDaVerificare ? '<div class="list-item__note">Incasso legacy non registrato: inserisci l\'importo effettivamente ricevuto.</div>' : ""}
      <div class="list-item__receipts" data-receipts></div>
      <div class="list-item__actions">
        ${(saldo > 0 || p.incassoDaVerificare) ? '<button type="button" class="btn-small" data-action="registra-incasso">Registra incasso</button>' : ""}
        ${(saldo > 0 && !p.incassoDaVerificare) ? '<button type="button" class="btn-small" data-action="salda-pagamento">Segna saldato</button>' : ""}
        ${p.incassoDaVerificare ? '<button type="button" class="btn-small" data-action="nessun-incasso">Nessun incasso</button>' : ""}
        <button type="button" class="btn-small" data-action="modifica-pagamento">Modifica</button>
        <button type="button" class="btn-small btn-small--danger" data-action="elimina-pagamento">Elimina</button>
      </div>
      <form class="receipt-form" data-form="incasso" aria-label="Registra incasso" hidden>
        <input type="hidden" name="pagamentoId" value="${p.id}" />
        <label><span>Importo incassato (€)</span>
          <input type="number" name="importo" min="0.01" step="0.01" max="${p.incassoDaVerificare ? p.importo : saldo}" required />
        </label>
        <label><span>Data incasso</span><input type="date" name="data" required /></label>
        <label><span>Nota (opzionale)</span><input type="text" name="nota" autocomplete="off" /></label>
        <div class="form-actions">
          <button type="submit" class="btn-action btn-primary">Salva incasso</button>
          <button type="button" class="btn-action" data-cancel-receipt>Annulla</button>
        </div>
      </form>`;
    li.querySelector(".list-item__title").textContent = clienteNome(p.clienteId);
    li.querySelector(".badge").textContent = badge.txt;
    const moneyLine = p.incassoDaVerificare
      ? "Contratto: " + money(p.importo) + "  ·  Incassato: da verificare  ·  Saldo contrattuale: " + money(saldo)
      : "Contratto: " + money(p.importo) + "  ·  Incassato: " + money(inc) + "  ·  Saldo: " + money(saldo);
    li.querySelector("[data-money]").textContent = moneyLine + (p.descrizione ? "  ·  " + p.descrizione : "");
    li.querySelector("[data-date]").textContent = "Data contratto: " + (p.data ? isoToDateLabel(p.data) : "non valida");
    const recBox = li.querySelector("[data-receipts]");
    for (const r of receipts) {
      const row = document.createElement("div");
      row.className = "receipt-row";
      row.innerHTML = `<span class="receipt-row__text"></span><button type="button" class="btn-small btn-small--danger" data-action="elimina-incasso" data-incasso-id="${r.id}">Rimuovi</button>`;
      row.querySelector(".receipt-row__text").textContent =
        (r.data ? isoToDateLabel(r.data) : "Data non valida") + " · " + money(r.importo) + (r.nota ? " · " + r.nota : "");
      recBox.appendChild(row);
    }
    ul.appendChild(li);
  }
  if (!ul.children.length) {
    const li = document.createElement("li");
    li.className = "list-empty";
    li.textContent = data.pagamenti.length ? "Nessun pagamento corrisponde ai filtri." : "Nessun pagamento registrato.";
    ul.appendChild(li);
  }
  // Aggiorna il select nei form (pagamento + appuntamento)
  fillClienteSelects();
}

/* ===== Render appuntamenti ===== */
function renderAppuntamenti() {
  const ul = document.getElementById("appuntamenti-list");
  ul.innerHTML = "";
  const query = filterValue("filtro-appuntamenti");
  const statoFiltro = filterValue("filtro-appuntamenti-stato");
  const periodo = filterValue("filtro-appuntamenti-periodo");
  const today = todayStr();
  const end = addDaysIso(today, 6);
  const rows = [...data.appuntamenti].filter(a => {
    if (statoFiltro === "fatti" && !a.fatto) return false;
    if (statoFiltro === "da-fare" && a.fatto) return false;
    if (periodo === "oggi" && a.data !== today) return false;
    if (periodo === "7" && (a.data < today || a.data > end)) return false;
    if (periodo === "passati" && a.data >= today) return false;
    return matchesText(query, clienteNome(a.clienteId), a.tipo, a.data, isoToDateLabel(a.data), a.ora);
  }).sort((a, b) => {
    const ka = a.data + a.ora + String(a.id);
    const kb = b.data + b.ora + String(b.id);
    return ka < kb ? -1 : 1;
  });
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
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.id = a.id;
    const badge = a.fatto ? "badge--ok" : "badge--neutral";
    const badgeTxt = a.fatto ? "Fatto" : a.tipo;
    li.innerHTML = `
      <div class="list-item__head">
        <span class="list-item__title"></span>
        <span class="badge ${badge}"></span>
      </div>
      <div class="list-item__meta"></div>
      <div class="list-item__actions">
        ${!a.fatto ? '<button type="button" class="btn-small" data-action="segna-fatto">Segna come fatto</button>' : ""}
        <button type="button" class="btn-small" data-action="modifica-appuntamento">Modifica</button>
        <button type="button" class="btn-small btn-small--danger" data-action="elimina-appuntamento">Elimina</button>
      </div>`;
    li.querySelector(".list-item__title").textContent = (a.data ? isoToDateLabel(a.data) : "Data non valida") + " · " + a.ora;
    li.querySelector(".badge").textContent = badgeTxt;
    li.querySelector(".list-item__meta").textContent = "Cliente: " + clienteNome(a.clienteId);
    ul.appendChild(li);
  }
  if (!ul.children.length) {
    const li = document.createElement("li");
    li.className = "list-empty";
    li.textContent = data.appuntamenti.length ? "Nessun appuntamento corrisponde ai filtri." : "Nessun appuntamento registrato.";
    ul.appendChild(li);
  }
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

/* ===== Render pacchetti ===== */
function renderPacchetti() {
  const ul = document.getElementById("pacchetti-list");
  ul.innerHTML = "";
  const query = filterValue("filtro-pacchetti");
  const statoFiltro = filterValue("filtro-pacchetti-stato");
  const rows = [...data.pacchetti].filter(pk => {
    const esaurito = pacchettoEsaurito(pk);
    if (statoFiltro === "attivi" && esaurito) return false;
    if (statoFiltro === "esauriti" && !esaurito) return false;
    const c = clienteById(pk.clienteId);
    return matchesText(query, clienteNome(pk.clienteId), c ? c.cane : "", pk.prezzo, money(pk.prezzo),
      pk.lezioni, pk.utilizzate, pk.data, isoToDateLabel(pk.data));
  }).sort((a, b) => {
    const ka = a.data + String(a.id).padStart(6, "0");
    const kb = b.data + String(b.id).padStart(6, "0");
    return ka < kb ? 1 : -1; // data decrescente, poi id decrescente
  });
  for (const pk of rows) {
    const c = clienteById(pk.clienteId);
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.id = pk.id;
    const esaurito = pacchettoEsaurito(pk);
    const badge = esaurito ? "badge--neutral" : "badge--ok";
    const badgeTxt = esaurito ? "Esaurito" : "Attivo";
    const linked = data.pagamenti.find(p => p.pacchettoId === pk.id);
    const inc = linked ? totaleIncassi(linked.id) : 0;
    const saldo = linked ? saldoPagamento(linked) : 0;
    li.innerHTML = `
      <div class="list-item__head">
        <span class="list-item__title"></span>
        <span class="badge ${badge}">${badgeTxt}</span>
      </div>
      <div class="list-item__meta"></div>
      <div class="list-item__meta"></div>
      <div class="list-item__actions">
        ${esaurito ? "" : '<button type="button" class="btn-small" data-action="consuma-lezione">Consuma lezione</button>'}
        ${linked && saldo > 0 ? '<button type="button" class="btn-small" data-action="incasso-pacchetto" data-pagamento-id="' + linked.id + '">Registra incasso</button>' : ""}
        <button type="button" class="btn-small" data-action="modifica-pacchetto">Modifica</button>
        <button type="button" class="btn-small btn-small--danger" data-action="elimina-pacchetto">Elimina</button>
      </div>`;
    li.querySelector(".list-item__title").textContent = clienteNome(pk.clienteId);
    const cane = c ? (c.cane || "—") : "—";
    const rimaste = lezioniRimanenti(pk);
    const metas = li.querySelectorAll(".list-item__meta");
    metas[0].textContent = "Cane: " + cane + "  ·  Lezioni: " + pk.lezioni + "  ·  Rimaste: " + rimaste;
    metas[1].textContent = "Prezzo: " + money(pk.prezzo)
      + (linked ? "  ·  Incassato: " + money(inc) + "  ·  Saldo: " + money(saldo) : "  ·  Nessun pagamento collegato")
      + "  ·  Data: " + isoToDateLabel(pk.data);
    ul.appendChild(li);
  }
  if (!ul.children.length) {
    const li = document.createElement("li");
    li.className = "list-empty";
    li.textContent = data.pacchetti.length ? "Nessun pacchetto corrisponde ai filtri." : "Nessun pacchetto registrato.";
    ul.appendChild(li);
  }
}

function refresh() {
  renderClienti();
  renderArchivio();
  renderPagamenti();
  renderAppuntamenti();
  renderPacchetti();
  renderResoconto();
  renderBackupInfo();
}

/* ===== Select cliente (nei form) ===== */
function fillClienteSelects() {
  const selects = document.querySelectorAll("select[name=clienteId]");
  // Il form dei pagamenti mostra tutti; quello degli appuntamenti usa la scelta corrente del pagamento
  for (const sel of selects) {
    const form = sel.closest("form");
    const keep = form.dataset.keepId;
    sel.innerHTML = "";
    for (const c of [...data.clienti].sort((a, b) => a.nome.localeCompare(b.nome, "it"))) {
      const opt = document.createElement("option");
      opt.value = String(c.id);
      opt.textContent = c.nome;
      sel.appendChild(opt);
    }
    if (keep && clienteById(Number(keep))) sel.value = keep;
  }
}

/* ===== Gestione form ===== */
let lastFormTrigger = null;

function syncFormExpanded(id) {
  const btn = document.querySelector('[aria-controls="' + id + '"]');
  const panel = document.getElementById(id);
  if (btn && panel) btn.setAttribute("aria-expanded", String(!panel.hidden));
}

function toggleForm(id, show, record) {
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.hidden = !show;
  const f = panel.querySelector("form");
  if (!show) {
    if (f) f.reset();
    syncFormExpanded(id);
    if (lastFormTrigger && document.contains(lastFormTrigger)) {
      lastFormTrigger.focus();
    } else if (f) {
      const fallback = document.getElementById("btn-nuovo-" + f.dataset.form);
      if (fallback) fallback.focus();
    }
    return;
  }
  lastFormTrigger = document.activeElement;
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
    const names = { cliente: "cliente", pagamento: "pagamento", appuntamento: "appuntamento", pacchetto: "pacchetto" };
    title.textContent = (record ? "Modifica " : "Nuovo ") + names[kind];
  }
  const receiptFields = panel.querySelector("[data-receipt-fields]");
  if (receiptFields) receiptFields.hidden = !!record;
  f.dataset.keepId = record && record.clienteId ? String(record.clienteId) : "";
  fillClienteSelects();
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
  for (const name of ["data", "dataIncasso"]) {
    const el = f.elements.namedItem(name);
    if (el && !el.value && !record) el.value = todayStr();
  }
  const first = panel.querySelector("input:not([type=hidden]), select");
  if (first) first.focus();
  syncFormExpanded(id);
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
  if (e.target.id === "btn-nuovo-cliente") { toggleForm("form-cliente", true); return; }
  if (e.target.id === "btn-nuovo-pagamento") { toggleForm("form-pagamento", true); return; }
  if (e.target.id === "btn-nuovo-appuntamento") { toggleForm("form-appuntamento", true); return; }
  if (e.target.id === "btn-nuovo-pacchetto") { toggleForm("form-pacchetto", true); return; }
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
      if (p) toggleForm("form-pagamento", true, p);
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
      if (pk) toggleForm("form-pacchetto", true, pk);
    } else if (act === "elimina-pacchetto") {
      const plan = pacchettoDeletionPlan(id);
      if (!plan) return;
      const pk = plan.pacchetto;
      const contratti = plan.pagamenti.reduce((s, p) => s + p.importo, 0);
      const items = [
        { n: plan.pagamenti.length, singular: "pagamento collegato", plural: "pagamenti collegati", extra: plan.pagamenti.length ? money(contratti) : "" },
        { n: plan.incassi.length, singular: "incasso", plural: "incassi", extra: plan.incassi.length ? money(plan.incassato) : "" },
      ];
      const msg = confirmDeletionMessage(
        "Eliminare il pacchetto di " + clienteNome(pk.clienteId) + " (" + pk.lezioni + " lezioni)?",
        items, plan.warnings, ""
      );
      if (!confirm(msg)) return;
      rememberUndo("Pacchetto eliminato.");
      deletePacchettoCascade(plan);
      if (!commit("Pacchetto eliminato con i dati collegati.")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "incasso-pacchetto") {
      const pid = Number(action.dataset.pagamentoId);
      goTo("pagamenti");
      const btn = document.querySelector("#pagamenti-list li[data-id='" + pid + "'] [data-action=registra-incasso]");
      if (btn) btn.click();
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
      if (!commit("Cliente riattivato: " + c.nome + ". È tornato in Clienti.")) { restoreUndoState(); return; }
      offerUndo();
    } else if (act === "modifica-cliente") {
      const c = clienteById(id);
      if (c) {
        if (action.closest("#archivio-list")) goTo("clienti");
        toggleForm("form-cliente", true, c);
      }
    } else if (act === "rinomina-cliente") {
      const c = clienteById(id);
      if (c) {
        const n = prompt("Nuovo nome del cliente:", c.nome);
        if (n === null) return;
        const nome = n.trim();
        if (!nome) { setStatus("Nome non valido.", true); return; }
        const d = prompt("Cane (razza):", c.cane || "");
        if (d === null) return;
        rememberUndo("Cliente rinominato.");
        c.nome = nome;
        c.cane = d.trim();
        if (!commit("Cliente rinominato.")) { restoreUndoState(); return; }
        offerUndo();
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
      if (a) toggleForm("form-appuntamento", true, a);
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
    if (!clienteId || !data_ || !(importo > 0)) { setStatus("Completa cliente, data e importo.", true); return; }
    if (!isIsoDate(data_)) { setStatus("La data del contratto non è valida.", true); return; }
    if (acconto < 0) { setStatus("L'incasso iniziale non può essere negativo.", true); return; }
    if (!clienteById(clienteId)) { setStatus("Seleziona un cliente valido.", true); return; }

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
      toggleForm("form-pagamento", false);
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
    toggleForm("form-pagamento", false);
  }

  if (kind === "pacchetto") {
    const id = Number(fd.get("id") || 0);
    const clienteId = Number(fd.get("clienteId"));
    const lezioni = Number(fd.get("lezioni"));
    const prezzo = Math.round(Number(fd.get("prezzo")) * 100) / 100;
    const accontoRaw = Number(fd.get("acconto")) || 0;
    const acconto = Math.round(accontoRaw * 100) / 100;
    const data_ = (fd.get("data") || "").toString();
    let dataIncasso = (fd.get("dataIncasso") || "").toString();
    if (!clienteId || !clienteById(clienteId)) { setStatus("Seleziona un cliente valido.", true); return; }
    if (!Number.isInteger(lezioni) || lezioni < 1) { setStatus("Il numero di lezioni deve essere almeno 1.", true); return; }
    if (!(prezzo > 0)) { setStatus("Il prezzo deve essere maggiore di 0.", true); return; }
    if (acconto < 0) { setStatus("L'acconto non può essere negativo.", true); return; }
    if (!isIsoDate(data_)) { setStatus("Inserisci una data di acquisto valida.", true); return; }

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
      pk.lezioni = lezioni;
      pk.prezzo = prezzo;
      pk.data = data_;
      if (linked) {
        linked.clienteId = clienteId;
        linked.importo = prezzo;
        linked.data = data_;
        linked.descrizione = "Pacchetto " + lezioni + " lezioni";
        linked.stato = statoPagamento(linked);
      } else {
        // Dato legacy o incompleto: ricrea il pagamento collegato mancante.
        data.pagamenti.push({
          id: nextId(data.pagamenti),
          clienteId,
          importo: prezzo,
          data: data_,
          stato: "Da pagare",
          descrizione: "Pacchetto " + lezioni + " lezioni",
          pacchettoId: pk.id,
          incassoDaVerificare: false,
        });
      }
      if (!commit("Pacchetto aggiornato: " + lezioni + " lezioni per " + clienteNome(clienteId))) {
        restoreUndoState();
        return;
      }
      toggleForm("form-pacchetto", false);
      offerUndo();
      return;
    }

    if (acconto > prezzo) { setStatus("L'acconto non può superare il prezzo totale.", true); return; }
    if (acconto > 0 && !dataIncasso) dataIncasso = data_;
    if (acconto > 0 && !isIsoDate(dataIncasso)) { setStatus("La data dell'acconto non è valida.", true); return; }
    // Evita raddoppio: stesso cliente, stessa data e stesso numero di lezioni.
    const dup = data.pacchetti.find(p => p.clienteId === clienteId && p.data === data_ && p.lezioni === lezioni);
    if (dup) { setStatus("Un pacchetto con le stesse lezioni e data è già registrato per questo cliente.", true); return; }
    const nuovoPacchetto = { id: nextId(data.pacchetti), clienteId, lezioni, utilizzate: 0, prezzo, data: data_ };
    const nuovoPagamento = {
      id: nextId(data.pagamenti),
      clienteId,
      importo: prezzo,
      data: data_,
      stato: "Da pagare",
      descrizione: "Pacchetto " + lezioni + " lezioni",
      pacchettoId: nuovoPacchetto.id,
      incassoDaVerificare: false,
    };
    data.pacchetti.push(nuovoPacchetto);
    data.pagamenti.push(nuovoPagamento);
    if (acconto > 0) addIncasso(nuovoPagamento.id, acconto, dataIncasso, "Acconto pacchetto");
    nuovoPagamento.stato = statoPagamento(nuovoPagamento);
    const saldoMsg = acconto > 0 ? " · saldo " + money(prezzo - acconto) : "";
    if (!commit("Pacchetto salvato: " + lezioni + " lezioni per " + clienteNome(clienteId) + saldoMsg)) {
      data.pacchetti = data.pacchetti.filter(x => x.id !== nuovoPacchetto.id);
      data.pagamenti = data.pagamenti.filter(x => x.id !== nuovoPagamento.id);
      data.incassi = data.incassi.filter(i => i.pagamentoId !== nuovoPagamento.id);
      return;
    }
    toggleForm("form-pacchetto", false);
  }

  if (kind === "appuntamento") {
    const id = Number(fd.get("id") || 0);
    const clienteId = Number(fd.get("clienteId"));
    const data_ = (fd.get("data") || "").toString();
    const ora = (fd.get("ora") || "").toString();
    const tipo = (fd.get("tipo") || "").toString();
    if (!clienteId || !data_ || !ora || !tipo) { setStatus("Completa tutti i campi dell'appuntamento.", true); return; }
    if (!clienteById(clienteId)) { setStatus("Seleziona un cliente valido.", true); return; }
    if (!isIsoDate(data_) || !isTime(ora)) { setStatus("Data o ora non valide.", true); return; }
    const dup = data.appuntamenti.find(a => a.id !== id && a.clienteId === clienteId && a.data === data_ && a.ora === ora);
    if (dup) { setStatus("Questo cliente ha già un appuntamento in questa data e ora.", true); return; }
    const conflict = data.appuntamenti.find(a => a.id !== id && a.data === data_ && a.ora === ora);
    if (conflict) { setStatus("Hai già un appuntamento in questa data e ora con " + clienteNome(conflict.clienteId) + ".", true); return; }
    if (id) {
      const a = data.appuntamenti.find(x => x.id === id);
      if (!a) { setStatus("Appuntamento non trovato.", true); return; }
      rememberUndo("Appuntamento modificato.");
      Object.assign(a, { clienteId, data: data_, ora, tipo });
      if (!commit("Appuntamento aggiornato per " + clienteNome(clienteId))) {
        restoreUndoState();
        return;
      }
      toggleForm("form-appuntamento", false);
      offerUndo();
      return;
    }
    const row = { id: nextId(data.appuntamenti), clienteId, data: data_, ora, tipo, fatto: false };
    data.appuntamenti.push(row);
    if (!commit("Appuntamento salvato per " + clienteNome(clienteId))) {
      data.appuntamenti = data.appuntamenti.filter(a => a.id !== row.id);
      return;
    }
    toggleForm("form-appuntamento", false);
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
      schemaVersion: 2,
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
  if (!KNOWN_VIEWS.includes(initial)) initial = "home";
  showView(initial);
  history.replaceState({ view: initial }, "", "#" + initial);
})();
initBanner();
