// Usage: node --no-warnings rb-site-updates/test/studio-pick.test.mjs <patched rb-mastering-studio dir> [--browser]
// The mastering studio survives a long wait in the file picker: a page reloaded mid-pick (as phones do) says so and
// asks for the file again; a phone refusing the first read of a file is retried; a normal pick after a long wait loads.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
const dir = process.argv[2];
const app = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("-app.html"))), "utf8");
assert.equal(app.split("/* rb studio pick guard */").length, 2, "guard once");
for (const want of ['openPicker("file", "mix")', 'openPicker("ref-file", "ref")', 'openPicker("v-file", "vault")', "return readFile(file, 2).then", '$("file").onchange = function () { picking("");'])
  assert.ok(app.includes(want), want);
assert.ok(!/\$\("(file|ref-file|v-file)"\)\.click\(\)/.test(app), "every picker goes through openPicker");
const scripts = [...app.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1].replace("/*__DSP__*/", ""));
const d = mkdtempSync(join(tmpdir(), "pick-"));
scripts.forEach((js, i) => { const f = join(d, i + ".js"); writeFileSync(f, js); execFileSync(process.execPath, ["--check", f]); });
console.log("studio pick guard ok: every picker noted, reads retried, scripts parse");

if (process.argv.includes("--browser")) {
  const page = app.replace("/*__DSP__*/", () => readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("-dsp.txt"))), "utf8"));
  const sr = 44100, n = sr * 6, wav = Buffer.alloc(44 + n * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.sin(i * 0.05) * 9000 + Math.sin(i * 0.31) * 3000); wav.writeInt16LE(v, 44 + i * 4); wav.writeInt16LE(v, 46 + i * 4); }
  const mix = join(d, "mix.wav"); writeFileSync(mix, wav);
  const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route(/^https:\/\/relentlessbillionaire\.com\/studio\/(\?.*)?$/, (r) => r.fulfill({ headers: { "Content-Type": "text/html; charset=utf-8" }, body: page }));
  await p.goto("https://relentlessbillionaire.com/studio/", { waitUntil: "domcontentloaded" });
  // 1. the phone reloads the page while the picker is open
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.locator("#drop").click()]);
  assert.match(await p.evaluate(() => sessionStorage.getItem("rb_studio_picking")), /^mix\|\d+$/);
  await p.reload({ waitUntil: "domcontentloaded" });
  assert.match(await p.locator("#load-status").textContent(), /reloaded this page while the file picker was open/);
  assert.equal(await p.evaluate(() => sessionStorage.getItem("rb_studio_picking")), null, "said once");
  await p.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await p.locator("#load-status").textContent(), "", "not repeated on the next load");
  // 2. a long wait in the picker, then a pick that the phone refuses to read the first time
  await p.evaluate(() => { const real = File.prototype.arrayBuffer; let n = 0; File.prototype.arrayBuffer = function () { return n++ === 0 ? Promise.reject(new DOMException("could not be read", "NotReadableError")) : real.call(this); }; });
  const [fc2] = await Promise.all([p.waitForEvent("filechooser"), p.locator("#drop").click()]);
  await p.waitForTimeout(5000);
  await fc2.setFiles(mix);
  await p.waitForFunction(() => !document.querySelector("#analysis").classList.contains("hide"), null, { timeout: 30000 });
  assert.equal(await p.evaluate(() => sessionStorage.getItem("rb_studio_picking")), null, "cleared when the file arrives");
  // 3. a read refused every time ends in plain words
  await p.evaluate(() => { File.prototype.arrayBuffer = function () { return Promise.reject(new DOMException("could not be read", "NotReadableError")); }; });
  const [fc3] = await Promise.all([p.waitForEvent("filechooser"), p.locator("#drop").click()]);
  await fc3.setFiles(mix);
  await p.waitForFunction(() => /didn't hand the file over/.test(document.querySelector("#load-status").textContent), null, { timeout: 15000 });
  // 4. the reference-track picker is noted too (a picker opened without a tap is cancelled by the browser, which clears the note)
  const [fc4] = await Promise.all([p.waitForEvent("filechooser"), p.locator("#ref-btn").click()]);
  assert.match(await p.evaluate(() => sessionStorage.getItem("rb_studio_picking")), /^ref\|/);
  assert.deepEqual(errs, []);
  await b.close();
  console.log("studio pick guard in Chromium ok: reload mid-pick explained once, refused read retried and loaded, persistent refusal explained, reference picker noted, no errors");
}
