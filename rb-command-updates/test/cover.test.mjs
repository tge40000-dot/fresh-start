// Usage: node --no-warnings rb-command-updates/test/cover.test.mjs <patched rb-command dir>
// Cover maker: the page and its script parse, the nonce is on every tag, the CSP is strict, the three formats and four
// looks are there, and the patch added the route, the nav entry, its section and the video creator's link once each.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const cover = await import(join(dir, "cover.js"));
const html = cover.page("n0nce");
for (const tag of html.match(/<(script|style)\b[^>]*>/g)) assert.match(tag, /nonce="n0nce"/, "every script and style tag is nonced");
const js = html.match(/<script nonce="n0nce">([\s\S]*?)<\/script>/)[1];
new Function(js); // parses
for (const want of ['"yt"', '"sq"', '"story"', "w: 1280, h: 720", "w: 1080, h: 1920", "big: 3000", "2e6"]) assert.ok(js.includes(want), "format: " + want);
for (const look of ["noir", "pulse", "vinyl", "editorial"]) assert.ok(html.includes(`data-look="${look}"`), "look " + look);
assert.ok(js.includes("/api/video/media?u="), "catalog covers load same-origin so the canvas can be saved");
const csp = cover.csp("n0nce");
assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'nonce-n0nce'(;|$)/); assert.doesNotMatch(csp, /unsafe/);
const index = readFileSync(join(dir, "index.js"), "utf8"), ui = readFileSync(join(dir, "ui.js"), "utf8"), video = readFileSync(join(dir, "video.js"), "utf8");
const once = (s, x, what) => assert.equal(s.split(x).length - 1, 1, what);
once(index, 'import * as cover from "./cover.js";', "import");
once(index, 'if (path === "/cover") {', "route");
once(ui, '["/cover", "Cover maker"]', "nav entry");
once(ui, '"/cover": "Shows & sites"', "nav section");
once(video, '<a class="back" href="/cover">Cover maker</a>', "video creator links to it");
assert.ok(/if \(path === "\/cover"\) \{\n\s+needs\(user, "TV", "view"\);/.test(index), "same permission as the video creator");
console.log("cover maker ok: page, nonces, strict CSP, script parses, formats and looks, route, nav, video link");
