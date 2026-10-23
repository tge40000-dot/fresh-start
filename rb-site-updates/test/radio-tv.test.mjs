// Usage: node --no-warnings rb-site-updates/test/radio-tv.test.mjs <patched rb-radio dir> <patched rb-tv dir>
// Each page carries exactly one ad slot for its own surface, plus the shared script and stylesheet.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [radio, tv] = process.argv.slice(2);
const count = (s, x) => s.split(x).length - 1;
const src = readFileSync(join(radio, "index.js"), "utf8");
const html = JSON.parse(src.match(/const PAGE_HTML = ("(?:[^"\\]|\\.)*");/)[1]);
assert.equal(count(html, '<section class="rb-ad-slot" data-rb-ads="radio" hidden></section>'), 1);
assert.equal(count(html, '<script src="/api/ads/slot.js" defer></script>'), 1);
assert.equal(count(html, '<link rel="stylesheet" href="/api/ads/slot.css">'), 1);
assert.ok(html.indexOf('id="recent"') < html.indexOf("rb-ad-slot"), "under Up next / Recently played");
const V = await import(join(tv, "views.js"));
const { i18n } = await import(join(tv, "i18n.js"));
const L = i18n("en");
const v = (i) => ({ id: "v" + i, kind: "video", source: "upload", title: "RB " + i, channel: "rb", channel_name: "RB", views: 1, likes: 0, duration_s: 60, published_at: "2026-10-01 10:00:00", video_url: "https://media.relentlessbillionaire.com/x.mp4", comments_on: 1 });
const home = V.layout({ L, title: "RB TV", body: V.homePage({ cat: "", cats: [], featured: null, shorts: [], latest: { items: [v(1), v(2)], more: false }, chans: [], beats: [], L }), here: "/tv" });
assert.equal(count(home, 'data-rb-ads="tv" data-rb-ads-max="2"'), 1, "one slot on the TV home");
assert.equal(count(home, '<script src="/api/ads/slot.js" defer></script>'), 1);
assert.equal(count(home, 'href="/api/ads/slot.css"'), 1);
const watch = V.watchPage({ v: v(1), next: [v(2)], comments: [], channel: { videos: 2 }, L });
assert.equal(count(watch, 'data-rb-ads="tv" data-rb-ads-max="1"'), 1, "one slot under Up next on watch pages");
console.log("radio/tv ok: one slot per page for its surface, the shared script and stylesheet once each");
