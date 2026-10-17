// Usage: node rb-site-updates/test/studio.test.mjs <patched rb-mastering-studio dir>
// Suggested settings are in the studio page once, labelled as rules (not AI), and every inline script still parses.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
const dir = process.argv[2];
const app = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("-app.html"))), "utf8");
assert.equal((app.match(/function renderSuggestions\(m\)/g) || []).length, 1);
assert.equal((app.match(/id="sugg-list"/g) || []).length, 1);
assert.ok(app.includes("not AI"), "says it isn't AI");
assert.ok(app.includes("renderSuggestions(m);"), "drawn after each measurement");
const scripts = [...app.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1].replace("/*__DSP__*/", ""));
assert.ok(scripts.length > 0);
const d = mkdtempSync(join(tmpdir(), "studio-"));
scripts.forEach((js, i) => { const f = join(d, i + ".js"); writeFileSync(f, js); execFileSync(process.execPath, ["--check", f]); });
console.log("studio ok: suggested settings once, labelled, " + scripts.length + " inline script(s) parse");
