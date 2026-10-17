// Usage: node rb-tools/test/custom-palettes.mjs <patched worker dir>...
// Custom palettes register, fail closed, build every site CSS, and validate in each copy of theme.js.
import assert from "node:assert/strict";
for (const d of process.argv.slice(2)) {
  const t = await import(d + "/theme.js");
  const good = { label: "Test Teal", void: "#081312", dark: "#0F1F1D", mid: "#1B312E", light: "#5F7F79", a1: "#F08A5D", a1s: "#F7B89B", a2: "#2EC4B6", a2b: "#7FE3D9", cream: "#F1F7F5" };
  assert.ok(t.checkPalette(good).ok, JSON.stringify(t.checkPalette(good)));
  assert.equal(t.checkPalette({ ...good, void: "#FFFFFF" }).ok, false);
  assert.equal(t.checkPalette({ ...good, a2: "red" }).ok, false);
  const s = t.parseSetting(JSON.stringify({ theme: "c_teal01", sites: { tv: "c_teal01" }, custom: { c_teal01: good, c_bad001: { ...good, void: "#FFFFFF" }, "bad key": good } }));
  assert.equal(s.theme, "c_teal01"); assert.equal(s.sites.tv, "c_teal01"); assert.deepEqual(Object.keys(s.custom), ["c_teal01"]);
  assert.equal(t.themeFor(s, "tv"), "c_teal01");
  if (t.MAPPED_SITES) for (const site of t.MAPPED_SITES) { const css = t.siteCss(site, "c_teal01"); assert.ok(!/NaN|undefined/.test(css), site); }
  const v = t.validateSetting({ theme: "c_teal02", sites: {}, custom: { c_teal02: good } }); assert.ok(v.ok, v.error); assert.ok(v.setting.custom.c_teal02);
  assert.equal(t.validateSetting({ theme: "c_zzz999", sites: {} }).ok, false);
  assert.equal(t.validateSetting({ theme: "blackgold", sites: {} }).ok, true, "presets still save");
  console.log(d.split("/").pop(), "custom palettes ok");
}
