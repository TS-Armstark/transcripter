// Web-Worker: Whisper per transformers.js – läuft komplett lokal im Browser (WebGPU oder WebAssembly).
import { AutoFeatureExtractor, WavLMForXVector, env, pipeline } from "./vendor/transformers.min.js";

// Nur eigene Dateien laden: WASM-Laufzeit aus ./vendor, Modelle zuerst aus ./models (mitgeliefert),
// sonst einmalig von Hugging Face (danach im Browser-Cache).
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/", self.location.href).href;
env.allowLocalModels = true;
env.localModelPath = new URL("./models/", self.location.href).href;
env.useBrowserCache = true;

export const MODELS = {
  small: { id: "Xenova/whisper-small", device: "wasm", dtype: "q8" },
  turbo: {
    id: "onnx-community/whisper-large-v3-turbo",
    device: "webgpu",
    dtype: { encoder_model: "fp16", decoder_model_merged: "q4" },
  },
};

// Stimmabdrücke für die Sprechererkennung (WavLM, auf Sprecher-Verifikation trainiert)
const SPEAKER_MODEL = "Xenova/wavlm-base-plus-sv";

let asr = null;
let loadedKey = null;
let speaker = null;

async function loadSpeaker() {
  if (speaker) return speaker;
  const [extractor, model] = await Promise.all([
    AutoFeatureExtractor.from_pretrained(SPEAKER_MODEL),
    WavLMForXVector.from_pretrained(SPEAKER_MODEL, { dtype: "q8", device: "wasm", progress_callback: reportProgress }),
  ]);
  speaker = { extractor, model };
  return speaker;
}

const progressFiles = new Map();
function reportProgress(p) {
  if (p.status === "progress" && p.total) {
    progressFiles.set(p.file, [p.loaded, p.total]);
    let loaded = 0;
    let total = 0;
    for (const [l, t] of progressFiles.values()) {
      loaded += l;
      total += t;
    }
    self.postMessage({ type: "load-progress", loaded, total });
  }
}

async function load(key) {
  if (asr && loadedKey === key) return;
  const cfg = MODELS[key];
  if (!cfg) throw new Error(`Unbekanntes Modell: ${key}`);
  asr = await pipeline("automatic-speech-recognition", cfg.id, {
    device: cfg.device,
    dtype: cfg.dtype,
    progress_callback: reportProgress,
  });
  loadedKey = key;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      await load(data.model);
      self.postMessage({ type: "loaded", model: data.model });
    } else if (data.type === "transcribe") {
      await load(data.model);
      const out = await asr(data.audio, {
        language: "german",
        task: "transcribe",
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const chunks = (out.chunks || [{ timestamp: [0, data.audio.length / 16000], text: out.text }]).map((c) => ({
        start: data.offset + (c.timestamp[0] ?? 0),
        end: data.offset + (c.timestamp[1] ?? c.timestamp[0] ?? 0),
        text: c.text,
      }));
      self.postMessage({ type: "result", id: data.id, chunks });
    } else if (data.type === "embed") {
      const { extractor, model } = await loadSpeaker();
      const inputs = await extractor(data.audio, { sampling_rate: 16000 });
      const { embeddings } = await model(inputs);
      self.postMessage({ type: "result", id: data.id, chunks: Array.from(embeddings.data) });
    }
  } catch (err) {
    self.postMessage({ type: "error", id: data.id, message: String(err?.message || err) });
  }
};
