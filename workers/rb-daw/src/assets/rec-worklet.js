// Records raw PCM on the audio thread, sample-accurate from a given AudioContext time.
// Messages in: {cmd:"start", at:<ctx time>} / {cmd:"stop"}. Out: {chunk:[Float32Array per channel]} batches, then {done:true}.
class RBRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false; this.at = 0; this.buf = null; this.fill = 0; this.channels = 1;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.cmd === "start") { this.on = true; this.at = m.at || 0; this.buf = null; this.fill = 0; }
      else if (m.cmd === "stop") { this.flush(); this.on = false; this.port.postMessage({ done: true }); }
    };
  }
  flush() {
    if (this.buf && this.fill) this.port.postMessage({ chunk: this.buf.map((b) => b.slice(0, this.fill)) });
    this.buf = null; this.fill = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!this.on || !input || !input.length) return true;
    const n = input[0].length, t0 = currentTime, dt = 1 / sampleRate;
    let from = 0;
    if (t0 + n * dt <= this.at) return true;           // not yet
    if (t0 < this.at) from = Math.min(n, Math.round((this.at - t0) / dt));
    if (!this.buf) { this.channels = Math.min(2, input.length); this.buf = Array.from({ length: this.channels }, () => new Float32Array(8192)); this.fill = 0; }
    for (let i = from; i < n; i++) {
      for (let c = 0; c < this.channels; c++) this.buf[c][this.fill] = (input[c] || input[0])[i];
      this.fill++;
      if (this.fill === 8192) this.flush(), (this.buf = Array.from({ length: this.channels }, () => new Float32Array(8192)));
    }
    return true;
  }
}
registerProcessor("rb-recorder", RBRecorder);
