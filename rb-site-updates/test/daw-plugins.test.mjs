// Usage: node rb-site-updates/test/daw-plugins.test.mjs <freshly pulled (unpatched) rb-daw dir>
// Runs patch_daw_plugins.py on a copy: every anchor applied once, a second run changes nothing (same BUILD), BUILD
// changed in assets.js and in both worklet URLs, main.js / fx-worklet.js parse, no brand names in the plugin UI.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const patch = join(here, "..", "patch_daw_plugins.py");
const src = process.argv[2];
assert.ok(src, "pass the pulled rb-daw dir");
const work = mkdtempSync(join(tmpdir(), "rb-daw-plugins-"));
const dir = join(work, "daw");
cpSync(src, dir, { recursive: true });

const load = async (f) => import("data:text/javascript;base64," + Buffer.from(readFileSync(f, "utf8")).toString("base64") + "#" + Math.random());
const before = await load(join(src, "assets.js"));
assert.ok(!before.ASSETS["fx-worklet.js"] && !before.ASSETS["main.js"].body.includes("rbApply"), "start from an unpatched pull");

const run = () => execFileSync("python3", ["-I", patch, dir], { encoding: "utf8" });
const out1 = run();
const s1 = readFileSync(join(dir, "assets.js"), "utf8");
const steps = ["engine+UI block", "track inserts", "apply params", "synced echo bpm", "removed-track cleanup", "offline worklet",
  "live worklet", "vocal presets", "preset resets plugins", "mixer plugins", "editor clip tools", "hint text", "mobile track x", "plugins css"];
for (const st of steps) assert.equal(out1.split("\n").filter((l) => l === `rb-daw: applied ${st}`).length, 1, `applied once: ${st}`);
assert.ok(out1.includes("rb-daw: added fx-worklet.js"));

const out2 = run();
const s2 = readFileSync(join(dir, "assets.js"), "utf8");
assert.equal(s2, s1, "second run changes nothing");
assert.match(out2, /^rb-daw: already in place \(BUILD [0-9a-f]{12}\)\n$/);

const m = await load(join(dir, "assets.js"));
const main = m.ASSETS["main.js"].body, css = m.ASSETS["daw.css"].body, wk = m.ASSETS["fx-worklet.js"];
assert.match(m.BUILD, /^[0-9a-f]{12}$/);
assert.notEqual(m.BUILD, before.BUILD, "BUILD changed");
assert.ok(out2.includes(`(BUILD ${m.BUILD})`), "BUILD stable across runs");
assert.equal((main.match(new RegExp(`\\.js\\?v=${m.BUILD}`, "g")) || []).length, 2, "rec-worklet and fx-worklet URLs carry the new BUILD");
assert.ok(main.includes(`./rec-worklet.js?v=${m.BUILD}`) && main.includes(`./fx-worklet.js?v=${m.BUILD}`));
assert.ok(!main.includes(before.BUILD) && !main.includes("__RB_BUILD__"), "no old BUILD or placeholder left");
for (const [k, v] of Object.entries(before.ASSETS)) if (k !== "main.js" && k !== "daw.css") assert.deepEqual(m.ASSETS[k], v, `${k} untouched`);
assert.equal(m.SHELL, before.SHELL, "shell untouched (it takes {{BUILD}} at request time)");

// each insertion is present exactly once, each old anchor is gone
const once = (txt, needle, what) => assert.equal(txt.split(needle).length - 1, 1, `${what}: ${needle}`);
for (const n of ["/* RB plugins begin */", "rbChain(this,n),n.vol.connect(n.pan)", "rbApply(this,a,e,n)}synth(e){", "setBpm(e){rbSetBpm(this,e),",
  "s.pan.disconnect(),rbKill(s),", "u=(await rbFxLoad(d),new Ht(d))", "rbFxLoad(this.ctx).then(()=>this.sync())", "...RBPRESETS};",
  "Object.assign(n.fx,RBFX,a.fx)", "rbPlug(n),", 'return l("div",{},rbClipBar(t),', "or use the buttons above"]) once(main, n, "main.js");
for (const n of ["n.input.connect(n.low)", ",u=new Ht(d);", "this.ready=this.loadRecorder()),", "delete with Delete."]) assert.ok(!main.includes(n), `old anchor gone: ${n}`);
once(css, "/* RB plugins begin */", "daw.css");
assert.ok(!css.includes(".mini.x{display:none}"), "track x no longer hidden on mobile");
assert.ok(css.includes(".cliptools .btn{min-height:40px"), "40px touch buttons");

// parses
const d = mkdtempSync(join(tmpdir(), "rb-daw-js-"));
for (const [f, body] of [["main.mjs", main], ["fx-worklet.js", wk.body]]) { writeFileSync(join(d, f), body); execFileSync(process.execPath, ["--check", join(d, f)]); }
assert.equal(wk.type, "text/javascript; charset=utf-8");
for (const p of ["rb-gate", "rb-deess", "rb-crush"]) assert.ok(wk.body.includes(`registerProcessor("${p}"`), p);

// generic names only, in everything this patch adds
const added = main.slice(main.indexOf("/* RB plugins begin */"), main.indexOf("/* RB plugins end */")) + wk.body;
for (const b of ["Auto-Tune", "Antares", "1176", "LA-2A", "SSL", "Pultec", "Waves", "FabFilter", "Soundtoys", "Valhalla", "Ozone", "iZotope", "Neve", "Fairchild", "Decapitator", "Melodyne"])
  assert.ok(!added.includes(b), `no brand name "${b}"`);
for (const p of ["Hard Trap Lead", "Melodic Hook", "Boom-bap Rap", "R&B Silk", "Ad-lib Spice", "Phone/Radio"]) assert.ok(added.includes(`label: "${p}"`), p);

// the worker still imports the patched assets
execFileSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify("file://" + join(dir, "index.js"))}); if (!m.default || !m.default.fetch) process.exit(1);`]);

console.log(`daw-plugins ok: ${steps.length} anchors + fx-worklet.js applied once, second run unchanged, BUILD ${before.BUILD} -> ${m.BUILD} in assets.js and both worklet URLs, main.js and fx-worklet.js parse`);
