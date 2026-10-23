"""RB Studio luxe (rb-daw, studio.relentlessbillionaire.com and /record): the RB editorial look and precise values.

Usage: python3 -I patch_daw_luxe.py <pulled rb-daw dir>      (after patch_daw_plugins.py and patch_daw_record_fix.py)

1. A value at the end of every slider, in real units: volume in dB (from the gain), pan as L/C/R, EQ and thresholds
   in dB, sends and amounts in %, frequencies in Hz/kHz, bits, sample-rate divider. Type a value and press Enter, use
   the arrow keys (Shift for x10), or drag up/down on the value. Shift-drag a slider moves it a tenth as far; double-
   click or Alt-click a slider resets it to its default. Every change goes through the slider's own events, so undo,
   saving, live audio and exports behave exactly as with a normal drag. Code: src/daw-luxe/luxe.js.
2. The look: Bodoni Moda for the song title and section titles, Manrope for the interface, JetBrains Mono for numbers;
   pill buttons with hairline borders, a glass position display, even mixer strips, segmented meters, sliders that
   fill from zero (from the centre for pan and EQ). Same layout and features. All colours are the site palette
   variables, so RB Command's palettes still restyle it. Code: src/daw-luxe/luxe.css. The fonts load from Google
   Fonts, which the page's CSP already allows.
BUILD is re-hashed the same way the other rb-daw patches do it. Running it twice changes nothing.
"""
import hashlib
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "src" / "daw-luxe"
folder = pathlib.Path(sys.argv[1])
p = folder / "assets.js"
s = p.read_text(encoding="utf-8")
PH = "__RB_BUILD__"

bm = re.findall(r'^export const BUILD = "([0-9a-f]{6,40})";$', s, re.M)
if len(bm) != 1:
    raise SystemExit(f"rb-daw: expected one BUILD, found {len(bm)}")
old_build = bm[0]
key = "export const ASSETS = "
if s.count(key) != 1 or not s.endswith(";\n"):
    raise SystemExit("rb-daw: ASSETS literal not where expected")
head, body = s.split(key)
assets = json.loads(body[:-2])
main = assets["main.js"]["body"].replace(f".js?v={old_build}", f".js?v={PH}")
css = assets["daw.css"]["body"]
log = []

BEGIN, END = "/* RB studio luxe begin */", "/* RB studio luxe end */"


def region(text, src, anchor, label):
    """Insert (or refresh) src between this patch's markers, placed before anchor (or at the end if anchor is None)."""
    code = BEGIN + "\n" + src.strip() + "\n" + END + "\n"
    if BEGIN in text:
        a, rest = text.split(BEGIN, 1)
        _, b = rest.split(END + "\n", 1)
        new = a + code + b
        return new, ("refreshed " + label) if new != text else ""
    if anchor is None:
        return text + "\n" + code, "applied " + label
    if text.count(anchor) != 1:
        raise SystemExit(f"rb-daw: {label}: anchor found {text.count(anchor)} times: {anchor[:60]!r}")
    return text.replace(anchor, code + anchor), "applied " + label


def edit(text, old, new, label):
    if new in text:
        return text, ""
    if text.count(old) != 1:
        raise SystemExit(f"rb-daw: {label}: anchor found {text.count(old)} times: {old[:60]!r}")
    return text.replace(old, new), "applied " + label


main, m1 = region(main, (SRC / "luxe.js").read_text(encoding="utf-8"), "function Vn(t,e){", "value readouts")
main, m2 = edit(main, "function qa(){rbSplit(),", "function qa(){rbSplit(),rbLuxe(),", "readout wiring")
main, m5 = edit(main, 't("Esc","Deselect the clip"),',
              't("Esc","Deselect the clip"),t("Enter \\u2191 \\u2193","In a value box: type a value and press Enter, or step with the arrows (Shift for \\xD710). Drag up or down on it to scrub."),'
              't("Shift-drag","Move a slider a tenth as far, for fine adjustments"),t("Double-click","Reset a slider to its default (or Alt-click)"),', "shortcut help")
css, m3 = region(css, (SRC / "luxe.css").read_text(encoding="utf-8"), None, "luxe css")
FONTS = ('<link rel=\\"preconnect\\" href=\\"https://fonts.googleapis.com\\"><link rel=\\"preconnect\\" href=\\"https://fonts.gstatic.com\\" crossorigin>'
         '<link rel=\\"stylesheet\\" href=\\"https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,500;0,600;1,500'
         '&family=JetBrains+Mono:wght@500&family=Manrope:wght@400;500;600;700&display=swap\\">\\n')
CSS_LINK = '<link rel=\\"stylesheet\\" href=\\"daw/assets/daw.css?v={{BUILD}}\\">'
head, m4 = edit(head, CSS_LINK, FONTS + CSS_LINK, "house fonts")
log += [m for m in (m1, m2, m3, m4, m5) if m]

assets["main.js"]["body"] = main
assets["daw.css"]["body"] = css
# BUILD = hash of every asset (with the placeholder) and the shell, exactly as patch_daw_plugins.py computes it.
shell = head.split("\n", 2)[2]
h = hashlib.sha256((shell + json.dumps(assets, sort_keys=True)).encode()).hexdigest()[:12]
assets["main.js"]["body"] = main.replace(PH, h)
if PH in json.dumps(assets) or PH in head:
    raise SystemExit("rb-daw: build placeholder left behind")
new_head = head.replace(f'export const BUILD = "{old_build}";', f'export const BUILD = "{h}";')
out = new_head + key + json.dumps(assets, separators=(",", ":")) + ";\n"
if out != s:
    p.write_text(out, encoding="utf-8")
    for m in log:
        print("rb-daw:", m)
    print(f"rb-daw: BUILD {old_build} -> {h}")
else:
    print(f"rb-daw: luxe already in place (BUILD {h})")
