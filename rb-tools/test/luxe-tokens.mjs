// Usage: node rb-tools/test/luxe-tokens.mjs <patched Worker dir>...   (rb-public-content, rb-command, rb-radio, artist-router)
// The Dark Luxury lock: every copy of theme.js knows the palette, gives exactly the locked tokens for it, passes every
// palette (built-in and a builder-made custom one) through the same token set, and adds the tokens to each site's
// stylesheet only when a theme is chosen.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOCK = { bg: "#05040A", "bg-elevated": "#0C0A10", gold: "#D4AF37", "gold-highlight": "#F5E6C8", "gold-deep": "#8B6914",
  crimson: "#C41E3A", text: "#F5F0E6", "text-muted": "#A89F8C", line: "#2A261C" };
const HEX = /^#[0-9A-F]{6}$/;

for (const dir of process.argv.slice(2)) {
  const th = await import(join(dir, "theme.js") + "?" + Math.random());
  const name = dir.split("/").filter(Boolean).pop();
  assert.equal(Object.keys(th.PALETTES)[0], "luxe", `${name}: Dark Luxury is the first palette`);
  assert.equal(th.PALETTES.luxe.label, "Dark Luxury");
  assert.deepEqual(th.LUXE_LOCK, LOCK, `${name}: the lock is the agreed set`);
  const lux = th.luxTokens(th.PALETTES.luxe);
  for (const [k, v] of Object.entries(LOCK)) assert.equal(lux[k], v, `${name}: --lux-${k} is ${lux[k]}, locked ${v}`);
  if (th.checkPalette) assert.ok(th.checkPalette(th.PALETTES.luxe).ok, `${name}: Dark Luxury passes the builder's own check`);
  const t = th.tones(th.PALETTES.luxe);
  for (const [what, a, b, min] of [["text", t.text, t.panel2, 7], ["muted", t.muted, t.panel2, 4.5], ["gold", t.accent, t.panel2, 4.5],
    ["crimson as text", lux["crimson-text"], t.panel2, 4.5], ["button text on gold", th.PALETTES.luxe.void, t.accent, 4.5]]) {
    assert.ok(th.contrast(a, b) >= min, `${name}: Dark Luxury ${what} ${th.contrast(a, b).toFixed(2)} < ${min}`);
  }
  // every palette (and a custom one from the builder) fills the same nine tokens with real colours
  const custom = { label: "Oakland Night", void: "#0B0E14", dark: "#151A24", mid: "#222A3A", light: "#5F6B80", a1: "#FF6B6B", a1s: "#FFB0B0", a2: "#F2C14E", a2b: "#F7DB98", cream: "#F2F4F8" };
  for (const [k, p] of [...Object.entries(th.PALETTES), ["custom", custom]]) {
    const x = th.luxTokens(p);
    for (const key of Object.keys(LOCK)) assert.match(x[key], HEX, `${name}/${k}: --lux-${key}`);
    assert.match(x["gold-line"], /^rgba\(/);
  }
  if (th.siteCss && th.MAPPED_SITES) {
    for (const site of th.MAPPED_SITES) {
      assert.equal(th.siteCss(site, null), "", `${name}: ${site} with no theme stays empty (sites look as before)`);
      const css = th.siteCss(site, "luxe");
      assert.match(css, /--lux-gold:#D4AF37/, `${name}: ${site} gets the tokens with Dark Luxury`);
      assert.equal((css.match(/--lux-gold:/g) || []).length, 1, `${name}: ${site}: tokens once`);
    }
    if (th.MAPPED_SITES.includes("radio")) assert.match(th.siteCss("radio", "luxe"), /--lux-gold:#D4AF37!important/, "attached sites get !important tokens");
    if (th.MAPPED_SITES.includes("tv")) assert.doesNotMatch(th.siteCss("tv", "luxe"), /--lux-gold:#D4AF37!important/, "other sites don't");
  }
  if (th.paletteList) assert.equal(th.paletteList()[0].label, "Dark Luxury");
  // the key lists elsewhere in the Worker know it too
  for (const f of ["blocks.js", "tables.js", "ui.js"]) {
    if (!existsSync(join(dir, f))) continue;
    const s = readFileSync(join(dir, f), "utf8");
    if (s.includes('"blackgold", "gold", ')) assert.ok(s.includes('"luxe", "blackgold", "gold", '), `${name}/${f}: luxe in the key list`);
  }
  // RB Command: the builder's check returns the tokens (locked deep gold kept), and the screen shows them
  if (existsSync(join(dir, "sitetheme.js")) && readFileSync(join(dir, "sitetheme.js"), "utf8").includes("luxTokens")) {
    const st = await import(join(dir, "sitetheme.js") + "?" + Math.random());
    const r = st.check({ palette: th.PALETTES.luxe });
    assert.ok(r.ok); assert.deepEqual(Object.fromEntries(Object.keys(LOCK).map((k) => [k, r.lux[k]])), LOCK, "check() gives the lock for Dark Luxury");
    const ui = readFileSync(join(dir, "ui.js"), "utf8");
    for (const bit of ['id="pb-lux"', 'if (r.lux && $("pb-lux"))', ".pblux{", ".skel.skel{border:1px", 'var st = { a: "#D4AF37", b: "#C41E3A",'])
      assert.equal(ui.split(bit).length - 1, 1, `rb-command/ui.js: ${bit} once`);
  }
  const ar = join(dir, "artist-router-v14.js");
  if (existsSync(ar)) assert.ok(readFileSync(ar, "utf8").includes('luxe: { label: "Dark Luxury"'), "artist-router's THEMES has it");
  console.log(`${name}: luxe tokens ok (${Object.keys(th.PALETTES).length} palettes)`);
}
