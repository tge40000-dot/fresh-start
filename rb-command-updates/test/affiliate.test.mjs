// Usage: node --no-warnings rb-command-updates/test/affiliate.test.mjs <patched rb-command dir>
// Runs affiliate.js against a fake page, a fake R2 bucket and an in-memory copy of the ads table, and checks that the
// patched RB Command page renders and its script parses.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
const aff = await import(join(dir, "affiliate.js"));
const { renderPage } = await import(join(dir, "ui.js"));

// --- link checks
assert.throws(() => aff.cleanLink("ftp://x.com"), /https/);
assert.throws(() => aff.cleanLink("http://localhost/a"), /public/);
assert.throws(() => aff.cleanLink("http://10.0.0.1/a"), /public/);
assert.throws(() => aff.cleanLink("not a link"), /full link/);
assert.equal(aff.cleanLink(" https://amzn.to/3abc ").toString(), "https://amzn.to/3abc");

// --- reading a product page
const PAGE = `<!doctype html><html><head><title>Fallback title</title>
<meta property="og:site_name" content="Gear &amp; Co">
<meta property="og:title" content="Studio Headphones X1 &#8211; Closed Back">
<meta name="description" content="Closed-back monitoring headphones.">
<meta property="og:image" content="/img/x1.jpg"></head><body>hi</body></html>`;
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const fakeFetch = async (url) => {
  if (url.startsWith("https://amzn.to/")) return Object.defineProperty(new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } }), "url", { value: "https://www.gearco.com/p/x1?tag=rb-20" });
  if (url === "https://www.gearco.com/img/x1.jpg") return new Response(PNG, { headers: { "Content-Type": "image/png", "Content-Length": String(PNG.length) } });
  if (url === "https://down.example.com/") throw new TypeError("network");
  if (url.startsWith("https://www.gearco.com/notimage")) return new Response("<html>", { headers: { "Content-Type": "text/html" } });
  return new Response("nope", { status: 404, headers: { "Content-Type": "text/html" } });
};
let p = await aff.preview({}, { url: "https://amzn.to/3abc" }, fakeFetch);
assert.equal(p.url, "https://amzn.to/3abc", "keeps the affiliate link as pasted");
assert.equal(p.domain, "gearco.com");
assert.equal(p.advertiser, "Gear & Co");
assert.equal(p.headline, "Studio Headphones X1 – Closed Back");
assert.equal(p.body, "Closed-back monitoring headphones.");
assert.equal(p.image, "https://www.gearco.com/img/x1.jpg", "relative picture resolved against the final page");
p = await aff.preview({}, { url: "https://down.example.com/" }, fakeFetch);
assert.ok(p.ok && !p.headline && /Couldn't open/.test(p.note), "unreachable page still returns, with a note");
p = await aff.preview({}, { url: "https://www.gearco.com/missing" }, fakeFetch);
assert.ok(/error \(404\)/.test(p.note));

// --- the card
const svg = aff.cardSvg({ advertiser: "Gear & Co", headline: "Studio <Headphones> X1 – Closed Back", body: "Closed-back monitoring headphones.", cta: "Shop now", domain: "gearco.com" }, "sapphire");
assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"));
assert.ok(svg.includes("GEAR &amp; CO") && svg.includes("&lt;Headphones&gt;"), "text is escaped");
assert.ok(!/<script|on\w+=/i.test(svg), "no script in the card");
assert.deepEqual(aff.wrap("one two three four five six", 9, 2), ["one two", "three…"]);
assert.ok(aff.wrap("x".repeat(40), 10, 5).every((l) => l.length <= 10));

// --- publishing
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE ads (id INTEGER PRIMARY KEY AUTOINCREMENT, advertiser TEXT NOT NULL, headline TEXT, body TEXT, image_url TEXT, click_url TEXT, placement TEXT DEFAULT 'sidebar', weight INTEGER DEFAULT 1, status TEXT DEFAULT 'live', starts_at TEXT, ends_at TEXT, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), format TEXT DEFAULT 'image', video_url TEXT, poster_url TEXT, cta TEXT, freq_cap INTEGER DEFAULT 3, max_impressions INTEGER, viewable INTEGER DEFAULT 0, video_starts INTEGER DEFAULT 0, video_completes INTEGER DEFAULT 0, report_token TEXT, report_url TEXT, surface TEXT NOT NULL DEFAULT 'all');
CREATE TABLE command_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, target TEXT, detail TEXT, at TEXT DEFAULT (datetime('now')));
CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
INSERT INTO site_settings VALUES ('site_theme', '{"theme":"teal","sites":{}}', datetime('now'));`);
class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.sql, a.map((v) => (v === undefined ? null : v))); }
  async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
}
const bucket = new Map();
const env = { DB: { prepare: (s) => new Stmt(s) }, MEDIA: { put: async (k, v, o) => { bucket.set(k, { v, o }); } } };
const who = { email: "owner@example.com" };
const base = { url: "https://amzn.to/3abc", advertiser: "Gear & Co", headline: "Studio Headphones X1", body: "Closed-back monitoring headphones.", cta: "Shop now" };

let r = await aff.create(env, who, { ...base, creative: "card", placement: "sidebar", surface: "home" }, fakeFetch);
assert.equal(r.ad.click_url, "https://amzn.to/3abc");
assert.equal(r.ad.status, "live"); assert.equal(r.ad.surface, "home"); assert.equal(r.ad.placement, "sidebar"); assert.equal(r.ad.format, "image"); assert.equal(r.ad.freq_cap, 3);
assert.match(r.ad.image_url, /^https:\/\/media\.relentlessbillionaire\.com\/admin\/ads\/\d{4}-\d{2}\/[0-9a-f-]{36}\.svg$/);
const card = [...bucket.values()].at(-1);
assert.equal(card.o.httpMetadata.contentType, "image/svg+xml");
assert.ok(new TextDecoder().decode(card.v).includes("Headphones X1"));
const log = db.prepare("SELECT * FROM command_log WHERE id = ?").get(r.log_id);
assert.equal(log.action, "row.create"); assert.equal(log.target, `ads:${r.id}`);
assert.equal(JSON.parse(log.detail).table, "ads", "logged so Undo can remove it");

r = await aff.create(env, who, { ...base, creative: "page", page_image: "https://www.gearco.com/img/x1.jpg", status: "paused", placement: "spotlight" }, fakeFetch);
assert.equal(r.ad.status, "paused"); assert.equal(r.ad.placement, "spotlight"); assert.equal(r.ad.surface, "all");
assert.match(r.ad.image_url, /\.png$/, "page picture copied into RB media");

r = await aff.create(env, who, { ...base, creative: "upload", image_url: "https://media.relentlessbillionaire.com/admin/ads/2026-10/abc.jpg", placement: "nonsense", surface: "moon" }, fakeFetch);
assert.equal(r.ad.placement, "sidebar"); assert.equal(r.ad.surface, "all");

await assert.rejects(aff.create(env, who, { ...base, creative: "upload", image_url: "https://evil.example.com/x.jpg" }, fakeFetch), /Upload the picture first/);
await assert.rejects(aff.create(env, who, { ...base, creative: "page", page_image: "https://www.gearco.com/notimage" }, fakeFetch), /isn't a JPG/);
await assert.rejects(aff.create(env, who, { ...base, headline: "", creative: "card" }, fakeFetch), /headline/);
await assert.rejects(aff.create(env, who, { ...base, url: "javascript:alert(1)", creative: "card" }, fakeFetch), /https/);
await assert.rejects(aff.create(env, who, { ...base }, fakeFetch), /Choose a picture/);
const c = await aff.card(env, base);
assert.ok(c.svg.includes("<svg") && c.svg.includes("Headphones X1"));

// --- the page renders and its script parses
const tables = { ads: { label: "Ads", group: "Money", canEdit: true, fields: {} } };
const html = renderPage("N0NCE", { me: { email: "o@x", name: "O", role: "owner", caps: { groups: { Money: "edit", Content: "edit" }, label: "Owner" } }, links: {}, media: "", tables, groups: ["Money"], uploads: true });
const script = html.match(/<script nonce="N0NCE">([\s\S]*?)<\/script>/);
assert.ok(script, "page has its script");
const f = join(mkdtempSync(join(tmpdir(), "rbc-")), "client.js");
writeFileSync(f, script[1]);
execFileSync(process.execPath, ["--check", f]);
assert.ok(html.includes('NAV_TOP.push(["affiliate", "Affiliate ads"])') && html.includes("function viewAffiliate()"));
assert.ok(html.includes(".afopt{"), "styles are in the stylesheet");
console.log("affiliate ok: link checks, page reading, card, publishing (card/page/upload), refusals, page script parses");
