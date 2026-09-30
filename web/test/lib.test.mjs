import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatTimestamp,
  isHallucination,
  mergeTracks,
  removeEcho,
  sessionFileName,
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
