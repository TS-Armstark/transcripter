import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { jsPDF } from "jspdf";

import { parseTranscript, toDocx, toPdf } from "../src/export.js";

const MD = `# Jour fixe „Vertrieb“ & Größe <Q4>

Aufgenommen: 30.09.2026 10:00

**[00:00:02]** **Anna:** Guten Morgen zusammen, heute geht es um Übergaben & Maße.

**[00:00:09]** Ein Satz ohne Sprecher.
`;

test("parseTranscript", () => {
  const t = parseTranscript(MD);
  assert.equal(t.title, "Jour fixe „Vertrieb“ & Größe <Q4>");
  assert.equal(t.meta, "Aufgenommen: 30.09.2026 10:00");
  assert.deepEqual(t.utts[0], { time: "00:00:02", who: "Anna", text: "Guten Morgen zusammen, heute geht es um Übergaben & Maße." });
  assert.equal(t.utts[1].who, "");
});

test("toDocx erzeugt ein gültiges Word-Dokument", () => {
  const bytes = toDocx(MD);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  const dir = mkdtempSync(join(tmpdir(), "docx-"));
  const file = join(dir, "t.docx");
  writeFileSync(file, bytes);
  // Mit Pythons zipfile + XML-Parser prüfen (CRC, Struktur, Wohlgeformtheit, Inhalt)
  const out = execFileSync("python3", [
    "-c",
    `import zipfile,sys,xml.dom.minidom as m
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
names=z.namelist(); assert "word/document.xml" in names and "[Content_Types].xml" in names
d=m.parseString(z.read("word/document.xml")); print("".join(t.firstChild.data for t in d.getElementsByTagName("w:t") if t.firstChild))`,
    file,
  ]).toString();
  assert.ok(out.includes("Größe <Q4>"));
  assert.ok(out.includes("Anna: Guten Morgen"));
});

test("toPdf erzeugt ein PDF mit Seitenumbruch", () => {
  const long = MD + Array.from({ length: 80 }, (_, i) => `\n**[00:01:${String(i % 60).padStart(2, "0")}]** **Bernd:** Satz Nummer ${i} mit etwas mehr Text, damit umgebrochen wird.\n`).join("");
  const buf = Buffer.from(toPdf(long, jsPDF));
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  assert.ok((buf.toString("latin1").match(/\/Type \/Page\b/g) || []).length >= 2);
});
