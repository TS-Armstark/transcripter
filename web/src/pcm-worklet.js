// AudioWorklet: gibt das Mikrofon-/System-Audio als Mono-Float32 in Blöcken (~0,25 s) an die Seite weiter.
// Für das Live-Transkript – es wird nichts gespeichert, die Blöcke werden nach der Verarbeitung verworfen.
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 4);
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) {
      const len = channels[0].length;
      for (let i = 0; i < len; i++) {
        let v = 0;
        for (const ch of channels) v += ch[i];
        this.buf[this.n++] = v / channels.length;
        if (this.n === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
