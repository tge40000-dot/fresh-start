// Usage: node --no-warnings rb-site-updates/test/post-link.test.mjs <patched artist-router-v14.js>
// The real artist-router bundle against an in-memory DB: /go/post/<id> counts the click and redirects with UTM tags.
import assert from "node:assert/strict";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const worker = (await import(process.argv[2])).default;
const DB = fakeD1();
DB.raw.exec(`CREATE TABLE router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT);
INSERT INTO router_schema VALUES ('artist-router','artist-router-v14.3',datetime('now'));
CREATE TABLE show_plans (id INTEGER PRIMARY KEY, title TEXT);
CREATE TABLE show_plan_items (id INTEGER PRIMARY KEY, plan_id INTEGER, kind TEXT, title TEXT, clicks INTEGER NOT NULL DEFAULT 0);
INSERT INTO show_plans VALUES (7, 'RB Presents');
INSERT INTO show_plan_items VALUES (42, 7, 'content', 'Announcement', 0), (43, 7, 'task', 'Book the DJ', 0);`);
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const go = async (path, headers = {}) => { const r = await worker.fetch(new Request("https://relentlessbillionaire.com" + path, { headers: { "User-Agent": "Mozilla/5.0 (iPhone)", ...headers }, redirect: "manual" }), { DB }, ctx); await Promise.all(waits.splice(0)); return r; };
const clicks = () => DB.raw.prepare("SELECT clicks FROM show_plan_items WHERE id = 42").get().clicks;

let r = await go("/go/post/42?c=instagram");
assert.equal(r.status, 302);
const to = new URL(r.headers.get("Location"));
assert.equal(to.origin + to.pathname, "https://relentlessbillionaire.com/events");
assert.deepEqual(Object.fromEntries(to.searchParams), { utm_source: "instagram", utm_medium: "social", utm_campaign: "rb-show-7", utm_content: "post-42" });
assert.equal(r.headers.get("X-Robots-Tag"), "noindex");
assert.equal(clicks(), 1, "a visit counts");
await go("/go/post/42?c=instagram", { "User-Agent": "facebookexternalhit/1.1" });
await go("/go/post/42", { "Sec-Purpose": "prefetch" });
assert.equal(clicks(), 1, "link previews and prefetches don't count");
r = await go("/go/post/42?c=Tik%20Tok%3Cscript%3E");
assert.equal(new URL(r.headers.get("Location")).searchParams.get("utm_source"), "tiktokscript", "channel cleaned to letters");
assert.equal(clicks(), 2);
r = await go("/go/post/43");
assert.equal(r.headers.get("Location"), "https://relentlessbillionaire.com/events", "not a post: plain /events, nothing counted");
assert.equal(DB.raw.prepare("SELECT clicks FROM show_plan_items WHERE id = 43").get().clicks, 0);
r = await go("/go/post/999");
assert.equal(r.status, 302); assert.equal(r.headers.get("Location"), "https://relentlessbillionaire.com/events");
DB.raw.exec("ALTER TABLE show_plan_items DROP COLUMN clicks");
r = await go("/go/post/42");
assert.equal(r.status, 302, "a missing clicks column never breaks the redirect");
console.log("post links ok: redirect with UTM tags, clicks counted, bots and prefetches skipped, unknown ids, missing column");

// ---------------------------------------------------------------- the ad slot files
for (const [f, type] of [["slot.js", "text/javascript"], ["slot.css", "text/css"]]) {
  const res = await worker.fetch(new Request("https://relentlessbillionaire.com/api/ads/" + f, { headers: { "User-Agent": "Mozilla/5.0" } }), { DB }, ctx);
  assert.equal(res.status, 200); assert.ok(res.headers.get("Content-Type").startsWith(type)); assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  const body = await res.text();
  assert.equal(body, (await import("node:fs")).readFileSync(new URL("../src/ad-" + f, import.meta.url), "utf8"), f + " served exactly as written");
}
console.log("ad slot files ok: /api/ads/slot.js and slot.css");
