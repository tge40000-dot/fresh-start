// Usage: node --no-warnings rb-site-updates/test/luxe-motion.test.mjs <patched rb-public-content dir> <patched artist-router dir>
// The luxe layer in /api/content/site-images.css, the hub following Dark Luxury, and RB Create's own copy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [pubDir, arDir] = process.argv.slice(2);
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const pub = await import(join(pubDir, "site-images-public.js"));
const css = async (site) => (await pub.siteImagesCss(null, {}, { waitUntil() {} }, new URL("https://x/api/content/site-images.css?site=" + site))).text();
const balanced = (s) => { let d = 0; for (const ch of s) { if (ch === "{") d++; if (ch === "}") d--; if (d < 0) return false; } return d === 0; };
const MOVES = /animation:rb-(rise|skel)|translate:0 -1px|:hover::after\{animation/;

for (const site of ["home", "beats", "tv", "studio", "mastering", "fund", "memberships", "events", "radio", "release", "jobs", "partners"]) {
  const c = await css(site);
  assert.ok(balanced(c), `${site}: braces balance`);
  assert.match(c, /\.rb-skel\{/, `${site}: gold skeleton class`); assert.match(c, /\.rb-shimmer::after\{/, `${site}: shimmer class`);
  assert.match(c, /var\(--lux-gold,#D4AF37\)/, `${site}: tokens with the locked fallback`);
  assert.doesNotMatch(c, /background:linear/, `${site}: no background shorthand (sites keep their own backgrounds)`);
  // everything that moves is inside prefers-reduced-motion: no-preference
  const still = c.replace(/@media \(prefers-reduced-motion:no-preference\)\{(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*\}/g, "");
  assert.doesNotMatch(still, MOVES, `${site}: motion outside the reduced-motion guard`);
  const outside = c.replace(/@supports \(animation-timeline:view\(\)\)\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g, "");
  assert.doesNotMatch(outside, /animation-timeline/, `${site}: scroll timelines only under @supports`);
}
const radio = await css("radio");
assert.doesNotMatch(radio, /animation-timeline|translate:0 -1px/, "RB Radio gets no reveals or button motion");
const home = await css("home");
assert.match(home, /@supports \(animation-timeline:view\(\)\)\{@media \(prefers-reduced-motion:no-preference\)\{\.rb-home \.rb-sec,\.rb-home \.rb-stats\{animation:rb-rise linear backwards/);
assert.match(home, /@media \(hover:hover\)\{\.rb-home \.rb-btn:hover:not\(:disabled\)\{translate:0 -1px/, "hover lift only with a real pointer");
assert.doesNotMatch(await css("mastering"), /animation-timeline/, "tools don't fade in");
assert.doesNotMatch(await css("studio"), /animation-timeline/, "tools don't fade in");
assert.doesNotMatch(await css("events"), /animation-timeline/, "/events keeps its own reveals");
assert.match(await css("events"), /\.venue-card:hover/);
assert.equal(pub.LUXE_SITE_IDS.includes("radio"), false);

// ---- the hub (artist-router)
const ar = readFileSync(join(arDir, "artist-router-v14.js"), "utf8");
const i = ar.indexOf("var RB_HUB_CSS = ");
const hub = JSON.parse(ar.slice(i + 17, ar.indexOf(";\nvar", i)));
const rest = hub.slice(hub.indexOf("}") + 1);
assert.doesNotMatch(rest, /rgba\((198,161,91|7,7,8|244,241,234|231,215,177|225,6,0|16,17,20),/, "hub colours go through their variables");
assert.doesNotMatch(rest, /#(070708|101114|C6A15B|E7D7B1|F4F1EA|A8A196|E10600)\b/i, "no hub literals outside :root");
assert.match(hub, /^[^]*:root\{--rb-void:#070708;--rb-ink:#101114;[^}]*--rb-gold:#C6A15B/, "the hub's own brand values are unchanged");
assert.equal(ar.split("${RB_HUB_CSS}\n${rbHubLux()}\n").length - 1, ar.split("${RB_HUB_CSS}").length - 1, "every hub page adds rbHubLux() after the hub CSS");
assert.match(ar, /function rbHubLux\(\) \{\n  const key = SITE_THEME \? themeFor\(SITE_THEME, "home"\) : null;\n  if \(key !== "luxe"/, "the hub only moves for Dark Luxury");
assert.match(ar, /import \{ parseSetting, themeFor, PALETTES, luxTokens, luxCss \} from "\.\/theme\.js";/);

// ---- RB Create carries the lock and its own motion
const m = ar.indexOf("const RB_CREATE_HTML = ");
const create = JSON.parse(ar.slice(m + 23, ar.indexOf(";\nfunction rbCreatePage", m)));
for (const v of ["--lux-bg:#05040A", "--lux-gold:#D4AF37", "--lux-gold-highlight:#F5E6C8", "--lux-gold-deep:#8B6914", "--lux-crimson:#C41E3A", "--lux-text:#F5F0E6", "--lux-text-muted:#A89F8C", "--lux-line:#2A261C", "--lux-bg-elevated:#0C0A10"])
  assert.ok(create.includes(v), `RB Create: ${v}`);
assert.match(create, /@media \(prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important\}\}/, "RB Create still stops all motion when asked");
assert.match(create, /<ul class="list" id="projects" aria-busy="true"><li aria-label="Loading your projects"><div class="grow"><span class="rb-skel w60">/);
assert.doesNotMatch(create, /Loading…<\/li>/);
// ---- public loading states are gold skeletons, words kept for screen readers (patch_loading_states.py)
for (const w of ["Loading the shop\\u2026", "Curating the storefront\\u2026", "Loading roster\\u2026", "Loading today’s games…"])
  assert.ok(ar.includes(`<span class="rb-sr">${w}</span>`), "skeleton for " + w);
assert.ok(!ar.includes('<p class="shop-empty">Loading the shop\\u2026</p>'), "no bare shop loading line left");
console.log("luxe motion ok: shared layer on every site (Radio: classes only), hub tokens, RB Create");
