import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clusterSpeakers,
  displayTitle,
  fileBase,
  setMarkdownTitle,
  slug,
  speakersForTrack,
  formatTimestamp,
  isHallucination,
  mergeTracks,
  normalize,
  removeEcho,
  renameSpeaker,
  sessionFileName,
  speakerLabel,
  speechRegions,
  toMarkdown,
} from "../src/lib.js";

test("formatTimestamp", () => {
  assert.equal(formatTimestamp(0), "00:00:00");
  assert.equal(formatTimestamp(3725.9), "01:02:05");
});

function signal(sr, parts) {
  // parts: [[sekunden, amplitude], ...] – Sinus 300 Hz bzw. Stille
  const out = [];
  for (const [secs, amp] of parts) {
    for (let i = 0; i < secs * sr; i++) out.push(amp * Math.sin((2 * Math.PI * 300 * out.length) / sr));
  }
  return Float32Array.from(out);
}

test("speechRegions findet Sprache und ignoriert Stille", () => {
  const sr = 16000;
  const s = signal(sr, [[3, 0], [2, 0.3], [5, 0], [1, 0.3], [2, 0]]);
  const r = speechRegions(s, sr);
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0].start - 3) < 0.4 && Math.abs(r[0].end - 5) < 0.9);
  assert.ok(Math.abs(r[1].start - 10) < 0.4);
});

test("speechRegions: nur Stille → nichts; lange Sprache → geteilt", () => {
  const sr = 8000;
  assert.deepEqual(speechRegions(signal(sr, [[5, 0]]), sr), []);
  const long = speechRegions(signal(sr, [[70, 0.3]]), sr);
  assert.equal(long.length, 3);
  assert.ok(long.every((x) => x.end - x.start <= 28.001));
});

test("isHallucination", () => {
  assert.ok(isHallucination("Untertitel im Auftrag des ZDF, 2021"));
  assert.ok(isHallucination("Vielen Dank fürs Zuschauen!"));
  assert.ok(isHallucination("  "));
  assert.ok(!isHallucination("Vielen Dank für die Info, das passt."));
});

test("removeEcho verwirft nur zeitgleiche, textgleiche Mikrofon-Segmente", () => {
  const system = [{ start: 10, end: 14, text: "Können Sie mich hören?", speaker: "Remote" }];
  const mic = [
    { start: 10.3, end: 14.2, text: "können sie mich hören", speaker: "Ich/Raum" },
    { start: 11, end: 13, text: "Ja, laut und deutlich.", speaker: "Ich/Raum" },
    { start: 30, end: 32, text: "Können Sie mich hören?", speaker: "Ich/Raum" },
  ];
  assert.deepEqual(
    removeEcho(mic, system).map((s) => s.text),
    ["Ja, laut und deutlich.", "Können Sie mich hören?"],
  );
});

test("mergeTracks + toMarkdown", () => {
  const merged = mergeTracks({
    mic: [{ start: 5, end: 6, text: " Guten Morgen!", speaker: "Ich/Raum" }],
    system: [
      { start: 0, end: 2, text: " Hallo,", speaker: "Remote" },
      { start: 2, end: 3, text: "alle da?", speaker: "Remote" },
    ],
  });
  const md = toMarkdown(merged, "Test", new Date(2026, 8, 30, 9, 15));
  assert.ok(md.startsWith("# Test\n\nAufgenommen: 30.09.2026 09:15\n"));
  assert.ok(md.includes("**[00:00:00]** **Remote:** Hallo, alle da?"));
  assert.ok(md.indexOf("Remote") < md.indexOf("**Ich/Raum:** Guten Morgen!"));
  assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"));
});

test("sessionFileName", () => {
  assert.equal(sessionFileName(new Date(2026, 8, 30, 9, 5, 7)), "2026-09-30_09-05-07");
});

function voice(base, noise, seed) {
  // deterministisches „Rauschen“ um einen Grundvektor
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return normalize(base.map((x) => x + noise * rnd()));
}

test("clusterSpeakers trennt zwei Stimmen automatisch", () => {
  const a = Array.from({ length: 64 }, (_, i) => Math.sin(i));
  const b = Array.from({ length: 64 }, (_, i) => Math.cos(i * 1.7));
  const embs = [voice(a, 0.3, 1), voice(b, 0.3, 2), voice(a, 0.3, 3), voice(b, 0.3, 4), voice(a, 0.3, 5)];
  const labels = clusterSpeakers(embs, { threshold: 0.7, durations: [5, 5, 5, 5, 5] });
  assert.deepEqual(labels, [0, 1, 0, 1, 0]);
});

test("clusterSpeakers: feste Anzahl, eine Stimme, winzige Cluster", () => {
  const a = Array.from({ length: 32 }, (_, i) => Math.sin(i));
  const b = Array.from({ length: 32 }, (_, i) => Math.cos(i * 2.3));
  const same = [voice(a, 0.1, 1), voice(a, 0.1, 2), voice(a, 0.1, 3)];
  assert.deepEqual(clusterSpeakers(same, { threshold: 0.7 }), [0, 0, 0]);
  assert.deepEqual(clusterSpeakers(same, { numSpeakers: 2 }).length, 3);
  // 1 s Ausreißer bei 60 s Sprache → wird zugeschlagen
  const embs = [voice(a, 0.1, 1), voice(b, 0.1, 9), voice(a, 0.1, 3)];
  assert.deepEqual(clusterSpeakers(embs, { threshold: 0.7, durations: [30, 1, 30] }), [0, 0, 0]);
  assert.deepEqual(clusterSpeakers([], {}), []);
});

test("speakerLabel + renameSpeaker", () => {
  assert.equal(speakerLabel(0, 1, "Remote"), "Remote");
  assert.equal(speakerLabel(1, 3, "Ich/Raum"), "Raum 2");
  assert.equal(speakerLabel(0, 2, null), "Sprecher 1");
  assert.equal(speakerLabel(0, 1, null), null);
  const md = "**[00:00:01]** **Sprecher 1:** Hallo\n\n**[00:00:05]** **Sprecher 12:** Hi\n";
  assert.equal(renameSpeaker(md, "Sprecher 1", "Anna"), "**[00:00:01]** **Anna:** Hallo\n\n**[00:00:05]** **Sprecher 12:** Hi\n");
});

test("Titel, Slug und Dateinamen", () => {
  const t = new Date(2026, 8, 30, 16, 57, 3).getTime();
  assert.equal(displayTitle({ startedAt: t }), "Meeting 30.09.2026 16:57");
  assert.equal(displayTitle({ startedAt: t, title: " Wochenmeeting " }), "Wochenmeeting");
  assert.equal(slug("Jour fixe: Größe & Übergabe/Q4"), "Jour-fixe-Groesse-Uebergabe-Q4");
  assert.equal(fileBase({ startedAt: t, title: "Vertrieb Süd" }), "2026-09-30_16-57-03_Vertrieb-Sued");
  assert.equal(fileBase({ startedAt: t }), "2026-09-30_16-57-03");
  assert.equal(setMarkdownTitle("# Alt\n\nText\n", "Neu"), "# Neu\n\nText\n");
});

test("speakersForTrack verteilt die Personenzahl", () => {
  assert.equal(speakersForTrack(null, "mic", ["mic", "system"]), null);
  assert.equal(speakersForTrack(4, "mic", ["mic"]), 4);
  assert.equal(speakersForTrack(4, "system", ["mic", "system"]), null);
  assert.equal(speakersForTrack(4, "mic", ["mic", "system"], 3), 1);
  assert.equal(speakersForTrack(5, "mic", ["mic", "system"], 2), 3);
  assert.equal(speakersForTrack(2, "mic", ["mic", "system"], 4), 1);
});
