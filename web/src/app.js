// Transcripter im Browser: Aufnahme (Mikrofon + geteilter System-/Tab-Ton), Ablage in IndexedDB,
// Transkription im Web-Worker. Es werden keine Audio- oder Textdaten an einen Server geschickt.
import {
  clusterSpeakers,
  formatTimestamp,
  isHallucination,
  mergeTracks,
  normalize,
  renameSpeaker,
  sessionFileName,
  sessionTitle,
  speakerLabel,
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
  diarize: $("diarize"),
  speakers: $("speakers"),
  list: $("sessions"),
  recent: $("recent"),
  search: $("search"),
  empty: $("empty"),
  file: $("file"),
  work: $("work"),
  workLabel: $("work-label"),
  progress: null, // siehe unten: Fortschritt → Ring
  viewer: $("viewer"),
  viewerTitle: $("viewer-title"),
  transcript: $("transcript"),
};
$("version").textContent = `v${VERSION}`;

// Fortschritt wird als Ring angezeigt (ui.progress.value = 0..100)
const ring = $("ring");
ui.progress = {
  set value(v) {
    const p = Math.max(0, Math.min(100, Math.round(v || 0)));
    ring.style.setProperty("--p", p);
    $("ring-value").textContent = `${p}%`;
    $("ring-sub").textContent = "in Arbeit";
  },
};
function resetRing(sub = "Bereit") {
  ring.style.setProperty("--p", 0);
  $("ring-value").textContent = "–";
  $("ring-sub").textContent = sub;
}

// Rechenwerk anzeigen
const engine = navigator.gpu ? "WebGPU" : window.crossOriginIsolated ? "CPU (mehrkernig)" : "CPU";
$("stat-engine").textContent = engine;
$("engine").textContent = `Lokal · ${engine}`;

// ---------- Seiten: #aufnehmen (Dashboard) und #transkripte (alle Transkripte) ----------
const PAGES = {
  record: ["Meeting-Transkription", "Aufnehmen, lokal transkribieren, als Markdown speichern"],
  transcripts: ["Transkripte", "Alle Aufnahmen und Transkripte in diesem Browser"],
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

// Pegelanzeige
const meter = $("meter");
const BARS = 36;
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
function embedAudio(audio) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: "embed", id, audio }, [audio.buffer]);
  });
}

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
  const session = { id: `s${current.startedAt}`, startedAt: current.startedAt, duration, tracks, transcript: null };
  await saveSession(session);

  ui.mic.disabled = ui.system.disabled = false;
  setRecordButton(false);
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
  resetRing("Fertig");
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
      ui.progress.value = totalSpeech ? ((ui.diarize.checked ? 85 : 100) * done) / totalSpeech : 100;
    }
  }

  if (ui.diarize.checked) {
    const fixed = Number(ui.speakers.value) || null;
    // Feste Anzahl nur bei einer Spur eindeutig (bei Mikrofon + System verteilt sie sich auf beide)
    const single = prepared.length === 1;
    let doneSegs = 0;
    const totalSegs = Object.values(tracks).reduce((a, t) => a + t.length, 0) || 1;
    for (const { key, label, samples } of prepared) {
      const segs = tracks[key];
      if (segs.length < 2) continue;
      ui.workLabel.textContent = `${name}: Sprecher werden erkannt …`;
      onLoadProgress = (loaded, total) => {
        ui.workLabel.textContent = `Stimmen-Modell wird geladen (einmalig) … ${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`;
      };
      const embeddings = [];
      for (const seg of segs) {
        embeddings.push(normalize(await embedAudio(speakerWindow(samples, seg))));
        onLoadProgress = null;
        doneSegs++;
        ui.progress.value = 85 + (15 * doneSegs) / totalSegs;
      }
      const labels = clusterSpeakers(embeddings, {
        numSpeakers: single ? fixed : null,
        durations: segs.map((x) => Math.max(0.1, x.end - x.start)),
      });
      const count = new Set(labels).size;
      segs.forEach((seg, i) => (seg.speaker = speakerLabel(labels[i], count, label)));
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
  if (location.hash !== "#transkripte") location.hash = "#transkripte";
  else showView("transcripts");
  $("viewer-empty").hidden = true;
  $("viewer-body").hidden = false;
  ui.viewerTitle.textContent = sessionTitle(session.startedAt);
  const tracks = Object.keys(session.tracks)
    .map((k) => ({ mic: "Mikrofon", system: "Teams/Zoom-Ton", file: "Audiodatei" })[k] || k)
    .join(" + ");
  $("viewer-meta").textContent = `${session.duration ? formatTimestamp(session.duration) : "–"} · ${tracks}`;
  $("copy").disabled = $("download-md").disabled = !session.transcript;
  $("retranscribe").textContent = session.transcript ? "Neu transkribieren" : "Jetzt transkribieren";
  $("retranscribe").disabled = queue.includes(session.id);
  if (session.transcript) renderTranscript(session.transcript);
  else {
    ui.transcript.replaceChildren();
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = queue.includes(session.id) ? "Wird gerade transkribiert …" : "Noch nicht transkribiert.";
    ui.transcript.append(p);
  }
  markSelected();
}
function markSelected() {
  ui.list.querySelectorAll(".item").forEach((el) => el.classList.toggle("selected", el.dataset.id === viewing?.id));
}
$("copy").onclick = () => navigator.clipboard.writeText(viewing?.transcript || "");
$("download-md").onclick = () =>
  viewing?.transcript &&
  download(new Blob([viewing.transcript], { type: "text/markdown" }), `${sessionFileName(viewing.startedAt)}.md`);
$("retranscribe").onclick = () => viewing && enqueue(viewing.id);
$("download-audio").onclick = () => {
  if (!viewing) return;
  for (const [key, t] of Object.entries(viewing.tracks)) {
    const ext = (t.blob.type || "").includes("ogg") ? "ogg" : (t.blob.name?.split(".").pop() ?? "webm");
    download(t.blob, `${sessionFileName(viewing.startedAt)}_${key}.${ext}`);
  }
};
$("delete").onclick = async () => {
  if (!viewing || queue.includes(viewing.id)) return;
  if (!confirm("Aufnahme und Transkript endgültig löschen?")) return;
  await deleteSession(viewing.id);
  viewing = null;
  $("viewer-body").hidden = true;
  $("viewer-empty").hidden = false;
  render();
};

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
function renderTranscript(markdown) {
  ui.transcript.replaceChildren();
  colorOf.clear();
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\*\*\[(\d\d:\d\d:\d\d)\]\*\*(?: \*\*(.+?):\*\*)? (.*)$/);
    if (m) {
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
    } else if (line.startsWith("Aufgenommen:")) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = line;
      ui.transcript.append(meta);
    }
  }
  if (!ui.transcript.querySelector(".utt")) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Keine Sprache erkannt.";
    ui.transcript.append(empty);
  }
}

const colorOf = new Map();
function speakerColor(name) {
  if (!colorOf.has(name)) colorOf.set(name, colorOf.size % 6);
  return colorOf.get(name);
}

async function renameInViewer(from) {
  const to = prompt(`Neuer Name für „${from}“ (gilt für das ganze Transkript):`, from)?.trim();
  if (!to || to === from || !viewing) return;
  viewing.transcript = renameSpeaker(viewing.transcript, from, to);
  await saveSession(viewing);
  renderTranscript(viewing.transcript);
}

function updateStats(sessions) {
  const total = sessions.reduce((a, s) => a + (s.duration || 0), 0);
  $("stat-count").textContent = sessions.length;
  $("stat-done").textContent = sessions.filter((s) => s.transcript).length;
  $("stat-time").textContent = `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}`;
}

function item(s) {
  const el = document.createElement("button");
  el.className = "item";
  el.dataset.id = s.id;
  const inQueue = queue.includes(s.id);
  const state = inQueue ? chip("läuft", "busy") : s.transcript ? chip("✓ Fertig", "done") : chip("Offen", "open");
  const head = document.createElement("div");
  head.className = "item-head";
  const title = document.createElement("strong");
  title.textContent = new Date(s.startedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  head.append(title, state);
  const meta = document.createElement("div");
  meta.className = "item-meta";
  meta.textContent = `${s.duration ? formatTimestamp(s.duration) : "–"}${s.tracks.file ? " · Audiodatei" : ""}`;
  const text = document.createElement("div");
  text.className = "item-preview";
  text.textContent = preview(s.transcript) || (s.transcript ? "Keine Sprache erkannt" : "Noch nicht transkribiert");
  el.append(head, meta, text);
  el.onclick = () => showTranscript(s);
  return el;
}

async function render() {
  const sessions = await allSessions();
  updateStats(sessions);
  $("nav-count").textContent = sessions.length;
  ui.empty.hidden = sessions.length > 0;
  ui.recent.replaceChildren(...sessions.slice(0, 3).map(item));

  const q = ui.search.value.trim().toLowerCase();
  const hits = sessions.filter(
    (s) =>
      !q ||
      (s.transcript || "").toLowerCase().includes(q) ||
      new Date(s.startedAt).toLocaleString("de-DE").includes(q),
  );
  ui.list.replaceChildren(...hits.map(item));
  $("no-hits").hidden = hits.length > 0 || !sessions.length;
  if (viewing) {
    viewing = sessions.find((s) => s.id === viewing.id) || null;
    if (viewing && !$("viewer-body").hidden && viewFromHash() === "transcripts") showTranscript(viewing);
  }
  markSelected();
}
ui.search.oninput = () => render();

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
