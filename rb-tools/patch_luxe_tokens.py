"""Lock the Dark Luxury tokens into every copy of the RB palette code, so the theme changer and the palette builder feed them.

Usage: python3 -I patch_luxe_tokens.py <pulled Worker dir> [more dirs...]
       (rb-public-content, rb-command, rb-radio, artist-router; run after palettes.py and patch_theme_custom.py)

In each folder it
- adds the "Dark Luxury" palette (key `luxe`) as the first card, before Black & Gold, in every palette table
  (theme.js, and artist-router's own THEMES), and to every list of palette keys (RB Command's blocks.js, tables.js, ui.js);
- appends rb-tools/luxe_tokens.js to theme.js (luxTokens, luxCss, LUXE_LOCK);
- makes siteCss() add the --lux-* tokens to every site's stylesheet when a theme is chosen (with !important for the
  sites whose own sheet comes later, like their other variables). No theme chosen: nothing changes.
Choosing Dark Luxury is still the owner's call in RB Command > Site colours; this only makes it available everywhere.
Running it twice changes nothing.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
BLOCK = (HERE / "luxe_tokens.js").read_text(encoding="utf-8")
MARK = "// ---------------------------------------------------------------- luxury tokens (Dark Luxury lock"
# void/dark/a1/a2/a2b/cream are the locked values. mid and light are chosen so tones() gives exactly the locked line
# (#2A261C) and muted text (#A89F8C); deep is the locked --lux-gold-deep. a1s is a lighter crimson for highlights.
LUXE = ('luxe: { label: "Dark Luxury", void: "#05040A", dark: "#0C0A10", mid: "#3E3924", light: "#4A3C1E", '
        'a1: "#C41E3A", a1s: "#E8889A", a2: "#D4AF37", a2b: "#F5E6C8", cream: "#F5F0E6", deep: "#8B6914" },')
BLACKGOLD = re.compile(r'^(?P<indent>[ \t]*)blackgold: \{ label: "Black & Gold",', re.M)
KEYLIST = re.compile(r'(\[|new Set\(\[)"blackgold", "gold", ')

NEW_RET = ('  return (list.length ? `:root{${list.map(([k, v]) => `${k}:${v}${imp}`).join(";")}}\\n` : "") + '
           '(Object.hasOwn(EXTRA, site) ? EXTRA[site](p, t) : "") + luxCss(p, imp);\n')
OLD_RET = ('  return (list.length ? `:root{${list.map(([k, v]) => `${k}:${v}${imp}`).join(";")}}\\n` : "") + '
           '(Object.hasOwn(EXTRA, site) ? EXTRA[site](p, t) : "");\n')
# artist-router's older copy of siteCss
NEW_RET_AR = '  return `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}\\n` + luxCss(p);\n'
OLD_RET_AR = '  return `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}\\n`;\n'
CLEAN_OLD = ('  for (const k of PKEYS) { if (typeof p[k] !== "string" || !HEXRE.test(p[k])) return null; out[k] = p[k].toUpperCase(); }\n'
             '  return out;\n')
CLEAN_NEW = ('  for (const k of PKEYS) { if (typeof p[k] !== "string" || !HEXRE.test(p[k])) return null; out[k] = p[k].toUpperCase(); }\n'
             '  if (typeof p.deep === "string" && HEXRE.test(p.deep)) out.deep = p.deep.toUpperCase();\n'
             '  return out;\n')


def patch_text(name, s):
    changed = []
    if 'luxe: { label: "Dark Luxury"' not in s:
        s, n = BLACKGOLD.subn(lambda m: m.group("indent") + LUXE + "\n" + m.group(0), s)
        if n:
            changed.append(f"palette x{n}")
    if '"luxe", "blackgold", "gold", ' not in s:
        s, n = KEYLIST.subn(lambda m: m.group(1) + '"luxe", "blackgold", "gold", ', s)
        if n:
            changed.append(f"key list x{n}")
    if name == "theme.js":
        if MARK not in s:
            s = s.rstrip("\n") + "\n" + BLOCK
            changed.append("token block")
        for old, new in ((OLD_RET, NEW_RET), (OLD_RET_AR, NEW_RET_AR)):
            if new in s:
                break
            if s.count(old) == 1:
                s = s.replace(old, new)
                changed.append("siteCss tokens")
                break
        else:
            raise SystemExit("theme.js: siteCss return line not found")
        # a palette may carry its own --lux-gold-deep (Dark Luxury does); keep it through the builder's clean-up
        if "export function cleanPalette" in s and CLEAN_NEW not in s:
            if s.count(CLEAN_OLD) != 1:
                raise SystemExit("theme.js: cleanPalette anchor")
            s = s.replace(CLEAN_OLD, CLEAN_NEW)
            changed.append("cleanPalette keeps deep")
        s = re.sub(r"/\*\* The (\d+) palettes", lambda m: "/** Dark Luxury (locked 28 Oct 2026) and the " + m.group(1) + " palettes", s, count=1) \
            if "Dark Luxury (locked" not in s else s
    return s, changed


def main(dirs):
    for arg in dirs:
        d = pathlib.Path(arg)
        if not (d / "theme.js").exists():
            raise SystemExit(f"{d}: no theme.js (not a Worker with the palette code)")
        done = []
        for f in sorted(d.glob("*.js")):
            s = f.read_text(encoding="utf-8")
            if "blackgold" not in s and f.name != "theme.js":
                continue
            s2, changed = patch_text(f.name, s)
            if s2 != s:
                f.write_text(s2, encoding="utf-8")
                done.append(f"{f.name} ({', '.join(changed)})")
        print(f"{d.name}: luxe tokens " + ("added: " + "; ".join(done) if done else "already in place"))


if __name__ == "__main__":
    main(sys.argv[1:])
