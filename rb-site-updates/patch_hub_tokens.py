"""The homepage hub follows the Dark Luxury lock (artist-router, code only). Run after rb-tools/patch_luxe_tokens.py.

Usage: python3 -I patch_hub_tokens.py <pulled artist-router dir>

The hub (RB_HUB_CSS: the homepage and /intake) has its own locked brand: void, ink, gold, champagne, paper, mute and
signal red, in :root variables. Many rules repeated those colours as literals (rgba(198,161,91,.5), #070708, ...), so
changing a variable never reached them. This
- turns each such literal into the same colour through its variable: rgba(198,161,91,.5) becomes
  color-mix(in srgb,var(--rb-gold) 50%,transparent), which is exactly the same colour. With the hub's own values
  nothing on the page changes;
- adds rbHubLux(): when RB Command > Site colours has Dark Luxury for the homepage, the hub's variables (and the
  --lux-* tokens) take the locked set: #05040A, #0C0A10, #D4AF37, #F5E6C8, #F5F0E6, #A89F8C, #C41E3A. Under any other
  palette, or none, the hub keeps its own brand exactly as before (it ignores other palettes today too).
Running it twice changes nothing.
"""
import json
import pathlib
import re
import sys

folder = pathlib.Path(sys.argv[1])
p = folder / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")
changed = []

# ---------------------------------------------------------------- the hub stylesheet: literals -> variables
HEAD = "var RB_HUB_CSS = "
i = s.find(HEAD)
if i < 0 or s.count(HEAD) != 1:
    raise SystemExit("artist-router: RB_HUB_CSS not found exactly once")
css, n = json.JSONDecoder().raw_decode(s[i + len(HEAD):])
lit_end = i + len(HEAD) + n
VARS = {(7, 7, 8): "--rb-void", (16, 17, 20): "--rb-ink", (198, 161, 91): "--rb-gold", (231, 215, 177): "--rb-champagne",
        (244, 241, 234): "--rb-paper", (225, 6, 0): "--rb-signal"}
HEXES = {"#070708": "--rb-void", "#101114": "--rb-ink", "#C6A15B": "--rb-gold", "#E7D7B1": "--rb-champagne",
         "#F4F1EA": "--rb-paper", "#A8A196": "--rb-mute", "#E10600": "--rb-signal"}
root_end = css.index("}", css.index(":root{")) + 1
root, rest = css[:root_end], css[root_end:]


def rgba(m):
    rgb = tuple(int(x) for x in m.group(1, 2, 3))
    if rgb not in VARS:
        return m.group(0)
    a = float(m.group(4))
    pct = ("%g" % (a * 100))
    return f"color-mix(in srgb,var({VARS[rgb]}) {pct}%,transparent)"


new_rest = re.sub(r"rgba\((\d+),(\d+),(\d+),(\.?\d*\.?\d+)\)", rgba, rest)
for h, v in HEXES.items():
    new_rest = re.sub(re.escape(h) + r"\b", f"var({v})", new_rest, flags=re.I)
# the root's own derived lines (--rb-line, --rb-soft) follow their colours too
new_root = root.replace("--rb-line:rgba(198,161,91,.26)", "--rb-line:color-mix(in srgb,var(--rb-gold) 26%,transparent)") \
               .replace("--rb-soft:rgba(244,241,234,.09)", "--rb-soft:color-mix(in srgb,var(--rb-paper) 9%,transparent)")
new_css = new_root + new_rest
if new_css != css:
    s = s[:i] + HEAD + json.dumps(new_css) + s[lit_end:]
    changed.append("hub colours through variables")

# ---------------------------------------------------------------- Dark Luxury for the hub
FN = "// ---------------------------------------------------------------- hub follows Dark Luxury (patch_hub_tokens.py)\n"
fn = FN + (
    "function rbHubLux() {\n"
    "  const key = SITE_THEME ? themeFor(SITE_THEME, \"home\") : null;\n"
    "  if (key !== \"luxe\" || !PALETTES.luxe) return \"\";\n"
    "  const L = luxTokens(PALETTES.luxe);\n"
    "  return `:root{--rb-void:${L.bg};--rb-ink:${L[\"bg-elevated\"]};--rb-gold:${L.gold};--rb-champagne:${L[\"gold-highlight\"]};--rb-paper:${L.text};`\n"
    "    + `--rb-mute:${L[\"text-muted\"]};--rb-signal:${L.crimson}}\\n` + luxCss(PALETTES.luxe);\n"
    "}\n")
ANCHOR = "function rbTheme(fallback) {\n"
if FN not in s:
    if s.count(ANCHOR) != 1:
        raise SystemExit("artist-router: rbTheme anchor")
    s = s.replace(ANCHOR, fn + ANCHOR)
    changed.append("rbHubLux")
OLD_IMP = 'import { parseSetting, themeFor, PALETTES } from "./theme.js";\n'
NEW_IMP = 'import { parseSetting, themeFor, PALETTES, luxTokens, luxCss } from "./theme.js";\n'
if NEW_IMP not in s:
    if s.count(OLD_IMP) != 1:
        raise SystemExit("artist-router: theme.js import anchor")
    s = s.replace(OLD_IMP, NEW_IMP)
    changed.append("import")
# after the hub stylesheet on every page that uses it (homepage and /intake)
n_use = s.count("${RB_HUB_CSS}\n")
s2 = s.replace("${RB_HUB_CSS}\n${rbHubLux()}\n", "${RB_HUB_CSS}\n").replace("${RB_HUB_CSS}\n", "${RB_HUB_CSS}\n${rbHubLux()}\n")
if s2 != s:
    if "${rbHubLux()}" not in s:
        changed.append(f"pages x{n_use}")
    s = s2
if n_use < 1:
    raise SystemExit("artist-router: no page uses RB_HUB_CSS")
p.write_text(s, encoding="utf-8")
print("artist-router: hub tokens " + (", ".join(changed) + " updated" if changed else "already in place"))
