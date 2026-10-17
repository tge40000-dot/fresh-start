"""Put RB Flow (src/rb-flow.js: the Create → Own → Elevate steps and the houses switcher) into /radio/embed.js (rb-radio).

Usage: python3 -I patch_radio_flow.py <pulled rb-radio dir>

embed.js is the radio bar every RB site already loads, so any page can show the steps with a placeholder:
<div data-rb-flow="license"></div>. Nothing shows on a page without a placeholder, and RB Flow never draws on RB TV.
The block is appended to the end of embed.js and replaced in place on later runs, so running it twice changes nothing.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
p = pathlib.Path(sys.argv[1]) / "index.js"
s = p.read_text(encoding="utf-8")
m = re.search(r'const EMBED_JS = ("(?:[^"\\]|\\.)*");', s)
if not m:
    raise SystemExit("rb-radio: EMBED_JS not found")
js = json.loads(m.group(1))
flow = (HERE / "src" / "rb-flow.js").read_text(encoding="utf-8")
MARK = "/* RB Flow:"
base = js[: js.index(MARK)].rstrip("\n") if MARK in js else js.rstrip("\n")
out = base + "\n" + flow
if out == js:
    print("rb-radio: RB Flow already in place")
else:
    s = s[: m.start(1)] + json.dumps(out, ensure_ascii=False) + s[m.end(1):]
    p.write_text(s, encoding="utf-8")
    print("rb-radio: RB Flow added to embed.js")
