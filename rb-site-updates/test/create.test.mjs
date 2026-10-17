// Usage: node --no-warnings rb-site-updates/test/create.test.mjs <patched artist-router-v14.js>
// The real artist-router bundle serves RB Create at /create with a fresh nonce and a strict CSP.
import assert from "node:assert/strict";
import vm from "node:vm";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const worker = (await import(process.argv[2])).default;
const DB = fakeD1();
DB.raw.exec(`CREATE TABLE router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT);
INSERT INTO router_schema VALUES ('artist-router','artist-router-v14.3',datetime('now'));`);
const ctx = { waitUntil() {} };
const go = (url, method = "GET") => worker.fetch(new Request(url, { method, headers: { "User-Agent": "Mozilla/5.0" } }), { DB }, ctx);

const nonces = new Set();
for (const path of ["/create", "/create/"]) {
  const r = await go("https://relentlessbillionaire.com" + path);
  assert.equal(r.status, 200, path);
  assert.ok(r.headers.get("Content-Type").startsWith("text/html"));
  const csp = r.headers.get("Content-Security-Policy"), html = await r.text();
  const n = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(csp)[1]; nonces.add(n);
  assert.match(csp, new RegExp(`style-src 'nonce-${n}'`));
  for (const d of ["frame-ancestors 'self'", "frame-src 'self' https://studio.relentlessbillionaire.vip", "connect-src 'self' https://media.relentlessbillionaire.com", "object-src 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"), "no unsafe sources");
  assert.match(r.headers.get("Permissions-Policy"), /microphone=\(self\)/);
  assert.ok(!html.includes("__NONCE__"), "every placeholder filled");
  const tags = html.match(/<(script|style)\b[^>]*>/g);
  assert.ok(tags.length >= 2 && tags.every((t) => t.includes(`nonce="${n}"`)), "every script and style tag carries the nonce");
  assert.ok(!/<[a-z][^<>]*\sstyle=["']/i.test(html) && !/\son[a-z]+=["']/i.test(html), "no inline style or handler attributes (the CSP would block them)");
  const js = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g).map((x) => x.replace(/^<script[^>]*>|<\/script>$/g, ""));
  js.forEach((code) => new vm.Script(code));
  for (const want of ['"/record/"', '"/studio/"', "studio.relentlessbillionaire.vip", "/ai/platform/speech", "/ai/platform/image", "/ai/platform/transcribe"]) assert.ok(html.includes(want), want);
}
assert.equal(nonces.size, 2, "a new nonce on every request");
const head = await go("https://relentlessbillionaire.com/create/", "HEAD");
assert.equal(head.status, 200); assert.equal(await head.text(), "");
const www = await go("https://www.relentlessbillionaire.com/create/");
assert.equal(www.status, 200);
console.log("RB Create ok: /create and /create/, nonce per request, strict CSP, every tag nonced, no inline attributes, scripts parse, HEAD");
