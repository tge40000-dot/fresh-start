// Checks the simplified /memberships (patch_memberships.py) against a patched rb-memberships index.js.
// Usage: node memberships.test.mjs <patched rb-memberships/index.js>
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const src = fs.readFileSync(process.argv[2], "utf8");
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rbm-")), "index.mjs");
fs.writeFileSync(tmp, src);
const worker = (await import(tmp)).default;

const pricing = { live: true, plans: [
  { id: "single", name: "Single master", blurb: "Unlock one master's pro tools", features: ["Match this master"], interval: null, regular: 700 },
  { id: "artist_month", name: "Artist", blurb: "Every pro tool, every master", features: ["Reference matching on every master", "Your own vault"], interval: "month", regular: 1499 },
  { id: "artist_year", name: "Artist (yearly)", blurb: "Unlimited masters, billed yearly", features: [], interval: "year", regular: 11900 },
  { id: "pro_month", name: "Pro", blurb: "Everything in Artist, plus RB Cloud", features: ["Everything in Artist", "RB Cloud stems"], interval: "month", regular: 2999 },
] };
const feats = [
  { key: "profile", label: "My artist page", passport: 0, starting: 1, coach: 1 },
  { key: "coaching", label: "Coaching line", passport: 0, starting: 0, coach: 1 },
  { key: "events", label: "Events", passport: 1, starting: 1, coach: 1 },
];
const env = (ok = true) => ({
  DB: { prepare: (q) => ({ all: async () => { if (!ok) throw new Error("down"); return { results: /portal_features/.test(q) ? feats : [] }; }, bind() { return this; }, run: async () => ({}) }) },
  STUDIO: { fetch: async () => ok ? new Response(JSON.stringify(pricing)) : new Response("no", { status: 500 }) },
});
const get = async (p, e = env()) => { const r = await worker.fetch(new Request("https://relentlessbillionaire.com" + p), e, { waitUntil() {} }); return [r.status, await r.text()]; };

let [st, h] = await get("/memberships");
assert.equal(st, 200);
for (const href of ["/radio", "/tv", "/record/", "/studio/", "/jobs", "/events", "/game/", "/book"]) assert.ok(h.includes(`href="${href}"`), "free house " + href);
assert.ok(h.includes("Three ways in") && h.includes('href="/memberships/passport"') && h.includes('href="/memberships/just-starting"'));
assert.ok(h.includes("$14.99") && h.includes("Pro: $29.99/month") && h.includes("$7 for a single master"), "studio card from live pricing");
assert.ok(h.includes('href="/memberships/coach"') && h.includes('href="/memberships/business"'));
assert.ok(!h.includes('href="/memberships/business-pro"'), "business cards are off the overview");
// Portal table follows portal_features: artist page not in Passport, coaching only in Coach.
const row = (label) => h.split(`<th scope="row">${label}</th>`)[1].split("</tr>")[0].match(/Included|Not included/g);
assert.deepEqual(row("Your artist page"), ["Not included", "Included", "Included"]);
assert.deepEqual(row("Coaching line"), ["Not included", "Not included", "Included"]);
assert.deepEqual(row("RB Cloud stems"), ["Not included", "Not included", "Included"]);
assert.deepEqual(row("Your own vault"), ["Not included", "Included", "Included"]);
assert.ok(!h.includes('<th scope="row">Everything in Artist</th>'));

// Business page and back links.
[st, h] = await get("/memberships/business");
assert.equal(st, 200);
for (const id of ["business-starter", "business-pro", "business-elite"]) assert.ok(h.includes(`href="/memberships/${id}"`));
[, h] = await get("/memberships/business-pro");
assert.ok(h.includes('href="/memberships/business">← Business plans'));
[, h] = await get("/memberships/coach");
assert.ok(h.includes('href="/memberships">← All memberships'));

// D1 and the studio both down: the page still renders, without the tables.
[st, h] = await get("/memberships", env(false));
assert.equal(st, 200);
assert.ok(h.includes("Free for everyone") && h.includes("See RB Studio plans") && !h.includes('class="cmp"'));
console.log("memberships: all checks passed");
