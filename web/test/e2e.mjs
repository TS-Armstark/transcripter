// End-to-End-Test der gebauten Seite (../site) in Chromium mit simuliertem Mikrofon.
// Aufruf: node test/e2e.mjs [--transcribe <audiodatei> --expect wort1,wort2]
//   CHROMIUM_PATH=/pfad/zu/chrome   (optional, sonst Playwright-Standard)
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "site");
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const sample = opt("--transcribe");
const expect = (opt("--expect") || "").split(",").filter(Boolean);
const speakers = opt("--speakers"); // z. B. "2" → feste Sprecheranzahl
const turns = (opt("--expect-turns") || "").split(",").filter(Boolean); // z. B. A,B,A

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".onnx": "application/octet-stream",
};
const server = createServer((req, res) => {
  const path = join(site, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
  if (!file.startsWith(site) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
// Ordnerauswahl ist ein nativer Dialog → im Test durch das private Dateisystem des Browsers (OPFS) ersetzen
await page.addInitScript(() => {
  window.showDirectoryPicker = async () => {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle("Speicherordner", { create: true });
  };
});
async function opfsList() {
  return page.evaluate(async () => {
    const out = {};
    const walk = async (dir, prefix) => {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === "directory") await walk(h, `${prefix}${name}/`);
        else {
          const f = await h.getFile();
          out[prefix + name] = { size: f.size, head: await f.slice(0, 5).text() };
        }
      }
    };
    const root = await navigator.storage.getDirectory();
    await walk(await root.getDirectoryHandle("Speicherordner", { create: true }), "");
    return out;
  });
}
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
page.on("response", (r) => r.status() >= 400 && console.log(`HTTP ${r.status()}: ${r.url()}`));
page.on("dialog", (d) => {
  console.log(`Dialog: ${d.message()}`);
  d.accept();
});

function check(cond, msg) {
  if (!cond) {
    console.error(`FEHLER: ${msg}`);
    if (errors.length) console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`ok – ${msg}`);
}

try {
  await page.goto(url);
  // coi-serviceworker lädt die Seite einmal neu, danach ist sie cross-origin-isoliert
  await page.waitForFunction(() => window.crossOriginIsolated && window.__transcripter, null, { timeout: 20000 });
  check(true, "Seite geladen, cross-origin-isoliert (Multithreading möglich)");

  // Ohne Speicherordner keine Aufnahme
  await page.click("#record");
  await page.waitForSelector("#toast:not([hidden])");
  check(
    (await page.textContent("#toast")).includes("Speicherordner") && !(await page.locator(".status.rec").count()),
    "Ohne Speicherordner: Aufnahme startet nicht, Hinweis erscheint",
  );
  await page.click("#storage-btn");
  await page.waitForFunction(() => !document.getElementById("record").classList.contains("locked"));
  check((await page.textContent("#storage-title")).includes("Speicherordner"), "Speicherordner gewählt, Aufnahme freigegeben");

  // Aufnahme nur mit Mikrofon (Bildschirmfreigabe lässt sich headless nicht auswählen)
  await page.fill("#title", "Testmeeting Vertrieb");
  await page.uncheck("#src-system", { force: true });
  await page.uncheck("#auto", { force: true });
  await page.click("#record");
  await page.waitForSelector(".status.rec");
  check((await page.textContent("#status")).includes("AUFNAHME"), "Aufnahme-Anzeige rot sichtbar");
  await page.waitForTimeout(3000);
  await page.click("#record");
  await page.waitForFunction(() => document.querySelectorAll("#sessions .item").length === 1);
  const sessions = await page.evaluate(() => window.__transcripter.allSessions());
  check(sessions.length === 1 && sessions[0].tracks.mic, "Aufnahme mit Mikrofon-Spur gespeichert");
  check(sessions[0].duration > 2, `Dauer plausibel (${sessions[0].duration.toFixed(1)} s)`);
  check(sessions[0].title === "Testmeeting Vertrieb", "Titel gespeichert");
  const files = await opfsList();
  check(
    Object.keys(files).some((f) => /^Audio\/.+_Testmeeting-Vertrieb_mic\.webm$/.test(f) && files[f].size > 0),
    `Aufnahme im Speicherordner abgelegt (${Object.keys(files).join(", ")})`,
  );
  await page.click("nav a[data-view=transcripts]");
  await page.fill("#search", "vertrieb");
  check((await page.locator("#sessions .item").count()) === 1, "Suche findet Aufnahme über den Titel");
  await page.fill("#search", "gibtsnicht");
  check((await page.locator("#sessions .item").count()) === 0, "Suche filtert");
  await page.fill("#search", "");
  await page.click("nav a[data-view=record]");

  if (sample) {
    if (speakers !== null) await page.fill("#speakers", speakers);
    await page.setInputFiles("#file", sample);
    await page.waitForFunction(() => window.__transcripter.queue.length === 0 && location.hash === "#transkripte", null, {
      timeout: 15 * 60 * 1000,
      polling: 1000,
    });
    await page.waitForSelector("#viewer-body:not([hidden])");
    const text = (await page.evaluate(() => window.__transcripter.allSessions())).find((x) => x.tracks.file)?.transcript || "";
    check((await page.locator("#transcript .utt").count()) > 0, "Transkript im Fenster als Gesprächsverlauf angezeigt");
    console.log(`--- Transkript ---\n${text}------------------`);
    const hits = expect.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
    check(text.includes("**[00:00:"), "Transkript mit Zeitstempel erzeugt");
    if (expect.length) check(hits.length > 0, `erwartete Wörter gefunden: ${hits.join(", ") || "keine"}`);
    // Export: Markdown liegt automatisch im Ordner, PDF und Word per Knopf
    await page.click("#export-pdf");
    await page.click("#export-docx");
    await page.waitForTimeout(1500);
    const exported = await opfsList();
    const has = (ext, head) => Object.entries(exported).some(([n, f]) => n.endsWith(ext) && !n.includes("/") && f.head.startsWith(head));
    check(has(".md", "# "), "Transkript als .md im Speicherordner");
    check(has(".pdf", "%PDF"), "PDF-Export im Speicherordner");
    check(has(".docx", "PK"), "Word-Export im Speicherordner");
    if (turns.length) {
      // Sprecherfolge aus dem Markdown: gleiche Buchstaben im Muster = gleicher Sprecher
      const seq = [...text.matchAll(/^\*\*\[[\d:]+\]\*\* \*\*(.+?):\*\*/gm)].map((m) => m[1]);
      const same = (x, y) => seq.length === turns.length && turns.every((t, i) => turns.every((u, j) => (t === u) === (seq[i] === seq[j])));
      check(same(), `Sprecherwechsel erkannt: ${seq.join(" → ") || "keine Sprecher"} (erwartet ${turns.join(" → ")})`);
    }
  }
  // Anderer Tab mit älterer Datenbank-Version: Seite zeigt Hinweis statt stumm zu hängen
  {
    const ctx = await browser.newContext();
    const old = await ctx.newPage();
    await old.goto(`${url}style.css`);
    await old.evaluate(
      () =>
        new Promise((r) => {
          const q = indexedDB.open("transcripter", 1);
          q.onupgradeneeded = () => q.result.createObjectStore("sessions", { keyPath: "id" });
          q.onsuccess = () => ((window.keep = q.result), r());
        }),
    );
    const p2 = await ctx.newPage();
    await p2.goto(url);
    await p2.waitForSelector("#fatal:not([hidden])", { timeout: 15000 });
    check((await p2.textContent("#fatal")).includes("anderen Tab"), "Hinweis bei blockierendem alten Tab");
    await old.close();
    await p2.waitForFunction(() => window.__transcripter, null, { timeout: 15000 });
    check(await p2.isHidden("#fatal"), "Seite startet, sobald der alte Tab geschlossen ist");
    await ctx.close();
  }
  check(errors.length === 0, `keine JS-Fehler${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  server.close();
}
