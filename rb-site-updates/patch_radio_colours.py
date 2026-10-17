"""Every site palette (the 26 presets and the palette builder's custom ones) restyles all of RB Radio.

Usage: python3 -I patch_radio_colours.py <pulled worker dir>
  any copy of theme.js (rb-radio, rb-public-content, rb-command, artist-router): the radio page's own colours follow
      the palette: console, cards, cover art placeholders, list borders, form fields and button text, which were
      hard-coded plum. Same edit in every copy, so the copies stay identical.
  rb-radio: the radio bar repaints when any colour of the palette changes, not only when its name changes (editing a
      custom palette keeps its name). RB Flow's colours come from rb-site-updates/src/rb-flow.js (run patch_radio_flow.py).
  rb-radio-hub: the call-in page, the friend pages and the hub console load the site's RB Radio colours
      (/api/content/theme.css?site=radio); the friend page's CSP allows that one same-site stylesheet.
Running it twice changes nothing.
"""
import json
import pathlib
import re
import sys

folder = pathlib.Path(sys.argv[1])
changed = []


def rep(s, old, new, what, name):
    if new in s:
        return s
    if s.count(old) != 1:
        raise SystemExit(f"{folder.name}/{name}: {what}: anchor found {s.count(old)} times")
    changed.append(what)
    return s.replace(old, new)


tj = folder / "theme.js"
if tj.exists() and "  radio: (p, t) => `body{" in tj.read_text(encoding="utf-8"):  # artist-router's older copy has no radio rules
    s = tj.read_text(encoding="utf-8")
    s = rep(s, "  radio: (p, t) => `body{background:radial-gradient(1200px 600px at 80% -10%,${rgba(t.accent, 0.12)},transparent 60%),var(--bg)!important}\\n`,\n",
            "  radio: (p, t) => `body{background:radial-gradient(1200px 600px at 80% -10%,${rgba(t.accent, 0.12)},transparent 60%),var(--bg)!important}`\n"
            "    + `.console{background:linear-gradient(160deg,${t.panel},${rgba(p.void, 0.7)})!important}`\n"
            "    + `.art,.list img,.list .ph{background:linear-gradient(135deg,${p.mid},${p.void})!important}`\n"
            "    + `.card{background:${rgba(t.panel, 0.55)}!important}`\n"
            "    + `.list li,.replays li{border-top-color:${rgba(t.line2, 0.6)}!important}`\n"
            "    + `.form input,.form select,.form textarea,.stream code{background:${t.bg2}!important}`\n"
            "    + `.big,.call,.tabs button[aria-selected=true]{color:${p.void}!important}\\n`,\n",
            "radio page colours", "theme.js")
    tj.write_text(s, encoding="utf-8")

ix = folder / "index.js"
if ix.exists():
    s = ix.read_text(encoding="utf-8")
    if "const EMBED_JS = " in s:  # rb-radio
        s = rep(s, 'var th = s.theme, tk = th ? th.key : \\"\\";', 'var th = s.theme, tk = th ? JSON.stringify(th) : \\"\\";', "radio bar repaint", "index.js")
        ix.write_text(s, encoding="utf-8")

assets = folder / "assets.js"
if assets.exists() and "export const CALL_HTML" in assets.read_text(encoding="utf-8"):  # rb-radio-hub
    a = assets.read_text(encoding="utf-8")
    link = '<link rel=\\"stylesheet\\" href=\\"/api/content/theme.css?site=radio\\">\\n</head>'
    n = a.count("</head>") - a.count(link)
    if n:
        a = re.sub(r'(?<!site=radio\\">\\n)</head>', lambda m: link, a)
        changed.append(f"theme link on {n} hub page(s)")
    assets.write_text(a, encoding="utf-8")
    fr = folder / "friends.js"
    s = fr.read_text(encoding="utf-8")
    s = rep(s, "style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https: data:; connect-src 'self';",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https: data:; connect-src 'self';",
            "friend page CSP", "friends.js")
    fr.write_text(s, encoding="utf-8")

print(f"{folder.name}: " + (", ".join(changed) + " updated" if changed else "radio colours already in place"))
