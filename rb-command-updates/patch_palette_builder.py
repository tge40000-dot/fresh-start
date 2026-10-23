"""Palette builder for RB Command > Site colours: make any colour theme, without asking for one to be added.

Usage: python3 -I patch_palette_builder.py <pulled rb-command dir>   (after rb-tools/patch_theme_custom.py on the same dir)

Adds, above the existing theme cards (nothing is removed):
- Build your own: pick a main colour and an optional second colour, a harmony (complementary, analogous, triadic,
  split, tetradic, one-colour), a mood (deep, rich, soft) and a background tint. Shuffle (with locks), or pull the
  colours out of an uploaded image. A live preview and RB Command's own readability check (every text and accent
  colour at 4.5:1 or more, the same check the sites run) update as you go. "Save to my palettes" adds it as a card.
- Ready-made: 96 palettes built the same way across the colour wheel, one click to load into the builder.
- Your palettes: use, edit or delete the ones you saved. They are published with "Publish colours", as before.
- POST /api/site-theme/check: the server-side check the builder calls (Content view).
Each anchor must match exactly once; running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])


def edit(name, old, new):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    added = new[len(old):] if new.startswith(old) else new[: len(new) - len(old)] if new.endswith(old) else None
    if added and s.count(added) > 1:
        first = s.index(added) + len(added)
        s = s[:first] + s[first:].replace(added, "")
        p.write_text(s, encoding="utf-8")
        print(f"{name}: removed a duplicate copy")
    mark = next((ln for ln in added.split("\n") if ln.strip()), "") if added else ""
    if new in s or (added and added in s) or (len(mark.strip()) >= 25 and ("\n" + mark + "\n") in ("\n" + s)):
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}: anchor found {s.count(old)} times: {old[:70]!r}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"{name}: edited")


if "export function checkPalette" not in (folder / "theme.js").read_text(encoding="utf-8"):
    raise SystemExit("theme.js has no custom palettes yet: run rb-tools/patch_theme_custom.py first")

# ---------------------------------------------------------------- server
edit("sitetheme.js", 'import { SITES, parseSetting, validateSetting, paletteList, tones, PALETTES } from "./theme.js";\n',
     'import { SITES, parseSetting, validateSetting, paletteList, tones, PALETTES, checkPalette, cleanPalette, CUSTOM_KEY } from "./theme.js";\n')
edit("sitetheme.js", "    palettes: paletteList().map((p) => { const t = tones(PALETTES[p.key]); return { ...p, preview:",
     "    palettes: paletteList().map((p) => { const t = tones(PALETTES[p.key]); return { ...p, custom: CUSTOM_KEY.test(p.key), preview:")
edit("sitetheme.js", "export async function save(env, user, body) {\n",
     "/** The builder's live check: the same test every site runs, plus the preview tones. */\n"
     "export function check(body) {\n"
     "  const c = cleanPalette(body && body.palette);\n"
     "  const r = checkPalette(body && body.palette);\n"
     "  if (!c) return r;\n"
     "  const t = tones(c);\n"
     "  return { ...r, palette: c, preview: { bg: t.bg, panel: t.panel2, text: t.text, muted: t.muted, accent: t.accent, hot: t.hot, line: t.line2 } };\n"
     "}\n\n"
     "export async function save(env, user, body) {\n")
edit("index.js", '  if (path === "/api/site-theme") { needs(user, "Content", "edit"); return json(await sitetheme.save(env, user, body)); }\n',
     '  if (path === "/api/site-theme/check") { needs(user, "Content", "view"); return json(sitetheme.check(body)); }\n'
     '  if (path === "/api/site-theme") { needs(user, "Content", "edit"); return json(await sitetheme.save(env, user, body)); }\n')

# ---------------------------------------------------------------- the screen
edit("ui.js", '      var draft = { theme: cur.theme || "", sites: Object.assign({}, cur.sites) };\n',
     '      var draft = { theme: cur.theme || "", sites: Object.assign({}, cur.sites), custom: Object.assign({}, cur.custom || {}) };\n')
edit("ui.js", '        if (e.target.id === "th-save") publish({ theme: draft.theme, sites: draft.sites }, e.target);\n',
     '        if (e.target.id === "th-save") publish({ theme: draft.theme, sites: draft.sites, custom: draft.custom }, e.target);\n')
edit("ui.js", '        if (e.target.id === "th-back" && d.previous) publish({ theme: d.previous.setting.theme || "", sites: d.previous.setting.sites }, e.target);\n',
     '        if (e.target.id === "th-back" && d.previous) publish({ theme: d.previous.setting.theme || "", sites: d.previous.setting.sites, custom: d.previous.setting.custom || {} }, e.target);\n')
edit("ui.js", '        "<section><h2>All sites</h2><div class=\\"tgrid\\">" + card(',
     '        (edit ? \'<section id="pb-root"></section>\' : "") +\n        "<section><h2>All sites</h2><div class=\\"tgrid\\">" + card(')
edit("ui.js", '      view.querySelectorAll("[data-bg]").forEach(function(n){ n.style.background = n.dataset.bg; }); // CSP: colours via CSSOM, not style attributes\n',
     '      view.querySelectorAll("[data-bg]").forEach(function(n){ n.style.background = n.dataset.bg; }); // CSP: colours via CSSOM, not style attributes\n'
     '      if (edit && $("pb-root")) paletteBuilder($("pb-root"), d, draft, function(key, label, pv){\n'
     '        var grid = view.querySelector("#pb-root ~ section .tgrid"), old = grid.querySelector(\'[data-theme="\' + key + \'"]\');\n'
     '        var tmp = document.createElement("div"); tmp.innerHTML = card(key, label, pv); var n = tmp.firstChild;\n'
     '        if (old) grid.replaceChild(n, old); else grid.appendChild(n);\n'
     '        n.querySelectorAll("[data-bg]").forEach(function(x){ x.style.background = x.dataset.bg; }); n.querySelectorAll("[data-fg]").forEach(function(x){ x.style.color = x.dataset.fg; });\n'
     '        var o = view.querySelector(\'#th-opts-tpl\'); view.querySelectorAll("select[data-site]").forEach(function(sel){ if (!sel.querySelector(\'option[value="\' + key + \'"]\')) { var op = document.createElement("option"); op.value = key; op.textContent = label; sel.appendChild(op); } else sel.querySelector(\'option[value="\' + key + \'"]\').textContent = label; });\n'
     '        return n;\n'
     '      }, function(key){\n'
     '        var n = view.querySelector(\'#pb-root ~ section .tgrid [data-theme="\' + key + \'"]\'); if (n) n.parentNode.removeChild(n);\n'
     '        view.querySelectorAll(\'select[data-site] option[value="\' + key + \'"]\').forEach(function(op){ if (op.selected) { op.parentNode.value = "all"; delete draft.sites[op.parentNode.dataset.site]; } op.parentNode.removeChild(op); });\n'
     '        if (draft.theme === key) { draft.theme = ""; var own = view.querySelector(\'.tgrid [data-theme=""]\'); if (own) own.setAttribute("aria-pressed", "true"); }\n'
     '      });\n')

CSS = (
    ".pb{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:16px}\n"
    ".pb .ctl{display:flex;flex-direction:column;gap:12px}\n"
    ".pb label.f{display:flex;flex-direction:column;gap:6px;font-size:.78rem;color:var(--muted);letter-spacing:.06em}\n"
    ".pb .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}\n"
    ".pb input[type=color]{width:56px;height:40px;border:1px solid var(--line2);border-radius:10px;background:var(--panel2);padding:3px;cursor:pointer}\n"
    ".pb input[type=text]{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;padding:.45rem .6rem;color:var(--text);min-width:0;flex:1}\n"
    ".pb .opt{border:1px solid var(--line2);background:var(--panel2);color:var(--muted);border-radius:999px;padding:.3rem .75rem;font-size:.8rem}\n"
    ".pb .opt[aria-pressed=true]{border-color:var(--brass);color:var(--brass2);box-shadow:0 0 0 2px var(--glow2,transparent)}\n"
    ".pb .lock{font-size:.74rem;color:var(--muted);display:inline-flex;gap:4px;align-items:center}\n"
    ".pbp{border-radius:14px;overflow:hidden;border:1px solid var(--line2);min-height:260px;display:flex;flex-direction:column}\n"
    ".pbp .ph{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;font:600 .72rem/1 var(--caps,serif);letter-spacing:.24em}\n"
    ".pbp .pc{margin:0 14px 14px;padding:16px;border-radius:12px;flex:1;display:flex;flex-direction:column;gap:8px}\n"
    ".pbp .pt{font:italic 600 1.5rem/1.1 var(--serif,Georgia,serif)}.pbp .pm{font-size:.84rem}\n"
    ".pbp .pbtn{align-self:flex-start;border-radius:999px;padding:.45rem 1rem;font-weight:700;font-size:.82rem}\n"
    ".pbp .pchip{align-self:flex-start;border-radius:999px;padding:.2rem .7rem;font-size:.72rem;font-weight:700;border:1px solid}\n"
    ".pbsw{display:grid;grid-template-columns:repeat(9,1fr);gap:4px;margin-top:10px}.pbsw i{height:26px;border-radius:6px;border:1px solid rgba(255,255,255,.08)}\n"
    ".pbck{list-style:none;margin:10px 0 0;padding:0;font-size:.8rem;display:grid;gap:3px}.pbck li.bad{color:var(--bad)}.pbck li.ok{color:var(--muted)}\n"
    ".pbmine{display:flex;flex-wrap:wrap;gap:8px}\n"
    ".pbmine .mine{display:flex;align-items:center;gap:6px;border:1px solid var(--line2);border-radius:999px;padding:.25rem .4rem .25rem .7rem;font-size:.8rem}\n"
    ".pbmine .mine i{width:14px;height:14px;border-radius:50%}.pbmine button{border:0;background:none;color:var(--muted);padding:.1rem .35rem;border-radius:6px}.pbmine button:hover{color:var(--text);background:var(--panel2)}\n"
    "#pb-gallery{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}#pb-gallery .tcard{font-size:.76rem}\n"
    "@media (max-width:900px){.pb{grid-template-columns:1fr}}\n"
)
edit("ui.js", ".tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\n",
     ".tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\n" + CSS)

JS = r"""
  // ---------- palette builder (Site colours): any theme, from one or two colours or an image; checked like the sites check it
  var OK = (function(){
    var lin = function(c){ c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var gam = function(c){ return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
    var hex2rgb = function(h){ h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
    var lab = function(rgb){
      var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
      var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
    };
    var rgbOf = function(L, a, b){
      var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
      return [gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
    };
    var toLch = function(h){ var o = lab(hex2rgb(h)); return { l: o[0], c: Math.sqrt(o[1] * o[1] + o[2] * o[2]), h: (Math.atan2(o[2], o[1]) * 180 / Math.PI + 360) % 360 }; };
    var fromLch = function(l, c, h){
      l = Math.max(0, Math.min(1, l)); var hr = h * Math.PI / 180, rgb;
      for (var i = 0; i < 24; i++) { rgb = rgbOf(l, c * Math.cos(hr), c * Math.sin(hr)); if (rgb.every(function(v){ return v >= -0.0005 && v <= 1.0005; })) break; c *= 0.85; }
      return "#" + rgb.map(function(v){ var n = Math.round(Math.max(0, Math.min(1, v)) * 255); return (n < 16 ? "0" : "") + n.toString(16); }).join("").toUpperCase();
    };
    var lum = function(h){ var c = hex2rgb(h).map(function(v){ return lin(v); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    var ratio = function(a, b){ var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    return { toLch: toLch, fromLch: fromLch, ratio: ratio, lab: lab, hex2rgb: hex2rgb };
  })();
  var HARM = { complementary: 180, analogous: 40, triadic: 120, split: 150, tetradic: 90, mono: 0 };
  var MOODS = { deep: { v: 0.115, d: 0.16, m: 0.225, c: 0.022 }, rich: { v: 0.14, d: 0.185, m: 0.255, c: 0.02 }, soft: { v: 0.165, d: 0.215, m: 0.29, c: 0.012 } };
  /** One palette from the builder's choices. Accents are lifted until dark button text reads on them at 4.6:1. */
  function buildPalette(o){
    var A = OK.toLch(o.a), B = o.b ? OK.toLch(o.b) : null, M = MOODS[o.mood] || MOODS.rich;
    var h2 = B ? B.h : (A.h + (HARM[o.harm] == null ? 180 : HARM[o.harm])) % 360;
    var base = o.tint === "second" ? h2 : o.tint === "warm" ? 70 : o.tint === "cool" ? 250 : A.h;
    var p = { label: o.label || "Custom" };
    p.void = OK.fromLch(M.v, M.c, base); p.dark = OK.fromLch(M.d, M.c * 1.2, base); p.mid = OK.fromLch(M.m, M.c * 1.5, base);
    p.light = OK.fromLch(0.56, 0.035, base); p.cream = OK.fromLch(0.965, 0.012, base);
    var aL = Math.max(A.l, 0.74), aC = Math.max(A.c, 0.06);
    p.a2 = OK.fromLch(aL, aC, A.h);
    for (var i = 0; i < 30 && OK.ratio(p.void, p.a2) < 4.6; i++) { aL += 0.01; p.a2 = OK.fromLch(aL, aC, A.h); }
    p.a2b = OK.fromLch(Math.min(0.93, aL + 0.09), aC * 0.75, A.h);
    var hL = o.harm === "mono" && !B ? 0.86 : Math.max(0.7, B ? B.l : 0.7), hC = o.harm === "mono" && !B ? Math.max(0.05, aC * 0.45) : Math.max(0.12, B ? B.c : aC);
    p.a1 = OK.fromLch(hL, hC, h2);
    for (var j = 0; j < 30 && OK.ratio(p.void, p.a1) < 4.6; j++) { hL += 0.01; p.a1 = OK.fromLch(hL, hC, h2); }
    p.a1s = OK.fromLch(Math.min(0.93, hL + 0.11), hC * 0.6, h2);
    return p;
  }
  /** Main and second colour from a picture: k-means on 64×64 pixels in OKLab; the most colourful, well-used clusters win. */
  function coloursFromImage(img){
    var cv = document.createElement("canvas"); cv.width = cv.height = 64; var g = cv.getContext("2d"); g.drawImage(img, 0, 0, 64, 64);
    var px = g.getImageData(0, 0, 64, 64).data, pts = [];
    for (var i = 0; i < px.length; i += 4) if (px[i + 3] > 128) pts.push(OK.lab([px[i], px[i + 1], px[i + 2]]));
    if (pts.length < 20) return null;
    var k = 6, cen = [pts[Math.floor(Math.random() * pts.length)]];
    while (cen.length < k) { var far = 0, best = pts[0]; pts.forEach(function(p){ var dmin = Infinity; cen.forEach(function(c){ var d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]) + (p[2] - c[2]) * (p[2] - c[2]); if (d < dmin) dmin = d; }); if (dmin > far) { far = dmin; best = p; } }); cen.push(best); }
    var cnt = [];
    for (var it = 0; it < 10; it++) {
      var sum = cen.map(function(){ return [0, 0, 0]; }); cnt = cen.map(function(){ return 0; });
      pts.forEach(function(p){ var bi = 0, bd = Infinity; cen.forEach(function(c, ci){ var d = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]) + (p[2] - c[2]) * (p[2] - c[2]); if (d < bd) { bd = d; bi = ci; } }); sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; cnt[bi]++; });
      cen = cen.map(function(c, ci){ return cnt[ci] ? [sum[ci][0] / cnt[ci], sum[ci][1] / cnt[ci], sum[ci][2] / cnt[ci]] : c; });
    }
    var cl = cen.map(function(c, ci){ var ch = Math.sqrt(c[1] * c[1] + c[2] * c[2]); return { lab: c, n: cnt[ci], c: ch, h: (Math.atan2(c[2], c[1]) * 180 / Math.PI + 360) % 360, score: cnt[ci] * (0.25 + ch * 4) }; }).sort(function(a, b){ return b.score - a.score; });
    var hexOf = function(x){ return OK.fromLch(x.lab[0], x.c, x.h); };
    var main = cl.filter(function(x){ return x.c > 0.04; })[0] || cl[0];
    var second = cl.filter(function(x){ return x !== main && x.c > 0.04 && Math.min(Math.abs(x.h - main.h), 360 - Math.abs(x.h - main.h)) > 35; })[0];
    return { a: hexOf(main), b: second ? hexOf(second) : null };
  }
  var GALLERY_NAMES = [[0, "Ruby"], [15, "Crimson"], [30, "Ember"], [45, "Copper"], [60, "Amber"], [75, "Gold"], [90, "Champagne"], [105, "Olive"], [120, "Moss"], [135, "Jade"], [150, "Emerald"], [165, "Mint"], [180, "Teal"], [195, "Lagoon"], [210, "Bay Fog"], [225, "Cobalt"], [240, "Sapphire"], [255, "Indigo"], [270, "Violet"], [285, "Amethyst"], [300, "Orchid"], [315, "Magenta"], [330, "Rose"], [345, "Garnet"]];
  function galleryList(){
    var out = [], moods = ["deep", "rich", "soft"], harms = ["complementary", "analogous", "split", "triadic"];
    GALLERY_NAMES.forEach(function(n, i){
      moods.forEach(function(m, mi){
        var a = OK.fromLch(0.78, 0.13, n[0]);
        out.push({ label: n[1] + " " + { deep: "Night", rich: "Velvet", soft: "Haze" }[m], o: { a: a, harm: harms[(i + mi) % harms.length], mood: m, tint: mi === 2 ? "warm" : "main" } });
      });
      out.push({ label: n[1] + " Gold", o: { a: OK.fromLch(0.8, 0.13, n[0]), b: "#D4AF37", harm: "complementary", mood: "deep", tint: "warm" } });
    });
    return out;
  }
  function paletteBuilder(root, d, draft, addCard, removeCard){
    var st = { a: "#C9A227", b: "#C0392B", useB: true, harm: "complementary", mood: "rich", tint: "main", label: "", editing: null, lockA: false, lockB: false };
    var mine = function(){ return Object.keys(draft.custom || {}); };
    var chips = function(name, list, cur){ return list.map(function(x){ return '<button type="button" class="opt" data-pb="' + name + '" data-v="' + x[0] + '" aria-pressed="' + (cur === x[0]) + '">' + x[1] + "</button>"; }).join(""); };
    root.innerHTML = '<h2>Build your own</h2><div class="panel"><div class="pb"><div class="ctl">' +
      '<div class="row"><label class="f">MAIN COLOUR<input type="color" id="pb-a"></label><label class="f">SECOND COLOUR<input type="color" id="pb-b"></label>' +
      '<div class="f"><span class="lock"><input type="checkbox" id="pb-useb"> Use my second colour</span><span class="lock"><input type="checkbox" id="pb-la"> Lock main</span><span class="lock"><input type="checkbox" id="pb-lb"> Lock second</span></div></div>' +
      '<div class="f">HARMONY<div class="row">' + chips("harm", [["complementary", "Complementary"], ["analogous", "Analogous"], ["triadic", "Triadic"], ["split", "Split"], ["tetradic", "Square"], ["mono", "One colour"]], st.harm) + "</div></div>" +
      '<div class="f">MOOD<div class="row">' + chips("mood", [["deep", "Deep"], ["rich", "Rich"], ["soft", "Soft"]], st.mood) + "</div></div>" +
      '<div class="f">BACKGROUND TINT<div class="row">' + chips("tint", [["main", "From main"], ["second", "From second"], ["warm", "Warm black"], ["cool", "Cool black"]], st.tint) + "</div></div>" +
      '<div class="row"><button class="btn" type="button" id="pb-shuffle">Shuffle</button><label class="btn" for="pb-img">From an image…</label><input type="file" id="pb-img" accept="image/*" hidden><span class="muted">Space bar shuffles too.</span></div>' +
      '<div class="row"><input type="text" id="pb-name" maxlength="40" placeholder="Name it (e.g. Oakland Night)"><button class="btn primary" type="button" id="pb-save">Save to my palettes</button></div>' +
      '<p class="muted" id="pb-msg" role="status"></p></div>' +
      '<div><div class="pbp" id="pb-prev"><div class="ph"><span>RELENTLESS BILLIONAIRE</span><span>ON AIR</span></div><div class="pc"><span class="pchip">LIVE</span><div class="pt">One name. Every venture.</div><div class="pm">This is how body text and muted notes read on the panels.</div><span class="pbtn">License this beat</span></div></div>' +
      '<div class="pbsw" id="pb-sw"></div><ul class="pbck" id="pb-ck"></ul></div></div></div>' +
      '<h2>Your palettes</h2><div class="panel"><div class="pbmine" id="pb-mine"></div></div>' +
      '<h2>Ready-made</h2><p class="note">Built the same way across the colour wheel. Click one to load it into the builder, adjust it, then save it.</p><div class="tgrid" id="pb-gallery"></div>';
    var gal = galleryList(), cur = null, timer = null;
    $("pb-gallery").innerHTML = gal.map(function(g, i){ var p = buildPalette(g.o); return '<button type="button" class="tcard" data-gal="' + i + '"><span class="tmini" data-bg="' + p.void + '"><span class="tbar" data-bg="' + p.mid + '"><i data-bg="' + p.a2 + '"></i><i data-bg="' + p.a1 + '"></i></span><b data-fg="' + p.cream + '">Aa</b><small data-fg="' + p.a2b + '">' + esc(g.o.mood) + "</small></span><span>" + esc(g.label) + "</span></button>"; }).join("");
    root.querySelectorAll("[data-bg]").forEach(function(n){ n.style.background = n.dataset.bg; });
    root.querySelectorAll("[data-fg]").forEach(function(n){ n.style.color = n.dataset.fg; });
    var drawMine = function(){
      var keys = mine();
      $("pb-mine").innerHTML = keys.length ? keys.map(function(k){ var p = draft.custom[k]; return '<span class="mine"><i data-bg="' + esc(p.a2) + '"></i>' + esc(p.label) + '<button type="button" data-mine-use="' + esc(k) + '">Use</button><button type="button" data-mine-edit="' + esc(k) + '">Edit</button><button type="button" data-mine-del="' + esc(k) + '" aria-label="Delete ' + esc(p.label) + '">✕</button></span>'; }).join("") : '<p class="muted">None yet. Build one above and save it.</p>';
      $("pb-mine").querySelectorAll("[data-bg]").forEach(function(n){ n.style.background = n.dataset.bg; });
    };
    var sync = function(){
      $("pb-a").value = st.a.toLowerCase(); $("pb-b").value = st.b.toLowerCase(); $("pb-useb").checked = st.useB; $("pb-la").checked = st.lockA; $("pb-lb").checked = st.lockB;
      root.querySelectorAll("[data-pb]").forEach(function(x){ x.setAttribute("aria-pressed", String(st[x.dataset.pb] === x.dataset.v)); });
      $("pb-name").value = st.label;
      cur = buildPalette({ a: st.a, b: st.useB ? st.b : null, harm: st.harm, mood: st.mood, tint: st.tint, label: st.label || "Custom" });
      var t = { bg: cur.void, panel: cur.dark, text: cur.cream, muted: cur.light, accent: cur.a2, hot: cur.a1 };
      paint(t);
      $("pb-sw").innerHTML = ["void", "dark", "mid", "light", "a1", "a1s", "a2", "a2b", "cream"].map(function(k){ return '<i title="' + k + " " + cur[k] + '" data-bg="' + cur[k] + '"></i>'; }).join("");
      $("pb-sw").querySelectorAll("[data-bg]").forEach(function(n){ n.style.background = n.dataset.bg; });
      clearTimeout(timer); $("pb-ck").innerHTML = '<li class="ok">Checking…</li>';
      timer = setTimeout(function(){
        var mineP = cur;
        api("site-theme/check", { palette: mineP }).then(function(r){
          if (mineP !== cur) return;
          if (r.preview) paint(r.preview);
          $("pb-ck").innerHTML = Object.keys(r.report || {}).map(function(k){ var v = r.report[k], min = k === "text on panels" ? 7 : 4.5; return '<li class="' + (v >= min ? "ok" : "bad") + '">' + (v >= min ? "✓ " : "✕ ") + esc(k) + " " + v.toFixed(2) + ":1</li>"; }).join("") + (r.ok ? '<li class="ok">✓ Safe for every RB site.</li>' : r.errors.map(function(e){ return '<li class="bad">✕ ' + esc(e) + "</li>"; }).join(""));
          $("pb-save").disabled = !r.ok;
        }).catch(function(e){ $("pb-ck").innerHTML = '<li class="bad">' + esc(e.message) + "</li>"; });
      }, 220);
    };
    var paint = function(t){
      var pv = $("pb-prev"); pv.style.background = t.bg; pv.style.color = t.text;
      var pc = pv.querySelector(".pc"); pc.style.background = t.panel; pc.style.border = "1px solid " + (t.line || t.panel);
      pv.querySelector(".ph").style.color = t.accent; pv.querySelector(".pt").style.color = t.text; pv.querySelector(".pm").style.color = t.muted;
      var b = pv.querySelector(".pbtn"); b.style.background = t.accent; b.style.color = t.bg;
      var c = pv.querySelector(".pchip"); c.style.color = t.hot; c.style.borderColor = t.hot;
    };
    var shuffle = function(){
      var rnd = function(lo, hi){ return lo + Math.random() * (hi - lo); };
      if (!st.lockA) st.a = OK.fromLch(rnd(0.7, 0.85), rnd(0.09, 0.17), rnd(0, 360));
      if (!st.lockB) st.b = OK.fromLch(rnd(0.66, 0.82), rnd(0.1, 0.19), rnd(0, 360));
      var hs = Object.keys(HARM); st.harm = hs[Math.floor(Math.random() * hs.length)];
      var ms = Object.keys(MOODS); st.mood = ms[Math.floor(Math.random() * ms.length)];
      st.useB = st.lockB ? true : Math.random() < 0.35; st.editing = null; st.label = "";
      sync();
    };
    root.onclick = function(e){
      var t = e.target, o = t.closest("[data-pb]"), g = t.closest("[data-gal]");
      if (o) { st[o.dataset.pb] = o.dataset.v; if (o.dataset.pb === "harm") st.useB = false; sync(); return; }
      if (g) { var it = gal[+g.dataset.gal]; st.a = it.o.a; st.b = it.o.b || st.b; st.useB = !!it.o.b; st.harm = it.o.harm; st.mood = it.o.mood; st.tint = it.o.tint; st.label = it.label; st.editing = null; sync(); root.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      if (t.id === "pb-shuffle") return shuffle();
      if (t.id === "pb-save") {
        if (!cur) return;
        var name = ($("pb-name").value || "").trim() || "Custom " + (mine().length + 1);
        var key = st.editing || ("c_" + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, "0").padEnd(8, "0"));
        var p = Object.assign({}, cur, { label: name });
        api("site-theme/check", { palette: p }).then(function(r){
          if (!r.ok) { $("pb-msg").textContent = r.errors[0]; return; }
          draft.custom[key] = r.palette; S.dirty = true; st.editing = key; st.label = name;
          var n = addCard(key, name, r.preview);
          draft.theme = key; view.querySelectorAll(".tgrid [data-theme]").forEach(function(x){ x.setAttribute("aria-pressed", String(x === n)); });
          drawMine(); $("pb-msg").textContent = "Saved as “" + name + "” and picked for all sites. Press Publish colours to put it live.";
        }).catch(function(err){ $("pb-msg").textContent = err.message; });
        return;
      }
      var u = t.dataset.mineUse, ed = t.dataset.mineEdit, del = t.dataset.mineDel;
      if (u) { draft.theme = u; S.dirty = true; view.querySelectorAll(".tgrid [data-theme]").forEach(function(x){ x.setAttribute("aria-pressed", String(x.dataset.theme === u)); }); $("pb-msg").textContent = "Picked for all sites. Press Publish colours to put it live."; return; }
      if (ed) { var p2 = draft.custom[ed]; st.a = p2.a2; st.b = p2.a1; st.useB = true; st.label = p2.label; st.editing = ed; sync(); $("pb-msg").textContent = "Editing “" + p2.label + "”: change it and save."; return; }
      if (del) { var lbl = draft.custom[del] && draft.custom[del].label; if (!confirm("Delete “" + lbl + "”? Sites using it go back to their own colours when you publish.")) return; delete draft.custom[del]; removeCard(del); S.dirty = true; drawMine(); $("pb-msg").textContent = "Deleted. Press Publish colours to make it final."; }
    };
    root.oninput = function(e){ if (e.target.id === "pb-a") { st.a = e.target.value.toUpperCase(); sync(); } if (e.target.id === "pb-b") { st.b = e.target.value.toUpperCase(); st.useB = true; sync(); } };
    root.onchange = function(e){
      var t = e.target;
      if (t.id === "pb-useb") { st.useB = t.checked; sync(); } else if (t.id === "pb-la") st.lockA = t.checked; else if (t.id === "pb-lb") st.lockB = t.checked;
      else if (t.id === "pb-name") st.label = t.value;
      else if (t.id === "pb-img" && t.files && t.files[0]) {
        var img = new Image(), url = URL.createObjectURL(t.files[0]);
        img.onload = function(){ var r = coloursFromImage(img); URL.revokeObjectURL(url); if (!r) { $("pb-msg").textContent = "That image has too few solid pixels."; return; } st.a = r.a; if (r.b) { st.b = r.b; st.useB = true; } st.editing = null; st.label = ""; sync(); $("pb-msg").textContent = "Colours taken from the image."; };
        img.onerror = function(){ $("pb-msg").textContent = "Couldn't read that image."; };
        img.src = url; t.value = "";
      }
    };
    var onKey = function(e){ if (!document.body.contains(root)) return document.removeEventListener("keydown", onKey); var tg = e.target; if (e.code === "Space" && !(tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT" || tg.tagName === "BUTTON"))) { e.preventDefault(); shuffle(); } };
    document.addEventListener("keydown", onKey);
    drawMine(); sync();
  }
"""
edit("ui.js", "  // ---------- site colours (one theme for every RB site)\n", JS.lstrip("\n") + "\n  // ---------- site colours (one theme for every RB site)\n")
print("rb-command: palette builder patched")
