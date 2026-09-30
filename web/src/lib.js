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
