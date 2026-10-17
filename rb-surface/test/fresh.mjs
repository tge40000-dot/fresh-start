// Usage: node --no-warnings rb-surface/test/fresh.mjs <patched artist-router-v14.js>
import { fakeD1 } from "./fake-d1.mjs";
import assert from "node:assert/strict";
const worker = (await import(process.argv[2])).default;
const DB = fakeD1();
DB.raw.exec("CREATE TABLE router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT)");
DB.raw.exec("INSERT INTO router_schema VALUES ('artist-router','artist-router-v14.2',datetime('now'))");
DB.raw.exec("CREATE TABLE ads (id INTEGER PRIMARY KEY AUTOINCREMENT, advertiser TEXT NOT NULL, headline TEXT, body TEXT, image_url TEXT, click_url TEXT, placement TEXT DEFAULT 'sidebar', weight INTEGER DEFAULT 1, status TEXT DEFAULT 'live', starts_at TEXT, ends_at TEXT, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), format TEXT DEFAULT 'image', video_url TEXT, poster_url TEXT, cta TEXT, freq_cap INTEGER DEFAULT 3, max_impressions INTEGER)");
DB.raw.exec("INSERT INTO ads (advertiser,click_url,placement) VALUES ('X','https://example.com','sidebar')");
const r = await worker.fetch(new Request("https://relentlessbillionaire.com/api/ads?surface=radio", { headers: { "User-Agent": "Mozilla/5.0" } }), { DB }, { waitUntil() {} });
const body = await r.json();
assert.equal(r.status, 200); assert.equal(body.ads.length, 1); assert.equal(body.ads[0].surface, "all");
assert.equal(DB.raw.prepare("SELECT version FROM router_schema").get().version, "artist-router-v14.3");
console.log("fresh-db ok: schema v14.3 added the surface column");
