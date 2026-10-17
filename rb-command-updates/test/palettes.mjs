// Usage: node rb-command-updates/test/palettes.mjs <patched rb-command/theme.js>
// Every palette must give readable text: body text, muted text, accents and the "hot" colour at 4.5:1 or more on
// the panels, and dark button text on the accent at 4.5:1 or more.
import assert from "node:assert/strict";
const { PALETTES, tones, contrast, siteCss, MAPPED_SITES, paletteList } = await import(process.argv[2]);
const keys = Object.keys(PALETTES);
assert.equal(keys.length, 26, "26 palettes");
assert.equal(new Set(keys).size, 26);
const rows = [];
for (const k of keys) {
  const p = PALETTES[k], t = tones(p);
  const c = { text: contrast(t.text, t.panel2), muted: contrast(t.muted, t.panel2), accent: contrast(t.accent, t.panel2), hot: contrast(t.hot, t.panel2), button: contrast(p.void, t.accent) };
  for (const [name, v] of Object.entries(c)) assert.ok(v >= 4.5, `${k}: ${name} contrast ${v.toFixed(2)} < 4.5`);
  for (const s of MAPPED_SITES) siteCss(s, k); // every site's stylesheet builds
  rows.push(`${k.padEnd(10)} text ${c.text.toFixed(1)}  muted ${c.muted.toFixed(1)}  accent ${c.accent.toFixed(1)}  hot ${c.hot.toFixed(1)}  button ${c.button.toFixed(1)}`);
}
assert.equal(paletteList().length, 26);
console.log(rows.join("\n"));
console.log("palettes ok: all 26 pass the 4.5:1 checks and build every site's stylesheet");
