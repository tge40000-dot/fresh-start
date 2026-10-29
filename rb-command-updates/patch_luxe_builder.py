"""RB Command: the palette builder shows the Dark Luxury tokens, and the loading skeletons go gold.

Usage: python3 -I patch_luxe_builder.py <pulled rb-command dir>
       (after rb-tools/patch_theme_custom.py, rb-tools/patch_luxe_tokens.py, patch_palette_builder.py and patch_signal.py)

- POST /api/site-theme/check also returns `lux`: the nine --lux-* tokens the palette gives every site.
- Site colours > Build your own shows them as a labelled token strip under the swatches, so what the builder makes is
  seen in the same names every site uses. The builder now starts from the locked gold (#D4AF37) and crimson (#C41E3A).
- The Live signal skeletons (.skel) take the refined gold sheen of the sites' .rb-skel, and still stop with reduced motion.
Each anchor must match exactly once; running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
changed = []


def edit(name, old, new, what):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"rb-command/{name}: {what}: anchor found {s.count(old)} times")
    p.write_text(s.replace(old, new), encoding="utf-8")
    changed.append(what)


if "export function luxTokens" not in (folder / "theme.js").read_text(encoding="utf-8"):
    raise SystemExit("rb-command/theme.js has no luxury tokens yet: run rb-tools/patch_luxe_tokens.py first")

edit("sitetheme.js", 'paletteList, tones, PALETTES, checkPalette, cleanPalette, CUSTOM_KEY } from "./theme.js";\n',
     'paletteList, tones, PALETTES, checkPalette, cleanPalette, CUSTOM_KEY, luxTokens } from "./theme.js";\n', "import")
edit("sitetheme.js", "  return { ...r, palette: c, preview: { bg: t.bg, panel: t.panel2, text: t.text, muted: t.muted, accent: t.accent, hot: t.hot, line: t.line2 } };\n",
     "  return { ...r, palette: c, lux: luxTokens(c), preview: { bg: t.bg, panel: t.panel2, text: t.text, muted: t.muted, accent: t.accent, hot: t.hot, line: t.line2 } };\n",
     "check returns tokens")

edit("ui.js", 'var st = { a: "#C9A227", b: "#C0392B",', 'var st = { a: "#D4AF37", b: "#C41E3A",', "builder starts from the lock")
edit("ui.js", "'<div class=\"pbsw\" id=\"pb-sw\"></div><ul class=\"pbck\" id=\"pb-ck\"></ul></div></div></div>' +",
     "'<div class=\"pbsw\" id=\"pb-sw\"></div><div class=\"pblux\" id=\"pb-lux\" aria-label=\"Luxury tokens this palette gives every site\"></div><ul class=\"pbck\" id=\"pb-ck\"></ul></div></div></div>' +",
     "token strip")
edit("ui.js", "          if (r.preview) paint(r.preview);\n",
     "          if (r.preview) paint(r.preview);\n"
     "          if (r.lux && $(\"pb-lux\")) {\n"
     "            var LUXK = [\"bg\", \"bg-elevated\", \"gold\", \"gold-highlight\", \"gold-deep\", \"crimson\", \"text\", \"text-muted\", \"line\"];\n"
     "            $(\"pb-lux\").innerHTML = LUXK.map(function(k){ return '<span title=\"--lux-' + k + ' ' + esc(r.lux[k]) + '\"><i data-bg=\"' + esc(r.lux[k]) + '\"></i>' + esc(k) + '</span>'; }).join(\"\");\n"
     "            $(\"pb-lux\").querySelectorAll(\"[data-bg]\").forEach(function(n){ n.style.background = n.dataset.bg; });\n"
     "          }\n",
     "token strip render")
CSS = (
    ".pblux{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:4px 8px;margin-top:8px;font-size:.68rem;color:var(--muted);letter-spacing:.04em}\n"
    ".pblux span{display:flex;align-items:center;gap:5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pblux i{flex:none;width:12px;height:12px;border-radius:3px;border:1px solid rgba(255,255,255,.1)}\n"
    "/* gold skeletons (28 Oct 2026), the same sheen as the sites' .rb-skel */\n"
    ".skel.skel{border:1px solid var(--line);background-color:var(--panel2,#0C0A10);background-image:linear-gradient(100deg,transparent 0 35%,color-mix(in srgb,var(--brass,#D4AF37) 14%,transparent) 46%,color-mix(in srgb,var(--brass2,#F5E6C8) 22%,transparent) 50%,color-mix(in srgb,var(--brass,#D4AF37) 14%,transparent) 54%,transparent 65% 100%);"
    "background-size:260% 100%;background-repeat:no-repeat;background-position:110% 0;border-radius:8px;animation:skelgold 1.8s cubic-bezier(.45,0,.25,1) infinite}\n"
    "@keyframes skelgold{from{background-position:110% 0}to{background-position:-10% 0}}@media (prefers-reduced-motion:reduce){.skel.skel{animation:none}}\n"
)
edit("ui.js", "@media (max-width:900px){.pb{grid-template-columns:1fr}}\n", "@media (max-width:900px){.pb{grid-template-columns:1fr}}\n" + CSS, "styles")
print("rb-command: luxe builder " + (", ".join(changed) + " updated" if changed else "already in place"))
