// Usage: node --no-warnings rb-site-updates/test/advertise.test.mjs <patched artist-router-v14.js> [pulled rb-command dir]
// The real artist-router bundle against an in-memory DB: /advertise with and without saved numbers, ad slot totals,
// the RB list with interests (validation, new and returning people), the homepage block and link, and the store's
// "What's next" links. With the rb-command dir, also checks mediakit.js saves only totals from a 30-day report.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const src = readFileSync(process.argv[2], "utf8");
const worker = (await import(process.argv[2])).default;
const DB = fakeD1();
DB.raw.exec(`CREATE TABLE router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT);
INSERT INTO router_schema VALUES ('artist-router','artist-router-v14.3',datetime('now'));
CREATE TABLE signups (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, ip_hash TEXT, source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE ads (id INTEGER PRIMARY KEY, placement TEXT);
CREATE TABLE ad_stats (ad_id INTEGER, day TEXT, impressions INTEGER DEFAULT 0, viewable INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, video_starts INTEGER DEFAULT 0, video_completes INTEGER DEFAULT 0, PRIMARY KEY (ad_id, day));`);
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const go = async (path, init = {}) => { const r = await worker.fetch(new Request("https://relentlessbillionaire.com" + path, { headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/json" }, redirect: "manual", ...init }), { DB }, ctx); await Promise.all(waits.splice(0)); return r; };
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// /advertise before any numbers are saved: honest notes, no prices
let r = await go("/advertise");
assert.equal(r.status, 200);
let t = text(await r.text());
assert.match(t, /appear here after RB Command's next daily update/);
assert.match(t, /No ads have run in the last 30 days/);
assert.match(t, /Rates are set per campaign/);
assert.doesNotMatch(t, /\$\s?\d/, "no prices on the media kit");

// with a saved snapshot and ad slot numbers
const today = new Date().toISOString().slice(0, 10), old = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10);
DB.raw.exec(`CREATE TABLE site_stats (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO ads VALUES (1,'spotlight'),(2,'sidebar');
INSERT INTO ad_stats (ad_id,day,impressions,viewable,clicks) VALUES (1,'${today}',1200,900,30),(2,'${today}',500,250,5),(1,'${old}',99999,0,999);`);
DB.raw.prepare("INSERT INTO site_stats VALUES ('media_kit_30d', ?, ?)").run(JSON.stringify({ from: "2026-09-21T00:00:00Z", to: "2026-10-21T00:00:00Z", visits: 12345, views: 45678, sites: [{ host: "relentlessbillionaire.com", visits: 10000, views: 40000 }], devices: [{ name: "mobile", pct: 71 }], countries: [{ name: "US", pct: 88 }] }), "2026-10-21T13:00:00Z");
t = text(await (await go("/advertise")).text());
for (const want of ["12,345", "45,678", "3.7", "relentlessbillionaire.com", "mobile 71%", "US 88%", "Homepage spotlight", "1,200", "75.0%", "2.50%", "Discovery rail and ad slots", "Oct 21, 2026"]) assert.ok(t.includes(want), "media kit shows " + want);
assert.ok(!t.includes("99,999"), "ad numbers older than 30 days are left out");

// the RB list
const join_ = (b) => go("/api/list", { method: "POST", body: JSON.stringify(b) }).then((x) => x.json());
assert.equal((await join_({ name: "", email: "a@b.co", interests: ["beats"] })).ok, false);
assert.equal((await join_({ name: "Ana", email: "nope", interests: ["beats"] })).ok, false);
assert.equal((await join_({ name: "Ana", email: "a@b.co", interests: ["casino"] })).ok, false, "unknown interests rejected");
let d = await join_({ name: "Ana", email: "A@B.co", interests: ["beats", "comedy", "beats", "casino"] });
assert.deepEqual([d.ok, d.alreadyRegistered, d.interests], [true, false, ["beats", "comedy"]]);
DB.raw.exec("INSERT INTO signups (email,name,source) VALUES ('fan@x.co','Fan','someartist')");
d = await join_({ name: "Fan", email: "fan@x.co", interests: ["jobs"] });
assert.equal(d.alreadyRegistered, true);
assert.deepEqual(DB.raw.prepare("SELECT email, source FROM signups ORDER BY id").all().map((x) => [x.email, x.source]), [["a@b.co", "rb-list"], ["fan@x.co", "someartist"]], "a returning person keeps their source");
assert.deepEqual(DB.raw.prepare("SELECT email, interest FROM signup_interests ORDER BY email, interest").all().map((x) => x.email + ":" + x.interest), ["a@b.co:beats", "a@b.co:comedy", "fan@x.co:jobs"]);

// homepage block and link, export column, store next steps (source checks: the hub needs live data to render)
assert.ok(src.includes('href="/advertise">See the numbers'));
assert.ok(src.includes("${rbListSection()}"));
assert.ok(src.includes('href="/advertise">Advertise</a>'), "footer Advertise opens the media kit");
assert.equal(src.split('class="rbl-go"').length - 1, 1, "the list button has its own style");
assert.ok(src.includes('"id,name,email,source,created_at,interests"'));
for (const want of ["['/record/', 'Record on it']", "['/studio/', 'Master your song']", "['/release', 'Release + submit to radio']"]) assert.ok(src.includes(want), "store next step " + want);

// rb-command: only totals are saved, and only from a 30-day all-sites report
if (process.argv[3]) {
  const mk = await import(join(process.argv[3], "mediakit.js"));
  const rep = { ok: true, connected: true, range: "30d", host: "", bots: false, from: "f", to: "t", totals: { views: 200, visits: 80 }, hosts: [{ host: "a", visits: 1, views: 2, vitals: {} }], devices: [{ name: "mobile", views: 150 }], countries: [{ code: "US", views: 100 }], pages: [{ path: "/secret" }], referrers: [{ host: "x" }] };
  const s = mk.snapshot(rep);
  assert.deepEqual(s, { from: "f", to: "t", visits: 80, views: 200, sites: [{ host: "a", visits: 1, views: 2 }], devices: [{ name: "mobile", pct: 75 }], countries: [{ name: "US", pct: 50 }] });
  for (const bad of [{ ...rep, range: "7d" }, { ...rep, host: "a" }, { ...rep, bots: true }, { ...rep, connected: false }, { ...rep, error: "x" }]) assert.equal(mk.snapshot(bad), null);
  const KDB = fakeD1();
  assert.equal(await mk.save({ DB: KDB }, rep), true);
  assert.deepEqual(JSON.parse(KDB.raw.prepare("SELECT json FROM site_stats WHERE key='media_kit_30d'").get().json), s);
  assert.equal(await mk.save({ DB: KDB }, { ...rep, range: "1d" }), false, "other ranges don't overwrite it");
}
console.log("advertise ok: media kit with and without numbers, 30-day ad totals, no prices, RB list with interests, homepage, export, next steps" + (process.argv[3] ? ", media kit snapshot" : ""));
