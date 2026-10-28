// node workers/rb-daw/test.mjs: builds dist/ and checks it: modules parse, the page and every asset are there, the
// worklet URLs carry the build hash, and the blocks added to the studio (plugins, recording fix, value boxes) are present once.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [join(here, "build.mjs")], { stdio: "inherit" });
for (const f of ["index.js", "assets.js"]) execFileSync(process.execPath, ["--check", join(here, "dist", f)]);
const m = await import(join(here, "dist", "assets.js") + "?" + Date.now());
assert.match(m.BUILD, /^[0-9a-f]{12}$/);
for (const name of ["main.js", "daw.css", "rec-worklet.js", "fx-worklet.js", "icon.svg"]) assert.ok(m.ASSETS[name]?.body.length > 100, name);
const main = m.ASSETS["main.js"].body, css = m.ASSETS["daw.css"].body;
assert.ok(!main.includes("__BUILD__"));
assert.equal(main.split(`.js?v=${m.BUILD}`).length - 1, 2, "both worklet URLs carry the build hash");
for (const want of ["function rbApply(", "function rbSplit()", "function rbLuxe()", "function rbSet(", 'R("transport"), R("lanes")', "function rbClaimSound()", "(this.playing = !0),\n        rbClaimSound(),"])
  assert.equal(main.split(want).length - 1, 1, "once in main.js: " + want);
for (const want of ["/* RB plugins", "/* RB studio fixes begin */", "/* RB studio luxe begin */"]) assert.ok(css.includes(want), want);
for (const ph of ["{{BASE}}", "{{CANONICAL}}", "{{BUILD}}", "{{THEME_LINK}}", "Bodoni+Moda"]) assert.ok(m.SHELL.includes(ph), ph);
const f = join(mkdtempSync(join(tmpdir(), "rb-daw-")), "main.mjs"); // outside dist/, which is what gets uploaded
writeFileSync(f, main);
execFileSync(process.execPath, ["--check", f]);
console.log(`rb-daw: source build checks passed (BUILD ${m.BUILD})`);
