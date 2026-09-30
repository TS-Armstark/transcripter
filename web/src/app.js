// Transcripter im Browser: Aufnahme (Mikrofon + geteilter System-/Tab-Ton), Ablage in IndexedDB,
// Transkription im Web-Worker. Es werden keine Audio- oder Textdaten an einen Server geschickt.
import {
  formatTimestamp,
  isHallucination,
  mergeTracks,
  sessionFileName,
  sessionTitle,
  speechRegions,
  toMarkdown,
} from "./lib.js";

const VERSION = "0.1.0-web";
const SR = 16000;
const LABELS = { mic: "Ich/Raum", system: "Remote" };

const $ = (id) => document.getElementById(id);
const ui = {
  status: $("status"),
  record: $("record"),
  mic: $("src-mic"),
  system: $("src-system"),
  auto: $("auto"),
  model: $("model"),
  tbody: document.querySelector("#sessions tbody"),
  empty: $("empty"),
  file: $("file"),
  work: $("work"),
  workLabel: $("work-label"),
  progress: $("progress"),
  viewer: $("viewer"),
  viewerTitle: $("viewer-title"),
  transcript: $("transcript"),
};
$("version").textContent = VERSION;

// ---------- Ablage (IndexedDB, nur in diesem Browser) ----------
const db = await new Promise((resolve, reject) => {
  const req = indexedDB.open("transcripter", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("sessions", { keyPath: "id" });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const store = (mode) => db.transaction("sessions", mode).objectStore("sessions");
const dbCall = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const saveSession = (s) => dbCall(store("readwrite").put(s));
const deleteSession = (id) => dbCall(store("readwrite").delete(id));
const allSessions = async () => (await dbCall(store("readonly").getAll())).sort((a, b) => b.startedAt - a.startedAt);
navigator.storage?.persist?.(); // Browser soll die Daten nicht automatisch aufräumen

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
function transcribeAudio(audio, offset, model) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: "transcribe", id, audio, offset, model }, [audio.buffer]);
  });
}

// ---------- Aufnahme ----------
let rec = null; // { startedAt, t0, recorders: {key: {mr, chunks}}, streams: [] }
let timer = null;
let busy = false;

function setStatus(text, cls = "idle") {
  ui.status.textContent = text;
  ui.status.className = `status ${cls}`;
}

function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

async function startRecording() {
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
  for (const [key, stream] of Object.entries(streams)) {
    const mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
    const chunks = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorders[key] = { mr, chunks };
  }
  Object.values(recorders).forEach((r) => r.mr.start(5000));
  rec = { startedAt: Date.now(), t0: performance.now(), recorders, streams: all, mimeType };

  // Beendet der Nutzer die Bildschirmfreigabe über die Browser-Leiste, läuft das Mikrofon weiter.
  ui.mic.disabled = ui.system.disabled = true;
  ui.record.textContent = "■ Aufnahme beenden";
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
  await Promise.all(
    Object.values(current.recorders).map(
      ({ mr }) => new Promise((resolve) => (mr.state === "inactive" ? resolve() : ((mr.onstop = resolve), mr.stop()))),
    ),
  );
  current.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));

  const tracks = {};
  for (const [key, { chunks }] of Object.entries(current.recorders)) {
    tracks[key] = { blob: new Blob(chunks, { type: current.mimeType || "audio/webm" }), label: LABELS[key] };
  }
  const session = { id: `s${current.startedAt}`, startedAt: current.startedAt, duration, tracks, transcript: null };
  await saveSession(session);

  ui.mic.disabled = ui.system.disabled = false;
  ui.record.textContent = "● Aufnahme starten";
  document.title = "Transcripter";
  setStatus(`Gespeichert (${formatTimestamp(duration)})`);
  await render();
  if (ui.auto.checked) enqueue(session.id);
}

ui.record.onclick = () => (rec ? stopRecording() : startRecording());

// ---------- Transkription ----------
const queue = [];
function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  render();
  runQueue();
}

async function runQueue() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const id = queue[0];
    const session = await dbCall(store("readonly").get(id));
    try {
      if (session) await transcribeSession(session);
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

function chosenModel() {
  if (ui.model.value === "turbo" && !navigator.gpu) {
    alert("Dieser Browser/Rechner unterstützt kein WebGPU – es wird das schnelle Modell verwendet.");
    ui.model.value = "small";
  }
  return ui.model.value;
}

async function transcribeSession(session) {
  const model = chosenModel();
  ui.work.hidden = false;
  ui.progress.value = 0;
  const name = sessionTitle(session.startedAt);

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

  onLoadProgress = (loaded, total) => {
    ui.workLabel.textContent = `Sprachmodell wird geladen (einmalig) … ${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`;
    ui.progress.value = (100 * loaded) / total;
  };

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
      ui.workLabel.textContent = `${name}: transkribiere ${label || "Audio"} …`;
      ui.progress.value = totalSpeech ? (100 * done) / totalSpeech : 100;
    }
  }

  session.transcript = toMarkdown(mergeTracks(tracks), name, session.startedAt);
  session.duration = duration;
  await saveSession(session);
  ui.workLabel.textContent = `Fertig: ${name}`;
  showTranscript(session);
}

// ---------- Liste & Anzeige ----------
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
  ui.viewer.hidden = false;
  ui.viewerTitle.textContent = sessionTitle(session.startedAt);
  ui.transcript.textContent = session.transcript;
  ui.viewer.scrollIntoView({ behavior: "smooth" });
}
$("close-viewer").onclick = () => (ui.viewer.hidden = true);
$("copy").onclick = () => navigator.clipboard.writeText(viewing?.transcript || "");
$("download-md").onclick = () =>
  viewing && download(new Blob([viewing.transcript], { type: "text/markdown" }), `${sessionFileName(viewing.startedAt)}.md`);

function button(text, onclick, disabled = false) {
  const b = document.createElement("button");
  b.textContent = text;
  b.disabled = disabled;
  b.onclick = onclick;
  return b;
}

async function render() {
  const sessions = await allSessions();
  ui.tbody.replaceChildren();
  ui.empty.hidden = sessions.length > 0;
  for (const s of sessions) {
    const tr = document.createElement("tr");
    const inQueue = queue.includes(s.id);
    const state = inQueue ? "läuft …" : s.transcript ? "✔" : "–";
    for (const text of [
      new Date(s.startedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }),
      s.duration ? formatTimestamp(s.duration) : "?",
      state,
    ]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    const actions = document.createElement("td");
    actions.className = "actions";
    actions.append(
      button("Anzeigen", () => showTranscript(s), !s.transcript),
      button("Transkribieren", () => enqueue(s.id), inQueue),
      button("Audio ↓", () => {
        for (const [key, t] of Object.entries(s.tracks)) {
          const ext = (t.blob.type || "").includes("ogg") ? "ogg" : (t.blob.name?.split(".").pop() ?? "webm");
          download(t.blob, `${sessionFileName(s.startedAt)}_${key}.${ext}`);
        }
      }),
      button("Löschen", async () => {
        if (!confirm("Aufnahme und Transkript endgültig löschen?")) return;
        await deleteSession(s.id);
        if (viewing?.id === s.id) ui.viewer.hidden = true;
        render();
      }, inQueue),
    );
    tr.append(actions);
    ui.tbody.append(tr);
  }
}

ui.file.onchange = async () => {
  const file = ui.file.files[0];
  if (!file) return;
  const session = {
    id: `f${Date.now()}`,
    startedAt: file.lastModified || Date.now(),
    duration: 0,
    tracks: { file: { blob: file, label: null } },
    transcript: null,
  };
  await saveSession(session);
  ui.file.value = "";
  enqueue(session.id);
};

window.addEventListener("beforeunload", (e) => {
  if (rec || busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});

if (!window.crossOriginIsolated) console.info("Nicht cross-origin-isoliert – WebAssembly läuft einfädig (langsamer).");
if (!navigator.mediaDevices?.getDisplayMedia) ui.system.disabled = true;
await render();
window.__transcripter = { enqueue, allSessions, queue }; // für automatische Tests
