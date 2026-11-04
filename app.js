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

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

/* Cani del cliente: il vecchio singolo cane viene migrato nel primo elemento. */
function normalizeCaniCliente(c) {
  const source = Array.isArray(c.cani) ? c.cani : [];
  const out = [];
  const seen = new Set();
  let next = 1;
  for (const raw of source) {
    if (!raw || typeof raw !== "object") continue;
    const nome = str(raw.nome, 120) || str(raw.cane, 120);
    const razza = str(raw.razza, 80);
    const eta = str(raw.eta, 20);
    if (!nome && !razza && !eta) continue;
    let id = validId(raw.id) ? raw.id : 0;
    if (!id || seen.has(id)) {
      while (seen.has(next)) next++;
      id = next;
    }
    seen.add(id);
    next = Math.max(next, id + 1);
    out.push({ id, nome, razza, eta });
  }
  if (!out.length && (c.cane || c.razza || c.eta)) {
    out.push({ id: 1, nome: str(c.cane, 120), razza: str(c.razza, 80), eta: str(c.eta, 20) });
  }
  return out;
}

/* Converte un record in forma normalizzata; restituisce null se non valido. */
function normalizeClienti(c) {
  if (!c || !validId(c.id)) { warn("clienti: riga senza id valido ignorata"); return null; }
  const stato = c.stato === "Pausa" || c.stato === "Archiviato" ? c.stato : "Attivo";
  const cani = normalizeCaniCliente(c);
  const primary = cani[0] || { nome: "", razza: "", eta: "" };
  return {
    id: c.id,
    nome: str(c.nome, 120),
    telefono: str(c.telefono, 40),
    email: str(c.email, 120),
    cane: primary.nome,
    razza: primary.razza,
    eta: primary.eta,
    note: str(c.note, 2000),
    stato,
    cani,
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
  const esito = ["completata", "assente", "annullata"].includes(a.esito)
    ? a.esito
    : (a.fatto === true ? "completata" : "");
  return {
    id: a.id,
    clienteId: typeof a.clienteId === "number" ? a.clienteId : 0,
    caneId: typeof a.caneId === "number" && Number.isInteger(a.caneId) && a.caneId > 0 ? a.caneId : 0,
    data,
    ora,
    tipo: str(a.tipo, 60) || "Addestramento",
    istruttore: str(a.istruttore, 60),
    pacchettoId: typeof a.pacchettoId === "number" && Number.isInteger(a.pacchettoId) && a.pacchettoId > 0 ? a.pacchettoId : 0,
    esito,
    note: str(a.note, 500),
    fatto: esito === "completata",
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
    consumiManuali: Number.isInteger(p.consumiManuali) && p.consumiManuali >= 0 ? p.consumiManuali : null,
  };
}

/* Lezioni rimanenti e stato sono derivati, non salvati: evita duplicazioni di stato. */
function lezioniRimanenti(pk) {
  return Math.max(pk.lezioni - pk.utilizzate, 0);
}

function pacchettoEsaurito(pk) {
  return pk.utilizzate >= pk.lezioni;
}

/* Le assenze e gli annullamenti non occupano un posto del pacchetto. */
function lezioniProgrammate(pk) {
  return data.appuntamenti.filter(a => a.pacchettoId === pk.id
    && a.esito !== "assente" && a.esito !== "annullata").length;
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
  let appPkOrfani = 0;
  for (const a of appuntamenti) if (a.pacchettoId && !pacchettiIds.has(a.pacchettoId)) { a.pacchettoId = 0; appPkOrfani++; }
  if (appPkOrfani) warn(appPkOrfani + " appuntamenti collegati a pacchetti inesistenti sono stati convertiti in lezioni singole");

  // Migrazione alla scheda a due sezioni: appuntamenti e pagamenti senza
  // pacchetto diventano lezioni singole, senza inventare importi o date.
  let migrateSingole = 0;
  for (const a of appuntamenti) {
    if (a.clienteId && !a.pacchettoId) {
      const pk = {
        id: nextId(pacchetti), clienteId: a.clienteId, categoria: "singola",
        tipo: a.tipo, istruttore: a.istruttore, lezioni: 1,
        utilizzate: a.fatto ? 1 : 0, prezzo: 0, data: a.data,
        consumiManuali: 0,
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
        consumiManuali: 0,
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
  // Collega ogni lezione a un cane esistente del cliente.
  for (const a of appuntamenti) {
    const c = clienti.find(x => x.id === a.clienteId);
    if (!c || !c.cani.length) { a.caneId = 0; continue; }
    if (!a.caneId || !c.cani.some(d => d.id === a.caneId)) a.caneId = c.cani[0].id;
  }
  // Consumi: le lezioni completate sono la fonte principale; consumiManuali
  // conserva eventuali utilizzate storiche senza appuntamento.
  for (const pk of pacchetti) {
    const completate = appuntamenti.filter(a => a.pacchettoId === pk.id && a.esito === "completata").length;
    if (pk.consumiManuali === null) pk.consumiManuali = Math.max(0, pk.utilizzate - completate);
    pk.consumiManuali = Math.min(pk.consumiManuali, pk.lezioni);
    pk.utilizzate = Math.min(pk.lezioni, completate + pk.consumiManuali);
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
// Consumo automatico delle lezioni già scadute (solo aumento, mai decremento).
const consumedOnLoad = autoConsumeLezioni();
// Esposto per test: consente ai test Playwright di re-idratre i dati da
// localStorage (data.__testSet = <oggetto>) e re-renderizzare senza ricarica.
window.__appData = data;
if (consumedOnLoad && !storageBlocked && !storageCorrupt) saveData();

/* ===== Helper ===== */
function clienteById(id) {
  return data.clienti.find(c => c.id === id);
}

function clienteNome(id) {
  const c = clienteById(id);
  return c ? c.nome : "Sconosciuto";
}

function caneById(c, caneId) {
  if (!c || !Array.isArray(c.cani)) return null;
  return c.cani.find(d => d.id === caneId) || null;
}

function canePrimario(c) {
  return c && Array.isArray(c.cani) && c.cani.length ? c.cani[0] : null;
}

function caneNome(a) {
  const c = a ? clienteById(a.clienteId) : null;
  const d = c ? caneById(c, a.caneId) : null;
  return d ? (d.nome || "Cane") : (c && c.cane ? c.cane : "—");
}

function esitoLabel(a) {
  if (!a) return "Da svolgere";
  if (a.esito === "completata") return "Completata";
  if (a.esito === "assente") return "Assente";
  if (a.esito === "annullata") return "Annullata";
  return "Da svolgere";
}

function esitoBadge(a) {
  if (a && a.esito === "completata") return { cls: "badge--ok", txt: "Completata" };
  if (a && a.esito === "assente") return { cls: "badge--warn", txt: "Assente" };
  if (a && a.esito === "annullata") return { cls: "badge--neutral", txt: "Annullata" };
  return { cls: "badge--neutral", txt: "Da svolgere" };
}

function iniziali(nome) {
  const parts = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
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
  autoConsumeLezioni();
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
  home: "Gestione Cinofila",
  oggi: "Oggi · Gestione Cinofila",
  clienti: "Clienti · Gestione Cinofila",
  pagamenti: "Pagamenti · Gestione Cinofila",
  report: "Report · Gestione Cinofila",
  archivio: "Archivio · Gestione Cinofila",
};
const VIEW_ELEMENTS = {
  home: "home",
  oggi: "appuntamenti",
  clienti: "clienti",
  pagamenti: "pagamenti",
  report: "resoconto",
  archivio: "archivio",
};

function updateAppNav(id) {
  const activeId = id === "oggi" ? "home" : id;
  for (const item of document.querySelectorAll(".app-nav__item")) {
    const active = item.dataset.navId === activeId;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
}

function showView(id) {
  const element = VIEW_ELEMENTS[id] || id;
  const target = "view-" + element;
  for (const v of views) {
    v.classList.toggle("is-hidden", v.id !== target);
  }
  document.title = VIEW_TITLES[id] || VIEW_TITLES.home;
  updateAppNav(id);
  window.scrollTo(0, 0);
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-nav]");
  if (link) {
    e.preventDefault();
    goTo(link.dataset.nav);
    return;
  }
  const periodTab = e.target.closest("[data-report-period]");
  if (periodTab) {
    reportPeriodMode = periodTab.dataset.reportPeriod;
    for (const tab of document.querySelectorAll("[data-report-period]")) {
      tab.classList.toggle("is-active", tab === periodTab);
    }
    fillPeriodSelect();
    renderResoconto();
  }
});

const FILTER_RENDERERS = {
  // I filtri aggiornano solo la lista: non ridisegnano la scheda aperta,
  // così i form in compilazione non perdono i valori.
  "filtro-clienti": () => renderClienti(true),
  "filtro-clienti-stato": () => renderClienti(true),
  "filtro-archivio": () => renderArchivio(true),
  "filtro-archivio-lezioni": renderArchivioLezioni,
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

// Normalizza le date digitate in gg/mm/aaaa quando il campo perde il focus.
document.addEventListener("focusout", (e) => {
  const el = e.target;
  if (!el || !el.matches || !el.matches("input[data-date-input]")) return;
  const iso = parseDateInput(el.value);
  if (iso) el.value = isoToDateLabel(iso);
});

const datePickerHelper = document.getElementById("date-picker-helper");
if (datePickerHelper) {
  datePickerHelper.addEventListener("change", () => {
    const target = datePickerHelper._target;
    datePickerHelper._target = null;
    if (!target || !isIsoDate(datePickerHelper.value)) return;
    target.value = isoToDateLabel(datePickerHelper.value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    const current = target.id ? document.getElementById(target.id) : target;
    if (current) current.focus();
  });
}

document.addEventListener("change", (e) => {
  if (e.target.matches('#form-appuntamento select[name="clienteId"]')) {
    const form = e.target.closest("form");
    fillAppuntamentoCani(form, e.target.value, 0);
    fillAppuntamentoPacchetti(form, e.target.value, 0);
  }
  if (e.target.matches('#form-pagamento-globale select[name="clienteId"]')) {
    const form = e.target.closest("form");
    const pay = form.elements.namedItem("pagamentoId");
    const contratti = data.pagamenti.filter(p => p.clienteId === Number(e.target.value)
      && (p.incassoDaVerificare || saldoPagamento(p) > 0));
    fillSelect(pay, contratti.map(p => ({
      value: p.id,
      label: (p.descrizione || "Contratto") + " · saldo " + money(saldoPagamento(p)),
    })), contratti[0] ? contratti[0].id : "", contratti.length ? "" : "Nessun contratto aperto");
    const amount = form.elements.namedItem("importo");
    if (amount) amount.value = contratti[0] ? String(saldoPagamento(contratti[0])) : "";
  }
  if (e.target.matches('#form-pagamento-globale select[name="pagamentoId"]')) {
    const form = e.target.closest("form");
    const p = data.pagamenti.find(x => x.id === Number(e.target.value));
    const amount = form.elements.namedItem("importo");
    if (p && amount) amount.value = String(saldoPagamento(p));
  }
});

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
const KNOWN_VIEWS = ["home", "oggi", "clienti", "pagamenti", "report", "archivio"];
const LEGACY_VIEWS = { appuntamenti: "oggi", resoconto: "report", pacchetti: "clienti" };

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
  const parts = String(iso || "").split("-");
  if (parts.length !== 3) return String(iso || "");
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function todayInput() {
  return isoToDateLabel(todayStr());
}

function parseDateInput(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (isIsoDate(s)) return s;
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (!m) return "";
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const month = Number(m[2]);
  const day = Number(m[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return "";
  return String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
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
let selectedCaneId = 0;
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
  const appuntamentiDaEliminare = appuntamenti.filter(a => !a.esito);
  const appuntamentiSvolti = appuntamenti.filter(a => a.esito);
  const warnings = [];
  if (!pagamenti.length) {
    warnings.push("Nessun pagamento collegato a questo pacchetto.");
  }
  if (pagamenti.length > 1) {
    warnings.push("Sono presenti " + pagamenti.length + " pagamenti collegati allo stesso pacchetto: verranno eliminati tutti.");
  }
  if (appuntamentiSvolti.length) {
    warnings.push(countLabel(appuntamentiSvolti.length, "lezione registrata resterà", "lezioni registrate resteranno")
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
    if (a.pacchettoId === id) {
      // Conserva l'attribuzione all'istruttore anche nello storico senza pacchetto.
      if (!a.istruttore && plan.pacchetto.istruttore) a.istruttore = plan.pacchetto.istruttore;
      a.pacchettoId = 0;
    }
  }
}

function deletePacchettoById(id) {
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

const DATE_INPUT_ATTRS = 'type="text" inputmode="numeric" placeholder="gg/mm/aaaa" maxlength="10" autocomplete="off" data-date-input';
const CALENDAR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18"></path></svg>';

function dateFieldHtml(attrs) {
  return `<span class="date-field"><input ${DATE_INPUT_ATTRS} ${attrs} /><button type="button" class="date-picker-btn" data-date-picker aria-label="Apri calendario">${CALENDAR_ICON}</button></span>`;
}

function openDatePicker(btn) {
  const field = btn.closest(".date-field");
  const target = field ? field.querySelector("input[data-date-input]") : null;
  const picker = document.getElementById("date-picker-helper");
  if (!target || !picker) return;
  const iso = parseDateInput(target.value);
  // Campo vuoto: nessuna data preselezionata, così anche "oggi" genera un cambio.
  picker.value = iso || "";
  picker._target = target;
  const r = target.getBoundingClientRect();
  picker.style.left = Math.max(0, r.left) + "px";
  picker.style.top = Math.max(0, r.top) + "px";
  picker.style.width = Math.max(1, r.width) + "px";
  picker.style.height = Math.max(1, r.height) + "px";
  if (typeof picker.showPicker === "function") {
    try { picker.showPicker(); } catch (e) { picker.focus(); picker.click(); }
  } else {
    picker.focus();
    picker.click();
  }
}

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
          ${dateFieldHtml('name="data" required')}
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
            ${dateFieldHtml('name="dataIncasso"')}
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
          <span>Cane</span>
          <select name="caneId"></select>
        </label>
        <label>
          <span>Data</span>
          ${dateFieldHtml('name="data" required')}
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
        <div class="esito-options" role="radiogroup" aria-label="Esito della lezione">
          <label><input type="radio" name="esito" value="" checked /><span>Da svolgere</span></label>
          <label><input type="radio" name="esito" value="completata" /><span>Lezione completata</span></label>
          <label><input type="radio" name="esito" value="assente" /><span>Cliente assente</span></label>
          <label><input type="radio" name="esito" value="annullata" /><span>Lezione annullata</span></label>
        </div>
        <label>
          <span>Note (facoltative)</span>
          <textarea name="note" rows="2" autocomplete="off"></textarea>
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
          <button type="button" class="btn-action btn-danger" data-delete-pacchetto hidden>Elimina</button>
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
  const deleteBtn = panel.querySelector("[data-delete-pacchetto]");
  if (deleteBtn) deleteBtn.hidden = !id;
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
    const dateText = row.querySelector('[data-field="data"]').value;
    const date = parseDateInput(dateText);
    const time = row.querySelector('[data-field="ora"]').value;
    const status = row.querySelector("[data-row-status]");
    row.classList.remove("is-conflict", "is-incomplete", "is-filled");
    if (!dateText && !time) {
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
  row.className = "dynamic-row dynamic-row--schedule";
  row.dataset.scheduleRow = "";
  row.innerHTML = `
    <label class="dynamic-row__field dynamic-row__field--data"><span>Data</span>
      ${dateFieldHtml('data-field="data"')}
    </label>
    <label class="dynamic-row__field dynamic-row__field--ora"><span>Ora</span>
      <input type="time" data-field="ora" />
    </label>
    <label class="dynamic-row__field dynamic-row__field--istruttore"><span>Istruttore</span>
      <input type="text" list="istruttori-suggeriti" data-field="istruttore" />
    </label>
    <span class="dynamic-row__status" data-row-status></span>`;
  const rawDate = (values && values.data) || "";
  row.querySelector('[data-field="data"]').value = isIsoDate(rawDate) ? isoToDateLabel(rawDate) : rawDate;
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
    data: parseDateInput(row.querySelector('[data-field="data"]').value),
    ora: row.querySelector('[data-field="ora"]').value,
    istruttore: row.querySelector('[data-field="istruttore"]').value.trim(),
  })).filter(r => r.data || r.ora);
}

function statoPagamentoLabel(p) {
  const stato = statoPagamento(p);
  if (stato === "Parziale") return "Parzialmente pagato";
  if (stato === "Da verificare") return "Da verificare";
  if (stato === "Pagato") return "Pagato";
  return "Da pagare";
}

function nextLezioneLabel(apps) {
  if (!apps.length) return "";
  const now = new Date();
  const sorted = [...apps].sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora));
  const next = sorted.find(a => {
    const when = new Date(a.data + "T" + a.ora + ":00");
    return !isNaN(when.getTime()) && when >= now;
  });
  const a = next || sorted[sorted.length - 1];
  return a ? isoToDateLabel(a.data) + (a.ora ? " · " + a.ora : "") : "";
}

function renderPaymentBlock(block, pk) {
  block.innerHTML = "";
  block.removeAttribute("data-id");
  const linked = data.pagamenti.find(p => p.pacchettoId === pk.id);
  if (!linked) {
    block.innerHTML = `<div class="list-empty">Nessun pagamento collegato.</div>
      <div class="lezione-block__actions">
        <button type="button" class="btn-small" data-action="modifica-pacchetto">Aggiungi pagamento</button>
      </div>`;
    return;
  }
  if (linked.clienteId !== pk.clienteId) {
    block.innerHTML = `<div class="list-empty">Pagamento collegato a un altro cliente.</div>`;
    return;
  }
  block.dataset.id = linked.id;
  const badge = statoBadge(linked);
  const inc = totaleIncassi(linked.id);
  const saldo = saldoPagamento(linked);
  const receipts = incassiDi(linked.id).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  block.innerHTML = `
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
      <label><span>Data incasso</span>${dateFieldHtml('name="data" required')}</label>
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
      <button type="button" class="btn-tiny btn-tiny--danger" data-action="elimina-incasso" data-incasso-id="${r.id}">Rimuovi</button>`;
    row.querySelector(".receipt-row__text").textContent =
      (r.data ? isoToDateLabel(r.data) : "Data non valida") + " · " + money(r.importo) +
      (r.nota ? " · " + r.nota : "");
    recBox.appendChild(row);
  }
}

function renderCalendarBlock(block, pk) {
  const apps = data.appuntamenti.filter(a => a.pacchettoId === pk.id)
    .sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora) || a.id - b.id);
  const canAdd = lezioniProgrammate(pk) < pk.lezioni;
  block.innerHTML = `<div class="date-list" data-calendar-rows></div>
    <div class="lezione-block__actions">
      ${canAdd ? `<button type="button" class="btn-small" data-action="nuova-lezione" data-pacchetto-id="${pk.id}">+ Aggiungi lezione</button>` : ""}
    </div>`;
  const list = block.querySelector("[data-calendar-rows]");
  if (!apps.length) {
    list.appendChild(emptyState("Nessuna data."));
    return;
  }
  for (const a of apps) {
    const row = document.createElement("div");
    row.className = "calendar-row calendar-row--compact";
    row.dataset.id = a.id;
    row.innerHTML = `
      <div class="calendar-row__info">
        <strong class="calendar-row__date"></strong>
        <span class="calendar-row__meta"></span>
      </div>
      <div class="calendar-row__actions">
        <button type="button" class="btn-tiny" data-action="modifica-appuntamento">Modifica</button>
        <button type="button" class="btn-tiny btn-tiny--danger" data-action="elimina-appuntamento">Elimina</button>
      </div>`;
    row.querySelector(".calendar-row__date").textContent =
      (a.data ? isoToDateLabel(a.data) : "Data non valida") + " · " + a.ora;
    row.querySelector(".calendar-row__meta").textContent =
      caneNome(a) + " · " + (a.istruttore || pk.istruttore || "—") + " · " + a.tipo + " · " + esitoLabel(a);
    list.appendChild(row);
  }
}

function lezioneGroup(pk) {
  const group = document.createElement("div");
  group.className = "lezione-group";
  group.dataset.id = pk.id;
  group.dataset.categoria = pk.categoria;
  const linked = data.pagamenti.find(p => p.pacchettoId === pk.id);
  const ownLinked = linked && linked.clienteId === pk.clienteId ? linked : null;
  const apps = data.appuntamenti.filter(a => a.pacchettoId === pk.id);
  const payLabel = ownLinked ? statoPagamentoLabel(ownLinked) : "Senza pagamento";
  const dateLabel = nextLezioneLabel(apps);
  const metaParts = ["Lezioni " + pk.utilizzate + "/" + lezioniRimanenti(pk), payLabel];
  if (dateLabel) metaParts.push(dateLabel);
  group.innerHTML = `
    <div class="lezione-row">
      <div class="lezione-row__top">
        <strong class="lezione-row__title"></strong>
        <div class="lezione-row__actions">
          <button type="button" class="btn-small" data-action="modifica-pacchetto">Modifica/Elimina</button>
          <button type="button" class="btn-small" data-action="toggle-pagamento" aria-expanded="false">Pagamento</button>
        </div>
      </div>
      <div class="lezione-row__meta" data-meta></div>
    </div>
    <div class="lezione-payment lezione-block--payments" hidden></div>
    <div class="lezione-dates lezione-block--calendar"></div>`;
  group.querySelector(".lezione-row__title").textContent = lezioneLabel(pk);
  group.querySelector("[data-meta]").textContent = metaParts.join(" · ");
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
      isoToDateLabel(a.data) + " · " + a.ora + " · " + caneNome(a) + " · " + a.tipo +
        (a.istruttore ? " · " + a.istruttore : "") +
        (pk ? " · " + lezioneLabel(pk) : ""),
      esitoLabel(a) + (a.note ? " · " + a.note : ""));
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
  if (box.dataset.clienteId !== String(clienteId)) selectedCaneId = 0;
  box.dataset.clienteId = String(clienteId);
  if (selectedCaneId && !(c.cani || []).some(d => d.id === selectedCaneId)) selectedCaneId = 0;
  const closeAction = boxId === "archivio-dettaglio" ? "chiudi-dettaglio-archivio" : "chiudi-dettaglio";
  const cani = Array.isArray(c.cani) ? c.cani : [];
  const links = clientLinks(c.id);
  const contratti = links.pagamenti.reduce((s, p) => s + p.importo, 0);
  const incassato = links.pagamenti.reduce((s, p) => s + totaleIncassi(p.id), 0);
  const saldo = links.pagamenti.reduce((s, p) => s + saldoPagamento(p), 0);
  const daVerificare = links.pagamenti.filter(p => p.incassoDaVerificare).length;
  const completate = links.appuntamenti.filter(a => a.esito === "completata").length;
  const rimanenti = links.pacchetti.reduce((s, pk) => s + Math.max(0, pk.lezioni - pk.utilizzate), 0);
  const caneCards = cani.map(d => {
    const lezioni = links.appuntamenti.filter(a => a.caneId === d.id).length;
    return `<article class="cane-card">
      <div class="cane-card__main">
        <strong>${escapeHtml(d.nome || "Cane")}</strong>
        <span>${escapeHtml([d.razza, d.eta ? d.eta + " anni" : ""].filter(Boolean).join(" · ") || "Dati facoltativi")}</span>
        <small>${countLabel(lezioni, "lezione", "lezioni")}</small>
      </div>
      <div class="cane-card__actions">
        <button type="button" class="btn-tiny" data-action="scheda-cane" data-cane-id="${d.id}">Scheda</button>
        <button type="button" class="btn-tiny" data-action="modifica-cane" data-cane-id="${d.id}">Modifica</button>
      </div>
    </article>`;
  }).join("");
  box.innerHTML = `
    <div class="client-detail__head">
      <span class="avatar avatar--large" aria-hidden="true">${escapeHtml(iniziali(c.nome))}</span>
      <div class="client-detail__identity">
        <h3 id="${boxId}-title" data-detail-title></h3>
        <p class="client-detail__contact" data-detail-meta></p>
      </div>
      <button type="button" class="btn-small" data-action="${closeAction}">Chiudi</button>
    </div>
    <div class="detail-panel__totals" data-detail-totals></div>
    ${boxId === "archivio-dettaglio" ? "" : `<section class="client-dogs" aria-label="Cani del cliente">
      <div class="section-subhead"><h4>Cani</h4><button type="button" class="btn-action btn-small" data-action="nuovo-cane">+ Aggiungi cane</button></div>
      <div class="cane-grid">${caneCards || '<p class="empty-inline">Nessun cane registrato.</p>'}</div>
      <div id="form-cliente-cane" class="form-panel" hidden>
        <h5 data-form-title>Cane</h5>
        <form data-form="cane">
          <input type="hidden" name="clienteId" value="${c.id}" />
          <input type="hidden" name="caneId" />
          <label><span>Nome</span><input type="text" name="nome" required autocomplete="off" /></label>
          <label><span>Razza (facoltativa)</span><input type="text" name="razza" autocomplete="off" /></label>
          <label><span>Età (facoltativa)</span><input type="text" name="eta" autocomplete="off" /></label>
          <div class="form-actions">
            <button type="submit" class="btn-action btn-primary">Salva cane</button>
            <button type="button" class="btn-action" data-cancel="form-cliente-cane">Annulla</button>
          </div>
        </form>
      </div>
      <div id="cliente-cane-dettaglio" class="cane-detail" hidden></div>
    </section>
    <div class="client-actions">
      <button type="button" class="action-btn action-btn--blue" data-action="nuova-lezione-cliente">Nuova lezione</button>
      <button type="button" class="action-btn action-btn--green" data-action="registra-pagamento-cliente">Registra pagamento</button>
      <button type="button" class="action-btn action-btn--grey" data-action="toggle-storico-cliente">Storico</button>
    </div>
    <div id="cliente-storico-panel" class="client-history" hidden></div>
    <details id="cliente-attivita" class="client-activity" open>
      <summary>Pacchetti, lezioni e pagamenti</summary>
      <div data-attivita-body></div>
    </details>`}`;
  box.querySelector("[data-detail-title]").textContent = c.nome;
  const meta = [];
  if (c.telefono) meta.push("Tel: " + c.telefono);
  if (c.email) meta.push(c.email);
  if (cani.length) meta.push((cani.length === 1 ? "Cane: " : "Cani: ") + cani.map(d => d.nome).filter(Boolean).join(", "));
  meta.push("Stato: " + (c.stato || "Attivo"));
  box.querySelector("[data-detail-meta]").textContent = meta.join(" · ");
  box.querySelector("[data-detail-totals]").textContent =
    "Contratti: " + money(contratti) + " · Pacchetti: " + links.pacchetti.length + " · Lezioni completate: " + completate
    + " · Lezioni rimaste: " + rimanenti + " · Incassato: " + money(incassato)
    + " · Saldo: " + money(saldo)
    + (daVerificare ? " · Da verificare: " + daVerificare : "");

  if (boxId === "archivio-dettaglio") renderClienteStorico(box, links);
  else {
    const activityBody = box.querySelector("[data-attivita-body]");
    renderClienteGestione(activityBody || box, c);
    restoreOpenCardForms(box, formSnapshot);
    renderCaneDettaglio(box, c);
  }
}

function renderCaneDettaglio(box, c) {
  const el = box ? box.querySelector("#cliente-cane-dettaglio") : null;
  if (!el) return;
  const dog = caneById(c, selectedCaneId);
  if (!dog) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const apps = data.appuntamenti.filter(a => a.clienteId === c.id && a.caneId === dog.id)
    .sort((a, b) => (b.data + b.ora).localeCompare(a.data + a.ora) || b.id - a.id);
  const completate = apps.filter(a => a.esito === "completata").length;
  el.hidden = false;
  el.innerHTML = `
    <div class="section-subhead">
      <h4>${escapeHtml(dog.nome || "Cane")}</h4>
      <button type="button" class="btn-tiny" data-action="chiudi-cane">Chiudi</button>
    </div>
    <p class="cane-detail__meta">${escapeHtml([dog.razza, dog.eta ? dog.eta + " anni" : ""].filter(Boolean).join(" · ") || "Dati facoltativi")}</p>
    <p class="cane-detail__stats">${countLabel(apps.length, "lezione", "lezioni")} · ${completate} completate</p>
    <div class="cane-detail__list">${apps.length ? apps.map(a => {
      const pk = a.pacchettoId ? data.pacchetti.find(x => x.id === a.pacchettoId) : null;
      return `<div class="cane-lesson-row">
        <span>${a.data ? isoToDateLabel(a.data) : "Data non valida"} · ${escapeHtml(a.ora || "—")}</span>
        <strong>${escapeHtml(a.tipo || "Lezione")}</strong>
        <span class="badge ${esitoBadge(a).cls}">${esitoBadge(a).txt}</span>
        <small>${escapeHtml(pk ? lezioneLabel(pk) : "Senza lezione")}</small>
      </div>`;
    }).join("") : '<p class="empty-inline">Nessuna lezione per questo cane.</p>'}</div>`;
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
  const cani = Array.isArray(c.cani) ? c.cani : [];
  const links = clientLinks(c.id);
  const rimanenti = links.pacchetti.reduce((sum, pk) => sum + lezioniRimanenti(pk), 0);
  const saldo = links.pagamenti.reduce((sum, p) => sum + saldoPagamento(p), 0);
  const avatar = li.querySelector(".avatar");
  if (avatar) avatar.textContent = iniziali(c.nome);
  li.querySelector(".list-item__title").textContent = c.nome;
  li.querySelector(".badge").textContent = c.stato || "Attivo";
  const contacts = [];
  if (c.telefono) contacts.push(c.telefono);
  if (c.email) contacts.push(c.email);
  li.querySelector(".list-item__meta").textContent =
    (contacts.join(" · ") || "Nessun contatto") + " · " +
    (cani.length ? cani.map(d => d.nome).join(", ") : "Nessun cane");
  const parts = [countLabel(cani.length, "cane", "cani")];
  parts.push(countLabel(rimanenti, "lezione rimasta", "lezioni rimaste"));
  if (saldo > 0) parts.push("Saldo " + money(saldo));
  else parts.push("Nessun saldo aperto");
  if (c.note) parts.push(c.note);
  li.querySelector(".list-item__note").textContent = parts.join(" · ");
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
    const cani = Array.isArray(c.cani) ? c.cani : [];
    return matchesText(query, c.nome, c.cane, c.telefono, c.email, c.note,
      ...cani.flatMap(d => [d.nome, d.razza, d.eta]));
  }).sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  for (const c of sorted) {
    const li = document.createElement("li");
    li.className = "list-item is-clickable";
    li.dataset.id = c.id;
    li.innerHTML = `
      <div class="list-item__head client-row__head">
        <span class="avatar" aria-hidden="true"></span>
        <div class="client-row__identity">
          <span class="list-item__title"></span>
          <span class="badge badge--${badgeKind(c.stato)}"></span>
        </div>
      </div>
      <div class="list-item__meta"></div>
      <div class="list-item__note"></div>
      <div class="list-item__actions">
        <button type="button" class="btn-small btn-primary" data-action="scheda-cliente">Apri scheda</button>
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

/* Le lezioni passate sono archiviate dal giorno successivo alla loro data. */
function lezioneArchiviata(a) {
  return !!a && !!a.data && a.data < todayStr();
}

function lezioniArchiviate() {
  return data.appuntamenti
    .filter(lezioneArchiviata)
    .sort((a, b) => (b.data + b.ora).localeCompare(a.data + a.ora) || b.id - a.id);
}

function renderArchivioLezioni() {
  const ul = document.getElementById("archivio-lezioni-list");
  if (!ul) return;
  const query = filterValue("filtro-archivio-lezioni");
  const all = lezioniArchiviate();
  const rows = all.filter(a => {
    const pk = a.pacchettoId ? data.pacchetti.find(x => x.id === a.pacchettoId) : null;
    return matchesText(query, clienteNome(a.clienteId), caneNome(a), istruttoreAppuntamento(a), a.tipo,
      esitoLabel(a), isoToDateLabel(a.data), pk ? lezioneLabel(pk) : "");
  });
  ul.innerHTML = "";
  let lastDate = null;
  for (const a of rows) {
    if (a.data !== lastDate) {
      lastDate = a.data;
      const head = document.createElement("li");
      head.className = "agenda-day";
      const parsed = new Date(a.data + "T00:00:00");
      head.textContent = parsed && !isNaN(parsed.getTime())
        ? parsed.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
        : isoToDateLabel(a.data);
      ul.appendChild(head);
    }
    const pk = a.pacchettoId ? data.pacchetti.find(x => x.id === a.pacchettoId) : null;
    const li = document.createElement("li");
    li.className = "list-item is-archived archive-lesson";
    li.dataset.id = a.id;
    li.dataset.date = a.data;
    li.innerHTML = `
      <div class="list-item__head">
        <span class="list-item__title"></span>
        <span class="badge ${esitoBadge(a).cls}"></span>
      </div>
      <div class="list-item__meta"></div>
      <div class="list-item__note"></div>`;
    li.querySelector(".list-item__title").textContent =
      clienteNome(a.clienteId) + " · " + (a.ora || "—");
    li.querySelector(".badge").textContent = esitoBadge(a).txt;
    li.querySelector(".list-item__meta").textContent =
      "Cane: " + caneNome(a) + " · Istruttore: " + (istruttoreAppuntamento(a) || "—") + " · Tipo: " + (a.tipo || "—");
    li.querySelector(".list-item__note").textContent =
      (pk ? lezioneLabel(pk) : "Senza lezione") + (a.note ? " · " + a.note : "");
    ul.appendChild(li);
  }
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "list-empty";
    li.textContent = all.length
      ? "Nessuna lezione archiviata corrisponde alla ricerca."
      : "Nessuna lezione archiviata. Le lezioni svolte o scadute compaiono qui dopo la mezzanotte.";
    ul.appendChild(li);
  }
  const count = document.getElementById("archivio-lezioni-count");
  if (count) {
    count.textContent = countLabel(rows.length, "lezione", "lezioni");
    count.hidden = all.length === 0;
  }
}

function renderArchivio(skipDetail) {
  const ul = document.getElementById("archivio-list");
  if (!ul) return;
  ul.innerHTML = "";
  const query = filterValue("filtro-archivio");
  const archiviati = data.clienti.filter(c => c.stato === "Archiviato");
  const sorted = archiviati
    .filter(c => matchesText(query, c.nome, c.cane, c.telefono, c.email, c.razza, c.eta, c.note,
      ...(Array.isArray(c.cani) ? c.cani.flatMap(d => [d.nome, d.razza, d.eta]) : [])))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  for (const c of sorted) {
    const li = document.createElement("li");
    li.className = "list-item is-archived";
    li.dataset.id = c.id;
    li.innerHTML = `
      <div class="list-item__head client-row__head">
        <span class="avatar" aria-hidden="true"></span>
        <div class="client-row__identity">
          <span class="list-item__title"></span>
          <span class="badge badge--neutral"></span>
        </div>
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
  const clientiCount = document.getElementById("archivio-clienti-count");
  if (clientiCount) {
    clientiCount.textContent = countLabel(sorted.length, "cliente", "clienti");
    clientiCount.hidden = archiviati.length === 0;
  }
  renderArchivioLezioni();
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
    if (a.data && a.data < today) return false;
    if (stato === "fatti" && a.esito !== "completata") return false;
    if (stato === "da-fare" && a.esito) return false;
    if (stato === "assenti" && a.esito !== "assente") return false;
    if (stato === "annullate" && a.esito !== "annullata") return false;
    if (periodo === "oggi" && a.data !== today) return false;
    if (periodo === "7" && (a.data < today || a.data > end)) return false;
    const pk = a.pacchettoId ? data.pacchetti.find(x => x.id === a.pacchettoId) : null;
    if (categoria === "pacchetto" && (!pk || pk.categoria === "singola")) return false;
    if (categoria === "singola" && (!pk || pk.categoria !== "singola")) return false;
    return matchesText(query, clienteNome(a.clienteId), caneNome(a), a.istruttore, a.tipo,
      esitoLabel(a), a.data, isoToDateLabel(a.data), a.ora, pk ? lezioneLabel(pk) : "");
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
    li.className = "list-item is-clickable";
    li.dataset.id = a.id;
    li.dataset.clienteId = a.clienteId;
    li.innerHTML = `
      <div class="list-item__head">
        <span class="list-item__title"></span>
        <span class="badge ${esitoBadge(a).cls}"></span>
      </div>
      <div class="list-item__meta"></div>
      <div class="list-item__actions">
        <button type="button" class="btn-small" data-action="modifica-appuntamento">Modifica</button>
        ${a.esito !== "completata" ? '<button type="button" class="btn-small" data-action="segna-fatto">Segna completata</button>' : ""}
        <button type="button" class="btn-small" data-action="vai-cliente" data-cliente-id="${a.clienteId}">Scheda cliente</button>
        <button type="button" class="btn-small btn-small--danger" data-action="elimina-appuntamento">Elimina</button>
      </div>`;
    li.querySelector(".list-item__title").textContent =
      (a.ora || "—") + " · " + clienteNome(a.clienteId);
    li.querySelector(".badge").textContent = esitoBadge(a).txt;
    li.querySelector(".list-item__meta").textContent =
      "Cane: " + caneNome(a) + " · " + a.tipo;
    ul.appendChild(li);
  }
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "list-empty";
    li.textContent = periodo === "oggi"
      ? "Nessuna lezione oggi."
      : (data.appuntamenti.length
        ? "Nessuna lezione corrisponde ai filtri."
        : "Nessuna lezione programmata.");
    ul.appendChild(li);
  }
  const istruttori = new Set();
  for (const pk of data.pacchetti) if (pk.istruttore) istruttori.add(pk.istruttore);
  for (const a of data.appuntamenti) if (a.istruttore) istruttori.add(a.istruttore);
  fillDatalist(document.getElementById("istruttori-globali"),
    [...istruttori].sort((a, b) => a.localeCompare(b, "it")));
}

function renderHome() {
  const today = todayStr();
  const oggi = data.appuntamenti.filter(a => a.data === today);
  const attivi = data.clienti.filter(c => c.stato !== "Archiviato");
  const cani = attivi.reduce((n, c) => n + (Array.isArray(c.cani) ? c.cani.length : (c.cane ? 1 : 0)), 0);
  const daIncassare = data.pagamenti.reduce((sum, p) => {
    if (p.incassoDaVerificare) return sum;
    return sum + Math.max(0, creditoPagamentoAl(p, today));
  }, 0);
  const mese = currentMonth();
  const completateMese = data.appuntamenti.filter(a => a.esito === "completata"
    && a.data >= mese.first && a.data <= mese.last).length;
  const hOggi = document.getElementById("home-oggi-hint");
  const hClienti = document.getElementById("home-clienti-hint");
  const hPagamenti = document.getElementById("home-pagamenti-hint");
  const hReport = document.getElementById("home-report-hint");
  if (hOggi) hOggi.textContent = oggi.length
    ? countLabel(oggi.length, "lezione oggi", "lezioni oggi")
    : "Nessuna lezione oggi";
  if (hClienti) hClienti.textContent = countLabel(attivi.length, "cliente attivo", "clienti attivi")
    + " · " + countLabel(cani, "cane", "cani");
  if (hPagamenti) hPagamenti.textContent = daIncassare > 0
    ? "Da incassare " + money(daIncassare)
    : "Nessun importo aperto";
  if (hReport) hReport.textContent = countLabel(completateMese, "lezione completata", "lezioni completate")
    + " questo mese";
}

function renderPagamenti() {
  const kpi = document.getElementById("pagamenti-kpi");
  if (!kpi) return;
  const mese = currentMonth();
  const incassi = incassiPeriodo(mese, 0);
  const incassato = incassi.reduce((s, i) => s + i.importo, 0);
  const daIncassare = data.pagamenti.reduce((sum, p) => {
    if (p.incassoDaVerificare) return sum;
    return sum + Math.max(0, creditoPagamentoAl(p, todayStr()));
  }, 0);
  kpi.innerHTML = `
    <article class="payment-kpi payment-kpi--green"><span>Incassato nel mese</span><strong>${escapeHtml(money(incassato))}</strong></article>
    <article class="payment-kpi payment-kpi--orange"><span>Da incassare</span><strong>${escapeHtml(money(daIncassare))}</strong></article>
    <article class="payment-kpi payment-kpi--blue"><span>Pagamenti ricevuti</span><strong>${incassi.length}</strong></article>`;

  const list = document.getElementById("pagamenti-list");
  if (!list) return;
  list.innerHTML = "";
  const recent = [...(data.incassi || [])].sort((a, b) => (b.data + String(b.id).padStart(6, "0"))
    .localeCompare(a.data + String(a.id).padStart(6, "0"))).slice(0, 10);
  for (const i of recent) {
    const p = data.pagamenti.find(x => x.id === i.pagamentoId);
    const cid = p ? p.clienteId : 0;
    const li = document.createElement("li");
    li.className = "list-item payment-row";
    li.innerHTML = `
      <span class="avatar" aria-hidden="true"></span>
      <div class="payment-row__main">
        <strong></strong>
        <span></span>
      </div>
      <strong class="payment-row__amount"></strong>`;
    li.querySelector(".avatar").textContent = iniziali(clienteNome(cid));
    li.querySelector(".payment-row__main strong").textContent = clienteNome(cid);
    li.querySelector(".payment-row__main span").textContent =
      (i.data ? isoToDateLabel(i.data) : "Data non valida") + (i.nota ? " · " + i.nota : "");
    li.querySelector(".payment-row__amount").textContent = money(i.importo);
    list.appendChild(li);
  }
  if (!recent.length) list.appendChild(emptyState("Nessun pagamento registrato."));

  const form = document.querySelector("#form-pagamento-globale form");
  if (!form) return;
  const clientSel = form.elements.namedItem("clienteId");
  const paySel = form.elements.namedItem("pagamentoId");
  const currentClient = clientSel.value;
  const clientsWithPayments = data.clienti.filter(c => data.pagamenti.some(p => p.clienteId === c.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  fillSelect(clientSel, clientsWithPayments.map(c => ({ value: c.id, label: c.nome })), currentClient, "Seleziona cliente");
  const cid = Number(clientSel.value);
  const contratti = data.pagamenti.filter(p => p.clienteId === cid
    && (p.incassoDaVerificare || saldoPagamento(p) > 0));
  fillSelect(paySel, contratti.map(p => ({
    value: p.id,
    label: (p.descrizione || "Contratto") + " · saldo " + money(saldoPagamento(p)),
  })), paySel.value, contratti.length ? "" : "Nessun contratto aperto");
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

let reportPeriodMode = "month";

function quarterRange(year, quarter) {
  const q = Math.min(4, Math.max(1, Number(quarter) || 1));
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const first = year + "-" + String(startMonth).padStart(2, "0") + "-01";
  const last = year + "-" + String(endMonth).padStart(2, "0") + "-" + String(new Date(year, endMonth, 0).getDate()).padStart(2, "0");
  return { first, last, label: "Q" + q + " " + year, mode: "quarter" };
}

function yearRange(year) {
  return { first: year + "-01-01", last: year + "-12-31", label: String(year), mode: "year" };
}

function selectedMonth() {
  const sel = document.getElementById("resoconto-mese");
  const val = sel ? sel.value : "";
  if (reportPeriodMode === "quarter") {
    const m = /^(\d{4})-Q([1-4])$/.exec(val);
    if (m) return quarterRange(Number(m[1]), Number(m[2]));
    return quarterRange(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) + 1);
  }
  if (reportPeriodMode === "year") {
    const m = /^(\d{4})$/.exec(val);
    if (m) return yearRange(Number(m[1]));
    return yearRange(new Date().getFullYear());
  }
  const [y, m] = val.split("-").map(Number);
  if (!y || !m) return currentMonth();
  return { ...periodRange(y, m), mode: "month" };
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

function recentQuarters(n) {
  const now = new Date();
  let year = now.getFullYear();
  let quarter = Math.floor(now.getMonth() / 3) + 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(year + "-Q" + quarter);
    quarter--;
    if (quarter < 1) { quarter = 4; year--; }
  }
  return out;
}

function fillPeriodSelect() {
  const sel = document.getElementById("resoconto-mese");
  if (!sel) return;
  const current = sel.value;
  if (sel.dataset.signature === reportPeriodMode) return;
  const options = [];
  if (reportPeriodMode === "quarter") {
    for (const q of recentQuarters(12)) {
      const [y, qn] = q.split("-Q");
      options.push({ value: q, label: "Q" + qn + " " + y });
    }
  } else if (reportPeriodMode === "year") {
    const year = new Date().getFullYear();
    for (let i = 0; i < 6; i++) options.push({ value: String(year - i), label: String(year - i) });
  } else {
    for (const ym of recentMonths(12)) {
      const [y, m] = ym.split("-").map(Number);
      options.push({ value: ym, label: periodRange(y, m).label });
    }
  }
  const valid = options.some(o => o.value === current);
  sel.innerHTML = "";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = valid ? current : options[0].value;
  sel.dataset.signature = reportPeriodMode;
  const label = document.getElementById("resoconto-periodo-label");
  if (label) label.textContent = reportPeriodMode === "quarter" ? "Trimestre" : reportPeriodMode === "year" ? "Anno" : "Mese";
}

document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "resoconto-mese" || id === "resoconto-cliente") { renderResoconto(); return; }
  if (id === "resoconto-collaboratore") { collabFilters.collaborator = e.target.value; renderResoconto(); return; }
  if (id === "resoconto-coll-mese") { collabFilters.month = e.target.value; renderResoconto(); return; }
  if (id === "resoconto-coll-anno") { collabFilters.year = e.target.value; renderResoconto(); return; }
  if (id === "resoconto-coll-dal") { setCollabDateFilter("from", e.target.value); renderResoconto(); return; }
  if (id === "resoconto-coll-al") { setCollabDateFilter("to", e.target.value); renderResoconto(); return; }
});

const RESOCONTO_MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

/* Filtri della sezione Collaboratori. Sono solo stato di interfaccia. */
const collabFilters = { collaborator: "", month: "", year: "", from: "", to: "" };

function createEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function resocontoSectionHead(section, title, hint) {
  section.appendChild(createEl("h3", "resoconto-section__title", title));
  if (hint) section.appendChild(createEl("p", "resoconto-section__hint", hint));
}

function appendKpi(parent, label, value, meta, metaClass) {
  const card = createEl("article", "resoconto-card");
  card.appendChild(createEl("span", "resoconto-card__label", label));
  card.appendChild(createEl("span", "resoconto-card__value", value));
  if (meta) {
    card.appendChild(createEl("span", "resoconto-card__meta" + (metaClass ? " " + metaClass : ""), meta));
  }
  parent.appendChild(card);
}

function appendChip(parent, text) {
  parent.appendChild(createEl("span", "resoconto-chip", text));
}

function istruttoreAppuntamento(a) {
  if (!a) return "";
  const direct = (a.istruttore || "").trim();
  if (direct) return direct;
  const pk = a.pacchettoId ? data.pacchetti.find(p => p.id === a.pacchettoId) : null;
  return pk && pk.istruttore ? pk.istruttore.trim() : "";
}

/* Registro derivato: nessun dato aggiuntivo viene salvato. */
function collaboratorRegistry() {
  const groups = new Map();
  for (const a of data.appuntamenti) {
    if (!a.fatto || !a.data) continue;
    const name = istruttoreAppuntamento(a);
    const key = name ? name.toLocaleLowerCase("it") : "__senza_istruttore__";
    let group = groups.get(key);
    if (!group) {
      group = { key, name: name || "Senza istruttore", days: new Map() };
      groups.set(key, group);
    }
    const pk = a.pacchettoId ? data.pacchetti.find(p => p.id === a.pacchettoId) : null;
    if (!group.days.has(a.data)) group.days.set(a.data, []);
    group.days.get(a.data).push({
      id: a.id,
      ora: a.ora || "—",
      clienteId: a.clienteId,
      cliente: clienteNome(a.clienteId),
      tipo: a.tipo || "—",
      lezione: pk ? lezioneLabel(pk) : "Senza lezione",
    });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "it"));
}

function collabDateValue(raw) {
  const iso = parseDateInput(raw);
  return iso ? isoToDateLabel(iso) : raw;
}

function setCollabDateFilter(key, raw) {
  const s = String(raw || "").trim();
  if (!s) { collabFilters[key] = ""; return; }
  const iso = parseDateInput(s);
  collabFilters[key] = iso || s;
}

function readCollabPeriod() {
  const fromRaw = String(collabFilters.from || "").trim();
  const toRaw = String(collabFilters.to || "").trim();
  const from = fromRaw ? parseDateInput(fromRaw) : "";
  const to = toRaw ? parseDateInput(toRaw) : "";
  const invalid = !!((fromRaw && !from) || (toRaw && !to) || (from && to && from > to));
  return { fromRaw, toRaw, from, to, invalid };
}

function collabDateMatches(iso, period) {
  if (period.from || period.to) {
    if (period.from && iso < period.from) return false;
    if (period.to && iso > period.to) return false;
    return true;
  }
  if (collabFilters.year && iso.slice(0, 4) !== collabFilters.year) return false;
  if (collabFilters.month && iso.slice(5, 7) !== collabFilters.month) return false;
  return true;
}

function filteredCollaboratorRegistry(registry, period) {
  if (period.invalid) return [];
  return registry.map(group => {
    const days = [...group.days.entries()]
      .filter(([date]) => collabDateMatches(date, period))
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, lessons]) => ({
        date,
        lessons: [...lessons].sort((a, b) => (a.ora || "").localeCompare(b.ora || "") || a.id - b.id),
      }));
    return { ...group, days };
  })
    .filter(group => group.days.length)
    .filter(group => !collabFilters.collaborator || group.key === collabFilters.collaborator);
}

function collaboratorPeriodLabel(period) {
  if (period.invalid) return "Periodo collaboratori: intervallo non valido";
  if (period.from || period.to) {
    if (period.from && period.to) {
      return "Periodo collaboratori: dal " + isoToDateLabel(period.from) + " al " + isoToDateLabel(period.to);
    }
    if (period.from) return "Periodo collaboratori: dal " + isoToDateLabel(period.from);
    return "Periodo collaboratori: fino al " + isoToDateLabel(period.to);
  }
  const parts = [];
  if (collabFilters.month) {
    const idx = Number(collabFilters.month) - 1;
    if (RESOCONTO_MONTHS[idx]) parts.push(RESOCONTO_MONTHS[idx]);
  }
  if (collabFilters.year) parts.push(collabFilters.year);
  return "Periodo collaboratori: " + (parts.length ? parts.join(" ") : "tutto il periodo");
}

function appendSelectOption(select, value, text) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = text;
  select.appendChild(opt);
}

function appendCollaboratorCard(parent, group) {
  const card = createEl("details", "collaborator-card");
  card.dataset.collaborator = group.key;
  if (group.key === "__senza_istruttore__") card.classList.add("collaborator-card--warn");
  const summary = createEl("summary", "collaborator-card__summary");
  const main = createEl("span", "collaborator-card__main");
  main.appendChild(createEl("strong", "collaborator-card__name", group.name));
  const lessonsCount = group.days.reduce((sum, day) => sum + day.lessons.length, 0);
  main.appendChild(createEl("span", "collaborator-card__meta",
    countLabel(group.days.length, "giornata", "giornate") + " · " +
    countLabel(lessonsCount, "lezione", "lezioni")));
  summary.appendChild(main);
  card.appendChild(summary);

  const body = createEl("div", "collaborator-card__body");
  for (const day of group.days) {
    const dayDetails = createEl("details", "collab-day");
    dayDetails.dataset.date = day.date;
    const daySummary = createEl("summary", "collab-day__summary");
    daySummary.appendChild(createEl("span", "collab-day__date", isoToDateLabel(day.date)));
    daySummary.appendChild(createEl("span", "collab-day__count",
      countLabel(day.lessons.length, "lezione", "lezioni")));
    dayDetails.appendChild(daySummary);

    const list = createEl("ul", "collab-day__list");
    for (const lesson of day.lessons) {
      const li = createEl("li", "collab-activity");
      li.appendChild(createEl("span", "collab-activity__time", lesson.ora || "—"));
      const parts = [lesson.cliente, lesson.lezione];
      if (lesson.tipo && !lesson.lezione.toLocaleLowerCase("it").includes(lesson.tipo.toLocaleLowerCase("it"))) {
        parts.push(lesson.tipo);
      }
      li.appendChild(createEl("span", "collab-activity__text", parts.join(" · ")));
      list.appendChild(li);
    }
    dayDetails.appendChild(list);
    body.appendChild(dayDetails);
  }
  card.appendChild(body);
  parent.appendChild(card);
}

function renderResoconto() {
  const el = document.getElementById("resoconto");
  if (!el) return;
  const focusId = document.activeElement && document.activeElement.id;
  const paymentsOpen = !!document.querySelector("#resoconto .resoconto-disclosure[open]");
  fillPeriodSelect();
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
  const rangeApps = data.appuntamenti.filter(a => a.data && a.data >= range.first && a.data <= range.last
    && (!clienteFiltro || a.clienteId === clienteFiltro));
  const svolte = rangeApps.filter(a => a.esito === "completata").length;
  const daSvolgere = rangeApps.filter(a => !a.esito).length;
  const clientiAttivi = clienteFiltro
    ? (clienteById(clienteFiltro).stato === "Attivo" ? 1 : 0)
    : data.clienti.filter(c => c.stato === "Attivo").length;
  const caniSeguiti = new Set(rangeApps.filter(a => a.caneId).map(a => a.clienteId + ":" + a.caneId)).size;
  const senzaData = incassiSenzaData(clienteFiltro);
  const rimanentiTotali = data.pacchetti
    .filter(pk => !clienteFiltro || pk.clienteId === clienteFiltro)
    .reduce((s, pk) => s + lezioniRimanenti(pk), 0);

  let trendText, trendCls;
  if (reportPeriodMode === "month") {
    const selEl = document.getElementById("resoconto-mese");
    const selYm = selEl ? selEl.value : recentMonths(1)[0];
    const prevIncassato = incassatoMese(prevMonth(selYm), clienteFiltro);
    if (prevIncassato === 0) {
      trendText = "Trend vs mese precedente: —";
      trendCls = "";
    } else {
      const pct = ((incassato - prevIncassato) / prevIncassato) * 100;
      const abs = Math.abs(Math.round(pct));
      if (pct > 0) {
        trendText = "Trend vs mese precedente: +" + abs + "%";
        trendCls = "resoconto-trend--up";
      } else if (pct < 0) {
        trendText = "Trend vs mese precedente: −" + abs + "%";
        trendCls = "resoconto-trend--down";
      } else {
        trendText = "Trend vs mese precedente: 0%";
        trendCls = "resoconto-trend--pari";
      }
    }
  } else {
    trendText = "Periodo selezionato";
    trendCls = "";
  }

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
  el.appendChild(createEl("div", "resoconto-period",
    "Periodo: " + label + (clienteFiltro ? " · Cliente: " + clienteLabel : "")));

  /* 1. Riepilogo */
  const overview = createEl("section", "resoconto-section");
  resocontoSectionHead(overview, "Riepilogo", "Panoramica del periodo selezionato.");
  const kpis = createEl("div", "resoconto-kpis");
  appendKpi(kpis, "Incassato", money(incassato), trendText, trendCls);
  appendKpi(kpis, "Lezioni svolte", String(svolte),
    rangeApps.length
      ? (daSvolgere ? countLabel(daSvolgere, "da svolgere", "da svolgere") : "Tutte svolte")
      : "Nessuna lezione in programma");
  appendKpi(kpis, "Clienti attivi", String(clientiAttivi), "clienti attivi");
  appendKpi(kpis, "Cani seguiti", String(caniSeguiti), "con lezioni nel periodo");
  overview.appendChild(kpis);
  el.appendChild(overview);

  /* 2. Lezioni e pagamenti */
  const lessons = createEl("section", "resoconto-section");
  resocontoSectionHead(lessons, "Lezioni", "Stato delle lezioni e situazione dei pagamenti.");
  const chips = createEl("div", "resoconto-chips");
  if (daSvolgere) appendChip(chips, countLabel(daSvolgere, "da svolgere", "da svolgere"));
  if (rimanentiTotali) appendChip(chips, countLabel(rimanentiTotali, "rimanente", "rimanenti"));
  appendChip(chips, "Crediti residui " + money(creditoTotale));
  if (chips.children.length) {
    lessons.appendChild(chips);
  } else if (!daVerificare.length && !senzaData.length) {
    lessons.appendChild(createEl("p", "resoconto-empty",
      svolte ? "Tutte le lezioni del periodo sono state svolte." : "Nessuna lezione nel periodo."));
  }

  if (daVerificare.length) {
    lessons.appendChild(createEl("p", "resoconto-note resoconto-note--warn",
      countLabel(daVerificare.length, "pagamento legacy", "pagamenti legacy") +
      " con incasso non registrato (contratti per " + money(daVerificareContratti) +
      "): esclusi da incassi e crediti finché non verifichi l'importo ricevuto."));
  }
  if (senzaData.length) {
    lessons.appendChild(createEl("p", "resoconto-note resoconto-note--warn",
      countLabel(senzaData.length, "incasso", "incassi") +
      " senza data valida: esclusi dal totale del periodo ma contati nel saldo dei pagamenti."));
  }

  const detail = createEl("details", "resoconto-disclosure");
  detail.open = paymentsOpen;
  detail.appendChild(createEl("summary", "resoconto-disclosure__summary", "Dettaglio pagamenti, incassi ed export"));
  const detailBody = createEl("div", "resoconto-disclosure__body");

  detailBody.appendChild(createEl("p", "resoconto-section__hint",
    "Le lezioni rimanenti rappresentano crediti da pacchetti inclusi nei crediti residui."));

  if (sortedCliente.length > 0) {
    const wrap = createEl("div", "resoconto-clienti");
    wrap.appendChild(createEl("div", "resoconto-clienti__title", "Incassi per cliente"));
    const list = createEl("ul", "resoconto-clienti__list");
    for (const [cid, tot] of sortedCliente) {
      const c = clienteById(cid);
      const li = createEl("li", "resoconto-cliente-row");
      li.appendChild(createEl("span", "resoconto-cliente-row__nome", c ? c.nome : "Sconosciuto"));
      li.appendChild(createEl("span", "resoconto-cliente-row__val", money(tot)));
      list.appendChild(li);
    }
    const total = createEl("li", "resoconto-cliente-row resoconto-cliente-row--totale");
    total.appendChild(createEl("span", "resoconto-cliente-row__nome", "Totale"));
    total.appendChild(createEl("span", "resoconto-cliente-row__val", money(incassato)));
    list.appendChild(total);
    wrap.appendChild(list);
    detailBody.appendChild(wrap);
  }

  const csvActions = createEl("div", "resoconto-csv-actions");
  const csvIncassi = createEl("button", "btn-action", "Esporta CSV incassi");
  csvIncassi.type = "button";
  csvIncassi.id = "btn-csv-incassi";
  const csvPagamenti = createEl("button", "btn-action", "Esporta CSV pagamenti");
  csvPagamenti.type = "button";
  csvPagamenti.id = "btn-csv-pagamenti";
  csvActions.appendChild(csvIncassi);
  csvActions.appendChild(csvPagamenti);
  detailBody.appendChild(csvActions);

  detail.appendChild(detailBody);
  lessons.appendChild(detail);
  el.appendChild(lessons);

  /* 3. Collaboratori */
  const collab = createEl("section", "resoconto-section");
  resocontoSectionHead(collab, "Collaboratori",
    "Giornate ricavate dalle lezioni segnate come Fatto; le lezioni non svolte non contano.");
  const registry = collaboratorRegistry();
  const years = [...new Set(registry.flatMap(g => [...g.days.keys()].map(d => d.slice(0, 4))))]
    .sort((a, b) => b.localeCompare(a));
  if (collabFilters.collaborator && !registry.some(g => g.key === collabFilters.collaborator)) {
    collabFilters.collaborator = "";
  }
  if (collabFilters.year && !years.includes(collabFilters.year)) collabFilters.year = "";
  if (collabFilters.month && !RESOCONTO_MONTHS.some((_, i) => String(i + 1).padStart(2, "0") === collabFilters.month)) {
    collabFilters.month = "";
  }
  const period = readCollabPeriod();
  const filtered = filteredCollaboratorRegistry(registry, period);
  const totalDays = filtered.reduce((sum, g) => sum + g.days.length, 0);
  const totalLessons = filtered.reduce((sum, g) =>
    sum + g.days.reduce((n, d) => n + d.lessons.length, 0), 0);

  const filters = createEl("div", "collab-filters");
  const collabSelect = createEl("select");
  collabSelect.id = "resoconto-collaboratore";
  collabSelect.setAttribute("aria-label", "Filtra per collaboratore");
  appendSelectOption(collabSelect, "", "Tutti i collaboratori");
  for (const group of registry) appendSelectOption(collabSelect, group.key, group.name);
  collabSelect.value = collabFilters.collaborator;
  const collabLabel = createEl("label", "resoconto-filter resoconto-filter--wide");
  collabLabel.appendChild(createEl("span", null, "Collaboratore"));
  collabLabel.appendChild(collabSelect);
  filters.appendChild(collabLabel);

  const monthSelect = createEl("select");
  monthSelect.id = "resoconto-coll-mese";
  monthSelect.setAttribute("aria-label", "Filtra per mese");
  appendSelectOption(monthSelect, "", "Tutti i mesi");
  RESOCONTO_MONTHS.forEach((name, i) => appendSelectOption(monthSelect, String(i + 1).padStart(2, "0"), name));
  monthSelect.value = collabFilters.month;
  const monthLabel = createEl("label", "resoconto-filter");
  monthLabel.appendChild(createEl("span", null, "Mese"));
  monthLabel.appendChild(monthSelect);
  filters.appendChild(monthLabel);

  const yearSelect = createEl("select");
  yearSelect.id = "resoconto-coll-anno";
  yearSelect.setAttribute("aria-label", "Filtra per anno");
  appendSelectOption(yearSelect, "", "Tutti gli anni");
  for (const year of years) appendSelectOption(yearSelect, year, year);
  yearSelect.value = collabFilters.year;
  const yearLabel = createEl("label", "resoconto-filter");
  yearLabel.appendChild(createEl("span", null, "Anno"));
  yearLabel.appendChild(yearSelect);
  filters.appendChild(yearLabel);

  const fromLabel = createEl("label", "resoconto-filter resoconto-filter--wide");
  fromLabel.appendChild(createEl("span", null, "Dal"));
  fromLabel.insertAdjacentHTML("beforeend", dateFieldHtml('id="resoconto-coll-dal" aria-label="Dal"'));
  const fromInput = fromLabel.querySelector("input");
  if (fromInput) fromInput.value = collabDateValue(collabFilters.from);
  filters.appendChild(fromLabel);

  const toLabel = createEl("label", "resoconto-filter resoconto-filter--wide");
  toLabel.appendChild(createEl("span", null, "Al"));
  toLabel.insertAdjacentHTML("beforeend", dateFieldHtml('id="resoconto-coll-al" aria-label="Al"'));
  const toInput = toLabel.querySelector("input");
  if (toInput) toInput.value = collabDateValue(collabFilters.to);
  filters.appendChild(toLabel);

  const reset = createEl("button", "btn-action collab-filters__reset", "Azzera filtri");
  reset.type = "button";
  reset.id = "resoconto-coll-reset";
  filters.appendChild(reset);
  collab.appendChild(filters);
  collab.appendChild(createEl("p", "collab-filter-hint",
    "Filtri indipendenti dal mese e dal cliente del riepilogo. Se compili Dal o Al, mese e anno vengono ignorati."));
  collab.appendChild(createEl("p", "collab-period", collaboratorPeriodLabel(period)));
  const summaryEl = createEl("p", "collab-summary",
    countLabel(filtered.length, "collaboratore", "collaboratori") + " · " +
    countLabel(totalDays, "giornata", "giornate") + " · " +
    countLabel(totalLessons, "lezione", "lezioni"));
  summaryEl.setAttribute("role", "status");
  summaryEl.setAttribute("aria-live", "polite");
  collab.appendChild(summaryEl);

  if (period.invalid) {
    const invalidEl = createEl("p", "resoconto-note resoconto-note--warn",
      "Intervallo di date non valido: controlla i campi Dal e Al.");
    invalidEl.setAttribute("role", "alert");
    collab.appendChild(invalidEl);
  } else if (!filtered.length) {
    collab.appendChild(createEl("p", "resoconto-empty",
      registry.length ? "Nessuna giornata corrisponde ai filtri." : "Nessuna lezione segnata come svolta."));
  } else {
    if (filtered.some(g => g.key === "__senza_istruttore__")) {
      collab.appendChild(createEl("p", "resoconto-note resoconto-note--warn",
        "Alcune lezioni svolte non hanno un istruttore: sono raccolte nella voce \"Senza istruttore\"."));
    }
    const list = createEl("div", "collab-list");
    for (const group of filtered) appendCollaboratorCard(list, group);
    collab.appendChild(list);
  }
  el.appendChild(collab);

  if (focusId) {
    const next = document.getElementById(focusId);
    if (next) next.focus();
  }
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
  const period = r.label.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "");
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
      <h1 class="report__title">Report incassi e crediti</h1>
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
    "Raccordo con l'app: l'Incassato effettivo nel periodo mostrato a schermo è "
    + money(r.effettivo) + "; i crediti residui al fine periodo sono " + money(r.creditoTotale) + ".";

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
    // Rigenera per essere certo che il report corrisponda al periodo selezionato.
    renderReport();
    window.print();
  } catch (err) {
    setStatus("Esportazione PDF non riuscita: " + err.message, true);
  }
}


function ricalcolaUtilizzate(pk) {
  if (!pk) return false;
  const completate = data.appuntamenti.filter(a =>
    a.pacchettoId === pk.id && a.esito === "completata").length;
  const extra = Number.isInteger(pk.consumiManuali) ? pk.consumiManuali : 0;
  const target = Math.min(pk.lezioni, Math.max(0, completate + extra));
  if (target !== pk.utilizzate) {
    pk.utilizzate = target;
    return true;
  }
  return false;
}

/* Alla scadenza una lezione senza esito viene considerata completata.
   Assenze e annullamenti espliciti non consumano la lezione. */
function autoConsumeLezioni() {
  const now = new Date();
  let changed = false;
  for (const pk of data.pacchetti) {
    if (!Number.isInteger(pk.consumiManuali)) pk.consumiManuali = 0;
    for (const a of data.appuntamenti) {
      if (a.pacchettoId !== pk.id || !a.data || !a.ora) continue;
      const when = new Date(a.data + "T" + a.ora + ":00");
      if (isNaN(when.getTime()) || when > now) continue;
      if (!a.esito) {
        a.esito = "completata";
        a.fatto = true;
        changed = true;
      }
    }
    if (ricalcolaUtilizzate(pk)) changed = true;
  }
  return changed;
}

function refresh() {
  autoConsumeLezioni();
  renderHome();
  renderClienti();
  renderPagamenti();
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
      if (el && typeof value !== "object" && value !== null) {
        el.value = el.matches("[data-date-input]") ? isoToDateLabel(String(value)) : String(value);
      }
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
    if (el && !el.value && !record) el.value = todayInput();
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

function fillSelect(select, options, selected, placeholder) {
  if (!select) return;
  select.innerHTML = "";
  if (placeholder) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  for (const item of options) {
    const opt = document.createElement("option");
    opt.value = String(item.value);
    opt.textContent = item.label;
    select.appendChild(opt);
  }
  select.value = selected != null ? String(selected) : "";
}

function fillAppuntamentoCani(form, clienteId, selected) {
  const select = form.querySelector('select[name="caneId"]');
  if (!select) return;
  const c = clienteById(Number(clienteId));
  const cani = c && Array.isArray(c.cani) ? c.cani : [];
  fillSelect(select, cani.map(d => ({
    value: d.id,
    label: d.nome || "Cane" + (d.razza ? " · " + d.razza : ""),
  })), selected || (cani[0] ? cani[0].id : ""), cani.length ? "" : "Nessun cane");
  select.disabled = cani.length === 0;
}

function fillAppuntamentoPacchetti(form, clienteId, selected) {
  const select = form.querySelector('select[name="pacchettoId"]');
  if (!select) return;
  const cid = Number(clienteId);
  const options = [{ value: 0, label: "Lezione singola (nuova)" }];
  for (const pk of data.pacchetti.filter(p => p.clienteId === cid)) {
    const count = lezioniProgrammate(pk);
    if (count >= pk.lezioni && pk.id !== Number(selected)) continue;
    options.push({
      value: pk.id,
      label: lezioneLabel(pk) + " · " + count + "/" + pk.lezioni,
    });
  }
  fillSelect(select, options, selected || 0, "");
}

function setEsitoForm(form, esito) {
  const value = ["completata", "assente", "annullata"].includes(esito) ? esito : "";
  const radios = form.querySelectorAll('input[name="esito"]');
  for (const r of radios) r.checked = r.value === value;
}

function openAppuntamentoForm(panelId, values) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  toggleForm(panelId, true);
  const form = panel.querySelector("form");
  const clientField = form.elements.namedItem("clienteId");
  if (clientField && clientField.tagName === "SELECT") {
    fillSelect(clientField, data.clienti
      .slice().sort((a, b) => a.nome.localeCompare(b.nome, "it"))
      .map(c => ({ value: c.id, label: c.nome + (c.stato === "Archiviato" ? " (archiviato)" : "") })),
      values.clienteId || "", "Seleziona cliente");
  } else if (clientField) {
    clientField.value = String(values.clienteId || 0);
  }
  const selectedCliente = Number(clientField ? clientField.value : values.clienteId || 0);
  fillAppuntamentoCani(form, selectedCliente, values.caneId || 0);
  fillAppuntamentoPacchetti(form, selectedCliente, values.pacchettoId || 0);
  const packageField = form.elements.namedItem("pacchettoId");
  if (packageField && packageField.tagName !== "SELECT") packageField.value = String(values.pacchettoId || 0);
  if (form.elements.namedItem("id")) form.elements.namedItem("id").value = values.id ? String(values.id) : "";
  if (form.elements.namedItem("data") && values.data) form.elements.namedItem("data").value = isoToDateLabel(values.data);
  if (form.elements.namedItem("ora") && values.ora) form.elements.namedItem("ora").value = values.ora;
  if (form.elements.namedItem("istruttore")) form.elements.namedItem("istruttore").value = values.istruttore || "";
  if (form.elements.namedItem("note")) form.elements.namedItem("note").value = values.note || "";
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
  setEsitoForm(form, values.esito || (values.fatto ? "completata" : ""));
  const first = panel.querySelector("select[name=clienteId], select[name=caneId], input:not([type=hidden])");
  if (first) first.focus();
}

function handleClick(e) {
  const appuntamentoRow = e.target.closest("#appuntamenti-list li[data-id]");
  if (appuntamentoRow && !e.target.closest("button, a")) {
    const cid = Number(appuntamentoRow.dataset.clienteId || 0);
    if (cid && clienteById(cid)) {
      selectedClienteId = cid;
      detailTriggerId = cid;
      goTo("clienti");
      renderClienti();
      return;
    }
  }
  const clienteRow = e.target.closest("#clienti-list li[data-id]");
  if (clienteRow && !e.target.closest("button, a")) {
    selectedClienteId = Number(clienteRow.dataset.id);
    detailTriggerId = selectedClienteId;
    renderClienti();
    const box = document.getElementById("cliente-dettaglio");
    if (box) box.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const cancel = e.target.closest("[data-cancel]");
  if (cancel) { toggleForm(cancel.dataset.cancel, false); return; }
  const cancelReceipt = e.target.closest("[data-cancel-receipt]");
  if (cancelReceipt) {
    const f = cancelReceipt.closest("form");
    if (f) { f.hidden = true; f.reset(); }
    return;
  }
  const datePickerBtn = e.target.closest("[data-date-picker]");
  if (datePickerBtn) { openDatePicker(datePickerBtn); return; }
  const deletePacchetto = e.target.closest("[data-delete-pacchetto]");
  if (deletePacchetto) {
    const panel = deletePacchetto.closest(".form-panel");
    const f = panel ? panel.querySelector("form") : null;
    const idField = f ? f.elements.namedItem("id") : null;
    const pkId = Number(idField ? idField.value : 0);
    if (pkId) deletePacchettoById(pkId);
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
      if (a) {
        rememberUndo("Lezione segnata completata.");
        a.esito = "completata";
        a.fatto = true;
        if (!commit("Lezione segnata completata.")) { restoreUndoState(); return; }
        offerUndo();
      }
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
          if (date && !date.value) date.value = todayInput();
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
    } else if (act === "nuovo-cane" || act === "modifica-cane") {
      const box = action.closest(".detail-panel");
      const cid = Number(box ? box.dataset.clienteId : 0);
      const c = clienteById(cid);
      if (!c) return;
      const caneId = Number(action.dataset.caneId || 0);
      const dog = caneId ? caneById(c, caneId) : null;
      toggleForm("form-cliente-cane", true, dog || null);
      const form = document.querySelector("#form-cliente-cane form");
      if (form) {
        form.elements.namedItem("clienteId").value = String(cid);
        form.elements.namedItem("caneId").value = dog ? String(dog.id) : "";
        if (!dog) {
          form.elements.namedItem("nome").value = "";
          form.elements.namedItem("razza").value = "";
          form.elements.namedItem("eta").value = "";
        }
      }
    } else if (act === "scheda-cane") {
      const box = action.closest(".detail-panel");
      const cid = Number(box ? box.dataset.clienteId : 0);
      selectedCaneId = Number(action.dataset.caneId || 0);
      renderCaneDettaglio(box, clienteById(cid));
      const el = box ? box.querySelector("#cliente-cane-dettaglio") : null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (act === "chiudi-cane") {
      selectedCaneId = 0;
      const box = action.closest(".detail-panel");
      renderCaneDettaglio(box, clienteById(Number(box ? box.dataset.clienteId : 0)));
    } else if (act === "nuova-lezione-cliente") {
      const box = action.closest(".detail-panel");
      const cid = Number(box ? box.dataset.clienteId : 0);
      if (!cid) return;
      const c = clienteById(cid);
      const dog = caneById(c, selectedCaneId) || canePrimario(c);
      const pk = data.pacchetti.find(x => x.clienteId === cid
        && x.categoria === "pacchetto" && lezioniProgrammate(x) < x.lezioni);
      const activity = box ? box.querySelector("#cliente-attivita") : null;
      if (activity) activity.open = true;
      openAppuntamentoForm(CARD_FORMS.appuntamento, {
        clienteId: cid,
        caneId: dog ? dog.id : 0,
        pacchettoId: pk ? pk.id : 0,
        istruttore: pk ? pk.istruttore : "",
        tipo: pk ? "Addestramento" : "Addestramento",
      });
    } else if (act === "registra-pagamento-cliente") {
      const box = action.closest(".detail-panel");
      const cid = Number(box ? box.dataset.clienteId : 0);
      const p = data.pagamenti.find(x => x.clienteId === cid && !x.incassoDaVerificare && saldoPagamento(x) > 0);
      if (!p) { setStatus("Nessun contratto con saldo da incassare per questo cliente.", true); return; }
      const pk = data.pacchetti.find(x => x.id === p.pacchettoId);
      const group = pk && box ? box.querySelector('.lezione-group[data-id="' + pk.id + '"]') : null;
      const block = group ? group.querySelector(".lezione-block--payments") : null;
      if (!block) { setStatus("Apri il pacchetto del cliente per registrare l'incasso.", true); return; }
      const activity = box ? box.querySelector("#cliente-attivita") : null;
      if (activity) activity.open = true;
      block.hidden = false;
      const toggle = group.querySelector("[data-action=toggle-pagamento]");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
      block.scrollIntoView({ behavior: "smooth", block: "start" });
      const trigger = block.querySelector("[data-action=registra-incasso]");
      if (trigger) { trigger.click(); trigger.focus(); }
    } else if (act === "toggle-storico-cliente") {
      const box = action.closest(".detail-panel");
      const cid = Number(box ? box.dataset.clienteId : 0);
      const panel = box ? box.querySelector("#cliente-storico-panel") : null;
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden && !panel.dataset.rendered) {
        panel.dataset.rendered = "1";
        renderClienteStorico(panel, clientLinks(cid));
      }
      if (!panel.hidden) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (act === "modifica-pacchetto") {
      const pk = data.pacchetti.find(x => x.id === id);
      if (pk) {
        toggleForm(CARD_FORMS.pacchetto, true, pk);
        syncPacchettoForm(document.getElementById(CARD_FORMS.pacchetto));
      }
    } else if (act === "nuova-lezione") {
      const pk = data.pacchetti.find(x => x.id === id);
      if (!pk) return;
      const count = lezioniProgrammate(pk);
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
      deletePacchettoById(id);
    } else if (act === "toggle-pagamento") {
      const group = action.closest(".lezione-group");
      const panel = group ? group.querySelector(".lezione-block--payments") : null;
      if (!panel) return;
      panel.hidden = !panel.hidden;
      action.setAttribute("aria-expanded", String(!panel.hidden));
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
        openAppuntamentoForm("form-appuntamento", a);
        const info = document.querySelector("[data-appuntamento-info]");
        if (info) {
          const pk = a.pacchettoId ? data.pacchetti.find(x => x.id === a.pacchettoId) : null;
          info.textContent = clienteNome(a.clienteId) + (pk ? " · " + lezioneLabel(pk) : "");
        }
      } else {
        openAppuntamentoForm(CARD_FORMS.appuntamento, a);
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
  if (e.target.id === "resoconto-coll-reset") {
    collabFilters.collaborator = "";
    collabFilters.month = "";
    collabFilters.year = "";
    collabFilters.from = "";
    collabFilters.to = "";
    renderResoconto();
    return;
  }
  if (e.target.id === "btn-nuovo-appuntamento") { openAppuntamentoForm("form-appuntamento", { clienteId: 0 }); return; }
  if (e.target.id === "btn-nuovo-pagamento-globale") {
    toggleForm("form-pagamento-globale", true);
    const form = document.querySelector("#form-pagamento-globale form");
    if (form) {
      renderPagamenti();
      const date = form.elements.namedItem("data");
      if (date) date.value = todayInput();
      const client = form.elements.namedItem("clienteId");
      if (client && client.value) client.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  if (e.target.id === "btn-csv-incassi-pagina") { exportCsvIncassi(); return; }
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
    const email = (fd.get("email") || "").toString().trim().slice(0, 120);
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
      const cani = Array.isArray(c.cani) && c.cani.length ? c.cani.slice() : [];
      if (cani.length) cani[0] = { ...cani[0], nome: cane, razza, eta };
      else cani.push({ id: 1, nome: cane, razza, eta });
      Object.assign(c, { nome, telefono, email, cane, razza, eta, note, stato, cani });
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
    const row = {
      id: nextId(data.clienti), nome, telefono, email, cane, razza, eta, note, stato,
      cani: [{ id: 1, nome: cane, razza, eta }],
    };
    data.clienti.push(row);
    if (!commit("Cliente salvato: " + nome)) {
      data.clienti = data.clienti.filter(c => c.id !== row.id);
      return;
    }
    toggleForm("form-cliente", false);
  }

  if (kind === "cane") {
    const clienteId = Number(fd.get("clienteId"));
    const caneId = Number(fd.get("caneId") || 0);
    const c = clienteById(clienteId);
    if (!c) { setStatus("Cliente non trovato.", true); return; }
    const nome = (fd.get("nome") || "").toString().trim();
    if (!nome) { setStatus("Inserisci il nome del cane.", true); return; }
    const razza = (fd.get("razza") || "").toString().trim();
    const eta = (fd.get("eta") || "").toString().trim();
    rememberUndo(caneId ? "Cane modificato." : "Cane aggiunto.");
    if (!Array.isArray(c.cani)) c.cani = [];
    if (caneId) {
      const dog = caneById(c, caneId);
      if (!dog) { setStatus("Cane non trovato.", true); return; }
      Object.assign(dog, { nome, razza, eta });
    } else {
      const id = c.cani.reduce((m, d) => Math.max(m, d.id), 0) + 1;
      c.cani.push({ id, nome, razza, eta });
    }
    c.cane = c.cani[0] ? c.cani[0].nome : "";
    c.razza = c.cani[0] ? c.cani[0].razza : "";
    c.eta = c.cani[0] ? c.cani[0].eta : "";
    if (!commit(caneId ? "Cane aggiornato." : "Cane aggiunto.")) { restoreUndoState(); return; }
    toggleForm("form-cliente-cane", false);
    offerUndo();
    return;
  }

  if (kind === "pagamento") {
    const id = Number(fd.get("id") || 0);
    const clienteId = Number(fd.get("clienteId"));
    const importo = Math.round(Number(fd.get("importo")) * 100) / 100;
    const data_ = parseDateInput(fd.get("data"));
    const descrizione = (fd.get("descrizione") || "").toString().trim();
    const acconto = Math.round((Number(fd.get("acconto")) || 0) * 100) / 100;
    let dataIncasso = parseDateInput(fd.get("dataIncasso"));
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
      consumiManuali: 0,
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
          caneId: canePrimario(clienteById(clienteId))?.id || 0,
          data: row.data,
          ora: row.ora,
          tipo: defaultTipo,
          istruttore: row.istruttore || defaultInstructor,
          pacchettoId: nuovoPacchetto.id,
          esito: "",
          note: "",
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
    const caneId = Number(fd.get("caneId") || 0);
    let pacchettoId = Number(fd.get("pacchettoId") || 0);
    const data_ = parseDateInput(fd.get("data"));
    const ora = (fd.get("ora") || "").toString();
    const tipo = (fd.get("tipo") || "").toString();
    const istruttore = (fd.get("istruttore") || "").toString().trim().slice(0, 60);
    const esitoRaw = (fd.get("esito") || "").toString();
    const esito = ["completata", "assente", "annullata"].includes(esitoRaw) ? esitoRaw : "";
    const note = (fd.get("note") || "").toString().trim().slice(0, 500);
    if (!clienteId || !data_ || !ora || !tipo) { setStatus("Completa tutti i campi della lezione.", true); return; }
    if (!clienteId || !clienteById(clienteId)) { setStatus("Cliente non valido: riapri la scheda e riprova.", true); return; }
    if (!isIsoDate(data_) || !isTime(ora)) { setStatus("Data o ora non valide.", true); return; }
    const cliente = clienteById(clienteId);
    const cane = caneId ? caneById(cliente, caneId) : canePrimario(cliente);
    if (!cane) { setStatus("Aggiungi almeno un cane al cliente prima di salvare una lezione.", true); return; }
    const caneIdFinal = cane.id;
    let linked = null;
    if (pacchettoId) {
      linked = data.pacchetti.find(pk => pk.id === pacchettoId);
      if (!linked || linked.clienteId !== clienteId) {
        setStatus("Pacchetto o lezione non valido per questo cliente.", true);
        return;
      }
    }
    if (!id && linked) {
      const count = lezioniProgrammate(linked);
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
      Object.assign(a, { clienteId, caneId: caneIdFinal, pacchettoId, data: data_, ora, tipo, istruttore, esito, note, fatto: esito === "completata" });
      if (!commit("Lezione aggiornata per " + clienteNome(clienteId))) {
        restoreUndoState();
        return;
      }
      closeFormPanel(form);
      offerUndo();
      return;
    }
    if (!pacchettoId) {
      const nuovaSingola = {
        id: nextId(data.pacchetti), clienteId, categoria: "singola", tipo,
        istruttore, lezioni: 1, utilizzate: 0, prezzo: 0, data: data_,
        consumiManuali: 0,
      };
      data.pacchetti.push(nuovaSingola);
      pacchettoId = nuovaSingola.id;
    }
    const row = {
      id: nextId(data.appuntamenti), clienteId, caneId: caneIdFinal, pacchettoId,
      data: data_, ora, tipo, istruttore, esito, note, fatto: esito === "completata",
    };
    data.appuntamenti.push(row);
    if (!commit("Lezione salvata per " + clienteNome(clienteId))) {
      data.appuntamenti = data.appuntamenti.filter(a => a.id !== row.id);
      return;
    }
    closeFormPanel(form);
  }

  if (kind === "incasso-globale") {
    const pagamentoId = Number(fd.get("pagamentoId"));
    const importo = Math.round(Number(fd.get("importo")) * 100) / 100;
    const data_ = parseDateInput(fd.get("data"));
    const nota = (fd.get("nota") || "").toString().trim();
    const p = data.pagamenti.find(x => x.id === pagamentoId);
    if (!p) { setStatus("Seleziona un contratto da incassare.", true); return; }
    if (!(importo > 0) || !isFinite(importo)) { setStatus("Inserisci un importo valido.", true); return; }
    if (!isIsoDate(data_)) { setStatus("Inserisci una data incasso valida.", true); return; }
    const max = p.incassoDaVerificare ? p.importo : saldoPagamento(p);
    if (importo > max + 0.005) {
      setStatus("L'importo supera il saldo disponibile (" + money(max) + ").", true);
      return;
    }
    const r = addIncasso(p.id, importo, data_, nota);
    if (!r) { setStatus("Impossibile registrare l'incasso.", true); return; }
    if (!commit("Pagamento registrato: " + money(importo) + " per " + clienteNome(p.clienteId) + ". Saldo " + money(saldoPagamento(p)) + ".")) {
      data.incassi = data.incassi.filter(i => i.id !== r.id);
      ricalcolaStatiPagamenti();
      refresh();
      return;
    }
    toggleForm("form-pagamento-globale", false);
    renderPagamenti();
    return;
  }

  if (kind === "incasso") {
    const pagamentoId = Number(fd.get("pagamentoId"));
    const importo = Math.round(Number(fd.get("importo")) * 100) / 100;
    const data_ = parseDateInput(fd.get("data"));
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

let lastCalendarDay = todayStr();

function tickCalendar() {
  const changed = autoConsumeLezioni();
  const dayChanged = todayStr() !== lastCalendarDay;
  if (changed && !saveData()) return;
  if (changed || dayChanged) {
    lastCalendarDay = todayStr();
    refresh();
  }
}

setInterval(tickCalendar, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tickCalendar();
});
