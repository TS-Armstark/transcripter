// Reine Logik ohne Browser-APIs (in Node testbar): Sprach-Erkennung per Energie, Echo-Filter, Markdown.

export const LANGUAGE = "german";

export function formatTimestamp(seconds) {
  const total = Math.floor(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Findet Abschnitte mit Sprache (einfache Energie-Schwelle statt VAD-Modell).
 * Spart Rechenzeit (System-Spur ist oft still) und verhindert Whisper-Halluzinationen auf Stille.
 * @returns {{start:number,end:number}[]} Sekunden, jeweils höchstens maxLen lang
 */
export function speechRegions(samples, sampleRate, opts = {}) {
  const { frameMs = 30, minRms = 0.004, noiseFactor = 3, hangoverS = 0.6, mergeGapS = 1.0, minLenS = 0.3, maxLenS = 28 } =
    opts;
  const frame = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const nFrames = Math.floor(samples.length / frame);
  if (nFrames === 0) return [];

  const rms = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let sum = 0;
    for (let j = i * frame; j < (i + 1) * frame; j++) sum += samples[j] * samples[j];
    rms[i] = Math.sqrt(sum / frame);
  }
  // Rauschboden = 10%-Quantil, Schwelle ein Vielfaches davon (mindestens minRms). Nach oben begrenzt auf die
  // halbe „laute“ Energie (90%-Quantil) – sonst würde durchgehende Sprache ohne Pausen komplett verworfen.
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loud = sorted[Math.floor(sorted.length * 0.9)];
  const threshold = Math.max(minRms, Math.min(floor * noiseFactor, loud * 0.5));

  const frameS = frame / sampleRate;
  const hang = Math.round(hangoverS / frameS);
  const raw = [];
  let start = -1;
  let lastVoice = -1;
  for (let i = 0; i < nFrames; i++) {
    if (rms[i] >= threshold) {
      if (start < 0) start = i;
      lastVoice = i;
    } else if (start >= 0 && i - lastVoice > hang) {
      raw.push([start, lastVoice + 1]);
      start = -1;
    }
  }
  if (start >= 0) raw.push([start, lastVoice + 1]);

  // Sekunden, mit etwas Rand, kurze Lücken zusammenfassen
  const pad = 0.2;
  const total = samples.length / sampleRate;
  const merged = [];
  for (const [a, b] of raw) {
    const s = Math.max(0, a * frameS - pad);
    const e = Math.min(total, b * frameS + pad);
    const prev = merged[merged.length - 1];
    if (prev && s - prev.end <= mergeGapS) prev.end = e;
    else merged.push({ start: s, end: e });
  }

  // Zu lange Abschnitte teilen (Whisper verarbeitet 30-s-Fenster)
  const result = [];
  for (const r of merged) {
    if (r.end - r.start < minLenS) continue;
    for (let s = r.start; s < r.end; s += maxLenS) result.push({ start: s, end: Math.min(r.end, s + maxLenS) });
  }
  return result;
}

// Typische Whisper-Halluzinationen auf Stille/Rauschen (deutsch)
const HALLUCINATIONS = [
  /untertitel(ung)? (im auftrag|der amara|von|des)/i,
  /amara\.org/i,
  /vielen dank f(ü|u)rs? (zuschauen|zusehen)/i,
  /copyright .{0,20}(wdr|swr|ard|zdf)/i,
  /^\W*(swr|wdr|zdf|ard)( \d{4})?\W*$/i,
  /^\W*(musik|applaus|\*.*\*)\W*$/i,
];

export function isHallucination(text) {
  const t = text.trim();
  return !t || HALLUCINATIONS.some((re) => re.test(t));
}

function similarity(a, b) {
  // Dice-Koeffizient über Zeichen-Bigramme (robust gegen kleine Abweichungen)
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const gx = grams(x);
  const gy = grams(y);
  let inter = 0;
  for (const [g, n] of gx) inter += Math.min(n, gy.get(g) || 0);
  return (2 * inter) / (x.length - 1 + (y.length - 1));
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** Entfernt Mikrofon-Segmente, die nur das Lautsprecher-Echo der System-Spur sind. */
export function removeEcho(mic, system, threshold = 0.6) {
  return mic.filter((m) => !system.some((s) => overlaps(m, s) && similarity(m.text, s.text) >= threshold));
}

/** tracks: { mic?: Segment[], system?: Segment[], ... } → zeitlich sortierte Segmente */
export function mergeTracks(tracks) {
  let mic = tracks.mic || [];
  if (tracks.system) mic = removeEcho(mic, tracks.system);
  const others = Object.entries(tracks)
    .filter(([k]) => k !== "mic")
    .flatMap(([, segs]) => segs);
  return [...mic, ...others].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Markdown wie in der Desktop-Version: aufeinanderfolgende Segmente desselben Sprechers zusammengefasst. */
export function toMarkdown(segments, title, recordedAt) {
  const lines = [`# ${title}`, ""];
  if (recordedAt) {
    const d = new Date(recordedAt);
    const p = (n) => String(n).padStart(2, "0");
    lines.push(`Aufgenommen: ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`, "");
  }
  let block = null;
  const flush = () => {
    if (!block) return;
    const who = block.speaker ? ` **${block.speaker}:**` : "";
    lines.push(`**[${formatTimestamp(block.start)}]**${who} ${block.text.join(" ")}`, "");
  };
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    if (!block || seg.speaker !== block.speaker) {
      flush();
      block = { start: seg.start, speaker: seg.speaker, text: [] };
    }
    block.text.push(text);
  }
  flush();
  return lines.join("\n").trimEnd() + "\n";
}

export function sessionTitle(startedAt) {
  const d = new Date(startedAt);
  const p = (n) => String(n).padStart(2, "0");
  return `Meeting ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function sessionFileName(startedAt) {
  const d = new Date(startedAt);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// ---------- Sprechererkennung ----------

export function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Gruppiert Stimmabdrücke (L2-normalisiert) zu Sprechern: agglomeratives Clustering über Schwerpunkte.
 * @param {Float32Array[]} embeddings je Segment
 * @param {object} opts threshold: minimale Ähnlichkeit zum Zusammenlegen (automatische Anzahl),
 *   numSpeakers: feste Anzahl (überschreibt threshold), durations: Segmentlängen in s (Gewichte),
 *   minShare: Cluster mit weniger Sprechanteil werden dem ähnlichsten großen zugeschlagen
 * @returns {number[]} Sprecher-Index je Segment, nummeriert nach erstem Auftreten (0, 1, …)
 */
export function clusterSpeakers(embeddings, opts = {}) {
  const n = embeddings.length;
  if (n === 0) return [];
  const { threshold = 0.86, numSpeakers = null, durations = null, minShare = 0.04, minSeconds = 3 } = opts;
  const w = durations ? durations.map((d) => Math.max(d, 0.1)) : new Array(n).fill(1);

  // Cluster: gewichtete Summe der Vektoren; Ähnlichkeit = Kosinus der Schwerpunkte
  const sums = embeddings.map((e, i) => Float32Array.from(e, (x) => x * w[i]));
  const weight = w.slice();
  const members = embeddings.map((_, i) => [i]);
  const active = new Array(n).fill(true);
  const centroid = (i) => normalize(sums[i]);
  let cents = sums.map((_, i) => centroid(i));

  const bestOf = (i) => {
    let bj = -1;
    let bs = -Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i || !active[j]) continue;
      const s = cosine(cents[i], cents[j]);
      if (s > bs) {
        bs = s;
        bj = j;
      }
    }
    return [bj, bs];
  };
  let best = cents.map((_, i) => bestOf(i));
  let count = n;
  const target = numSpeakers ? Math.max(1, numSpeakers) : 1;

  const mergeInto = (i, j) => {
    for (let k = 0; k < sums[i].length; k++) sums[i][k] += sums[j][k];
    weight[i] += weight[j];
    members[i].push(...members[j]);
    active[j] = false;
    cents[i] = centroid(i);
    count--;
    for (let k = 0; k < n; k++) if (active[k] && (k === i || best[k][0] === i || best[k][0] === j)) best[k] = bestOf(k);
  };

  while (count > target) {
    let bi = -1;
    for (let i = 0; i < n; i++) if (active[i] && best[i][0] >= 0 && (bi < 0 || best[i][1] > best[bi][1])) bi = i;
    if (bi < 0) break;
    const [bj, bs] = best[bi];
    if (!numSpeakers && bs < threshold) break;
    mergeInto(bi, bj);
  }

  // Winzige Cluster (Räuspern, Fehlzuordnung) dem ähnlichsten großen Cluster zuschlagen
  if (!numSpeakers) {
    const total = weight.reduce((a, x, i) => a + (active[i] ? x : 0), 0);
    const small = (i) => weight[i] < Math.max(minSeconds, total * minShare);
    const big = () => [...Array(n).keys()].filter((i) => active[i] && !small(i));
    if (big().length) {
      for (let i = 0; i < n; i++) {
        if (!active[i] || !small(i)) continue;
        const target = big().reduce((a, b) => (cosine(cents[i], cents[a]) >= cosine(cents[i], cents[b]) ? a : b));
        mergeInto(target, i);
      }
    }
  }

  // Nummerierung nach erstem Auftreten
  const clusterOf = new Array(n);
  for (let i = 0; i < n; i++) if (active[i]) for (const m of members[i]) clusterOf[m] = i;
  const order = new Map();
  return clusterOf.map((c) => {
    if (!order.has(c)) order.set(c, order.size);
    return order.get(c);
  });
}

/** Anzeigenamen: bei nur einem Sprecher der Spur-Name, sonst „Präfix 1“, „Präfix 2“, … */
export function speakerLabel(index, count, trackLabel) {
  if (count <= 1) return trackLabel || null;
  const prefix = trackLabel === "Ich/Raum" ? "Raum" : trackLabel === "Remote" ? "Remote" : "Sprecher";
  return `${prefix} ${index + 1}`;
}

/** Ersetzt einen Sprechernamen im Markdown-Transkript. */
export function renameSpeaker(markdown, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(new RegExp(`\\*\\*${esc}:\\*\\*`, "g"), `**${to.replace(/\*/g, "")}:**`);
}

// ---------- Titel & Dateinamen ----------

/** Anzeigename einer Aufnahme: eigener Titel oder „Meeting TT.MM.JJJJ hh:mm“. */
export function displayTitle(session) {
  return session.title?.trim() || sessionTitle(session.startedAt);
}

/** Für Dateinamen: Umlaute ausschreiben, Sonderzeichen entfernen, max. 60 Zeichen. */
export function slug(text) {
  return (text || "")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/, "");
}

/** Basis-Dateiname: 2026-09-30_16-57-03_Wochenmeeting-Vertrieb */
export function fileBase(session) {
  const s = slug(session.title);
  return s ? `${sessionFileName(session.startedAt)}_${s}` : sessionFileName(session.startedAt);
}

/** Ersetzt die Überschrift (erste „# “-Zeile) im Markdown. */
export function setMarkdownTitle(markdown, title) {
  return /^# .*$/m.test(markdown) ? markdown.replace(/^# .*$/m, `# ${title}`) : `# ${title}\n\n${markdown}`;
}

/**
 * Verteilt eine vorgegebene Personenzahl auf die Spuren: Die System-Spur (Remote) wird automatisch erkannt,
 * das Mikrofon bekommt den Rest (mindestens 1). Bei nur einer Spur gilt die Zahl direkt.
 */
export function speakersForTrack(total, key, keys, systemFound = 0) {
  if (!total) return null;
  if (keys.length === 1) return total;
  if (key === "system") return null;
  return Math.max(1, total - systemFound);
}

// ---------- Live-Transkript ----------

/**
 * Wo soll ein laufender Audiopuffer abgeschnitten werden? An der leisesten Stelle (0,3 s Fenster) in den letzten
 * `searchS` Sekunden – so werden Wörter möglichst nicht zerteilt.
 * @returns {number} Schnittposition (Samples) oder -1, solange der Puffer kürzer als minLenS ist
 */
export function findCut(samples, sampleRate, { minLenS = 12, searchS = 4, windowS = 0.3 } = {}) {
  if (samples.length < minLenS * sampleRate) return -1;
  const win = Math.round(windowS * sampleRate);
  const step = Math.round(win / 3);
  const from = Math.max(0, samples.length - Math.round(searchS * sampleRate));
  let best = samples.length;
  let bestE = Infinity;
  for (let s = from; s + win <= samples.length; s += step) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += samples[i] * samples[i];
    if (e < bestE) {
      bestE = e;
      best = s + Math.floor(win / 2);
    }
  }
  return best;
}
