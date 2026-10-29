// Usage: node rb-site-updates/test/onesound.test.mjs <patched rb-radio dir>
// /radio/embed.js: one RB sound at a time across tabs, frames and tools (patch_radio_onesound.py), present once.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const s = readFileSync(join(process.argv[2], "index.js"), "utf8");
const js = JSON.parse(s.match(/const EMBED_JS = ("(?:[^"\\]|\\.)*");/)[1]);
const once = (x) => assert.equal(js.split(x).length - 1, 1, "once in embed.js: " + x);
once("/* One RB sound at a time (patch_radio_onesound.py)");
once('new BroadcastChannel("rb-sound")');
once("pauseOthers(); claimSound();");
once('window.addEventListener("rbsound:claim"');
assert.match(js, /function mediaSound\(ev\) \{[^}]*!t\.paused && audible\(t\)\) claimSound\(\); \}/, "only audible media claims");
new Function(js); // parses
console.log("one sound ok: channel, claims on radio play and audible media, rbsound:claim");
