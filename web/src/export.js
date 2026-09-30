// Export eines Markdown-Transkripts nach Word (.docx, selbst erzeugt) und PDF (jsPDF).

const LINE = /^\*\*\[(\d\d:\d\d:\d\d)\]\*\*(?: \*\*(.+?):\*\*)? (.*)$/;

/** Zerlegt das Transkript-Markdown in Titel, Metazeile und Redebeiträge. */
export function parseTranscript(markdown) {
  const out = { title: "", meta: "", utts: [] };
  for (const line of markdown.split("\n")) {
    const m = line.match(LINE);
    if (m) out.utts.push({ time: m[1], who: m[2] || "", text: m[3] });
    else if (line.startsWith("# ") && !out.title) out.title = line.slice(2).trim();
    else if (line.startsWith("Aufgenommen:")) out.meta = line.trim();
  }
  return out;
}

// ---------- ZIP (ohne Kompression, reicht für .docx) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {{name:string, data:string}[]} files → Uint8Array (ZIP, „stored“) */
export function zip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // Version
    local.setUint16(6, 0x0800, true); // UTF-8-Dateinamen
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const result = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let pos = 0;
  for (const p of all) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}

// ---------- Word (.docx) ----------
const xml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function run(text, { bold = false, size = 22, color = null } = {}) {
  const props = [
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>',
    bold ? "<w:b/>" : "",
    color ? `<w:color w:val="${color}"/>` : "",
    `<w:sz w:val="${size}"/>`,
  ].join("");
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}
const para = (runs, after = 120) => `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr>${runs}</w:p>`;

/** Erzeugt eine .docx-Datei (Uint8Array) aus dem Transkript-Markdown. */
export function toDocx(markdown) {
  const t = parseTranscript(markdown);
  const body = [
    para(run(t.title || "Transkript", { bold: true, size: 36 }), 80),
    t.meta ? para(run(t.meta, { size: 18, color: "808080" }), 240) : "",
    ...t.utts.map((u) =>
      para(
        run(`${u.time}  `, { size: 18, color: "808080" }) +
          (u.who ? run(`${u.who}: `, { bold: true, color: "4B3FB5" }) : "") +
          run(u.text),
      ),
    ),
  ].join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: document },
  ]);
}

// ---------- PDF ----------
/**
 * Erzeugt ein PDF (ArrayBuffer) aus dem Transkript-Markdown.
 * @param {string} markdown
 * @param {any} JsPDF Konstruktor von jsPDF (im Browser window.jspdf.jsPDF)
 */
export function toPdf(markdown, JsPDF) {
  const t = parseTranscript(markdown);
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const left = 20;
  const width = 170;
  const bottom = 280;
  let y = 22;
  const ensure = (h) => {
    if (y + h > bottom) {
      doc.addPage();
      y = 20;
    }
  };
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  for (const line of doc.splitTextToSize(t.title || "Transkript", width)) {
    doc.text(line, left, y);
    y += 7;
  }
  if (t.meta) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(128);
    doc.text(t.meta, left, y);
    y += 8;
  }
  y += 2;
  for (const u of t.utts) {
    const lines = doc.setFont("helvetica", "normal").setFontSize(11).splitTextToSize(u.text, width);
    ensure(5 + lines.length * 5);
    doc.setFontSize(9);
    doc.setTextColor(128);
    doc.text(u.time, left, y);
    if (u.who) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(75, 63, 181);
      doc.text(u.who, left + 18, y);
    }
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(30);
    for (const line of lines) {
      ensure(5);
      doc.text(line, left, y);
      y += 5;
    }
    y += 3;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`${t.title || "Transkript"} · Seite ${i}/${pages}`, left, 290);
  }
  return doc.output("arraybuffer");
}
