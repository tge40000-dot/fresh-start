// Usage: node rb-site-updates/test/film.test.mjs
// RB Create's Film upgrades (29 Oct 2026): the lip-sync analysis on sounds with known shapes, shapes from text, and
// that the page wires the new paths (looks and shapes through aiService, the new camera moves, frames on the audio
// clock in both exporters, the switches).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../src/create/create.html", import.meta.url), "utf8");
const block = html.slice(html.indexOf("/* ------------------------------------------------------------ lip-sync"), html.indexOf("/* ------------------------------------------------------------ switches"));
const L = new Function(block + "; return { visemes, textVisemes, MOUTHS, drawMouth };")();

// a buffer made of parts, each a known kind of sound
const sr = 48000;
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const parts = [
  ["X", 0.4, () => 0],
  ["O", 0.5, (t) => 0.5 * Math.sin(2 * Math.PI * 220 * t) + 0.3 * Math.sin(2 * Math.PI * 440 * t) + 0.12 * Math.sin(2 * Math.PI * 660 * t)],
  ["M", 0.05, () => 0],
  ["A", 0.5, (t) => 0.45 * Math.sin(2 * Math.PI * 800 * t) + 0.4 * Math.sin(2 * Math.PI * 1300 * t) + 0.15 * Math.sin(2 * Math.PI * 300 * t)],
  ["E", 0.5, (t) => 0.2 * Math.sin(2 * Math.PI * 300 * t) + 0.35 * Math.sin(2 * Math.PI * 2700 * t) + 0.3 * Math.sin(2 * Math.PI * 3200 * t)],
  ["S", 0.4, () => 0.12 * rnd()],
  ["X", 0.4, () => 0],
];
const total = parts.reduce((n, p) => n + Math.round(p[1] * sr), 0), data = new Float32Array(total);
let at = 0; const spans = [];
for (const [shape, dur, f] of parts) { const n = Math.round(dur * sr); for (let i = 0; i < n; i++) data[at + i] = f(i / sr); spans.push([shape, at / sr, (at + n) / sr]); at += n; }
// hiss: keep only the highs (a simple difference filter), as an S does
const sStart = Math.round(spans[5][1] * sr), sEnd = Math.round(spans[5][2] * sr);
for (let i = sEnd - 1; i > sStart; i--) data[i] = data[i] - data[i - 1];
const buf = { sampleRate: sr, length: total, duration: total / sr, getChannelData: () => data };
const v = L.visemes(buf, "test");
assert.equal(v.length, Math.ceil(total / Math.floor(sr / 60)), "60 a second");
const most = (a, b) => { const c = {}; for (let f = Math.ceil(a * 60) + 4; f < Math.floor(b * 60) - 4; f++) c[v[f].s] = (c[v[f].s] || 0) + 1; return Object.entries(c).sort((x, y) => y[1] - x[1])[0]?.[0]; };
for (const [shape, a, b] of spans) if (shape !== "M") assert.equal(most(a, b), shape, `${shape} from ${a.toFixed(2)} to ${b.toFixed(2)} s`);
const mid = spans[2], mf = Math.round(((mid[1] + mid[2]) / 2) * 60);
assert.equal(v[mf].s, "M", "a short silence inside a word is pressed lips");
assert.ok(v[Math.round(spans[1][1] * 60 + 15)].h > 0.4 && v[Math.round(spans[0][1] * 60 + 5)].h < 0.05, "open while sounding, closed in silence");
assert.ok(v.every((x) => x.w > 0 && x.h >= 0 && x.r >= 0 && x.r <= 1), "every frame is a drawable mouth");
assert.equal(L.visemes(buf, "test"), v, "worked out once per line");
// text, for lines without audio
const tv = L.textVisemes("Mama, oh see", 2);
assert.equal(tv.length, 120); assert.ok(tv.some((x) => x.s === "M") && tv.some((x) => x.s === "O") && tv.some((x) => x.s === "S"));
// drawing doesn't throw for any shape
const calls = []; const ctx = new Proxy({}, { get: (_, k) => (k in { strokeStyle: 1, fillStyle: 1, lineWidth: 1, lineCap: 1 } ? undefined : (...a) => calls.push(k)), set: () => true });
for (const s of Object.keys(L.MOUTHS)) L.drawMouth(ctx, 0, 0, 40, { s, ...L.MOUTHS[s] });
assert.ok(calls.includes("bezierCurveTo") && calls.includes("quadraticCurveTo"));

// the page wiring
const once = (x, msg) => assert.equal(html.split(x).length - 1, 1, msg || x);
once('var FLAGS = (function(){ var f = { visemes: true, cams: true, hq: true };');
once("image: function(o){", "aiService.image");
assert.match(html, /if \(o\.style\) body\.style = o\.style; if \(o\.aspect\) body\.aspect = o\.aspect;/);
assert.match(html, /aiService\.image\(\{ prompt: pr, style: P\.look \|\| null, aspect: P\.aspect, label: "AI background" \}\)/, "backgrounds take the film's look and shape");
assert.match(html, /aiService\.image\(\{ prompt: pr, aspect: "3:4", label: "AI character" \}\)/);
for (const k of ['["dolly", "Dolly in"]', '["orbit", "Orbit"]', '["rack", "Rack focus"]', '["light", "Moving light"]']) once(k);
assert.equal((html.match(/if \(exportFrame\) exportFrame\(t\);/g) || []).length, 2, "both exporters hand over their frames");
once('canvas.captureStream(0)'); once('vt.requestFrame()');
once('else if (name === "look" || name === "quality") P[name] = v;');
once('if (mouthV && c.mouthMode !== "simple") drawMouth(ctx, mx, my, mw, mouthV);', "the manual open-and-close mouth stays as an override");
once("vg.gain.value = FLAGS.hq ? voiceGain(b, L.line.audio) : 1;");
assert.ok(!/\sstyle="/.test(html.slice(html.indexOf("<body"))), "no inline style attributes (the CSP takes nonced styles only)");
console.log("film ok: mouth shapes from the sound (O, A, E, S, M, rest), from text, drawable; looks and shapes through aiService; four camera moves; frames on the audio clock; switches");
