// RB Studio plugins that need the audio thread: Noise gate, Sibilance (de-esser) and Crunch (bit depth + sample rate).
// Loaded with audioWorklet.addModule() in the live AudioContext and in every OfflineAudioContext export, so a song
// sounds the same in the studio and in its WAV. If this file can't load, main.js bypasses Gate and Sibilance and
// Crunch falls back to a WaveShaper (bit depth only).
const toGain = (db) => Math.pow(10, db / 20);
const coef = (seconds) => 1 - Math.exp(-1 / (Math.max(1e-5, seconds) * sampleRate));

function silence(outputs) { for (const o of outputs[0] || []) o.fill(0); return true; }

// Noise gate: peak detector with hysteresis (closes 6 dB under the threshold) and a 40 ms hold, 1 ms open, fast close
// (a 35 ms time constant) down to -70 dB (not full mute, so breaths fade instead of chopping).
class RBGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "threshold", defaultValue: -50, minValue: -100, maxValue: 0, automationRate: "k-rate" }];
  }
  constructor() { super(); this.env = 0; this.g = 1; this.hold = 0; this.open = true; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return silence(outputs);
    const n = inp[0].length, open = toGain(p.threshold[0]), close = open * 0.5, floor = toGain(-70);
    const ea = coef(0.0005), er = coef(0.05), ga = coef(0.001), gr = coef(0.035), holdN = Math.round(0.04 * sampleRate);
    for (let i = 0; i < n; i++) {
      let pk = 0;
      for (let c = 0; c < inp.length; c++) { const v = Math.abs(inp[c][i]); if (v > pk) pk = v; }
      this.env += (pk > this.env ? ea : er) * (pk - this.env);
      if (this.env >= open) { this.open = true; this.hold = holdN; }
      else if (this.env < close) { if (this.hold > 0) this.hold--; else this.open = false; }
      const target = this.open ? 1 : floor;
      this.g += (target > this.g ? ga : gr) * (target - this.g);
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] || inp[0])[i] * this.g;
    }
    return true;
  }
}

// Sibilance: split-band de-esser. band = 0 dB-peak band-pass around `freq` (Q 1.2), the rest = x - band, so the two
// add back to exactly x. The band is its own sidechain; above `threshold` only the band is turned down (about 5:1,
// at most 15 dB): y = x - (1 - g) * band. At the centre the band-pass has no phase shift, so the cut is exact there.
class RBDeEss extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "freq", defaultValue: 6500, minValue: 2000, maxValue: 12000, automationRate: "k-rate" },
      { name: "threshold", defaultValue: -30, minValue: -60, maxValue: 0, automationRate: "k-rate" },
    ];
  }
  constructor() { super(); this.f = 0; this.z = [[0, 0, 0, 0], [0, 0, 0, 0]]; this.e2 = 0; this.g = 1; }
  design(f) {
    const w = 2 * Math.PI * Math.min(f, sampleRate * 0.45) / sampleRate, cs = Math.cos(w), al = Math.sin(w) / (2 * 1.2), a0 = 1 + al;
    this.b = [al / a0, 0, -al / a0]; this.a = [-2 * cs / a0, (1 - al) / a0]; this.f = f;
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return silence(outputs);
    if (p.freq[0] !== this.f) this.design(p.freq[0]);
    const n = inp[0].length, thr = p.threshold[0], [b0, b1, b2] = this.b, [a1, a2] = this.a;
    const ea = coef(0.001), er = coef(0.06), ga = coef(0.0008), gr = coef(0.05);
    const hi = [];
    for (let c = 0; c < out.length; c++) {
      const x = inp[c] || inp[0], z = this.z[c] || (this.z[c] = [0, 0, 0, 0]), h = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const y = b0 * x[i] + b1 * z[0] + b2 * z[1] - a1 * z[2] - a2 * z[3];
        z[1] = z[0]; z[0] = x[i]; z[3] = z[2]; z[2] = y; h[i] = y;
      }
      hi.push(h);
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < hi.length; c++) { const v = hi[c][i] * hi[c][i]; if (v > s) s = v; }
      this.e2 += (s > this.e2 ? ea : er) * (s - this.e2);
      const lvl = 10 * Math.log10(this.e2 + 1e-12) + 3, over = lvl - thr;
      const target = over > 0 ? toGain(-Math.min(15, over * 0.8)) : 1;
      this.g += (target < this.g ? ga : gr) * (target - this.g);
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] || inp[0])[i] - (1 - this.g) * hi[c][i];
    }
    return true;
  }
}

// Crunch: sample-and-hold every `step` samples (sample-rate reduction) and round to `bits` (bit depth).
class RBCrush extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bits", defaultValue: 8, minValue: 1, maxValue: 16, automationRate: "k-rate" },
      { name: "step", defaultValue: 4, minValue: 1, maxValue: 64, automationRate: "k-rate" },
    ];
  }
  constructor() { super(); this.n = 0; this.held = [0, 0]; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return silence(outputs);
    const n = inp[0].length, L = Math.pow(2, Math.round(p.bits[0]) - 1), step = Math.max(1, Math.round(p.step[0]));
    for (let i = 0; i < n; i++) {
      if (this.n <= 0) for (let c = 0; c < out.length; c++) this.held[c] = Math.round((inp[c] || inp[0])[i] * L) / L;
      if (++this.n >= step) this.n = 0;
      for (let c = 0; c < out.length; c++) out[c][i] = this.held[c];
    }
    return true;
  }
}

registerProcessor("rb-gate", RBGate);
registerProcessor("rb-deess", RBDeEss);
registerProcessor("rb-crush", RBCrush);
