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

  // Aufnahme nur mit Mikrofon (Bildschirmfreigabe lässt sich headless nicht auswählen)
  await page.uncheck("#src-system");
  await page.uncheck("#auto");
  await page.click("#record");
  await page.waitForSelector(".status.rec");
  check((await page.textContent("#status")).includes("AUFNAHME"), "Aufnahme-Anzeige rot sichtbar");
  await page.waitForTimeout(3000);
  await page.click("#record");
  await page.waitForFunction(() => document.querySelectorAll("#sessions tbody tr").length === 1);
  const sessions = await page.evaluate(() => window.__transcripter.allSessions());
  check(sessions.length === 1 && sessions[0].tracks.mic, "Aufnahme mit Mikrofon-Spur gespeichert");
  check(sessions[0].duration > 2, `Dauer plausibel (${sessions[0].duration.toFixed(1)} s)`);

  if (sample) {
    await page.setInputFiles("#file", sample);
    await page.waitForSelector("#viewer:not([hidden])", { timeout: 15 * 60 * 1000 });
    const text = await page.textContent("#transcript");
    console.log(`--- Transkript ---\n${text}------------------`);
    const hits = expect.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
    check(text.includes("**[00:00:"), "Transkript mit Zeitstempel erzeugt");
    if (expect.length) check(hits.length > 0, `erwartete Wörter gefunden: ${hits.join(", ") || "keine"}`);
  }
  check(errors.length === 0, `keine JS-Fehler${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  server.close();
}
