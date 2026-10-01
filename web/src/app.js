// Transcripter im Browser: Aufnahme (Mikrofon + geteilter System-/Tab-Ton), Ablage im Browser (IndexedDB) und
// optional als Dateien in einem gewählten Ordner, Transkription + Sprechererkennung im Web-Worker.
// Es werden keine Audio- oder Textdaten an einen Server geschickt.
import { toDocx, toPdf } from "./export.js";
import { Folder, folderSupported } from "./folder.js";
import {
  clusterSpeakers,
  displayTitle,
  fileBase,
  findCut,
  formatTimestamp,
  isHallucination,
  mergeTracks,
  normalize,
  renameSpeaker,
  setMarkdownTitle,
  speakerLabel,
  speakersForTrack,
  speechRegions,
  toMarkdown,
} from "./lib.js";

const VERSION = "0.2.0-web";
const SR = 16000;
const LABELS = { mic: "Ich/Raum", system: "Remote" };
const TRACK_NAMES = { mic: "Mikrofon", system: "Teams/Zoom-Ton", file: "Audiodatei" };

const $ = (id) => document.getElementById(id);

// Fehler nie stumm lassen: sichtbar oben auf der Seite anzeigen
function fatal(message) {
  const el = $("fatal");
  el.textContent = message;
  el.hidden = false;
}
window.addEventListener("error", (e) => fatal(`Fehler: ${e.message}. Bitte Seite neu laden (Strg + F5).`));
window.addEventListener("unhandledrejection", (e) =>
  fatal(`Fehler: ${e.reason?.message || e.reason}. Bitte Seite neu laden (Strg + F5).`),
);
const ui = {
  status: $("status"),
  record: $("record"),
  title: $("title"),
  mic: $("src-mic"),
  system: $("src-system"),
  auto: $("auto"),
  live: $("live"),
  model: $("model"),
  diarize: $("diarize"),
  speakers: $("speakers"),
  list: $("sessions"),
  recent: $("recent"),
  search: $("search"),
  empty: $("empty"),
  file: $("file"),
  work: $("work"),
  workLabel: $("work-label"),
  transcript: $("transcript"),
};
$("version").textContent = `v${VERSION}`;
const engine = navigator.gpu ? "WebGPU" : window.crossOriginIsolated ? "CPU (mehrkernig)" : "CPU";
$("engine").textContent = `Lokal · ${engine}`;

// Schlanke Fortschrittsanzeige: ui.progress.value = 0..100
ui.progress = {
  set value(v) {
    const p = Math.max(0, Math.min(100, Math.round(v || 0)));
    $("work-bar").style.width = `${p}%`;
    $("work-pct").textContent = `${p} %`;
  },
};

// ---------- Seiten ----------
const PAGES = {
  record: ["Aufnehmen", "Meeting aufnehmen und lokal transkribieren"],
  transcripts: ["Transkripte", "Alle Aufnahmen und Transkripte"],
};
function showView(name) {
  if (!PAGES[name]) name = "record";
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  [$("page-title").textContent, $("page-sub").textContent] = PAGES[name];
  window.scrollTo(0, 0);
}
const viewFromHash = () => (location.hash === "#transkripte" ? "transcripts" : "record");
window.addEventListener("hashchange", () => showView(viewFromHash()));
showView(viewFromHash());

// ---------- Ablage im Browser (IndexedDB) ----------
const db = await new Promise((resolve, reject) => {
  const req = indexedDB.open("transcripter", 2);
  req.onupgradeneeded = () => {
    const d = req.result;
    if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" });
    if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings");
  };
  // Ein anderer Tab mit älterer Version hält die Datenbank offen → Umstellung wartet, bis er zu ist
  req.onblocked = () =>
    fatal(
      "Transcripter ist noch in einem anderen Tab oder Fenster geöffnet (ältere Version). Bitte diesen anderen Tab schließen – danach startet die Seite automatisch.",
    );
  req.onsuccess = () => {
    $("fatal").hidden = true;
    resolve(req.result);
  };
  req.onerror = () => reject(req.error);
});
// Öffnet später eine neuere Version, diese nicht blockieren
db.onversionchange = () => {
  db.close();
  fatal("Eine neuere Version von Transcripter wurde geöffnet. Bitte diese Seite neu laden (Strg + F5).");
};
const dbCall = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const store = (name, mode) => db.transaction(name, mode).objectStore(name);
const getSession = (id) => dbCall(store("sessions", "readonly").get(id));
const putSession = (s) => dbCall(store("sessions", "readwrite").put(s));
const deleteSession = (id) => dbCall(store("sessions", "readwrite").delete(id));
const allSessions = async () =>
  (await dbCall(store("sessions", "readonly").getAll())).sort((a, b) => b.startedAt - a.startedAt);
const settings = {
  get: (key) => dbCall(store("settings", "readonly").get(key)),
  set: (key, value) => dbCall(store("settings", "readwrite").put(value, key)),
};
navigator.storage?.persist?.(); // Browser soll die Daten nicht automatisch aufräumen

// ---------- Speicherordner (echte Dateien) ----------
const folder = new Folder(settings);
await folder.load();

function renderStorage() {
  const box = $("storage");
  const btn = $("storage-btn");
  box.className = "storage";
  if (folder.state === "unsupported") {
    box.classList.add("warn");
    $("storage-title").textContent = "Dieser Browser wird nicht unterstützt";
    $("storage-sub").textContent = "Zum Aufnehmen wird ein lokaler Speicherordner benötigt – bitte Microsoft Edge oder Google Chrome verwenden.";
    btn.hidden = true;
  } else if (folder.state === "none") {
    box.classList.add("warn");
    $("storage-title").textContent = "Bitte zuerst einen Speicherordner wählen";
    $("storage-sub").textContent =
      "Aufnahmen und Transkripte werden dort als Dateien abgelegt. Einen lokalen Ordner wählen, nicht OneDrive. Ohne Ordner ist keine Aufnahme möglich.";
    btn.hidden = false;
    btn.textContent = "Speicherordner wählen";
  } else if (folder.state === "prompt") {
    box.classList.add("warn");
    $("storage-title").textContent = `Speicherordner „${folder.name}“`;
    $("storage-sub").textContent = "Der Browser fragt nach dem Neustart erneut um Erlaubnis, in den Ordner zu schreiben.";
    btn.hidden = false;
    btn.textContent = "Zugriff erlauben";
  } else {
    box.classList.add("ok");
    $("storage-title").textContent = `Speicherordner: ${folder.name}`;
    $("storage-sub").textContent = "Transkripte (.md) direkt im Ordner, Aufnahmen im Unterordner „Audio“.";
    btn.hidden = false;
    btn.textContent = "Ordner ändern";
    btn.className = "btn";
  }
  if (folder.state !== "granted") btn.className = "btn primary";
  box.classList.toggle("required", !folder.ready);
  // Ohne Speicherordner keine Aufnahme und kein Upload (Knöpfe bleiben klickbar und erklären, warum)
  ui.record.classList.toggle("locked", !folder.ready && !rec);
  $("upload-label").classList.toggle("disabled", !folder.ready);
  if (!rec && !folder.ready) {
    setStatus(
      folder.state === "unsupported"
        ? "Aufnahme nur in Edge oder Chrome möglich"
        : folder.state === "prompt"
          ? "Bitte oben den Zugriff auf den Speicherordner erlauben"
          : "Bitte zuerst oben einen Speicherordner wählen",
      "warn",
    );
  } else if (!rec && ui.status.classList.contains("warn")) setStatus("Bereit");
}
$("storage-btn").onclick = async () => {
  try {
    if (folder.state === "prompt") await folder.grant();
    else await folder.pick();
  } catch (err) {
    if (err.name === "AbortError") return; // Dialog abgebrochen
    const policy = err.name === "SecurityError" || err.name === "NotAllowedError";
    alert(
      policy
        ? "Der Browser erlaubt dieser Seite keinen Ordnerzugriff – vermutlich durch eine Firmenrichtlinie (IT). Bitte die IT bitten, den Dateizugriff für diese Seite zu erlauben."
        : `Ordner konnte nicht verwendet werden: ${err.message}`,
    );
  }
  renderStorage();
  if (folder.ready) await syncAll();
};

/** Schreibt Transkript und Aufnahme einer Sitzung in den Ordner (sofern gewählt); merkt sich die Dateinamen. */
async function exportSession(session) {
  if (!folder.ready) return;
  session.files ||= {};
  const base = fileBase(session);
  try {
    // Aufnahmen einmalig nach Audio/ (hochgeladene Dateien liegen ja schon beim Nutzer)
    for (const [key, track] of Object.entries(session.tracks)) {
      if (key === "file" || session.files[key]) continue;
      const path = `Audio/${base}_${key}.webm`;
      await folder.write(path, track.blob);
      session.files[key] = path;
    }
    if (session.transcript) {
      const path = `${base}.md`;
      await folder.write(path, session.transcript);
      if (session.files.md && session.files.md !== path) await folder.remove(session.files.md); // Titel geändert
      session.files.md = path;
    }
    await putSession(session);
  } catch (err) {
    console.error("Export in Ordner fehlgeschlagen", err);
  }
}
async function syncAll() {
  for (const s of await allSessions()) {
    const missing =
      (s.transcript && !(s.files?.md && (await folder.exists(s.files.md)))) ||
      Object.keys(s.tracks).some((k) => k !== "file" && !s.files?.[k]);
    if (missing) await exportSession(s);
  }
}

async function saveSession(session) {
  await putSession(session);
  await exportSession(session);
}

// ---------- Worker ----------
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let nextId = 1;
const pending = new Map();
let onLoadProgress = null;
worker.onmessage = ({ data }) => {
  if (data.type === "load-progress") return onLoadProgress?.(data.loaded, data.total);
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  if (data.type === "error") p.reject(new Error(data.message));
  else p.resolve(data.chunks);
};
function call(msg, transfer) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}
const transcribeAudio = (audio, offset, model) => call({ type: "transcribe", audio, offset, model }, [audio.buffer]);
const embedAudio = (audio) => call({ type: "embed", audio }, [audio.buffer]);

// ---------- Pegelanzeige & Aufnahme ----------
const meter = $("meter");
const BARS = 40;
for (let i = 0; i < BARS; i++) meter.append(document.createElement("span"));
let meterCtx = null;
let meterRaf = 0;
function startMeter(streams) {
  meterCtx = new AudioContext();
  const analysers = streams.map((stream) => {
    const a = meterCtx.createAnalyser();
    a.fftSize = 256;
    meterCtx.createMediaStreamSource(stream).connect(a);
    return a;
  });
  const data = new Uint8Array(128);
  const levels = new Array(BARS).fill(0);
  meter.classList.add("live");
  const draw = () => {
    let peak = 0;
    for (const a of analysers) {
      a.getByteTimeDomainData(data);
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    }
    levels.shift();
    levels.push(Math.min(1, peak * 2.2));
    meter.childNodes.forEach((bar, i) => (bar.style.height = `${8 + levels[i] * 92}%`));
    meterRaf = requestAnimationFrame(draw);
  };
  draw();
}
function stopMeter() {
  cancelAnimationFrame(meterRaf);
  meterCtx?.close();
  meterCtx = null;
  meter.classList.remove("live");
  meter.childNodes.forEach((bar) => (bar.style.height = "8%"));
}
function setRecordButton(on) {
  ui.record.classList.toggle("recording", on);
  ui.record.querySelector(".label").textContent = on ? "Aufnahme beenden" : "Aufnahme starten";
  ui.record.setAttribute("aria-label", on ? "Aufnahme beenden" : "Aufnahme starten");
}
function setStatus(text, cls = "idle") {
  ui.status.textContent = text;
  ui.status.className = `status ${cls}`;
}
const speakersValue = (input) => {
  const n = parseInt(input.value, 10);
  return n >= 1 ? Math.min(n, 30) : null;
};

let rec = null;
let timer = null;
let busy = false;

function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function needFolder() {
  const box = $("storage");
  box.classList.remove("attention");
  void box.offsetWidth; // Animation neu starten
  box.classList.add("attention");
  box.scrollIntoView({ behavior: "smooth", block: "center" });
  toast(
    folder.state === "unsupported"
      ? "Aufnahme nicht möglich: Dieser Browser kann keinen Speicherordner nutzen – bitte Edge oder Chrome verwenden."
      : folder.state === "prompt"
        ? "Aufnahme nicht möglich: Bitte oben zuerst den Zugriff auf den Speicherordner erlauben."
        : "Aufnahme nicht möglich: Bitte oben zuerst einen Speicherordner wählen.",
  );
}

async function startRecording() {
  if (!folder.ready) return needFolder();
  if (!ui.mic.checked && !ui.system.checked) return alert("Bitte mindestens eine Quelle auswählen.");
  const streams = {};
  const all = [];
  try {
    if (ui.system.checked) {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: "include",
      });
      all.push(display);
      if (display.getAudioTracks().length) streams.system = new MediaStream(display.getAudioTracks());
      else if (!confirm("Es wurde kein Ton geteilt („Systemaudio teilen“ nicht angehakt). Nur mit Mikrofon weiter?")) {
        throw new Error("abgebrochen");
      }
    }
    if (ui.mic.checked) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      all.push(mic);
      streams.mic = mic;
    }
    if (!Object.keys(streams).length) throw new Error("Keine Audioquelle verfügbar.");
  } catch (err) {
    all.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    if (err.message !== "abgebrochen" && err.name !== "NotAllowedError") alert(`Aufnahme nicht möglich: ${err.message}`);
    return;
  }

  const mimeType = pickMime();
  const recorders = {};
  const startedAt = Date.now();
  let live = null;
  if (ui.live.checked) {
    // Live: Audio nur im Arbeitsspeicher verarbeiten, nichts aufzeichnen
    try {
      live = await startLive(streams, startedAt);
    } catch (err) {
      all.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      return alert(`Live-Transkript nicht möglich: ${err.message}`);
    }
  } else {
    for (const [key, stream] of Object.entries(streams)) {
      const mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorders[key] = { mr, chunks };
    }
    Object.values(recorders).forEach((r) => r.mr.start(5000));
  }
  rec = { startedAt, t0: performance.now(), recorders, streams: all, mimeType, live };
  ui.live.disabled = ui.auto.disabled = true;

  ui.mic.disabled = ui.system.disabled = true;
  setRecordButton(true);
  try {
    startMeter(Object.values(streams));
  } catch (err) {
    console.warn("Pegelanzeige nicht verfügbar", err);
  }
  tick();
  timer = setInterval(tick, 500);
}

function tick() {
  const t = formatTimestamp((performance.now() - rec.t0) / 1000);
  setStatus(`● AUFNAHME LÄUFT  ${t}`, "rec");
  document.title = `● Aufnahme ${t} – Transcripter`;
}

async function stopRecording() {
  clearInterval(timer);
  const current = rec;
  rec = null;
  const duration = (performance.now() - current.t0) / 1000;
  if (current.live) return finishLive(current, duration);
  await Promise.all(
    Object.values(current.recorders).map(
      ({ mr }) => new Promise((resolve) => (mr.state === "inactive" ? resolve() : ((mr.onstop = resolve), mr.stop()))),
    ),
  );
  stopMeter();
  current.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));

  const tracks = {};
  for (const [key, { chunks }] of Object.entries(current.recorders)) {
    tracks[key] = { blob: new Blob(chunks, { type: current.mimeType || "audio/webm" }), label: LABELS[key] };
  }
  const session = {
    id: `s${current.startedAt}`,
    title: ui.title.value.trim(),
    startedAt: current.startedAt,
    duration,
    tracks,
    numSpeakers: speakersValue(ui.speakers),
    transcript: null,
  };
  await saveSession(session);

  ui.mic.disabled = ui.system.disabled = false;
  ui.live.disabled = false;
  ui.auto.disabled = ui.live.checked;
  ui.title.value = "";
  setRecordButton(false);
  renderStorage();
  document.title = "Transcripter";
  setStatus(`Gespeichert: ${displayTitle(session)} (${formatTimestamp(duration)})`);
  await render();
  if (ui.auto.checked) {
    enqueue(session.id, { model: ui.model.value, diarize: ui.diarize.checked, numSpeakers: session.numSpeakers });
  }
}
ui.record.onclick = () => (rec ? stopRecording() : startRecording());
ui.live.onchange = () => (ui.auto.disabled = ui.live.checked);

// ---------- Live-Transkript (ohne Audio zu speichern) ----------
const LIVE_MIN_S = 12; // Stückgröße: frühestens nach 12 s an einer leisen Stelle schneiden

function concatParts(parts, len) {
  const out = new Float32Array(len);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

async function startLive(streams, startedAt) {
  let model = ui.model.value;
  if (model === "turbo" && !navigator.gpu) model = "small";
  const ctx = new AudioContext({ sampleRate: SR });
  await ctx.audioWorklet.addModule(new URL("./pcm-worklet.js", import.meta.url));
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mute.connect(ctx.destination);
  const state = {
    ctx,
    model,
    startedAt,
    diarize: ui.diarize.checked,
    numSpeakers: speakersValue(ui.speakers),
    tracks: {},
    jobs: [],
    running: null,
  };
  for (const [key, stream] of Object.entries(streams)) {
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-tap");
    const track = (state.tracks[key] = { label: LABELS[key], parts: [], len: 0, offset: 0, segs: [] });
    node.port.onmessage = ({ data }) => {
      track.parts.push(data);
      track.len += data.length;
      cutLive(state, key, false);
    };
    src.connect(node).connect(mute);
  }
  $("live-lines").replaceChildren();
  $("live-lag").textContent = "Sprachmodell wird vorbereitet …";
  $("live-panel").hidden = false;
  onLoadProgress = (loaded, total) =>
    ($("live-lag").textContent = `Modell wird geladen (einmalig) … ${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`);
  worker.postMessage({ type: "load", model, speaker: state.diarize }); // vorladen, während schon aufgenommen wird
  return state;
}

/** Puffer einer Spur an einer leisen Stelle abschneiden und zur Verarbeitung einreihen. */
function cutLive(state, key, force) {
  const t = state.tracks[key];
  if (!force && t.len < LIVE_MIN_S * SR) return;
  if (force && t.len < SR / 3) return;
  const all = concatParts(t.parts, t.len);
  const cut = force ? all.length : findCut(all, SR);
  if (cut < 0) return;
  state.jobs.push({ key, samples: all.slice(0, cut), offset: t.offset });
  const rest = all.slice(cut);
  t.parts = rest.length ? [rest] : [];
  t.len = rest.length;
  t.offset += cut / SR;
  pumpLive(state);
}

function pumpLive(state) {
  if (state.running) return;
  state.running = processLive(state).finally(() => {
    state.running = null;
    if (state.jobs.length) pumpLive(state);
  });
}

async function processLive(state) {
  while (state.jobs.length) {
    const job = state.jobs.shift();
    const t = state.tracks[job.key];
    showLag(state);
    try {
      await processLiveJob(state, job, t);
    } catch (err) {
      console.error(err);
      state.error = err.message;
      $("live-lag").textContent = `Fehler bei der Live-Transkription: ${err.message}`;
    }
    if (!state.error) showLag(state);
  }
}

async function processLiveJob(state, job, t) {
  {
    for (const r of speechRegions(job.samples, SR)) {
      const audio = job.samples.slice(Math.floor(r.start * SR), Math.ceil(r.end * SR));
      const chunks = await transcribeAudio(audio, job.offset + r.start, state.model);
      onLoadProgress = null;
      for (const c of chunks) {
        if (isHallucination(c.text)) continue;
        const seg = { start: c.start, end: c.end, text: c.text, speaker: t.label, key: job.key };
        if (state.diarize) {
          const rel = { start: c.start - job.offset, end: c.end - job.offset };
          seg.emb = normalize(await embedAudio(speakerWindow(job.samples, rel)));
        }
        t.segs.push(seg);
        addLiveLine(seg);
      }
    }
  }
}

function showLag(state) {
  const queued = state.jobs.reduce((a, j) => a + j.samples.length / SR, 0);
  $("live-lag").textContent =
    queued > 20 ? `Rückstand ${formatTimestamp(queued)} – wird nach dem Ende fertig verarbeitet` : "läuft";
}

function addLiveLine(seg) {
  const box = $("live-lines");
  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  const line = document.createElement("div");
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = formatTimestamp(seg.start);
  const w = document.createElement("span");
  w.className = `w${seg.key === "system" ? " remote" : ""}`;
  w.textContent = `${seg.speaker}:`;
  line.append(t, w, document.createTextNode(seg.text.trim()));
  box.append(line);
  if (atEnd) box.scrollTop = box.scrollHeight;
}

let liveFinishing = false;
async function finishLive(current, duration) {
  const state = current.live;
  liveFinishing = true;
  stopMeter();
  current.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  await state.ctx.close();
  for (const key of Object.keys(state.tracks)) cutLive(state, key, true);
  setRecordButton(false);
  ui.record.disabled = true;
  setStatus("Live-Transkript wird fertiggestellt …");
  while (state.running) await state.running;

  const tracks = Object.fromEntries(Object.entries(state.tracks).map(([k, t]) => [k, t.segs]));
  if (state.diarize) assignSpeakers(tracks, Object.fromEntries(Object.entries(state.tracks).map(([k, t]) => [k, t.label])), state.numSpeakers);
  for (const segs of Object.values(tracks)) for (const seg of segs) delete seg.key;
  const session = {
    id: `l${state.startedAt}`,
    title: ui.title.value.trim(),
    startedAt: state.startedAt,
    duration,
    tracks: {}, // bewusst kein Audio
    sources: Object.keys(state.tracks),
    live: true,
    numSpeakers: state.numSpeakers,
    model: state.model,
    transcript: null,
  };
  session.transcript = toMarkdown(mergeTracks(tracks), displayTitle(session), session.startedAt);
  await saveSession(session);
  liveFinishing = false;
  if (state.error) alert(`Bei der Live-Transkription ist ein Fehler aufgetreten: ${state.error}\nDas bisher erkannte Transkript wurde gespeichert.`);

  ui.record.disabled = false;
  ui.mic.disabled = ui.system.disabled = ui.live.disabled = false;
  ui.auto.disabled = ui.live.checked;
  ui.title.value = "";
  $("live-panel").hidden = true;
  renderStorage();
  document.title = "Transcripter";
  setStatus(`Gespeichert: ${displayTitle(session)} (${formatTimestamp(duration)}, ohne Audio)`);
  await render();
  showTranscript(session);
}

// ---------- Transkription ----------
const queue = []; // [{ id, model, diarize, numSpeakers }]
const inQueue = (id) => queue.some((j) => j.id === id);

function enqueue(id, opts) {
  if (!inQueue(id)) queue.push({ id, ...opts });
  render();
  runQueue();
}

async function runQueue() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue[0];
    const session = await getSession(job.id);
    try {
      if (session) await transcribeSession(session, job);
    } catch (err) {
      console.error(err);
      const net = /fetch|network|load/i.test(err.message)
        ? "\n\nVermutlich konnte das Sprachmodell nicht geladen werden (Internet/Firewall). Bitte später erneut versuchen oder das schnelle Modell wählen."
        : "";
      alert(`Transkription fehlgeschlagen: ${err.message}${net}`);
    }
    queue.shift();
    await render();
  }
  busy = false;
  ui.work.hidden = true;
}

/**
 * Ordnet Sätze anhand ihrer Stimmabdrücke (seg.emb) Sprechern zu.
 * Die System-Spur (Remote) wird zuerst automatisch erkannt, das Mikrofon bekommt den Rest der Personenzahl.
 */
function assignSpeakers(tracks, labels, numSpeakers) {
  const keys = Object.keys(tracks);
  const order = [...keys].sort((a, b) => (a === "system" ? -1 : b === "system" ? 1 : 0));
  let systemFound = 0;
  for (const key of order) {
    const segs = tracks[key].filter((x) => x.emb);
    const fixed = speakersForTrack(numSpeakers, key, keys, systemFound);
    if (segs.length < 2 || fixed === 1) {
      if (key === "system") systemFound = tracks[key].length ? 1 : 0;
    } else {
      const ids = clusterSpeakers(
        segs.map((x) => x.emb),
        { numSpeakers: fixed, durations: segs.map((x) => Math.max(0.1, x.end - x.start)) },
      );
      const count = new Set(ids).size;
      if (key === "system") systemFound = count;
      segs.forEach((seg, i) => (seg.speaker = speakerLabel(ids[i], count, labels[key])));
    }
    for (const seg of tracks[key]) delete seg.emb;
  }
}

/** Audioausschnitt für den Stimmabdruck: mindestens 1,5 s (mit Umgebung), höchstens 10 s aus der Mitte. */
function speakerWindow(samples, seg) {
  let start = seg.start;
  let end = Math.max(seg.end, seg.start + 0.1);
  const len = end - start;
  if (len < 1.5) {
    start -= (1.5 - len) / 2;
    end += (1.5 - len) / 2;
  } else if (len > 10) {
    const mid = (start + end) / 2;
    start = mid - 5;
    end = mid + 5;
  }
  const a = Math.max(0, Math.floor(start * SR));
  const b = Math.min(samples.length, Math.ceil(end * SR));
  return samples.slice(a, Math.max(b, a + SR / 2));
}

async function decodeMono16k(blob) {
  const ctx = new AudioContext({ sampleRate: SR });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close();
  }
}

function loadingLabel(what) {
  return (loaded, total) => {
    ui.workLabel.textContent = `${what} wird geladen (einmalig) … ${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`;
    ui.progress.value = (100 * loaded) / total;
  };
}

async function transcribeSession(session, job) {
  let model = job.model || "small";
  if (model === "turbo" && !navigator.gpu) {
    alert("Dieser Browser/Rechner unterstützt kein WebGPU – es wird das schnelle Modell verwendet.");
    model = "small";
  }
  const name = displayTitle(session);
  ui.work.hidden = false;
  ui.progress.value = 0;
  ui.workLabel.textContent = `${name}: Audio wird vorbereitet …`;

  const prepared = [];
  let totalSpeech = 0;
  let duration = session.duration || 0;
  for (const [key, track] of Object.entries(session.tracks)) {
    const samples = await decodeMono16k(track.blob);
    duration = Math.max(duration, samples.length / SR);
    const regions = speechRegions(samples, SR);
    totalSpeech += regions.reduce((a, r) => a + r.end - r.start, 0);
    prepared.push({ key, label: track.label, samples, regions });
  }

  onLoadProgress = loadingLabel("Sprachmodell");
  const share = job.diarize ? 85 : 100;
  const tracks = {};
  let done = 0;
  for (const { key, label, samples, regions } of prepared) {
    tracks[key] = [];
    for (const r of regions) {
      const audio = samples.slice(Math.floor(r.start * SR), Math.ceil(r.end * SR));
      const chunks = await transcribeAudio(audio, r.start, model);
      onLoadProgress = null;
      for (const c of chunks) if (!isHallucination(c.text)) tracks[key].push({ ...c, speaker: label });
      done += r.end - r.start;
      ui.workLabel.textContent = `${name}: transkribiere ${TRACK_NAMES[key] || "Audio"} …`;
      ui.progress.value = totalSpeech ? (share * done) / totalSpeech : share;
    }
  }

  if (job.diarize) {
    // Stimmabdruck je Satz (nicht nötig, wenn eine einzelne Spur fest 1 Person hat)
    const single = prepared.length === 1;
    let doneSegs = 0;
    const totalSegs = Object.values(tracks).reduce((a, t) => a + t.length, 0) || 1;
    for (const { key, samples } of prepared) {
      const segs = tracks[key];
      if (segs.length < 2 || (single && job.numSpeakers === 1)) continue;
      ui.workLabel.textContent = `${name}: Sprecher werden erkannt …`;
      onLoadProgress = loadingLabel("Stimmen-Modell");
      for (const seg of segs) {
        seg.emb = normalize(await embedAudio(speakerWindow(samples, seg)));
        onLoadProgress = null;
        doneSegs++;
        ui.progress.value = 85 + (15 * doneSegs) / totalSegs;
      }
    }
    assignSpeakers(tracks, Object.fromEntries(prepared.map((p) => [p.key, p.label])), job.numSpeakers);
  }

  session.transcript = toMarkdown(mergeTracks(tracks), name, session.startedAt);
  session.duration = duration;
  session.model = model;
  await saveSession(session);
  ui.progress.value = 100;
  ui.workLabel.textContent = `Fertig: ${name}`;
  showTranscript(session);
}

// ---------- Transkripte: Liste & Ansicht ----------
function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

let viewing = null;
function showTranscript(session) {
  viewing = session;
  if (location.hash !== "#transkripte") location.hash = "#transkripte";
  else showView("transcripts");
  $("viewer-empty").hidden = true;
  $("viewer-body").hidden = false;
  $("viewer-title").textContent = displayTitle(session);
  const when = new Date(session.startedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  const tracks =
    (session.sources || Object.keys(session.tracks)).map((k) => TRACK_NAMES[k] || k).join(" + ") +
    (session.live ? " · Live, ohne Audio" : "");
  const file = session.files?.md ? ` · Datei: ${session.files.md}` : "";
  $("viewer-meta").textContent = `${when} · ${session.duration ? formatTimestamp(session.duration) : "–"} · ${tracks}${file}`;
  $("copy").disabled = $("download-md").disabled = $("export-pdf").disabled = $("export-docx").disabled = !session.transcript;
  $("retranscribe").textContent = session.transcript ? "Neu transkribieren …" : "Transkribieren …";
  const hasAudio = Object.keys(session.tracks).length > 0;
  $("retranscribe").disabled = inQueue(session.id) || !hasAudio;
  $("download-audio").disabled = !hasAudio;
  $("retranscribe").title = hasAudio ? "" : "Live-Transkript: kein Audio gespeichert";
  if (session.transcript) renderTranscript(session.transcript);
  else {
    ui.transcript.replaceChildren();
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = inQueue(session.id) ? "Wird gerade transkribiert …" : "Noch nicht transkribiert.";
    ui.transcript.append(p);
  }
  markSelected();
}
function markSelected() {
  ui.list.querySelectorAll(".item").forEach((el) => el.classList.toggle("selected", el.dataset.id === viewing?.id));
}

$("copy").onclick = () => navigator.clipboard.writeText(viewing?.transcript || "");
$("download-md").onclick = () =>
  viewing?.transcript && download(new Blob([viewing.transcript], { type: "text/markdown" }), `${fileBase(viewing)}.md`);
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 4500);
}

let jsPdfLoading = null;
function loadJsPdf() {
  jsPdfLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("./vendor/jspdf.umd.min.js", import.meta.url).href;
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error("PDF-Bibliothek konnte nicht geladen werden"));
    document.head.append(s);
  });
  return jsPdfLoading;
}

/** Export als PDF oder Word: in den Speicherordner (falls gewählt), sonst als Download. */
async function exportAs(kind) {
  if (!viewing?.transcript) return;
  try {
    const blob =
      kind === "pdf"
        ? new Blob([toPdf(viewing.transcript, await loadJsPdf())], { type: "application/pdf" })
        : new Blob([toDocx(viewing.transcript)], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
    const name = `${fileBase(viewing)}.${kind}`;
    if (folder.ready && (await folder.write(name, blob))) toast(`Gespeichert im Speicherordner „${folder.name}“: ${name}`);
    else download(blob, name);
  } catch (err) {
    console.error(err);
    alert(`Export fehlgeschlagen: ${err.message}`);
  }
}
$("export-pdf").onclick = () => exportAs("pdf");
$("export-docx").onclick = () => exportAs("docx");

$("download-audio").onclick = () => {
  if (!viewing) return;
  for (const [key, t] of Object.entries(viewing.tracks)) {
    const ext = (t.blob.type || "").includes("ogg") ? "ogg" : (t.blob.name?.split(".").pop() ?? "webm");
    download(t.blob, `${fileBase(viewing)}_${key}.${ext}`);
  }
};
$("delete").onclick = async () => {
  if (!viewing || inQueue(viewing.id)) return;
  const inFolder = viewing.files?.md || Object.keys(viewing.files || {}).length ? " Die Dateien im Speicherordner bleiben erhalten." : "";
  if (!confirm(`„${displayTitle(viewing)}“ aus der Liste löschen?${inFolder}`)) return;
  await deleteSession(viewing.id);
  viewing = null;
  $("viewer-body").hidden = true;
  $("viewer-empty").hidden = false;
  render();
};
$("edit-title").onclick = async () => {
  if (!viewing) return;
  const title = prompt("Titel der Aufnahme:", viewing.title || "")?.trim();
  if (title === undefined || title === null || title === (viewing.title || "")) return;
  viewing.title = title;
  if (viewing.transcript) viewing.transcript = setMarkdownTitle(viewing.transcript, displayTitle(viewing));
  await saveSession(viewing);
  render();
};

// Dialog „Neu transkribieren“: Modell, Sprechererkennung und Personenzahl vor dem Start wählen
const reDialog = $("re-dialog");
$("retranscribe").onclick = () => {
  if (!viewing) return;
  $("re-name").textContent = displayTitle(viewing);
  $("re-model").value = viewing.model || ui.model.value;
  $("re-diarize").checked = true;
  $("re-speakers").value = viewing.numSpeakers || "";
  reDialog.showModal();
};
reDialog.addEventListener("close", async () => {
  if (reDialog.returnValue !== "ok" || !viewing) return;
  viewing.numSpeakers = speakersValue($("re-speakers"));
  await putSession(viewing);
  enqueue(viewing.id, {
    model: $("re-model").value,
    diarize: $("re-diarize").checked,
    numSpeakers: viewing.numSpeakers,
  });
  showTranscript(viewing);
});

function chip(text, cls) {
  const c = document.createElement("span");
  c.className = `chip ${cls}`;
  c.textContent = text;
  return c;
}

/** Erster gesprochener Satz als Vorschau */
function preview(markdown) {
  const m = markdown?.match(/^\*\*\[[\d:]+\]\*\*(?: \*\*.+?:\*\*)? (.*)$/m);
  return m ? m[1] : "";
}

/** Markdown-Transkript als Gesprächsverlauf anzeigen (Zeitstempel, Sprecher, Text). */
const colorOf = new Map();
function speakerColor(name) {
  if (!colorOf.has(name)) colorOf.set(name, colorOf.size % 6);
  return colorOf.get(name);
}
function renderTranscript(markdown) {
  ui.transcript.replaceChildren();
  colorOf.clear();
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\*\*\[(\d\d:\d\d:\d\d)\]\*\*(?: \*\*(.+?):\*\*)? (.*)$/);
    if (!m) continue;
    const [, time, who, text] = m;
    const row = document.createElement("div");
    row.className = "utt";
    if (who) row.dataset.color = String(speakerColor(who));
    const t = document.createElement("time");
    t.textContent = time;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (who) {
      const w = document.createElement("div");
      w.className = "who";
      w.textContent = who;
      w.title = "Klicken zum Umbenennen";
      w.onclick = () => renameInViewer(who);
      bubble.append(w);
    }
    bubble.append(document.createTextNode(text));
    row.append(t, bubble);
    ui.transcript.append(row);
  }
  if (!ui.transcript.querySelector(".utt")) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Keine Sprache erkannt.";
    ui.transcript.append(empty);
  }
}
async function renameInViewer(from) {
  const to = prompt(`Neuer Name für „${from}“ (gilt für das ganze Transkript):`, from)?.trim();
  if (!to || to === from || !viewing) return;
  viewing.transcript = renameSpeaker(viewing.transcript, from, to);
  await saveSession(viewing);
  renderTranscript(viewing.transcript);
}

function item(s) {
  const el = document.createElement("button");
  el.className = "item";
  el.dataset.id = s.id;
  const state = inQueue(s.id) ? chip("läuft", "busy") : s.transcript ? chip("✓ Fertig", "done") : chip("Offen", "open");
  const head = document.createElement("div");
  head.className = "item-head";
  const title = document.createElement("strong");
  title.textContent = displayTitle(s);
  head.append(title, state);
  const meta = document.createElement("div");
  meta.className = "item-meta";
  const when = new Date(s.startedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  meta.textContent = `${when} · ${s.duration ? formatTimestamp(s.duration) : "–"}${s.tracks.file ? " · Audiodatei" : ""}${s.live ? " · Live" : ""}`;
  const text = document.createElement("div");
  text.className = "item-preview";
  text.textContent = preview(s.transcript) || (s.transcript ? "Keine Sprache erkannt" : "Noch nicht transkribiert");
  el.append(head, meta, text);
  el.onclick = () => showTranscript(s);
  return el;
}

function matches(s, q) {
  if (!q) return true;
  const hay = [
    s.title || "",
    s.transcript || "",
    new Date(s.startedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }),
    new Date(s.startedAt).toLocaleDateString("de-DE"),
  ]
    .join("\n")
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

async function render() {
  const sessions = await allSessions();
  $("nav-count").textContent = sessions.length;
  ui.empty.hidden = sessions.length > 0;
  ui.recent.replaceChildren(...sessions.slice(0, 3).map(item));
  const q = ui.search.value.trim().toLowerCase();
  const hits = sessions.filter((s) => matches(s, q));
  ui.list.replaceChildren(...hits.map(item));
  $("no-hits").hidden = hits.length > 0 || !sessions.length;
  if (viewing) {
    viewing = sessions.find((s) => s.id === viewing.id) || null;
    if (viewing && !$("viewer-body").hidden && viewFromHash() === "transcripts") showTranscript(viewing);
  }
  markSelected();
}
ui.search.oninput = () => render();

$("upload-label").addEventListener("click", (e) => {
  if (!folder.ready) {
    e.preventDefault();
    needFolder();
  }
});

ui.file.onchange = async () => {
  const file = ui.file.files[0];
  if (!file) return;
  if (!folder.ready) {
    ui.file.value = "";
    return needFolder();
  }
  const session = {
    id: `f${Date.now()}`,
    title: ui.title.value.trim() || file.name.replace(/\.[^.]+$/, ""),
    startedAt: file.lastModified || Date.now(),
    duration: 0,
    tracks: { file: { blob: file, label: null } },
    numSpeakers: speakersValue(ui.speakers),
    transcript: null,
  };
  await saveSession(session);
  ui.file.value = "";
  ui.title.value = "";
  enqueue(session.id, { model: ui.model.value, diarize: ui.diarize.checked, numSpeakers: session.numSpeakers });
};

window.addEventListener("beforeunload", (e) => {
  if (rec || busy || liveFinishing) {
    e.preventDefault();
    e.returnValue = "";
  }
});

if (!window.crossOriginIsolated) console.info("Nicht cross-origin-isoliert – WebAssembly läuft einfädig (langsamer).");
if (!navigator.mediaDevices?.getDisplayMedia) ui.system.disabled = true;
if (!folderSupported) console.info("File System Access API nicht verfügbar – Ablage nur im Browser.");
await render();
renderStorage();
window.__transcripter = { enqueue, allSessions, queue }; // für automatische Tests
