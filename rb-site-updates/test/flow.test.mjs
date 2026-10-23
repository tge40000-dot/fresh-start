// Usage: node rb-site-updates/test/flow.test.mjs <patched rb-radio dir>
// RB Flow is in embed.js exactly once, embed.js still parses, and the flow skips RB TV.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const s = readFileSync(join(process.argv[2], "index.js"), "utf8");
const js = JSON.parse(s.match(/const EMBED_JS = ("(?:[^"\\]|\\.)*");/)[1]);
assert.equal((js.match(/\/\* RB Flow:/g) || []).length, 1, "RB Flow once");
assert.ok(js.indexOf("window.RBRadio") < js.indexOf("/* RB Flow:"), "after the radio bar");
new Function(js);
assert.ok(js.includes("if (/^\\/tv(\\/|$)/.test(location.pathname)) return;"), "never on RB TV");
for (const k of ["record", "license", "master", "release"]) assert.ok(js.includes('key: "' + k + '"'));
console.log("rb-flow ok: once, parses, skips RB TV");
