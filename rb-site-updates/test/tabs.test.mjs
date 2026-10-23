// Usage: node rb-site-updates/test/tabs.test.mjs <patched site Worker dir>...
// Every page of every user site opens with one row of RB site tabs: all 14 sites, hidden until the shared stylesheet
// shows it, with at most the right one marked current; the Worker's modules still parse.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const LINKS = ["https://relentlessbillionaire.com/", "https://relentlessbillionaire.com/events", "https://relentlessbillionaire.com/store", "https://beatstore.relentlessbillionaire.com/", "https://relentlessbillionaire.com/studio/", "https://studio.relentlessbillionaire.com/", "https://relentlessbillionaire.com/create", "https://relentlessbillionaire.com/tv", "https://relentlessbillionaire.com/radio", "https://relentlessbillionaire.com/release", "https://relentlessbillionaire.com/game/", "https://relentlessbillionaire.com/jobs", "https://relentlessbillionaire.com/memberships", "https://relentlessbillionaire.com/fund"];
let pages = 0;
for (const d of process.argv.slice(2)) {
  for (const f of readdirSync(d).filter((x) => /\.(js|html)$/.test(x) && x !== "brand_icons.js")) {
    const s = readFileSync(join(d, f), "utf8").replace(/\\"/g, '"');
    for (const m of s.matchAll(/<body\b[^>]*>/gi)) {
      if (/data-rbtabs="off"/.test(m[0])) { assert.ok(!s.slice(m.index, m.index + 400).includes('class="rbtabs"'), `${d}/${f}: an app page keeps its own nav`); continue; }
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 3000);
      assert.ok(after.startsWith('<nav class="rbtabs" hidden aria-label="Relentless Billionaire sites">'), `${d}/${f}: the tabs open the page`);
      const bar = after.slice(0, after.indexOf("</nav>") + 6);
      assert.deepEqual([...bar.matchAll(/href="([^"]+)"/g)].map((x) => x[1]), LINKS, `${d}/${f}: all the sites, in order`);
      assert.ok((bar.match(/aria-current="page"/g) || []).length <= 1, `${d}/${f}: at most one current tab`);
      assert.equal(after.split('<nav class="rbtabs"').length - 1, 1, `${d}/${f}: one bar per page`);
      pages++;
    }
    if (f.endsWith(".js")) execFileSync(process.execPath, ["--check", join(d, f)]);
  }
}
assert.ok(pages > 0);
console.log(`tabs ok: ${pages} page(s) across ${process.argv.length - 2} site Worker(s) open with the 14 site tabs`);
