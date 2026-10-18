// Usage: node rb-site-updates/test/daw-record-fix.test.mjs <pulled rb-daw dir>
// Runs patch_daw_plugins.py then patch_daw_record_fix.py on a copy: the fixes are in main.js, the resizer CSS is in
// daw.css, BUILD is the same whichever patch runs last, a second run changes nothing, and main.js parses.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
assert.ok(src, "pass the pulled rb-daw dir");
const dir = join(mkdtempSync(join(tmpdir(), "rb-daw-rec-")), "daw");
cpSync(src, dir, { recursive: true });
const run = (name) => execFileSync("python3", ["-I", join(here, "..", name), dir], { encoding: "utf8" });
const read = () => readFileSync(join(dir, "assets.js"), "utf8");
const load = async () => import("data:text/javascript;base64," + Buffer.from(read()).toString("base64") + "#" + Math.random());

run("patch_daw_plugins.py");
run("patch_daw_record_fix.py");
const s1 = read();
assert.match(run("patch_daw_record_fix.py"), /already in place/);
assert.match(run("patch_daw_plugins.py"), /already in place/, "plugins patch keeps the same BUILD on top of the fix");
assert.equal(read(), s1, "second runs change nothing");

const m = await load();
const main = m.ASSETS["main.js"].body, css = m.ASSETS["daw.css"].body;
for (const want of [
  'if(R("transport"),R("lanes"),!e)',
  'g.setMonitor(null),r.recordingClip=null,R("lanes");',
  "async function yt(t){g.recording&&await bt(),",
  'function qa(){rbSplit(),k("#t-play")',
  "function rbSplit()",
]) assert.equal(main.split(want).length - 1, 1, "once in main.js: " + want);
assert.ok(css.includes("body.rb-has-split .panel{height:var(--rb-panel-h,300px)}") && css.includes(".rb-split{"));
assert.equal(main.split(`.js?v=${m.BUILD}`).length - 1, 2, "both worklet URLs carry the new BUILD");
const f = join(dir, "main.check.mjs");
writeFileSync(f, main);
execFileSync(process.execPath, ["--check", f]);
console.log(`daw-record-fix: all checks passed (BUILD ${m.BUILD})`);
