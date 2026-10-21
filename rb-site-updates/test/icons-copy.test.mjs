// Usage: node rb-site-updates/test/icons-copy.test.mjs <patched rb-release dir> <patched Worker dir>...
// The /release page has no "flat" wording or unsupported claims, and every Worker given has the RB icon tags and no
// old icon tags. Also checks the icon files: the .ico holds 16, 32 and 48 px images and the SVG needs no font.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const [release, ...dirs] = process.argv.slice(2);
const page = readFileSync(join(release, "rb-release-worker.js"), "utf8");
for (const bad of [/\bflats?\b/i, /\$1\b/, /\$500/, /Content ID safe/, /Viral cleared/]) assert.doesNotMatch(page, bad, "release page: " + bad);
assert.ok(page.includes("PICK A BEAT") && page.includes("GET A BEAT"));
const TAG = "https://relentlessbillionaire.com/brand/icon.svg?v=3";
const OLD = /<link\b[^>]*\brel=\\?["'](?:shortcut icon|icon|apple-touch-icon)\\?["'][^>]*>/gi;
for (const d of dirs) {
  const files = readdirSync(d).filter((f) => /\.(js|html)$/.test(f) && f !== "brand_icons.js");
  const all = files.map((f) => readFileSync(join(d, f), "utf8")).join("\n");
  if (!/<meta\s+charset/i.test(all) && !OLD.test(all)) continue;
  assert.ok(all.includes(TAG), d + ": has the RB icon");
  const left = (all.match(OLD) || []).filter((t) => !t.includes("?v=3"));
  assert.deepEqual(left, [], d + ": no old icon tags");
  assert.ok(!all.includes("relentlessbillionaire.com/favicon.ico?v="), d + ": the .ico is linked from /brand/ (the /favicon.ico route doesn't match a query string)");
  for (const f of files) for (const doc of readFileSync(join(d, f), "utf8").split(/(?=<head[\s>])/i))
    assert.ok(doc.split(TAG).length - 1 <= 1 || doc.includes('\\"'), `${d}/${f}: one set of icon tags per page`);
}
const brand = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "rb-tools", "brand");
const ico = readFileSync(join(brand, "favicon.ico"));
assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 3);
assert.deepEqual([0, 1, 2].map((i) => ico[6 + i * 16]), [16, 32, 48]);
const svg = readFileSync(join(brand, "icon.svg"), "utf8");
assert.ok(!/<text\b/.test(svg) && /<path\b/.test(svg), "letters are outlines");
console.log(`icons and /release copy ok: no flat wording or unsupported claims, RB icon on ${dirs.length} Worker(s), .ico 16/32/48, outlined SVG`);
