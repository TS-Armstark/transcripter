// Baut die statische Seite nach ../site: eigene Dateien + transformers.js/ONNX-Runtime + optional Modelle.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "site");
const tf = join(here, "node_modules", "@huggingface", "transformers", "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "vendor"), { recursive: true });
cpSync(join(here, "src"), out, { recursive: true });
for (const f of ["transformers.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  cpSync(join(tf, f), join(out, "vendor", f));
}
cpSync(join(here, "node_modules", "coi-serviceworker", "coi-serviceworker.min.js"), join(out, "coi-serviceworker.min.js"));
cpSync(join(here, "..", "LICENSE"), join(out, "LICENSE.txt"));

// Mitgelieferte Modelle (vom Workflow nach web/models geladen) – so klappt es auch, wenn Hugging Face gesperrt ist
const models = join(here, "models");
if (existsSync(models)) cpSync(models, join(out, "models"), { recursive: true });
console.log(`Fertig: ${out}`);
