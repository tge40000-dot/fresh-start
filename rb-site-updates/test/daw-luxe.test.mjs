// Usage: node rb-site-updates/test/daw-luxe.test.mjs <pulled rb-daw dir>
// Runs the three rb-daw patches (plugins, record fix, luxe) on a copy in both orders: same BUILD either way, second
// runs change nothing, luxe code/CSS/fonts/help present once, main.js parses. Then checks the value formatting and
// parsing in luxe.js on its own: dB from gain, pan L/C/R, %, Hz/kHz, clamping and step snapping.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
assert.ok(src, "pass the pulled rb-daw dir");
const copy = () => { const d = join(mkdtempSync(join(tmpdir(), "rb-daw-luxe-")), "daw"); cpSync(src, d, { recursive: true }); return d; };
const run = (name, dir) => execFileSync("python3", ["-I", join(here, "..", name), dir], { encoding: "utf8" });
const read = (dir) => readFileSync(join(dir, "assets.js"), "utf8");
const A = copy(), B = copy();
for (const n of ["patch_daw_plugins.py", "patch_daw_record_fix.py", "patch_daw_luxe.py"]) run(n, A);
for (const n of ["patch_daw_luxe.py", "patch_daw_record_fix.py", "patch_daw_plugins.py"]) run(n, B);
assert.equal(read(A), read(B), "same output in either order");
const s1 = read(A);
for (const n of ["patch_daw_luxe.py", "patch_daw_plugins.py", "patch_daw_record_fix.py"]) assert.match(run(n, A), /already in place/, n);
assert.equal(read(A), s1, "second runs change nothing");

const m = await import("data:text/javascript;base64," + Buffer.from(s1).toString("base64"));
const main = m.ASSETS["main.js"].body, css = m.ASSETS["daw.css"].body;
for (const want of ["function rbLuxe()", "function qa(){rbSplit(),rbLuxe(),", 't("Shift-drag",', "function rbSplit()"])
  assert.equal(main.split(want).length - 1, 1, "once in main.js: " + want);
assert.ok(css.includes("/* RB studio luxe begin */") && css.includes(".rb-val{") && css.includes("input.rb-r::-webkit-slider-thumb"));
assert.equal(m.SHELL.split("fonts.googleapis.com/css2?family=Bodoni+Moda").length - 1, 1, "house fonts linked once");
assert.ok(m.SHELL.indexOf("Bodoni+Moda") < m.SHELL.indexOf("daw.css?v="), "fonts load before the studio CSS");
assert.equal(main.split(`.js?v=${m.BUILD}`).length - 1, 2, "both worklet URLs carry the new BUILD");
const f = join(A, "main.check.mjs");
writeFileSync(f, main);
execFileSync(process.execPath, ["--check", f]);

// The formatting and parsing helpers, run on their own.
const lib = readFileSync(join(here, "..", "src", "daw-luxe", "luxe.js"), "utf8");
const L = new Function(lib + "; return { rbFmt, rbParse, rbSnap, rbKind };")();
const R = (label, min, max, step) => ({ min: String(min), max: String(max), step: String(step), getAttribute: () => label });
assert.equal(L.rbFmt("gain", .8), "−1.9 dB");
assert.equal(L.rbFmt("gain", 1), "0.0 dB");
assert.equal(L.rbFmt("gain", 0), "−∞ dB");
assert.ok(Math.abs(L.rbParse("gain", "-6") - 0.501) < .001);
assert.equal(L.rbParse("gain", "-inf"), 0);
assert.equal(L.rbFmt("pan", -.35), "L 35"); assert.equal(L.rbFmt("pan", 0), "C"); assert.equal(L.rbFmt("pan", .2), "R 20");
assert.equal(L.rbParse("pan", "L25"), -.25); assert.equal(L.rbParse("pan", "r 40"), .4); assert.equal(L.rbParse("pan", "c"), 0);
assert.equal(L.rbFmt("db", 3.5), "+3.5 dB"); assert.equal(L.rbFmt("db", -30), "−30 dB"); assert.equal(L.rbFmt("db", 0), "0 dB");
assert.equal(L.rbParse("db", "−12 dB"), -12);
assert.equal(L.rbFmt("pct", .35), "35%"); assert.equal(L.rbParse("pct", "35%"), .35);
assert.equal(L.rbFmt("hz", 80), "80 Hz"); assert.equal(L.rbFmt("hz", 6500), "6.50 kHz"); assert.equal(L.rbParse("hz", "6.5k"), 6500);
assert.equal(L.rbFmt("bits", 8), "8-bit"); assert.equal(L.rbFmt("div", 4), "÷4");
assert.equal(L.rbParse("db", "loud"), null);
assert.equal(L.rbSnap(R("x", -12, 12, .5), 40), 12, "clamps");
assert.equal(L.rbSnap(R("x", -12, 12, .5), 3.3), 3.5, "snaps to the step");
assert.equal(L.rbSnap(R("x", 0, 1.25, .01), .50118), .5);
for (const [label, kind, d] of [["Vocal Vol", "gain", .8], ["Vocal volume", "gain", .8], ["Master volume", "gain", .85], ["Vocal Pan", "pan", 0],
  ["Drums Low", "db", 0], ["Vocal Reverb", "pct", 0], ["Vocal low cut frequency", "hz", 80], ["Vocal sibilance threshold", "db", -30], ["Vocal crunch bits", "bits", 8]])
  assert.deepEqual(L.rbKind(R(label, 0, 1, .01)), { k: kind, d }, label);
console.log(`daw-luxe: all checks passed (BUILD ${m.BUILD})`);
