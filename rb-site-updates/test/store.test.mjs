// Usage: node --no-warnings rb-site-updates/test/store.test.mjs <patched artist-router-v14.js> [--browser]
// The Shop at /store: the three apparel houses (Soho Atelier, Slank Customs, Sports 4 All), no beats; the beat store's
// exclusive-rights link still reaches the old request form; the homepage card describes the houses.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const worker = (await import(process.argv[2])).default;
const DB = fakeD1();
DB.raw.exec(`CREATE TABLE router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT);
INSERT INTO router_schema VALUES ('artist-router','artist-router-v14.3',datetime('now'));
CREATE TABLE shop_products (id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT NOT NULL DEFAULT 'rb', kind TEXT NOT NULL DEFAULT 'beat', title TEXT NOT NULL, subtitle TEXT, description TEXT, price TEXT, price_cents INTEGER, image_url TEXT, audio_url TEXT, bpm INTEGER, song_key TEXT, genre TEXT, sizes TEXT, colors TEXT, buy_url TEXT, featured INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, status TEXT DEFAULT 'live', created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO shop_products (brand,kind,title,price,status) VALUES ('rb','beat','Midnight Gold','$30','live');`);
DB.raw.exec(readFileSync(new URL("../atelier_seed.sql", import.meta.url), "utf8"));
const env = { DB }, ctx = { waitUntil() {}, passThroughOnException() {} };
const go = (url, init = {}) => worker.fetch(new Request(url, { headers: { "User-Agent": "Mozilla/5.0", ...(init.headers || {}) }, ...init }), env, ctx);

const r = await go("https://relentlessbillionaire.com/store");
assert.equal(r.status, 200);
const csp = r.headers.get("Content-Security-Policy"), html = await r.text(), n = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(csp)[1];
assert.ok(!/script-src [^;]*unsafe/.test(csp));
assert.ok(html.match(/<script\b[^>]*>/g).every((t) => t.includes(`nonce="${n}"`)));
assert.ok(!/<[a-z][^<>]*\sstyle=["']/i.test(html) && !/\son[a-z]+=["']/i.test(html), "no inline style or handler attributes");
html.match(/<script[^>]*>([\s\S]*?)<\/script>/g).map((x) => x.replace(/^<script[^>]*>|<\/script>$/g, "")).forEach((c) => new vm.Script(c));
for (const want of ['href="https://relentlessbillionaire.com/soho"', 'href="https://slank.relentlessbillionaire.com/"', 'href="https://sports4all.relentlessbillionaire.com/"', "Manzo Leathers", "1530 Sonoma Blvd"]) assert.ok(html.includes(want), want);
const body = html.replace(/<nav class="tabs"[\s\S]*?<\/nav>/, "");
assert.ok(!/beat|GOT BEATS|licens/i.test(body), "no beats on the shop page (the site tabs keep their Beats link)");
const links = [...html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u));
assert.ok(links.every((u) => /^https:\/\/([a-z0-9]+\.)?relentlessbillionaire\.com\//.test(u)), "every link on relentlessbillionaire.com");
assert.equal((await go("https://relentlessbillionaire.com/store", { method: "HEAD" })).status, 200);
// the beat store's exclusive request still opens the old form
const old = await (await go("https://relentlessbillionaire.com/store?license=exclusive&beat=1")).text();
assert.ok(old.includes("/api/shop/inquire") && old.includes("license") && !old.includes("Three houses"));
// /shop still lands here
const sh = await go("https://relentlessbillionaire.com/shop", { redirect: "manual" });
assert.equal(sh.status, 301); assert.match(sh.headers.get("Location"), /\/store$/);
// the homepage card
const src = readFileSync(process.argv[2], "utf8");
assert.ok(src.includes('kicker: "Apparel", title: "The Shop", blurb: "The Soho Luxury Atelier, Slank Customs and Sports 4 All under one name."'));
console.log("The Shop ok: three houses with every link on relentlessbillionaire.com, no beats, strict scripts, the exclusive-rights request kept, /shop redirect, homepage card");

if (process.argv.includes("--browser")) {
  const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
  const b = await chromium.launch();
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const p = await b.newPage({ viewport: vp }); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await p.route(/^https:\/\/relentlessbillionaire\.com\/(store|api\/shop)/, async (route) => {
      const q = route.request(), res = await go(q.url(), { method: q.method(), headers: q.headers() });
      const h = {}; res.headers.forEach((v, k) => (h[k] = v));
      await route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) });
    });
    await p.goto("https://relentlessbillionaire.com/store", { waitUntil: "networkidle" });
    for (let y = 0; y < 5000; y += 400) { await p.evaluate((v) => scrollTo(0, v), y); await p.waitForTimeout(100); }
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(800);
    assert.equal(await p.locator("#soho-strip a").count(), 4, "four Atelier pieces");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll at " + vp.width);
    await p.screenshot({ path: `store-${vp.width}.png`, fullPage: true });
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log("The Shop in Chromium ok: three houses, four Atelier pieces, no errors, no sideways scroll (1440 and 390 wide)");
}
