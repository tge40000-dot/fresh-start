// Usage: node rb-site-updates/test/studio-vocal.test.mjs
// RB Studio's vocal tools (Prompt C, 29 Oct 2026), on sounds whose answer is known: noise reduction (how far the
// noise comes down, and that the voice doesn't), the two cases where it refuses, timing tighten (phrases land on the
// grid, unstretched), take comping (the right take in each bar, smooth joins), bar lines in a clip, and the page wiring.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const main = readFileSync(new URL("../../workers/rb-daw/src/assets/main.js", import.meta.url), "utf8");
const cut = (a, b) => { const i = main.indexOf(a), j = main.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return main.slice(i, j); };
const src = cut("function Ue(", "function Pt(") + cut("var $t =", "/* RB vocal tools end */");
const V = new Function("r", src + "; return { rbDenoise, rbPhrases, rbTighten, rbComp, rbBars };")({ p: { bpm: 120, beatsPerBar: 4 } });

const sr = 48000;
let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const db = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return 10 * Math.log10(s / (b - a) + 1e-20); };
const voice = (t) => 0.25 * Math.sin(2 * Math.PI * 220 * t) + 0.12 * Math.sin(2 * Math.PI * 440 * t) + 0.06 * Math.sin(2 * Math.PI * 660 * t) + 0.03 * Math.sin(2 * Math.PI * 1320 * t);

// 1. noise reduction: 1 s of hiss, then 4 s of "voice" with gaps, hiss under it all at about -50 dBFS
{
  const n = 6 * sr, x = new Float32Array(n), clean = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, on = t >= 1 && t < 5.5 && (t % 1) < 0.7;
    clean[i] = on ? voice(t) : 0;
    x[i] = clean[i] + 0.0055 * rnd();
  }
  const t0 = Date.now();
  const res = await V.rbDenoise([x], sr, 0.6);
  const ms = Date.now() - t0;
  assert.ok(res.out, JSON.stringify(res));
  const y = res.out[0];
  assert.ok(res.noiseDb < -45 && res.noiseDb > -55, "the hiss is measured near -50 dBFS: " + res.noiseDb.toFixed(1));
  const quietBefore = db(x, 0.1 * sr, 0.9 * sr), quietAfter = db(y, 0.1 * sr, 0.9 * sr);
  assert.ok(quietBefore - quietAfter >= 12, `hiss lowered by ${(quietBefore - quietAfter).toFixed(1)} dB`);
  assert.ok(res.lowered >= 12, "and the report says so: " + res.lowered.toFixed(1));
  // the voice keeps its level and shape (measured inside a phrase, away from its edges)
  const a = Math.round(2.1 * sr), b = Math.round(2.6 * sr);
  assert.ok(Math.abs(db(y, a, b) - db(clean, a, b)) < 1, "voice level within 1 dB");
  let dot = 0, yy = 0, cc = 0; for (let i = a; i < b; i++) (dot += y[i] * clean[i]), (yy += y[i] * y[i]), (cc += clean[i] * clean[i]);
  assert.ok(dot / Math.sqrt(yy * cc) > 0.99, "voice shape kept (correlation " + (dot / Math.sqrt(yy * cc)).toFixed(4) + ")");
  // stereo: both sides processed with the same gains
  const st = await V.rbDenoise([x, x.map((v) => v * 0.5)], sr, 0.6);
  assert.equal(st.out.length, 2);
  const r0 = st.out[0], r1 = st.out[1];
  for (let i = sr; i < sr * 1.1; i += 997) assert.ok(Math.abs(r1[i] - r0[i] * 0.5) < 1e-4, "same gains on both sides");
  console.log(`  noise reduction: hiss ${quietBefore.toFixed(1)} → ${quietAfter.toFixed(1)} dBFS; 6 s mono in ${ms} ms here`);
}
// refusals: already quiet, and no quiet part to learn from
{
  const n = 3 * sr, quiet = new Float32Array(n), hum = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; quiet[i] = (t % 1) < 0.6 ? voice(t) + 0.00001 * rnd() : 0.00001 * rnd(); hum[i] = voice(t) + 0.005 * rnd(); }
  assert.equal((await V.rbDenoise([quiet], sr, 0.6)).skipped, "clean");
  assert.equal((await V.rbDenoise([hum], sr, 0.6)).skipped, "noquiet");
  assert.equal((await V.rbDenoise([new Float32Array(sr / 4)], sr, 0.6)).skipped, "short");
}

// 2. timing tighten at 120 BPM on a 1/8 grid (0.25 s): phrases sung early or late by known amounts
{
  const spb = 0.5, n = 4 * sr, x = new Float32Array(n);
  const late = [[0.5, 0.03], [1.0, -0.02], [1.75, 0.06], [2.5, -0.045]]; // [grid time, how far off]
  for (const [g, off] of late) for (let i = 0; i < 0.3 * sr; i++) { const t = i / sr; x[Math.round((g + off) * sr) + i] = voice(t) * Math.min(1, t / 0.003, (0.3 - t) / 0.01); }
  const beatAt = (s) => s / sr / spb;
  const ph = V.rbPhrases(x, sr);
  assert.equal(ph.length, 4, "four phrases found");
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(ph[i].start / sr - (late[i][0] + late[i][1])) < 0.006, "onset " + i);
  const full = V.rbTighten([x], sr, { beatAt, spb, grid: 0.5, strength: 1 });
  const after = V.rbPhrases(full.out[0], sr);
  assert.equal(after.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(after[i].start / sr - late[i][0]) < 0.006, `phrase ${i} lands on the grid (${(after[i].start / sr).toFixed(3)} s)`);
    assert.ok(Math.abs(full.moves[i] + late[i][1] * 1e3) < 1.5, "reported move " + full.moves[i].toFixed(1) + " ms");
  }
  // unstretched: the phrase's samples are the same, only later or earlier
  const d = Math.round(-late[2][1] * sr), s0 = Math.round((late[2][0] + late[2][1]) * sr);
  for (let i = s0 + 100; i < s0 + 0.29 * sr; i += 501) assert.ok(Math.abs(full.out[0][i + d] - x[i]) < 1e-6, "sample moved, not changed");
  const half = V.rbTighten([x], sr, { beatAt, spb, grid: 0.5, strength: 0.5 });
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(half.moves[i] + late[i][1] * 500) < 1.5, "half strength, half the move");
  // a phrase never jumps into its neighbour: two phrases 40 ms apart, the second 100 ms late
  const y = new Float32Array(2 * sr);
  for (let i = 0; i < 0.3 * sr; i++) { y[Math.round(0.2 * sr) + i] = voice(i / sr); y[Math.round(0.54 * sr) + i] = voice(i / sr); }
  const tight = V.rbTighten([y], sr, { beatAt, spb, grid: 0.5, strength: 1, phrases: [{ start: 0.2 * sr, end: 0.5 * sr }, { start: 0.54 * sr, end: 0.84 * sr }] });
  assert.ok(tight.moves[1] >= -20.5, "moves at most half the 40 ms gap: " + tight.moves[1].toFixed(1));
}

// 3. comping: three takes, each a constant, picked per bar
{
  const len = 4 * sr, takes = [1, 2, 3].map((v) => [new Float32Array(len).fill(v * 0.1)]);
  const bounds = [0, sr, 2 * sr, 3 * sr], picks = [0, 2, 2, 1];
  const out = V.rbComp(takes, picks, bounds, sr)[0];
  assert.equal(out.length, len);
  for (const [k, want] of [[0.5, 0.1], [1.5, 0.3], [2.5, 0.3], [3.5, 0.2]]) assert.ok(Math.abs(out[k * sr] - want) < 1e-6, "bar at " + k + " s");
  let jump = 0; for (let i = 1; i < len; i++) jump = Math.max(jump, Math.abs(out[i] - out[i - 1]));
  assert.ok(jump < 0.001, "no clicks at the joins (largest step " + jump.toFixed(5) + ")");
  const m = sr; assert.ok(Math.abs(out[m] - 0.1 * Math.SQRT1_2 - 0.3 * Math.SQRT1_2) < 0.002, "equal-power crossfade");
}

// 4. bar lines: a clip starting on beat 2 at 120 BPM, 4/4
{
  const b = V.rbBars({ start: 2, audio: { offset: 0 } }, 8 * sr, sr, 120, 4);
  assert.deepEqual(b.bounds, [0, sr, 3 * sr, 5 * sr, 7 * sr]);
  assert.deepEqual(b.bars, [1, 2, 3, 4, 5]);
  const c = V.rbBars({ start: 8, audio: { offset: 1 } }, 4 * sr, sr, 120, 4); // trimmed by 1 s: the file starts on beat 6
  assert.deepEqual(c.bounds, [0, sr, 3 * sr]);
  assert.deepEqual(c.bars, [2, 3, 4]);
}

// 5. latency measurement: clicks heard 37 ms late over room noise, one lost, one with an echo after it
{
  const L = new Function(cut("function rbClickDelays(", "async function rbMeasureLatency(") + "; return { rbClickDelays, rbLatencyFrom };")();
  const clicks = Array.from({ length: 8 }, (_, k) => 0.5 + k * 0.45), x = new Float32Array(Math.round(4.5 * sr));
  for (let i = 0; i < x.length; i++) x[i] = 0.002 * rnd();
  clicks.forEach((c, k) => {
    if (k === 3) return; // lost
    const at = Math.round((c + 0.037) * sr);
    for (let j = 0; j < 144; j++) x[at + j] += 0.4 * (j % 2 ? -1 : 1) * (1 - j / 144);
    if (k === 5) for (let j = 0; j < 144; j++) x[at + 2400 + j] += 0.2 * (j % 2 ? -1 : 1); // echo 50 ms later
  });
  const d = L.rbClickDelays(x, sr, clicks);
  assert.equal(d.length, 7, "the lost click isn't invented");
  assert.ok(Math.abs(L.rbLatencyFrom(d) - 0.037) < 0.0005, "37 ms measured: " + L.rbLatencyFrom(d));
  assert.equal(L.rbLatencyFrom(L.rbClickDelays(x.map(() => 0.002 * rnd()), sr, clicks)), null, "nothing heard, nothing set");
  assert.equal(L.rbLatencyFrom([0.03, 0.05, 0.07, 0.09, 0.11]), null, "clicks that disagree aren't trusted");
}

// 6. the page wiring
const once = (x, msg) => assert.equal(main.split(x).length - 1, 1, msg || x);
for (const k of ['label: "Warm vocal"', 'label: "Radio-Ready vocal"', 'label: "Aggressive vocal"', 'label: "Clean vocal"']) once(k);
for (const k of ["function rbLatencyNote(", "async function rbMeasureLatency(", "function rbOrig(", "function rbFixPanel(", "async function rbFix(", "function rbFixOff(", "async function rbBuildComp(", "function rbPreview("]) once(k);
once("(o.audio.fix && o.audio.fix.src === e)", "a take kept under a clean-up still counts as in use");
console.log("studio vocal tools ok: noise down, voice kept, refusals, phrases on the grid unstretched, comp per bar without clicks, bar lines, latency measured from clicks, presets and wiring");
