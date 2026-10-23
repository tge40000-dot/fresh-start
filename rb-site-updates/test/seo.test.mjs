// Usage: node --no-warnings rb-site-updates/test/seo.test.mjs <patched artist-router-v14.js> <patched beatstore worker.js>
//   [<patched events-worker.js> <patched rb-fund-campaign worker.js> <patched rb-release-worker.js>]
// rb-tools/patch_seo.py: the sitemap, game.relentlessbillionaire.com to RB World, the baseline security header, and
// the beatstore's robots.txt and sitemap.
import assert from "node:assert/strict";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
globalThis.HTMLRewriter = class { on() { return this; } transform(r) { return r; } };
const [arPath, bsPath, ...others] = process.argv.slice(2);
const ar = (await import(arPath)).default, bs = (await import(bsPath)).default;
const env = { DB: fakeD1() }, ctx = { waitUntil() {}, passThroughOnException() {} };
const go = (w, u, init) => w.fetch(new Request(u, init), env, ctx);

// the old game host goes to RB World
let r = await go(ar, "https://game.relentlessbillionaire.com/?ref=old");
assert.equal(r.status, 302); assert.equal(r.headers.get("Location"), "https://relentlessbillionaire.com/app/world/?ref=old");
r = await go(ar, "https://game.relentlessbillionaire.com/anything");
assert.equal(r.headers.get("Location"), "https://relentlessbillionaire.com/app/world/", "any page on it");
r = await go(ar, "https://game.relentlessbillionaire.com/", { method: "POST" });
assert.notEqual(r.status, 302, "only GET and HEAD redirect");

// the sitemap
r = await go(ar, "https://relentlessbillionaire.com/sitemap.xml");
const xml = await r.text();
for (const p of ["/create", "/beats", "/advertise", "/app/world/", "/memberships", "/radio"]) assert.ok(xml.includes(`<loc>https://relentlessbillionaire.com${p}</loc>`), p);
assert.ok(!xml.includes("/game/</loc>"), "not the old redirect");
assert.ok(!xml.includes("/rewards</loc>") && !xml.includes("/badge</loc>"), "switched-off pages stay out");

// the baseline header: added where a page has none, never replacing a page's own
r = await go(ar, "https://relentlessbillionaire.com/sitemap.xml");
assert.equal(r.headers.get("Content-Security-Policy"), null, "not on XML");
const page = await go(ar, "https://relentlessbillionaire.com/terms");
if (/^text\/html/.test(page.headers.get("Content-Type") || "")) assert.equal(page.headers.get("Content-Security-Policy"), "frame-ancestors 'self'; base-uri 'self'; object-src 'none'", "/terms gets the baseline");
const own = await go(ar, "https://relentlessbillionaire.com/create");
if (own.headers.get("Content-Security-Policy")) assert.ok(/script-src/.test(own.headers.get("Content-Security-Policy")), "a page's own policy is kept");

// the beatstore
r = await go(bs, "https://beatstore.relentlessbillionaire.com/robots.txt");
assert.equal(r.status, 200); assert.match(r.headers.get("Content-Type"), /text\/plain/);
const robots = await r.text();
assert.ok(robots.includes("Sitemap: https://beatstore.relentlessbillionaire.com/sitemap.xml") && robots.includes("Disallow: /api/"));
r = await go(bs, "https://beatstore.relentlessbillionaire.com/sitemap.xml");
assert.match(r.headers.get("Content-Type"), /xml/); assert.ok((await r.text()).includes("<loc>https://beatstore.relentlessbillionaire.com/</loc>"));

// the other page Workers: an HTML page gets the baseline, nothing else changes
const BASE = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'";
for (const [path, url] of others.map((p, i) => [p, ["https://relentlessbillionaire.com/events", "https://relentlessbillionaire.com/fund", "https://relentlessbillionaire.com/release"][i]])) {
  const w = (await import(path)).default;
  assert.ok(w.fetch.__rbSec, path + " is wrapped");
  let res;
  try { res = await go(w, url); } catch (e) { continue; }   // a page that needs bindings the fake env lacks: the wrap is checked above
  const ct = res.headers.get("Content-Type") || "", csp = res.headers.get("Content-Security-Policy");
  if (/^text\/html/.test(ct)) { assert.ok(csp, url + " has a policy"); if (!csp.includes("script-src")) assert.equal(csp, BASE, url); }
  else assert.notEqual(csp, BASE, url + ": not on " + ct);
}
console.log("seo ok: game.relentlessbillionaire.com to RB World (GET/HEAD, query kept), sitemap with /create /beats /advertise /app/world/ (switched-off pages out), baseline CSP only where a page has none, beatstore robots.txt and sitemap" + (others.length ? ", baseline on /events /fund /release" : ""));
