// Usage: node --no-warnings rb-surface/test/test.mjs <artist-router-v14.js> [--expect-surface]
import { fakeD1 } from "./fake-d1.mjs";
import assert from "node:assert/strict";
const [bundle, flag] = process.argv.slice(2);
const patched = flag === "--expect-surface";
const worker = (await import(bundle)).default;

const DB = fakeD1();
// The live ads schema (pragma_table_info on waitlist-db, 14 Oct 2026) and its six rows.
DB.raw.exec(`CREATE TABLE ads (id INTEGER PRIMARY KEY AUTOINCREMENT, advertiser TEXT NOT NULL, headline TEXT, body TEXT, image_url TEXT, click_url TEXT,
  placement TEXT DEFAULT 'sidebar', weight INTEGER DEFAULT 1, status TEXT DEFAULT 'live', starts_at TEXT, ends_at TEXT, impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), format TEXT DEFAULT 'image', video_url TEXT, poster_url TEXT, cta TEXT,
  freq_cap INTEGER DEFAULT 3, max_impressions INTEGER, viewable INTEGER DEFAULT 0, video_starts INTEGER DEFAULT 0, video_completes INTEGER DEFAULT 0,
  report_token TEXT, report_url TEXT)`);
DB.raw.exec("CREATE TABLE ad_stats (ad_id INTEGER NOT NULL, day TEXT NOT NULL, impressions INTEGER DEFAULT 0, viewable INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, video_starts INTEGER DEFAULT 0, video_completes INTEGER DEFAULT 0, PRIMARY KEY (ad_id, day))");
const img2 = "https://media.relentlessbillionaire.com/admin/ads/2026-10/31e4ce21-17bb-483c-a5fa-cd5f85b32c49.webp";
const img4 = "https://media.relentlessbillionaire.com/admin/ads/2026-10/8cfe26eb-4fff-453c-afb2-f9be388e2a88.jpg";
const vid4 = "https://media.relentlessbillionaire.com/admin/tv/2026-10/46b5717a-7213-4771-9037-dd8d63e1f02f.mp4";
const ins = DB.raw.prepare("INSERT INTO ads (id,advertiser,headline,body,image_url,click_url,placement,weight,status,format,video_url,poster_url,cta,freq_cap,starts_at,impressions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
ins.run(1, "KBT", "Ruthless out now!", "", null, null, "spotlight", null, "live", "image", null, null, "", 0, null, 385);
ins.run(2, '"Pussy Ass"', "Out Now!", "", img2, "https://relentlessbillionaire.com/tv", "both", null, "live", "image", null, img2, "", 3, "2026-10-02T18:20:00", 252);
ins.run(3, "Relentless Billionaire", "Free Mastering", "", null, "https://relentlessbillionaire.com/home", "sidebar", 1, "paused", "video", null, null, "", 3, null, 0);
ins.run(4, "Relentless Billionaire", "Free Mastering", "TGE x DADDYSHARK", img4, "https://relentlessbillionaire.com/home", "sidebar", 1, "live", "video", vid4, img4, "Listen now", 3, "2026-10-03T01:38:00", 91);
ins.run(5, "Relentless Billionaire", "Match Any Brand... Are You With That?", "", null, "https://relentlessbillionaire.com/home", "sidebar", 1, "paused", "video", null, null, "", 3, null, 0);
ins.run(6, "RELENTLESS BILLIONAIRE LLC", "I am so sorry....", "", null, "https://partners.relentlessbillionaire.com/", "spotlight", 44, "live", "video", null, null, "", 3, null, 19);
if (patched) DB.raw.exec("ALTER TABLE ads ADD COLUMN surface TEXT NOT NULL DEFAULT 'all'"); // applied to D1 before deploy

const env = { DB, ADMIN_API_KEY: "test-key" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const UA = { "User-Agent": "Mozilla/5.0 test" };
const call = async (path, init = {}) => {
  const res = await worker.fetch(new Request("https://relentlessbillionaire.com" + path, { ...init, headers: { ...UA, ...(init.headers || {}) } }), env, ctx);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
};
const ids = (r) => r.body.ads.map((a) => a.id).sort();

// Unchanged behaviour: no surface.
let r = await call("/api/ads?slot=rail");
assert.equal(r.status, 200); assert.deepEqual(ids(r), [2, 4]);
assert.ok(r.body.ads.every((a) => a.click === `/go/ad/${a.id}?s=rail`), "rail click slot unchanged");
const keys = Object.keys(r.body.ads[0]);
for (const k of ["id","advertiser","headline","body","image_url","click","format","video_url","poster_url","cta","freq_cap"]) assert.ok(keys.includes(k), "keeps " + k);
r = await call("/api/ads?slot=spotlight");
assert.equal(r.status, 200); assert.equal(r.body.ads.length, 1); assert.ok([1, 6].includes(r.body.ads[0].id));
r = await call("/api/ads?slot=rail&skip=2");
assert.deepEqual(ids(r), [4], "skip still works");

if (!patched) { console.log("baseline ok: original bundle serves", JSON.stringify(Object.keys(r.body))); process.exit(0); }

// New behaviour.
r = await call("/api/ads?slot=rail");
assert.equal(r.body.surface, "all"); assert.ok(r.body.ads.every((a) => a.surface === "all"));
r = await call("/api/ads?slot=rail&surface=all");
assert.deepEqual(ids(r), [2, 4]); assert.ok(r.body.ads.every((a) => a.click.endsWith("?s=rail")));
r = await call("/api/ads?slot=rail&surface=radio");
assert.deepEqual(ids(r), [2, 4], "all-surface ads show on radio");
assert.ok(r.body.ads.every((a) => a.click === `/go/ad/${a.id}?s=radio-rail`));
r = await call("/api/ads?surface=TV");
assert.equal(r.status, 200); assert.equal(r.body.surface, "tv");
r = await call("/api/ads?surface=nope");
assert.equal(r.status, 400); assert.equal(r.body.error, "surface must be home, radio, tv, or all");

// Setting a surface needs the admin key.
r = await call("/api/ads", { method: "POST", body: JSON.stringify({ id: 4, surface: "radio" }) });
assert.equal(r.status, 401);
const admin = { "X-API-Key": "test-key", "Content-Type": "application/json" };
r = await call("/api/ads", { method: "POST", headers: admin, body: JSON.stringify({ id: 4, surface: "radio" }) });
assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, id: 4, surface: "radio" });
r = await call("/api/ads", { method: "POST", headers: admin, body: JSON.stringify({ id: 4 }) });
assert.equal(r.status, 400, "surface required");
r = await call("/api/ads", { method: "POST", headers: admin, body: JSON.stringify({ id: 4, surface: "moon" }) });
assert.equal(r.status, 400);
r = await call("/api/ads", { method: "POST", headers: admin, body: JSON.stringify({ id: 999, surface: "tv" }) });
assert.equal(r.status, 404);

// Targeting takes effect.
assert.deepEqual(ids(await call("/api/ads?slot=rail&surface=radio")), [2, 4]);
assert.deepEqual(ids(await call("/api/ads?slot=rail&surface=tv")), [2], "radio-only ad stays off tv");
assert.deepEqual(ids(await call("/api/ads?slot=rail&surface=home")), [2], "radio-only ad stays off home surface");
assert.deepEqual(ids(await call("/api/ads?slot=rail")), [2, 4], "no surface still returns every ad");
r = await call("/api/ads?slot=spotlight&surface=tv&skip=1");
assert.deepEqual(ids(r), [6]);
assert.ok(r.body.ads.every((a) => a.click.endsWith("?s=tv-spotlight")));

// The admin save form does not reset a surface it doesn't send.
r = await call("/api/ads/save", { method: "POST", headers: admin, body: JSON.stringify({ id: 4, advertiser: "Relentless Billionaire", headline: "Free Mastering", body: "TGE x DADDYSHARK", image_url: img4, click_url: "https://relentlessbillionaire.com/home", placement: "sidebar", weight: 1, status: "live", starts_at: "2026-10-03T01:38:00" }) });
assert.equal(r.status, 200);
assert.equal(DB.raw.prepare("SELECT surface FROM ads WHERE id=4").get().surface, "radio");

// Click redirect keeps the hyphenated slot in utm_content.
r = await call("/go/ad/4?s=radio-rail");
assert.equal(r.status, 302);
const loc = new URL(r.headers.get("Location"));
assert.equal(loc.searchParams.get("utm_content"), "radio-rail");
r = await call("/go/ad/4?s=rail");
assert.equal(new URL(r.headers.get("Location")).searchParams.get("utm_content"), "rail");

// Other ad routes still answer.
r = await call("/api/ads/event", { method: "POST", body: JSON.stringify({ events: [{ id: 2, kind: "imp" }] }) });
assert.equal(r.status, 200);
r = await call("/api/signal");
assert.equal(r.status, 200); assert.equal(r.body.metrics.liveAds, 4, "liveAds counts every live ad");

console.log("patched ok: all surface checks passed");
