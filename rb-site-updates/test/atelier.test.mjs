// Usage: node --no-warnings rb-site-updates/test/atelier.test.mjs <patched artist-router-v14.js> [--browser]
// The Soho Atelier: the page at /soho (/atelier redirects there) with a strict CSP, the nine pieces as shop products (the seed), requests through
// the shop's inquiry API, the Store's third tab, RB admin keeping the brand. With --browser, the page itself in
// Chromium (desktop and phone) against the real Worker and a stand-in database: collection, filters, quick view, size,
// bag, the request saved, no errors, no sideways scroll.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const worker = (await import(process.argv[2])).default;
const DB = fakeD1();
DB.raw.exec(`CREATE TABLE router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT);
INSERT INTO router_schema VALUES ('artist-router','artist-router-v14.3',datetime('now'));
CREATE TABLE shop_products (id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT NOT NULL DEFAULT 'rb', kind TEXT NOT NULL DEFAULT 'beat', title TEXT NOT NULL, subtitle TEXT, description TEXT, price TEXT, price_cents INTEGER, image_url TEXT, audio_url TEXT, bpm INTEGER, song_key TEXT, genre TEXT, sizes TEXT, colors TEXT, buy_url TEXT, featured INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, status TEXT DEFAULT 'live', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE shop_inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_title TEXT, brand TEXT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, options TEXT, quantity INTEGER, message TEXT, status TEXT DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO shop_products (brand,kind,title,price,status) VALUES ('rb','beat','A beat','$30','live');`);
const seed = readFileSync(new URL("../atelier_seed.sql", import.meta.url), "utf8");
DB.raw.exec(seed); DB.raw.exec(seed); // twice: nothing doubles
const env = { DB }, ctx = { waitUntil() {}, passThroughOnException() {} };
const go = (url, init = {}) => worker.fetch(new Request(url, { headers: { "User-Agent": "Mozilla/5.0", ...(init.headers || {}) }, ...init }), env, ctx);

// the seed
const rows = DB.raw.prepare("SELECT * FROM shop_products WHERE brand='atelier' ORDER BY sort_order").all();
assert.equal(rows.length, 9, "nine pieces, once");
assert.deepEqual(rows.map((r) => r.price), ["$1,250", "$1,850", "$1,250", "$950", "$2,100", "$1,100", "$2,500", "$1,350", "$1,250"]);
assert.ok(rows.every((r) => /Made by Manzo Leathers\.$/.test(r.description) && /^https:\/\/media\.relentlessbillionaire\.com\/atelier\/[a-z-]+-1200\.webp$/.test(r.image_url) && r.kind === "apparel"));

// the page
const nonces = new Set();
for (const path of ["/soho", "/soho/"]) {
  const r = await go("https://relentlessbillionaire.com" + path);
  assert.equal(r.status, 200, path);
  const csp = r.headers.get("Content-Security-Policy"), html = await r.text();
  const n = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(csp)[1]; nonces.add(n);
  const scriptSrc = /script-src [^;]*/.exec(csp)[0];
  assert.ok(!scriptSrc.includes("unsafe") && !csp.includes("unsafe-eval"), "scripts by nonce only");
  assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/, "inline styles allowed, so the RB Radio bar can style itself");
  assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/, "fonts from Google or the site's own /cf-fonts/ (Cloudflare Fonts)");
  assert.ok(!html.includes("__NONCE__"));
  const tags = html.match(/<(script|style)\b[^>]*>/g);
  assert.ok(tags.length >= 2 && tags.filter((t) => t.startsWith("<script")).every((t) => t.includes(`nonce="${n}"`)), "every script tag nonced");
  assert.ok(!/<[a-z][^<>]*\sstyle=["']/i.test(html) && !/\son[a-z]+=["']/i.test(html), "no inline style or handler attributes");
  html.match(/<script[^>]*>([\s\S]*?)<\/script>/g).map((x) => x.replace(/^<script[^>]*>|<\/script>$/g, "")).forEach((c) => new vm.Script(c));
  assert.ok(html.includes("Manzo Leathers") && html.includes("/api/shop?brand=atelier") && html.includes("/api/shop/inquire"));
  const links = [...html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u));
  assert.ok(links.every((u) => /^https:\/\/([a-z]+\.)?relentlessbillionaire\.com\//.test(u)), "every link stays on relentlessbillionaire.com: " + links.filter((u) => !/relentlessbillionaire\.com/.test(u)));
  assert.ok(!/treasury|ad revenue|genesis \d+\/\d+|\d+ (genesis )?left\b|\+12\.4%|sponsored/i.test(html.replace(/<(script|style)[\s\S]*?<\/(script|style)>/g, "")), "no invented numbers, scarcity or ads");
}
assert.equal(nonces.size, 2);
assert.equal((await go("https://relentlessbillionaire.com/soho", { method: "HEAD" })).status, 200);
assert.equal((await go("https://www.relentlessbillionaire.com/soho")).status, 200);
for (const old of ["/atelier", "/atelier/", "/atelier?x=1"]) {
  const r = await go("https://relentlessbillionaire.com" + old, { redirect: "manual" });
  assert.equal(r.status, 301, old); assert.equal(r.headers.get("Location"), "https://relentlessbillionaire.com/soho" + (old.includes("?") ? "?x=1" : ""));
}

// the data and a request
const shop = await (await go("https://relentlessbillionaire.com/api/shop?brand=atelier")).json();
assert.equal(shop.products.length, 9); assert.equal(shop.products[0].brand, "atelier");
const all = await (await go("https://relentlessbillionaire.com/api/shop")).json();
assert.equal(all.products.filter((p) => p.brand === "rb").length, 1, "the beats are still there");
let r = await go("https://relentlessbillionaire.com/api/shop/inquire", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: rows[0].id, product_title: rows[0].title, brand: "atelier", name: "Test Buyer", email: "buyer@example.com", options: "Black Wool Varsity M", quantity: 1, message: "Black Wool Varsity ($1,250, size M)" }) });
assert.equal(r.status, 200);
assert.equal(DB.raw.prepare("SELECT brand FROM shop_inquiries ORDER BY id DESC").get().brand, "atelier");

// the Store's tab and RB admin
const store = await (await go("https://relentlessbillionaire.com/store")).text();
assert.match(store, /<a class="btab" href="\/soho"[^>]*>Soho Atelier<small>Varsity &amp; Leather · Manzo Leathers<\/small><\/a>/);
assert.ok(store.includes(".btab[data-brand]"), "only the two brand tabs switch in place");
const src = readFileSync(process.argv[2], "utf8");
for (const want of ['<option value="atelier">Soho Atelier \\u2014 Manzo Leathers</option>', "q.brand==='atelier'?'Soho Atelier'", 'b.brand === "slank" || b.brand === "atelier" ? b.brand : "rb"'])
  assert.equal(src.split(want).length - 1, 1, want);
console.log("Soho Atelier ok: nine pieces seeded once, /soho (and /atelier redirecting) with scripts by nonce only, with every link on relentlessbillionaire.com, no invented numbers, requests saved as Atelier, the Store tab, RB admin keeps the brand");

if (process.argv.includes("--browser")) {
  const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
  const b = await chromium.launch();
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const p = await b.newPage({ viewport: vp }); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await p.route(/^https:\/\/relentlessbillionaire\.com\/(soho|api\/shop)/, async (route) => {
      const q = route.request();
      const res = await go(q.url(), { method: q.method(), headers: q.headers(), body: q.method() === "POST" ? q.postData() : undefined });
      const h = {}; res.headers.forEach((v, k) => (h[k] = v));
      await route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) });
    });
    await p.goto("https://relentlessbillionaire.com/soho", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
    assert.equal(await p.locator(".card").count(), 9);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll at " + vp.width);
    for (let y = 0; y < 6000; y += 500) { await p.evaluate((v) => scrollTo(0, v), y); await p.waitForTimeout(120); }
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(900);
    await p.screenshot({ path: `atelier-${vp.width}.png`, fullPage: true });
    await p.getByRole("button", { name: "Leather", exact: true }).click();
    assert.equal(await p.locator(".card").count(), 1);
    await p.getByRole("button", { name: "All", exact: true }).click();
    await p.locator(".card").first().getByRole("button", { name: "Add to bag" }).click();
    await p.getByRole("button", { name: "M", exact: true }).click();
    if (vp.width > 500) await p.screenshot({ path: "atelier-view.png" });
    await p.locator("#v-add").click();
    assert.match(await p.locator("#b-list").textContent(), /Black Wool Varsity.*\$1,250.*Size M/);
    await p.fill("#f-name", "Browser Buyer"); await p.fill("#f-email", "browser@example.com");
    await p.locator("#b-send").click(); await p.waitForTimeout(600);
    assert.match(await p.locator("#b-msg").textContent(), /^Sent\./);
    const q = DB.raw.prepare("SELECT * FROM shop_inquiries ORDER BY id DESC").get();
    assert.equal(q.brand, "atelier"); assert.equal(q.email, "browser@example.com"); assert.match(q.message, /Black Wool Varsity \(\$1,250, size M\)/);
    assert.deepEqual(errs, [], "no errors at " + vp.width);
    await p.close();
  }
  await b.close();
  console.log("Soho Atelier in Chromium ok: 9 pieces, filters, quick view, size, bag, request saved, no errors, no sideways scroll (1440 and 390 wide)");
}
