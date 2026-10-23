// Usage: node rb-site-updates/test/studio-plugins.test.mjs <pulled rb-mastering-studio dir (unpatched, as pulled)>
// Runs patch_studio_plugins.py on a copy, checks it is idempotent, then runs the real DSP engine under Node:
// with no plug-in options the master is bit-identical to the unpatched engine; each plug-in changes the output while
// keeping true peak under the ceiling, no NaN, and loudness within 1 LU of the target. The page's inline scripts parse.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const src = process.argv[2];
if (!src) throw new Error("usage: node studio-plugins.test.mjs <pulled rb-mastering-studio dir>");
const patch = join(dirname(fileURLToPath(import.meta.url)), "..", "patch_studio_plugins.py");
const pick = (d, end) => join(d, readdirSync(d).find((f) => f.endsWith(end)));
const read = (d, end) => readFileSync(pick(d, end), "utf8");
const pass = (m) => console.log("ok  " + m);

// ---------------------------------------------------------------- patch a copy, twice
const work = mkdtempSync(join(tmpdir(), "studio-plugins-"));
cpSync(src, work, { recursive: true });
const out1 = execFileSync("python3", ["-I", patch, work], { encoding: "utf8" });
const dsp1 = read(work, "-dsp.txt"), app1 = read(work, "-app.html");
const out2 = execFileSync("python3", ["-I", patch, work], { encoding: "utf8" });
assert.match(out2, /already in place/);
assert.equal(read(work, "-dsp.txt"), dsp1); assert.equal(read(work, "-app.html"), app1);
pass("patch applies (" + out1.trim() + "); second run changes nothing");

// ---------------------------------------------------------------- engine text
const origDsp = read(src, "-dsp.txt"), origApp = read(src, "-app.html");
const wasPatched = origDsp.includes("function plugOpts(");
assert.ok(!/<\/script/i.test(dsp1), "DSP text must not contain </script");
let es5 = "regex";
try { createRequire(import.meta.url)("/opt/node-tools/node_modules/acorn").parse(dsp1, { ecmaVersion: 5 }); es5 = "acorn ecmaVersion 5"; }
catch (e) { if (e instanceof SyntaxError) throw e; assert.ok(!/=>|`|\bconst\s|\blet\s/.test(dsp1), "ES5 only"); }
pass("DSP has no </script and parses as ES5 (" + es5 + ")");
for (const bad of ["ozone", "pro-l", "ssl", "pultec", "waves", "fabfilter", "izotope"]) {
  const n = (t) => (t.toLowerCase().match(new RegExp("\\b" + bad.replace("-", "\\-") + "\\b", "g")) || []).length;
  assert.equal(n(app1), n(origApp), "no brand name added: " + bad); assert.equal(n(dsp1), n(origDsp), "no brand name added: " + bad);
}
pass("no product or brand names added");
const load = (text) => { const m = { exports: {} }; new Function("module", text)(m); return m.exports; };
const NEW = load(dsp1), OLD = load(origDsp);
assert.equal(typeof NEW.master, "function");
pass("patched DSP loads in Node (module.exports)");

// ---------------------------------------------------------------- synthetic stereo mix: sines + noise burst, 4 s at 44.1 kHz
const sr = 44100, n = sr * 4;
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
const L = new Float32Array(n), R = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const t = i / sr, env = 0.6 + 0.4 * Math.max(0, Math.sin(2 * Math.PI * 2 * t)) ** 4; // pumping "kick" envelope
  const lo = 0.30 * Math.sin(2 * Math.PI * 55 * t) * env, mid = 0.12 * Math.sin(2 * Math.PI * 440 * t), mid2 = 0.08 * Math.sin(2 * Math.PI * 1000 * t + 0.5);
  const harsh = 0.06 * Math.sin(2 * Math.PI * 3500 * t) * (t % 1 < 0.25 ? 2 : 1), hi = 0.03 * Math.sin(2 * Math.PI * 9000 * t);
  const burst = t > 1.5 && t < 2.0 ? 0.35 * rnd() : 0, noise = 0.004 * rnd();
  L[i] = lo + mid + 0.7 * mid2 + harsh + hi + burst + noise;
  R[i] = lo + 0.8 * mid + mid2 + 0.9 * harsh + 0.6 * Math.sin(2 * Math.PI * 9000 * t + 1) * 0.03 + burst * 0.8 + 0.004 * rnd();
}
const base = { genre: "pop", character: "balanced", intensity: 0.6, target: -12, ceiling: -1 };
const run = (dsp, extra) => dsp.master([L, R], sr, Object.assign({}, base, extra || {}));
const same = (a, b) => a.length === b.length && a.every((ch, c) => ch.length === b[c].length && ch.every((v, i) => Object.is(v, b[c][i])));
const t0 = Date.now();
const ref = run(NEW);
if (!wasPatched) {
  const old = run(OLD);
  assert.ok(same(ref.channels, old.channels), "no plug-in options: bit-identical to the unpatched engine");
  for (const k of ["lufs", "truePeak", "plr", "correlation"]) assert.ok(Object.is(ref.after[k], old.after[k]), "after." + k + " identical");
  pass("no plug-in options: output bit-identical to the unpatched DSP (" + 2 * n + " samples, after-measurements equal)");
} else console.log("skip bit-identity vs unpatched: the given dir already has the plug-ins");
const offExplicit = run(NEW, { glue: { on: false }, warmth: null, deharsh: false, lowTrick: { on: false }, bandWidth: null, clipper: false, limiterStyle: "" });
assert.ok(same(ref.channels, offExplicit.channels));
assert.deepEqual(ref.settings.plugins, {});
pass("plug-ins switched off explicitly: bit-identical too, settings.plugins empty");

// ---------------------------------------------------------------- each stage on
const cases = [
  ["glue", { glue: { ratio: 4, attack: 10, release: "auto", amount: 2 } }, "glue"],
  ["glue 2:1 fixed release", { glue: { ratio: 2, attack: 0.3, release: 300, amount: 1 } }, "glue"],
  ["warmth", { warmth: { amount: 0.6 } }, "warmth"],
  ["de-harsh", { deharsh: { amount: 4, focus: 3500 } }, "deharsh"],
  ["low-end trick 60", { lowTrick: { freq: 60, boost: 3 } }, "lowTrick"],
  ["low-end trick 100", { lowTrick: { freq: 100, boost: 2 } }, "lowTrick"],
  ["stereo by band", { bandWidth: { low: 0, mid: 1.1, high: 1.6 } }, "bandWidth"],
  ["clipper hard", { clipper: { mode: "hard", amount: 2 } }, "clipper"],
  ["clipper soft", { clipper: { mode: "soft", amount: 1.5 } }, "clipper"],
  ["clipper tape", { clipper: { mode: "tape", amount: 3 } }, "clipper"],
  ["limiter transparent", { limiterStyle: "transparent" }, "limiter"],
  ["limiter punchy", { limiterStyle: "punchy" }, "limiter"],
  ["limiter aggressive", { limiterStyle: "aggressive" }, "limiter"],
  ["all together", { glue: { ratio: 2, attack: 30, release: "auto", amount: 1.5 }, warmth: { amount: 0.4 }, deharsh: { amount: 3, focus: 4500 }, lowTrick: { freq: 60, boost: 2 },
    bandWidth: { low: 0, mid: 1.2, high: 1.4 }, clipper: { mode: "soft", amount: 1.5 }, limiterStyle: "punchy" }, "glue"]
];
for (const [name, extra, key] of cases) {
  const r = run(NEW, extra), ch = r.channels;
  let diff = 0, nan = 0;
  ch.forEach((x, c) => x.forEach((v, i) => { if (!Number.isFinite(v)) nan++; const d = Math.abs(v - ref.channels[c][i]); if (d > diff) diff = d; }));
  const tp = NEW.truePeak(ch), lu = NEW.lufs(ch, sr);
  assert.equal(nan, 0, name + ": no NaN");
  assert.ok(diff > 1e-4, name + ": output differs (max diff " + diff + ")");
  assert.ok(tp <= base.ceiling + 1e-3, name + ": true peak " + tp + " <= ceiling");
  assert.ok(Math.abs(lu - base.target) <= 1, name + ": loudness " + lu + " within 1 LU of " + base.target);
  assert.ok(r.settings.plugins[key], name + ": reports settings.plugins." + key);
  const want = Object.keys(extra).map((k) => (k === "limiterStyle" ? "limiter" : k));
  assert.deepEqual(Object.keys(r.settings.plugins).sort(), want.sort(), name + ": only the asked-for stages ran");
  pass(name.padEnd(22) + " differs (max " + diff.toFixed(4) + "), TP " + tp.toFixed(2) + " dBTP <= " + base.ceiling + ", " + lu.toFixed(2) + " LUFS (target " + base.target + "), no NaN");
}
const m = run(NEW, { glue: { ratio: 4, amount: 2 } }).settings.plugins.glue;
assert.ok(m.avgGrDb > 0.2 && m.maxGrDb < 12, "glue does a sensible amount of reduction: " + m.avgGrDb);
const cl = run(NEW, { clipper: { mode: "off" } });
assert.equal(cl.settings.plugins.clipper.mode, "off"); assert.equal(cl.limiter.clipPct, 0);
pass("glue average reduction " + m.avgGrDb.toFixed(2) + " dB; clipper Off skips clipping (0% clipped)");
console.log("    engine runs took " + ((Date.now() - t0) / 1000).toFixed(1) + " s");

// ---------------------------------------------------------------- page
const html = app1.replace("/*__DSP__*/", () => dsp1); // exactly how index.js builds the page
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
assert.ok(scripts.length >= 2);
scripts.forEach((js, i) => new vm.Script(js, { filename: "inline-" + i + ".js" }));
writeFileSync(join(work, "built.html"), html);
assert.equal((html.match(/id="plugs"/g) || []).length, 1);
assert.equal((html.match(/class="plug" data-plug=/g) || []).length, 7);
for (const id of ["pl-glue", "pl-warmth", "pl-deharsh", "pl-lowtrick", "pl-bandwidth", "pl-clipper", "pl-limstyle", "tgt-rows"]) assert.equal((html.match(new RegExp('id="' + id + '"', "g")) || []).length, 1, id);
assert.ok(html.includes("var pg = pluginOpts();") && html.includes("withPlugins(s, report, [") && html.includes("renderTargets(m);"));
pass("page: " + scripts.length + " inline scripts parse (new vm.Script), one PLUG-INS section with 7 plug-ins, loudness-target table wired in");
console.log("studio plug-ins ok");
