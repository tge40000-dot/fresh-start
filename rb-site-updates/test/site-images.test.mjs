// Usage: node --no-warnings rb-site-updates/test/site-images.test.mjs <patched rb-command dir> <patched rb-public-content dir> <patched site Worker dir>...
// Site images end to end against an in-memory DB: RB Command lists, saves, refuses and puts back choices and pictures;
// rb-public-content serves the chosen picture or the right fallback, and the background/logo CSS per site; every site
// Worker links its own icon, stylesheet and share picture, once per page.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const [cmdDir, pubDir, ...siteDirs] = process.argv.slice(2);
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const DB = fakeD1();
DB.raw.exec("CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT); CREATE TABLE command_log (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, target TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')))");
const deleted = [];
const env = { DB, MEDIA: { delete: async (k) => deleted.push(k) }, MEDIA_PUBLIC_URL: "https://media.relentlessbillionaire.com" };
const who = { email: "owner@rb.test" };
const si = await import(join(cmdDir, "siteimages.js"));
const pub = await import(join(pubDir, "site-images-public.js"));
const rejects = (p, re) => assert.rejects(p, (e) => re.test(e.message));

// ---- RB Command
let g = await si.get(env);
assert.deepEqual(g.assets, []); assert.equal(g.previous, null); assert.equal(g.label, "every site uses its own pictures");
assert.deepEqual(g.slots.map((s) => s.id), ["icon", "share", "background", "logo"]);
const key = (n) => `admin/site-images/2026-10/0000000${n}-aaaa-bbbb-cccc-dddddddddddd.png`;
const add = (kind, n, name) => si.addAsset(env, who, { kind, key: key(n), url: `${env.MEDIA_PUBLIC_URL}/${key(n)}`, name, width: 512, height: 512 });
await rejects(si.addAsset(env, who, { kind: "icon", key: "admin/ads/x.png", url: "https://media.relentlessbillionaire.com/admin/ads/x.png" }), /isn't one of RB Command's site pictures/);
await rejects(si.addAsset(env, who, { kind: "icon", key: key(1), url: "https://evil.example/" + key(1) }), /isn't one of/);
await rejects(si.addAsset(env, who, { kind: "poster", key: key(1), url: `${env.MEDIA_PUBLIC_URL}/${key(1)}` }), /Pick what the picture is for/);
const icon = (await add("icon", 1, "Gold crown")).asset, bg = (await add("background", 2, "Club night")).asset, logo = (await add("logo", 3, "Wordmark")).asset;
await rejects(si.save(env, who, { setting: { icon: { all: bg.id } } }), /made for another slot/);
await rejects(si.save(env, who, { setting: { icon: { all: "zzzzzzzzzzzz" } } }), /isn't in the library/);
let r = await si.save(env, who, { setting: { icon: { all: icon.id, sites: { fund: "none", nowhere: icon.id } }, background: { all: bg.id, sites: { tv: bg.id } }, logo: { sites: { home: logo.id } } } });
assert.match(r.label, /Tab icon \(all sites: Gold crown, \/fund: own\)/);
assert.equal(r.setting.icon.sites.nowhere, undefined, "unknown sites are dropped");
g = await si.get(env);
assert.equal(g.previous.label, "every site uses its own pictures"); assert.deepEqual(new Set(g.in_use), new Set([icon.id, bg.id, logo.id]));
await rejects(si.removeAsset(env, who, { id: icon.id }), /still uses/);
await si.save(env, who, { setting: { icon: { all: icon.id } } });
await si.undo(env, who);
assert.equal((await si.get(env)).setting.background.all, bg.id, "Undo puts the earlier setting back");

// ---- rb-public-content
const ctx = { waitUntil() {} };
const fetched = [];
globalThis.fetch = async (u) => { fetched.push(String(u)); return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } }); };
const img = (q) => pub.siteImage(new Request("https://relentlessbillionaire.com/api/content/site-image?" + q), env, ctx, new URL("https://relentlessbillionaire.com/api/content/site-image?" + q));
const css = async (site) => (await pub.siteImagesCss(null, env, ctx, new URL("https://relentlessbillionaire.com/api/content/site-images.css?site=" + site))).text();
let res = await img("site=home&slot=icon");
assert.equal(res.status, 200); assert.equal(res.headers.get("Content-Type"), "image/png"); assert.equal(fetched.pop(), icon.url, "the chosen icon, read from RB media");
res = await img("site=fund&slot=icon");
assert.equal(res.status, 302); assert.equal(res.headers.get("Location"), "https://relentlessbillionaire.com/brand/icon.svg?v=3", "a site set to keep its own gets the RB icon");
assert.equal((await img("site=fund&slot=apple")).headers.get("Location"), "https://relentlessbillionaire.com/brand/apple-touch-icon.png?v=3");
assert.equal((await img("site=home&slot=share&fallback=" + encodeURIComponent("https://relentlessbillionaire.com/hero.jpg?a=1&amp;b=2"))).headers.get("Location"), "https://relentlessbillionaire.com/hero.jpg?a=1&b=2", "no share picture chosen: the page's own");
assert.equal((await img("site=home&slot=share&fallback=" + encodeURIComponent("https://evil.example/x.jpg"))).headers.get("Location"), "https://relentlessbillionaire.com/brand/icon-512.png?v=3", "fallbacks only to RB hosts");
assert.equal((await img("site=home&slot=logo")).status, 200);
assert.equal((await img("site=beats&slot=logo")).status, 204, "no logo chosen for the beat store");
assert.equal((await img("site=mars&slot=icon")).status, 400); assert.equal((await img("site=home&slot=poster")).status, 400);
let c = await css("home");
assert.match(c, /html body\{background:linear-gradient/); assert.match(c, /slot=background&v=/);
assert.match(c, /a#rb-nav-mark\{background:url\("https:\/\/relentlessbillionaire\.com\/api\/content\/site-image\?site=home&slot=logo&v=/);
c = await css("tv");
assert.doesNotMatch(c, /background:linear/, "RB TV keeps its own background, even when set for it");
c = await css("beats");
assert.match(c, /background:linear/); assert.doesNotMatch(c, /nav\.nav > a\.logo\{/, "logo only where chosen");
assert.equal((await pub.siteImagesCss(null, env, ctx, new URL("https://x/api/content/site-images.css?site=mars"))).status, 400);
await si.save(env, who, { setting: {} });
assert.equal(await css("home"), "/* RB site images: home */\n", "nothing chosen: empty, so sites look as before");
assert.equal((await img("site=home&slot=share")).headers.get("Location"), "https://relentlessbillionaire.com/brand/icon-512.png?v=3", "TV aside, no choice and no fallback: the RB icon");
globalThis.fetch = async () => new Response("<html>", { headers: { "Content-Type": "text/html" } });
await si.save(env, who, { setting: { icon: { all: icon.id } } });
assert.equal((await img("site=home&slot=icon")).status, 302, "a stored file that isn't a picture is never passed on");
await si.save(env, who, { setting: {} }); await si.save(env, who, { setting: {} });
await si.removeAsset(env, who, { id: bg.id });
assert.deepEqual(deleted, [key(2)], "deleting removes the file from RB media");

// ---- the page and the routes
const html = si.page("n0nce", true);
for (const tag of html.match(/<(script|style)\b[^>]*>/g)) assert.match(tag, /nonce="n0nce"/);
new Function(html.match(/<script nonce="n0nce">([\s\S]*?)<\/script>/)[1]);
assert.ok(!si.page("n0nce", false).includes('id="save"'), "view-only people get no Publish button");
const once = (s, x, what) => assert.equal(s.split(x).length - 1, 1, what);
const index = readFileSync(join(cmdDir, "index.js"), "utf8"), ui = readFileSync(join(cmdDir, "ui.js"), "utf8");
for (const x of ['if (path === "/images") {', 'if (path === "/api/site-images") { needs(user, "Content", "view")', 'if (path === "/api/site-images") { needs(user, "Content", "edit")', '"/api/site-images/undo"', '"/api/site-images/asset"', '"/api/site-images/asset/delete"']) once(index, x, x);
once(ui, '["/images", "Site images"]', "nav entry"); once(ui, '"/images": "Shows & sites"', "nav section");
const pubSrc = readFileSync(join(pubDir, "rb-public-content.js"), "utf8");
once(pubSrc, '"/api/content/site-image") return siteImage', "image route"); once(pubSrc, '"/api/content/site-images.css") return siteImagesCss', "css route");

// ---- each site Worker
for (const d of siteDirs) {
  const files = readdirSync(d).filter((f) => /\.(js|html)$/.test(f) && f !== "brand_icons.js");
  const site = (readFileSync(join(d, files.find((f) => readFileSync(join(d, f), "utf8").includes("site-image?site="))), "utf8").match(/site-image\?site=([a-z]+)&amp;slot=icon/) || [])[1];
  assert.ok(site, d + ": links its site picture");
  for (const f of files) {
    const s = readFileSync(join(d, f), "utf8");
    for (const doc of s.split(/(?=<head[\s>])/i)) {
      if (doc.includes('\\"')) continue;
      assert.ok(doc.split(`site-image?site=${site}&amp;slot=icon`).length - 1 <= 1, `${d}/${f}: one icon per page`);
      assert.ok(doc.split(`site-images.css?site=${site}`).length - 1 <= 1, `${d}/${f}: one stylesheet per page`);
      assert.ok((doc.match(/property="og:image"/g) || []).length <= 1 || /og:image" content="\$\{/.test(doc), `${d}/${f}: one share picture per page`);
    }
    assert.ok(!s.includes("/brand/icon.svg?v=3"), `${d}/${f}: no fixed icon left on a site page`);
  }
}
console.log(`site images ok: library, save, slot and site checks, undo, delete, served picture and fallbacks, per-site CSS, page, routes, ${siteDirs.length} site Worker(s)`);
