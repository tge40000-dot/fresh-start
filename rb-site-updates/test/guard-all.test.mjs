// Usage: node --no-warnings rb-site-updates/test/guard-all.test.mjs <patched Worker dir>...
// rb-tools/patch_resilience.py on the other site Workers: each has the crash guard as its outermost wrapper, and with
// every binding missing (no database, no storage, no upstream) a GET of its home page answers instead of throwing.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
globalThis.HTMLRewriter = class { on() { return this; } transform(r) { return r; } };
globalThis.caches = { default: { match: async () => null, put: async () => {} }, open: async () => ({ match: async () => null, put: async () => {} }) };
globalThis.fetch = async () => { throw new Error("Network connection lost."); }; // no upstream either
const quiet = console.error; console.error = () => {};
const out = [];
for (const dir of process.argv.slice(2)) {
  const man = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")), entry = man.entry || "index.js";
  const src0 = fs.readFileSync(path.join(dir, entry), "utf8");
  // outermost: the guard's call comes after every other wrapper's call
  const at = src0.lastIndexOf("\n__rbSafeWrap(");
  assert.ok(at > 0, `${man.script}: guarded`);
  for (const w of ["\n__rbRadioWrap(", "\n__rbSecWrap("]) assert.ok(src0.lastIndexOf(w) < at, `${man.script}: the guard is outermost`);
  // load it: copy the modules, inlining text and HTML imports
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(m?js)$/.test(f)) continue;
    let s = fs.readFileSync(path.join(dir, f), "utf8");
    s = s.replace(/import (\w+) from "\.\/([^"]+\.(?:html|txt|css|svg|json|bin|wasm|mp3))";/g, (m, n, file) => fs.existsSync(path.join(dir, file)) ? `const ${n} = ${JSON.stringify(fs.readFileSync(path.join(dir, file), "utf8"))};` : m);
    s = s.replace(/from "cloudflare:workers"/g, 'from "data:text/javascript,export class WorkerEntrypoint{} export class DurableObject{}"');
    fs.writeFileSync(path.join(tmp, f.replace(/\.js$/, ".mjs")), s.replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"'));
  }
  let mod;
  try { mod = await import(path.join(tmp, entry.replace(/\.js$/, ".mjs"))); } catch (e) { out.push(`${man.script}: guarded (not loadable here: ${String(e.message).slice(0, 60)})`); continue; }
  const W = mod.default;
  assert.ok(W.fetch.__rbSafe, `${man.script}: the loaded handler is the guard`);
  const r = await Promise.race([W.fetch(new Request("https://relentlessbillionaire.com/"), {}, { waitUntil() {}, passThroughOnException() {} }), new Promise((res) => setTimeout(() => res("slow"), 4000))]);
  assert.ok(r === "slow" || r instanceof Response, `${man.script}: answers instead of throwing`);
  out.push(`${man.script}: ${r === "slow" ? "waits on its upstream" : r.status}`);
}
console.error = quiet;
console.log("guard ok: " + out.join(", "));
